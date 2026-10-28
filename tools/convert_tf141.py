"""Convert the "Smoky's CT Afgan Force" Source player models into a web-ready TF141 kit.

    python tools/convert_tf141.py "assets-src/Smoky's_CT_Afgan_Force" public/models/tf141

Output (same layout as tools/convert_opfor.py, which this reuses for re-posing,
texture decoding and glTF writing):
  tf141.glb          one "body-<model>" mesh per character, skinned to the game's 17-bone rig
  tf141_albedo.jpg   all colour maps packed in one atlas
  tf141_normal.jpg   matching tangent-space normal atlas (OpenGL / +Y convention)

The CS:S-style models use the ValveBiped rig ("ValveBiped.Bip01_L_Thigh", ...). Bone names
are rewritten to the Insurgency spelling convert_opfor.build_repose understands; the model
space axes (+X left, -Y forward, +Z up) already match.
"""
from __future__ import annotations

import os
import re
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
import convert_opfor as co  # noqa: E402
import source_mdl  # noqa: E402

MODELS = ["ct_sas", "ct_gign", "ct_gsg9", "ct_urban"]
# Largest tile edge in the atlas. The source maps are up to 2048²; 1024 keeps the
# whole kit in one 4096² atlas, which is plenty at third-person distances.
MAX_TILE = 1024

# ValveBiped -> Insurgency bone names (only the ones whose spelling differs).
RENAME = {"Spine4": "Spine3", "Neck1": "Neck", "Head1": "Head",
          # The wrist helper sits exactly on the hand joint and should follow the hand.
          "Wrist": "Hand"}


def insurgency_name(name: str) -> str:
    rest = name.removeprefix("ValveBiped.").removeprefix("Bip01_")
    side = ""
    if rest[:2] in ("L_", "R_"):
        side, rest = rest[0] + " ", rest[2:]
    return side + RENAME.get(rest, rest)


def load_model(model_dir: str, stem: str) -> source_mdl.StudioModel:
    sm = source_mdl.load(os.path.join(model_dir, stem))
    for b in sm.bones:
        b.name = insurgency_name(b.name)
    return sm


class Materials:
    """Case-insensitive view of the pack's materials/ folder (Source paths ignore case)."""

    def __init__(self, root: str):
        self.files: dict[str, str] = {}
        for dirpath, _dirs, names in os.walk(os.path.join(root, "materials")):
            for n in names:
                full = os.path.join(dirpath, n)
                rel = os.path.relpath(full, root).replace("\\", "/").lower()
                self.files[rel] = full

    def read(self, rel: str) -> bytes | None:
        path = self.files.get(rel.lower().replace("\\", "/"))
        if not path:
            return None
        with open(path, "rb") as f:
            return f.read()

    def vmt(self, material_dirs: list[str], material: str) -> tuple[str, str | None] | None:
        for d in material_dirs:
            buf = self.read(f"materials/{d}{material}.vmt")
            if buf is None:
                continue
            text = buf.decode("latin-1")

            def key(k):
                m = re.search(rf'"?\${k}"?\s+"?([^"\r\n]+)"?', text, re.I)
                return m.group(1).strip().lower().replace("\\", "/") if m else None

            return key("basetexture"), key("bumpmap")
        return None


def unwrap_uvs(sm: source_mdl.StudioModel) -> None:
    """These models carry UVs offset by whole tiles (v in 2..5, a few u near 148). Source
    samples with wrap so that's invisible there, but the atlas needs each mesh in [0, 1]:
    shift every mesh by the integer tile its median sits in, then wrap any stragglers."""
    for bp in sm.body_parts:
        for model in bp.models:
            for mesh in model.meshes:
                idx = sorted(set(mesh.tris))
                if not idx:
                    continue
                uv = np.array([sm.vertices[i].uv for i in idx])
                off = np.floor(np.median(uv, axis=0))
                for i, (u, v) in zip(idx, uv - off):
                    if not 0 <= u <= 1:
                        u -= np.floor(u)
                    if not 0 <= v <= 1:
                        v -= np.floor(v)
                    sm.vertices[i].uv = (float(u), float(v))


