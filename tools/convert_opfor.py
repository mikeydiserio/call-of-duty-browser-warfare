"""Convert the "codmw2 - opfor" Source/Insurgency VPK into a web-ready OpFor kit.

    python tools/convert_opfor.py "assets-src/codmw2 - opfor.vpk" public/models/opfor

Output:
  opfor.glb          one mesh per interchangeable part (body / head / kit / glasses / helmet),
                     already skinned to the game's 17-bone soldier rig (src/ai/soldier-model.ts)
  opfor_albedo.jpg   all colour maps packed in one atlas (UVs are remapped into it)
  opfor_normal.jpg   matching tangent-space normal atlas (OpenGL / +Y convention)

The Source models are authored in an A-pose with a 74-bone ValveBiped-style rig. Each
part is re-posed into the game's rest pose (arms straight down, feet on y = 0, facing -Z)
by linear-blend skinning against per-segment transforms, then its weights are folded onto
the game's 17 bones. Joint positions follow REST/DIM in soldier-model.ts.
"""
from __future__ import annotations

import io
import json
import os
import re
import struct
import sys
from dataclasses import dataclass

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
import source_mdl  # noqa: E402
from vpk import read_vpk  # noqa: E402

# ─── Game rig (keep in sync with src/ai/soldier-model.ts) ────────────────────

BONE_ORDER = [
    "pelvis", "spine", "chest", "neck", "head",
    "uarmL", "farmL", "handL", "uarmR", "farmR", "handR",
    "thighL", "shinL", "footL", "thighR", "shinR", "footR",
]
REST_PELVIS_Y = 0.955
REST_NECK_Y = 1.475
DIM_UPPER_ARM = 0.29
DIM_FORE_ARM = 0.27
DIM_THIGH = 0.44

# Source units -> metres. Chosen so the legs match DIM (thigh 19.67u -> 0.44 m).
S = 0.02237
# Source model space is (+X left, -Y forward, +Z up); the game is (+X right, +Y up, -Z forward).
C = np.array([[-1.0, 0, 0], [0, 0, 1.0], [0, 1.0, 0]])
DOWN = np.array([0.0, -1.0, 0.0])

MODELS = ["insurgent_standard", "insurgent_light", "insurgent_heavy", "civilian_vip_insurgent"]
HELMET = "ins_helmet_head"
CATEGORY = {"light": "body", "noarmor": "body", "heavy": "body", "vip_insurgent": "body",
            "backpack": "head", "kit": "kit", "glasses": "glasses", "studio": "helmet"}

ATLAS_W, ATLAS_H = 4096, 2048


# ─── Re-posing ───────────────────────────────────────────────────────────────