def drop_meshes(sm: source_mdl.StudioModel, keep: set[int]) -> None:
    for bp in sm.body_parts:
        for model in bp.models:
            model.meshes = [m for m in model.meshes if sm.skins[0][m.material] in keep]


def main(src: str, out_dir: str) -> None:
    model_dir = os.path.join(src, "models", "player")
    mats = Materials(src)

    parts: list[co.Part] = []
    resolved: dict[str, tuple[str, str | None]] = {}
    for stem in MODELS:
        sm = load_model(model_dir, stem)
        rp = co.build_repose(sm)
        keep = set()
        for i, name in enumerate(sm.materials):
            info = mats.vmt(sm.material_dirs, name)
            if info and info[0]:
                resolved[name] = info
                keep.add(i)
            else:
                print(f"[{stem}] dropping meshes using missing material {name!r}")
        drop_meshes(sm, keep)
        unwrap_uvs(sm)
        for bp in sm.body_parts:
            for model in bp.models:
                parts.append(co.extract_part(sm, rp, model, sm.materials, stem, "body"))

    # Textures -> atlases.
    tiles: list[co.Tile] = []
    for mat in sorted({t for p in parts for t in p.textures}):
        base, bump = resolved[mat]
        albedo = co.decode_vtf(mats.read(f"materials/{base}.vtf")).convert("RGB")
        nbuf = mats.read(f"materials/{bump}.vtf") if bump else None
        if nbuf:
            r, g, b, _a = co.decode_vtf(nbuf).split()
            normal = Image.merge("RGB", (r, g.point(lambda c: 255 - c), b))  # DirectX -> OpenGL green
        else:
            normal = co.flat_normal(albedo.size)
        scale = min(1.0, MAX_TILE / max(albedo.size))
        size = (max(1, round(albedo.width * scale)), max(1, round(albedo.height * scale)))
        albedo = albedo.resize(size, Image.LANCZOS) if size != albedo.size else albedo
        normal = normal.resize(size, Image.LANCZOS) if normal.size != size else normal
        tiles.append(co.Tile(mat, albedo, normal))

    co.ATLAS_W, co.ATLAS_H = 4096, 4096
    co.pack(tiles)
    used_h = max(t.y + t.albedo.height for t in tiles)
    co.ATLAS_H = 1 << (used_h - 1).bit_length()  # shrink to the smallest power of two that fits
    atlas_a = Image.new("RGB", (co.ATLAS_W, co.ATLAS_H))
    atlas_n = Image.new("RGB", (co.ATLAS_W, co.ATLAS_H), (128, 128, 255))
    atlas_uv = {}
    for t in tiles:
        atlas_a.paste(t.albedo, (t.x, t.y))
        atlas_n.paste(t.normal, (t.x, t.y))
        w, h = t.albedo.size
        atlas_uv[t.key] = (t.x / co.ATLAS_W, t.y / co.ATLAS_H, w / co.ATLAS_W, h / co.ATLAS_H)

    os.makedirs(out_dir, exist_ok=True)
    atlas_a.save(os.path.join(out_dir, "tf141_albedo.jpg"), quality=86, optimize=True)
    atlas_n.save(os.path.join(out_dir, "tf141_normal.jpg"), quality=90, optimize=True)
    co.write_glb(os.path.join(out_dir, "tf141.glb"), parts, atlas_uv, prefix="tf141")

    print(f"atlas {co.ATLAS_W}x{co.ATLAS_H}, {len(tiles)} textures")
    for p in parts:
        lo, hi = p.positions.min(0), p.positions.max(0)
        print(f"{p.category:8s} {p.name:16s} verts {len(p.positions):5d} tris {len(p.indices) // 3:5d}"
              f"  y {lo[1]:.2f}..{hi[1]:.2f}  x {lo[0]:.2f}..{hi[0]:.2f}  z {lo[2]:.2f}..{hi[2]:.2f}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