def _affine(lin: np.ndarray, src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    """4x4 mapping p -> dst + lin @ (p - src)."""
    a = np.eye(4)
    a[:3, :3] = lin
    a[:3, 3] = dst - lin @ src
    return a


def _arc(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Shortest-arc rotation taking unit vector a onto unit vector b."""
    a = a / np.linalg.norm(a)
    b = b / np.linalg.norm(b)
    v = np.cross(a, b)
    c = float(np.dot(a, b))
    if c < -0.9999:
        raise ValueError("antiparallel bone direction")
    k = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + k + k @ k / (1 + c)


def _stretch(d: np.ndarray, k: float) -> np.ndarray:
    """Uniform S, with an extra factor k along unit axis d."""
    return S * (np.eye(3) + (k - 1) * np.outer(d, d))


def _segment_of(name: str) -> str:
    side = name[0] if name[:2] in ("L ", "R ") else ""
    rest = name[2:] if side else name
    if rest in ("UpperArm",):
        return "uarm" + side
    if rest == "Forearm" or rest.startswith("ForeTwist"):
        return "farm" + side
    if rest == "Hand" or rest.startswith("Finger"):
        return "hand" + side
    if rest == "Thigh":
        return "thigh" + side
    if rest == "Calf":
        return "shin" + side
    if rest in ("Foot", "Toe0"):
        return "foot" + side
    if rest in ("Neck", "Head", "ATTACH_NVG"):
        return "neckhead"
    if rest in ("Bip01", "Pelvis", "Spine", "Spine1", "Spine2", "Spine3", "Clavicle"):
        return "torso"
    return ""


def _game_bone(name: str, seg: str) -> str:
    side = name[0] if name[:2] in ("L ", "R ") else ""
    rest = name[2:] if side else name
    if seg == "torso":
        if rest in ("Bip01", "Pelvis"):
            return "pelvis"
        if rest in ("Spine", "Spine1"):
            return "spine"
        return "chest"  # Spine2, Spine3, clavicles
    if seg == "neckhead":
        return "neck" if rest == "Neck" else "head"
    return seg  # limb segments are named after the game bone


@dataclass
class Repose:
    seg_affine: dict[str, np.ndarray]
    bone_seg: list[str]  # per Source bone
    bone_game: list[int]  # per Source bone -> BONE_ORDER index
    bind: list[np.ndarray]  # per Source bone, bone->model 4x4


def build_repose(sm: source_mdl.StudioModel) -> Repose:
    bind = []
    for b in sm.bones:
        m = np.eye(4)
        m[:3, :] = np.array(b.pose_to_bone).reshape(3, 4)
        bind.append(np.linalg.inv(m))
    J = {b.name: bind[i][:3, 3] for i, b in enumerate(sm.bones)}

    # Segment / game bone per Source bone; unmapped bones inherit from their parent.
    seg: list[str] = []
    game: list[int] = []
    for i, b in enumerate(sm.bones):
        s = _segment_of(b.name)
        if s:
            seg.append(s)
            game.append(BONE_ORDER.index(_game_bone(b.name, s)))
        elif b.parent >= 0:
            seg.append(seg[b.parent])
            game.append(game[b.parent])
        else:
            seg.append("torso")
            game.append(0)

    pelvis = J["Pelvis"]
    neck_h = (C @ (J["Neck"] - pelvis))[1]
    sv = (REST_NECK_Y - REST_PELVIS_Y) / neck_h
    zoff = -0.5 * (C @ (J["Neck"] - pelvis))[2] * S  # centre the torso depth on the rig's z = 0
    torso_lin = np.diag([S, sv, S]) @ C
    torso_dst = np.array([0.0, REST_PELVIS_Y, zoff])
    aff = {"torso": _affine(torso_lin, pelvis, torso_dst)}

    def torso(p):
        return (aff["torso"] @ np.append(p, 1))[:3]

    aff["neckhead"] = _affine(S * C, J["Neck"], torso(J["Neck"]))

    ground = min(v.pos[2] for v in sm.vertices)
    for side in "LR":
        # Arm: hang straight down from the (torso-mapped) shoulder, elbow and wrist on DIM lengths.
        sh, el, wr = J[f"{side} UpperArm"], J[f"{side} Forearm"], J[f"{side} Hand"]
        d_u = C @ (el - sh)
        d_f = C @ (wr - el)
        r_u = _arc(d_u, DOWN)
        r_f = _arc(r_u @ d_f, DOWN) @ r_u
        shoulder = torso(sh)
        elbow = shoulder + DOWN * DIM_UPPER_ARM
        wrist = elbow + DOWN * DIM_FORE_ARM
        aff["uarm" + side] = _affine(r_u @ _stretch(d_u / np.linalg.norm(d_u), DIM_UPPER_ARM / (np.linalg.norm(d_u) * S)) @ C, sh, shoulder)
        aff["farm" + side] = _affine(r_f @ _stretch(d_f / np.linalg.norm(d_f), DIM_FORE_ARM / (np.linalg.norm(d_f) * S)) @ C, el, elbow)
        aff["hand" + side] = _affine(r_f @ (S * C), wr, wrist)

        # Leg: straight down from the hip; ankle height keeps the soles on y = 0.
        hp, kn, an = J[f"{side} Thigh"], J[f"{side} Calf"], J[f"{side} Foot"]
        d_t = C @ (kn - hp)
        d_s = C @ (an - kn)
        r_t = _arc(d_t, DOWN)
        r_s = _arc(r_t @ d_s, DOWN) @ r_t
        hip = torso(hp)
        knee = hip + DOWN * DIM_THIGH
        ankle = np.array([knee[0], (an[2] - ground) * S, knee[2]])
        aff["thigh" + side] = _affine(r_t @ _stretch(d_t / np.linalg.norm(d_t), DIM_THIGH / (np.linalg.norm(d_t) * S)) @ C, hp, hip)
        aff["shin" + side] = _affine(r_s @ _stretch(d_s / np.linalg.norm(d_s), (knee[1] - ankle[1]) / (np.linalg.norm(d_s) * S)) @ C, kn, knee)
        aff["foot" + side] = _affine(S * C, an, ankle)
    return Repose(aff, seg, game, bind)


# ─── Part extraction ─────────────────────────────────────────────────────────

@dataclass
class Part:
    name: str
    category: str
    positions: np.ndarray  # (n, 3)
    normals: np.ndarray
    uvs: np.ndarray
    textures: list[str]  # per vertex: albedo texture key
    joints: np.ndarray  # (n, 4) uint8
    weights: np.ndarray  # (n, 4) float32
    indices: np.ndarray  # (m,) uint32


def extract_part(sm, rp: Repose, model, materials: list[str], name: str, category: str,
                 head_override: np.ndarray | None = None) -> Part:
    # Collect the vertices this sub-model references and re-index them.
    used: dict[int, int] = {}
    vert_mat: list[str] = []
    tris: list[int] = []
    for mesh in model.meshes:
        mat = materials[sm.skins[0][mesh.material]]
        for vi in mesh.tris:
            if vi not in used:
                used[vi] = len(used)
                vert_mat.append(mat)
            tris.append(used[vi])
    n = len(used)
    pos = np.zeros((n, 3))
    nor = np.zeros((n, 3))
    uv = np.zeros((n, 2))
    joints = np.zeros((n, 4), np.uint8)
    weights = np.zeros((n, 4), np.float32)
    seg_lin = {k: a[:3, :3] for k, a in rp.seg_affine.items()}
    seg_nrm = {k: np.linalg.inv(l).T for k, l in seg_lin.items()}
    for vi, j in used.items():
        v = sm.vertices[vi]
        p = np.array(v.pos)
        nr = np.array(v.normal)
        if head_override is not None:
            p = (head_override @ np.append(p, 1))[:3]
            nr = head_override[:3, :3] @ nr
        acc_p = np.zeros(3)
        acc_n = np.zeros(3)
        per_bone: dict[int, float] = {}
        total = 0.0
        for k in range(v.num_bones):
            w = v.weights[k]
            if w <= 0:
                continue
            b = v.bones[k]
            s = rp.bone_seg[b]
            acc_p += w * (rp.seg_affine[s] @ np.append(p, 1))[:3]
            acc_n += w * (seg_nrm[s] @ nr)
            g = rp.bone_game[b]
            per_bone[g] = per_bone.get(g, 0.0) + w
            total += w
        pos[j] = acc_p / total
        nor[j] = acc_n / (np.linalg.norm(acc_n) or 1)
        uv[j] = v.uv
        top = sorted(per_bone.items(), key=lambda kv: -kv[1])[:4]
        tw = sum(w for _, w in top)
        for k, (g, w) in enumerate(top):
            joints[j, k] = g
            weights[j, k] = w / tw
    return Part(name, category, pos, nor, uv, vert_mat, joints, weights, np.array(tris, np.uint32))


# ─── Textures ────────────────────────────────────────────────────────────────

VTF_BLOCK = {13: (8, 1), 14: (16, 2), 15: (16, 3)}  # DXT1/3/5 -> (bytes per 4x4 block, bcn id)


def decode_vtf(buf: bytes) -> Image.Image:
    assert buf[:4] == b"VTF\x00"
    w, h = struct.unpack_from("<HH", buf, 16)
    (fmt,) = struct.unpack_from("<i", buf, 52)
    if fmt in VTF_BLOCK:
        bpb, bcn = VTF_BLOCK[fmt]
        size = max(1, (w + 3) // 4) * max(1, (h + 3) // 4) * bpb
        # Mips are stored smallest-first, so the full-size image is the tail of the file.
        return Image.frombytes("RGBA", (w, h), buf[len(buf) - size:], "bcn", bcn)
    if fmt == 12:  # BGRA8888
        b, g, r, a = Image.frombytes("RGBA", (w, h), buf[len(buf) - w * h * 4:]).split()
        return Image.merge("RGBA", (r, g, b, a))
    raise ValueError(f"unsupported VTF format {fmt}")


def read_vmt(files: dict[str, bytes], material: str) -> tuple[str, str | None]:
    text = files[f"materials/models/player/codmw2/{material}.vmt"].decode("latin-1")

    def key(k):
        m = re.search(rf'\${k}\s+"?([^"\r\n]+)"?', text, re.I)
        return m.group(1).strip().lower().replace("\\", "/") if m else None

    return key("basetexture"), key("bumpmap")


@dataclass
class Tile:
    key: str
    albedo: Image.Image
    normal: Image.Image
    x: int = 0
    y: int = 0


def pack(tiles: list[Tile]) -> None:
    """Shelf packing, tallest first. All textures are power-of-two so this packs tightly."""
    x = y = shelf = 0
    for t in sorted(tiles, key=lambda t: (-t.albedo.height, -t.albedo.width)):
        w, h = t.albedo.size
        if x + w > ATLAS_W:
            x, y = 0, y + shelf
            shelf = 0
        if y + h > ATLAS_H:
            raise ValueError("atlas overflow")
        t.x, t.y = x, y
        x += w
        shelf = max(shelf, h)


def flat_normal(size) -> Image.Image:
    return Image.new("RGB", size, (128, 128, 255))


# ─── glTF writer ─────────────────────────────────────────────────────────────

def write_glb(path: str, parts: list[Part], atlas_uv: dict[str, tuple[float, float, float, float]], prefix: str = "opfor"):
    bin_chunks: list[bytes] = []
    views, accessors, meshes, nodes = [], [], [], []
    offset = 0

    def add(arr: np.ndarray, comp: int, typ: str, target: int | None, minmax=False, normalized=False):
        nonlocal offset
        data = arr.tobytes()
        pad = (-len(data)) % 4
        view = {"buffer": 0, "byteOffset": offset, "byteLength": len(data)}
        if target:
            view["target"] = target
        views.append(view)
        bin_chunks.append(data + b"\x00" * pad)
        offset += len(data) + pad
        acc = {"bufferView": len(views) - 1, "componentType": comp, "count": len(arr), "type": typ}
        if normalized:
            acc["normalized"] = True
        if minmax:
            acc["min"] = arr.min(0).tolist()
            acc["max"] = arr.max(0).tolist()
        accessors.append(acc)
        return len(accessors) - 1

    for p in parts:
        uv = np.array([
            [atlas_uv[t][0] + u * atlas_uv[t][2], atlas_uv[t][1] + v * atlas_uv[t][3]]
            for (u, v), t in zip(p.uvs, p.textures)
        ], np.float32)
        attrs = {
            "POSITION": add(p.positions.astype(np.float32), 5126, "VEC3", 34962, minmax=True),
            "NORMAL": add(p.normals.astype(np.float32), 5126, "VEC3", 34962),
            "TEXCOORD_0": add(uv, 5126, "VEC2", 34962),
            "JOINTS_0": add(p.joints, 5121, "VEC4", 34962),
            "WEIGHTS_0": add(p.weights, 5126, "VEC4", 34962),
        }
        idx = add(p.indices.astype(np.uint16), 5123, "SCALAR", 34963)
        meshes.append({"name": p.name, "primitives": [{"attributes": attrs, "indices": idx, "material": 0}]})
        # "category-name": GLTFLoader strips "/", "." and ":" from node names.
        nodes.append({"name": f"{p.category}-{p.name}", "mesh": len(meshes) - 1})

    doc = {
        "asset": {"version": "2.0", "generator": f"tools/convert_{prefix}.py"},
        "scene": 0,
        "scenes": [{"nodes": list(range(len(nodes)))}],
        "nodes": nodes,
        "meshes": meshes,
        "materials": [{
            "name": prefix,
            "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicFactor": 0, "roughnessFactor": 0.78},
            "normalTexture": {"index": 1},
        }],
        "textures": [{"source": 0, "sampler": 0}, {"source": 1, "sampler": 0}],
        "images": [{"uri": f"{prefix}_albedo.jpg"}, {"uri": f"{prefix}_normal.jpg"}],
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}],
        "buffers": [{"byteLength": offset}],
        "bufferViews": views,
        "accessors": accessors,
    }
    js = json.dumps(doc, separators=(",", ":")).encode()
    js += b" " * ((-len(js)) % 4)
    bin_data = b"".join(bin_chunks)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_data)))
        f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(bin_data), 0x004E4942) + bin_data)


# ─── Main ────────────────────────────────────────────────────────────────────

def main(vpk_path: str, out_dir: str) -> None:
    files = read_vpk(vpk_path)

    def studio(stem: str):
        base = f"models/characters/{stem}"
        return source_mdl.parse(files[base + ".mdl"], files[base + ".vvd"], files[base + ".dx90.vtx"])

    parts: list[Part] = []
    seen: set[str] = set()
    reference = None
    for stem in MODELS:
        sm = studio(stem)
        rp = build_repose(sm)
        reference = reference or (sm, rp)
        for bp in sm.body_parts:
            for model in bp.models:
                name = model.name.removesuffix(".smd")
                if not name or name in seen:
                    continue
                seen.add(name)
                parts.append(extract_part(sm, rp, model, sm.materials, name, CATEGORY[bp.name]))

    # The helmet is bone-merged onto the head: bring it into the reference body's head frame first.
    helmet = studio(HELMET)
    ref_sm, ref_rp = reference
    head_i = next(i for i, b in enumerate(ref_sm.bones) if b.name == "Head")
    h_bind = np.linalg.inv(np.vstack([np.array(helmet.bones[0].pose_to_bone).reshape(3, 4), [0, 0, 0, 1]]))
    to_ref = ref_rp.bind[head_i] @ np.linalg.inv(h_bind)
    # Helmet vertices, reference rig's segment transforms; its single "Head" bone -> neckhead.
    helmet_rp = Repose(ref_rp.seg_affine, ["neckhead"], [BONE_ORDER.index("head")], [h_bind])
    parts.append(extract_part(helmet, helmet_rp, helmet.body_parts[0].models[0], helmet.materials,
                              "ARAB_HELMET", "helmet", head_override=to_ref))

    # Textures -> atlases.
    materials = sorted({t for p in parts for t in p.textures})
    tiles: list[Tile] = []
    for mat in materials:
        base, bump = read_vmt(files, mat)
        albedo = decode_vtf(files[f"materials/{base}.vtf"]).convert("RGB")
        nkey = f"materials/{bump}.vtf" if bump else None
        if nkey and nkey in files:
            r, g, b, _a = decode_vtf(files[nkey]).split()
            normal = Image.merge("RGB", (r, g.point(lambda c: 255 - c), b))  # DirectX -> OpenGL green
            if normal.size != albedo.size:
                normal = normal.resize(albedo.size, Image.LANCZOS)
        else:
            normal = flat_normal(albedo.size)
        tiles.append(Tile(mat, albedo, normal))
    pack(tiles)
    atlas_a = Image.new("RGB", (ATLAS_W, ATLAS_H))
    atlas_n = Image.new("RGB", (ATLAS_W, ATLAS_H), (128, 128, 255))
    atlas_uv = {}
    for t in tiles:
        atlas_a.paste(t.albedo, (t.x, t.y))
        atlas_n.paste(t.normal, (t.x, t.y))
        w, h = t.albedo.size
        atlas_uv[t.key] = (t.x / ATLAS_W, t.y / ATLAS_H, w / ATLAS_W, h / ATLAS_H)

    os.makedirs(out_dir, exist_ok=True)
    atlas_a.save(os.path.join(out_dir, "opfor_albedo.jpg"), quality=86, optimize=True)
    atlas_n.save(os.path.join(out_dir, "opfor_normal.jpg"), quality=90, optimize=True)
    write_glb(os.path.join(out_dir, "opfor.glb"), parts, atlas_uv)

    for p in parts:
        lo, hi = p.positions.min(0), p.positions.max(0)
        print(f"{p.category:8s} {p.name:16s} verts {len(p.positions):5d} tris {len(p.indices) // 3:5d}"
              f"  y {lo[1]:.2f}..{hi[1]:.2f}  x {lo[0]:.2f}..{hi[0]:.2f}  z {lo[2]:.2f}..{hi[2]:.2f}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
