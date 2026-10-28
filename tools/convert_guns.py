"""
Convert the MW2 weapon viewmodels (ported to GoldSrc / CS 1.6 MDL v10, kept in
assets-src/guns) into glTF for the game.

Outputs (public/models/guns/):
  vm_<id>.glb    first-person viewmodel: MW2 arms + gun skinned to the full rig,
                 every sequence as an animation clip, metadata in scene extras
                 (sequence roles, muzzle / brass tags, ADS transform).
                 Skeleton is in raw model units; the "vm" root node converts
                 GoldSrc view space (X fwd, Y left, Z up) to camera space
                 (-Z fwd, +Y up, +X right) in metres.
  world.glb      static gun-only meshes for bots, drops and menu previews:
                 one "world-<id>" node per weapon, barrel along -Z, metres,
                 origin at the pistol grip, with a "muzzle" child.
  tex/*.jpg|png  textures shared by both (deduplicated by content).

Usage: python tools/convert_guns.py assets-src/guns public/models/guns
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import struct
import sys
from dataclasses import dataclass, field

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from goldsrc_mdl import StudioModel  # noqa: E402

# Model units -> metres. Calibrated on the MW2 hand (wrist -> middle knuckle
# ~7.6 units ~ 0.088 m), which also gives true-to-life gun lengths.
SCALE = 0.0117

# Arm / wrist-gear textures: everything else is the weapon.
ARM_TEXTURES = {"ava_hands.bmp", "ava_arms.bmp", "plastic.bmp", "numpad.bmp", "gps.bmp", "buttons.bmp"}


@dataclass
class GunCfg:
    file: str
    # Sight-line height in gun-local units (rear aperture centre / notch bottom, scope axis),
    # read off a down-the-bore render. The rear sight's position along the bore is derived.
    sight_z: float | None = None
    # Rear-sight position along the bore when the derived one misses (iron line not parallel to the bore).
    sight_x: float | None = None
    # Nose-up tilt (degrees) when aiming, for iron sights that aren't parallel to the bore.
    sight_pitch: float = 0.0
    # Eye distance behind the rear sight when aiming (metres).
    relief: float = 0.1
    # Bones whose geometry is left out of the static world model (parked extras, silencers).
    world_skip: tuple[str, ...] = ()


GUNS: dict[str, GunCfg] = {
    "acr": GunCfg("v_sg552", sight_z=6.85),
    "m4a1": GunCfg("v_m4a1", sight_z=10.6, world_skip=("tag_laser",)),
    "ak47": GunCfg("v_ak47", sight_z=7.6),
    "ump45": GunCfg("v_ump45", sight_z=7.75),
    "intervention": GunCfg("v_scout", sight_z=10.4),
    "rpd": GunCfg("v_m249", sight_z=11.75, sight_pitch=2.2),
    "aa12": GunCfg("v_xm1014", sight_z=5.3),
    "spas12": GunCfg("v_m3", sight_z=3.35, sight_x=10.1),
    "usp45": GunCfg("v_usp", sight_z=3.85, relief=0.2, world_skip=("j_press_rear",)),
    "deagle": GunCfg("v_deagle", sight_z=6.9, relief=0.2, world_skip=("j_speedloader",)),
    "g18": GunCfg("v_glock18", sight_z=4.35, relief=0.2),
    "frag": GunCfg("v_hegrenade"),
    "knife": GunCfg("v_knife"),
}

# CS 1.6 viewmodels are authored left-handed; the engine mirrors them for
# right-handed play (cl_righthand). We mirror the lateral (Y) axis likewise —
# in the view and in the world models, so textures and ejection ports match.
MIRROR = np.diag([1.0, -1.0, 1.0])
# GoldSrc view space -> camera space (rows): x' = -y, y' = z, z' = -x.
VIEW_TO_CAM = np.array([[0, -1, 0], [0, 0, 1], [-1, 0, 0]], float)
# Gun-local (j_gun, after the mirror: -x forward, -y right, +z up) -> weapon space (+x right, +y up, -z forward).
GUN_TO_WEAPON = np.array([[0, 1, 0], [0, 0, 1], [1, 0, 0]], float) @ MIRROR


# ─── math ────────────────────────────────────────────────────────────────────

def angle_quat(a) -> np.ndarray:
    """GoldSrc AngleQuaternion -> (x, y, z, w)."""
    sy, cy = np.sin(a[2] * 0.5), np.cos(a[2] * 0.5)
    sp, cp = np.sin(a[1] * 0.5), np.cos(a[1] * 0.5)
    sr, cr = np.sin(a[0] * 0.5), np.cos(a[0] * 0.5)
    return np.array([
        sr * cp * cy - cr * sp * sy,
        cr * sp * cy + sr * cp * sy,
        cr * cp * sy - sr * sp * cy,
        cr * cp * cy + sr * sp * sy,
    ])


def mat_quat(m: np.ndarray) -> np.ndarray:
    """3x3 rotation -> (x, y, z, w)."""
    t = np.trace(m)
    if t > 0:
        s = np.sqrt(t + 1.0) * 2
        q = [(m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s, 0.25 * s]
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = np.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        q = [0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s, (m[2, 1] - m[1, 2]) / s]
    elif m[1, 1] > m[2, 2]:
        s = np.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        q = [(m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s, (m[0, 2] - m[2, 0]) / s]
    else:
        s = np.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
        q = [(m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s, (m[1, 0] - m[0, 1]) / s]
    q = np.array(q)
    return q / np.linalg.norm(q)


# ─── glTF builder ────────────────────────────────────────────────────────────

@dataclass
class Gltf:
    doc: dict = field(default_factory=lambda: {
        "asset": {"version": "2.0", "generator": "convert_guns.py"},
        "scenes": [{"nodes": []}], "scene": 0, "nodes": [], "meshes": [], "materials": [],
        "textures": [], "images": [], "samplers": [{"magFilter": 9729, "minFilter": 9987}],
        "accessors": [], "bufferViews": [], "buffers": [],
    })
    bin: bytearray = field(default_factory=bytearray)
    tex_index: dict[str, int] = field(default_factory=dict)
    mat_index: dict[str, int] = field(default_factory=dict)

    def accessor(self, arr: np.ndarray, ctype: int, typ: str, target: int | None = None,
                 normalized: bool = False, minmax: bool = False) -> int:
        data = arr.tobytes()
        self.bin.extend(b"\0" * ((-len(self.bin)) % 4))
        view = {"buffer": 0, "byteOffset": len(self.bin), "byteLength": len(data)}
        if target:
            view["target"] = target
        self.bin.extend(data)
        self.doc["bufferViews"].append(view)
        ncomp = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[typ]
        acc = {"bufferView": len(self.doc["bufferViews"]) - 1, "componentType": ctype,
               "count": int(arr.size // ncomp), "type": typ}
        if normalized:
            acc["normalized"] = True
        if minmax:
            a = arr.reshape(-1, ncomp)
            acc["min"] = [float(v) for v in a.min(0)]
            acc["max"] = [float(v) for v in a.max(0)]
        self.doc["accessors"].append(acc)
        return len(self.doc["accessors"]) - 1

    def node(self, **kw) -> int:
        self.doc["nodes"].append({k: v for k, v in kw.items() if v is not None})
        return len(self.doc["nodes"]) - 1

    def material(self, tex_name: str, uri: str, arm: bool) -> int:
        if tex_name in self.mat_index:
            return self.mat_index[tex_name]
        if uri not in self.tex_index:
            self.doc["images"].append({"uri": uri})
            self.doc["textures"].append({"sampler": 0, "source": len(self.doc["images"]) - 1})
            self.tex_index[uri] = len(self.doc["textures"]) - 1
        self.doc["materials"].append({
            "name": ("arm:" if arm else "gun:") + tex_name,
            "pbrMetallicRoughness": {"baseColorTexture": {"index": self.tex_index[uri]},
                                     "metallicFactor": 0.0, "roughnessFactor": 0.75},
        })
        self.mat_index[tex_name] = len(self.doc["materials"]) - 1
        return self.mat_index[tex_name]

    def write(self, path: str) -> None:
        self.bin.extend(b"\0" * ((-len(self.bin)) % 4))
        self.doc["buffers"] = [{"byteLength": len(self.bin)}]
        for k in ("textures", "images", "materials", "meshes", "accessors", "bufferViews"):
            if not self.doc[k]:
                del self.doc[k]
        js = json.dumps(self.doc, separators=(",", ":")).encode()
        js += b" " * ((-len(js)) % 4)
        with open(path, "wb") as f:
            f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(self.bin)))
            f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
            f.write(struct.pack("<II", len(self.bin), 0x004E4942) + bytes(self.bin))


FLOAT, U8, U16, U32, I16 = 5126, 5121, 5123, 5125, 5122
ARRAY, ELEMENTS = 34962, 34963


# ─── textures ────────────────────────────────────────────────────────────────

class TextureStore:
    """Writes each distinct texture once to <out>/tex and hands back its URI."""

    def __init__(self, out_dir: str):
        self.dir = os.path.join(out_dir, "tex")
        os.makedirs(self.dir, exist_ok=True)
        self.by_hash: dict[str, str] = {}
        self.written: set[str] = set()

    def uri(self, name: str, img: Image.Image) -> str:
        h = hashlib.sha1(img.tobytes()).hexdigest()[:10]
        if h in self.by_hash:
            return self.by_hash[h]
        stem = os.path.splitext(name)[0].lower().replace(" ", "_")
        alpha = img.getextrema()[3][0] < 255
        fname = f"{stem}-{h[:6]}.{'png' if alpha else 'jpg'}"
        path = os.path.join(self.dir, fname)
        if alpha:
            img.save(path, optimize=True)
        else:
            img.convert("RGB").save(path, quality=88, optimize=True)
        self.written.add(fname)
        self.by_hash[h] = f"tex/{fname}"
        return self.by_hash[h]


# ─── per-weapon conversion ───────────────────────────────────────────────────

def sequence_roles(labels: list[str]) -> dict[str, str]:
    """Map the game's animation roles to sequence names (silenced set + '_unsil' variants)."""
    have = set(labels)
    roles: dict[str, str] = {"idle": "idle" if "idle" in have else labels[0]}
    for base in ("draw", "reload", "shoot_empty", "start_reload", "insert", "after_reload",
                 "pullpin", "throw", "slash1", "slash2", "stab", "midslash1"):
        if base in have:
            roles[base] = base
    shoots = [s for s in labels if s.startswith("shoot") and "empty" not in s and "unsil" not in s
              and "left" not in s and "right" not in s]
    if shoots:
        roles["shoot"] = ",".join(shoots)
    if "idle_unsil" in have:
        for r in ("idle", "draw", "reload", "shoot_empty"):
            if f"{r}_unsil" in have:
                roles[f"{r}_unsil"] = f"{r}_unsil"
        roles["shoot_unsil"] = ",".join(s for s in labels if s.startswith("shoot") and s.endswith("_unsil") and "empty" not in s)
    return roles


def sight_point(local: np.ndarray, z: float | None) -> np.ndarray:
    """Rear sight at sight height z (default: top of the gun): its rear face along the bore,
    and its lateral centre (rear sights are symmetric about the sight line, j_gun need not be)."""
    centre = local[np.abs(local[:, 1]) < 1.5]
    if not len(centre):
        centre = local
    if z is None:
        z = float(centre[:, 2].max())
    band = centre[np.abs(centre[:, 2] - z) < 0.6]
    if not len(band):
        return np.array([0.0, 0.0, z])
    x = float(band[:, 0].max())
    sight = local[(local[:, 0] > x - 3) & (np.abs(local[:, 2] - z) < 1.5) & (np.abs(local[:, 1]) < 3)]
    y = 0.5 * float(sight[:, 1].min() + sight[:, 1].max()) if len(sight) else 0.0
    return np.array([x, y, z])


def convert(gid: str, cfg: GunCfg, src_dir: str, out_dir: str, store: TextureStore, world: Gltf) -> dict:
    sm = StudioModel(open(os.path.join(src_dir, cfg.file + ".mdl"), "rb").read())
    bones = sm.bones
    names = [b.name for b in bones]
    labels = [s.label for s in sm.sequences]
    roles = sequence_roles(labels)
    bind_seq = labels.index(roles["idle"])
    vals = sm.bone_values(bind_seq, 0)
    mats = sm.bone_matrices(bind_seq, 0)
    gun_i = names.index("j_gun")
    gun_m = mats[gun_i]
    gun_inv = np.linalg.inv(gun_m)

    g = Gltf()
    # ── skeleton ──
    # mirror as a negative Y scale under the axis rotation (three.js flips the cull face for it)
    root = g.node(name="vm", rotation=[float(v) for v in mat_quat(VIEW_TO_CAM)], scale=[SCALE, -SCALE, SCALE], children=[])
    g.doc["scenes"][0]["nodes"].append(root)
    joint_nodes = []
    for i, b in enumerate(bones):
        q = angle_quat(vals[i, 3:])
        joint_nodes.append(g.node(name=b.name, translation=[float(v) for v in vals[i, :3]],
                                  rotation=[float(v) for v in q]))
    for i, b in enumerate(bones):
        parent = root if b.parent < 0 else joint_nodes[b.parent]
        g.doc["nodes"][parent].setdefault("children", []).append(joint_nodes[i])
    ibm = np.stack([np.linalg.inv(m) for m in mats]).astype("<f4")
    # glTF matrices are column-major
    ibm_acc = g.accessor(np.ascontiguousarray(ibm.transpose(0, 2, 1)), FLOAT, "MAT4")
    g.doc["skins"] = [{"joints": joint_nodes, "inverseBindMatrices": ibm_acc, "skeleton": joint_nodes[0]}]

    # ── skinned mesh, one primitive per texture ──
    by_tex: dict[int, list] = {}
    for m in sm.models:
        for me in m.meshes:
            by_tex.setdefault(me.texture, []).append(me)
    prims = []
    world_parts: dict[int, list[np.ndarray]] = {}
    for ti, meshes in by_tex.items():
        tex = sm.textures[ti]
        arm = tex.name in ARM_TEXTURES
        bone = np.concatenate([me.bone for me in meshes])
        lp = np.concatenate([me.pos for me in meshes])
        ln = np.concatenate([me.norm for me in meshes])
        uv = np.concatenate([me.uv for me in meshes]) / np.array([tex.width, tex.height], np.float32)
        rot = mats[bone][:, :3, :3]
        pos = np.einsum("nij,nj->ni", rot, lp) + mats[bone][:, :3, 3]
        nrm = np.einsum("nij,nj->ni", rot, ln)
        nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-9)
        key = np.concatenate([bone[:, None], pos, nrm, uv], axis=1).astype("<f4")
        uniq, inv = np.unique(key, axis=0, return_inverse=True)
        inv = inv.reshape(-1)
        joints = np.zeros((len(uniq), 4), np.uint8)
        joints[:, 0] = uniq[:, 0].astype(np.uint8)
        weights = np.zeros((len(uniq), 4), np.uint8)
        weights[:, 0] = 255
        mat = g.material(tex.name, store.uri(tex.name, tex.image), arm)
        prims.append({
            "attributes": {
                "POSITION": g.accessor(np.ascontiguousarray(uniq[:, 1:4]), FLOAT, "VEC3", ARRAY, minmax=True),
                "NORMAL": g.accessor(np.ascontiguousarray(uniq[:, 4:7]), FLOAT, "VEC3", ARRAY),
                "TEXCOORD_0": g.accessor(np.ascontiguousarray(uniq[:, 7:9]), FLOAT, "VEC2", ARRAY),
                "JOINTS_0": g.accessor(joints, U8, "VEC4", ARRAY),
                "WEIGHTS_0": g.accessor(weights, U8, "VEC4", ARRAY, normalized=True),
            },
            # GoldSrc winds triangles clockwise: reverse for glTF's counter-clockwise front faces
            "indices": g.accessor(np.ascontiguousarray(inv.reshape(-1, 3)[:, ::-1]).astype("<u2" if len(uniq) < 65536 else "<u4"),
                                  U16 if len(uniq) < 65536 else U32, "SCALAR", ELEMENTS),
            "material": mat,
        })
        # world-model geometry: gun only, in gun-local space
        if arm:
            continue
        keep = np.ones(len(bone), bool)
        for b in cfg.world_skip:
            if b in names:
                keep &= bone != names.index(b)
        if keep.sum() == 0:
            continue
        lpos = (gun_inv[:3, :3] @ pos[keep].T).T + gun_inv[:3, 3]
        lnrm = (gun_inv[:3, :3] @ nrm[keep].T).T
        world_parts.setdefault(ti, []).append((lpos, lnrm, uv[keep], tex))
    g.doc["meshes"].append({"name": f"vm_{gid}", "primitives": prims})
    mesh_node = g.node(name=f"vm_{gid}_mesh", mesh=0, skin=0)
    g.doc["nodes"][root]["children"].append(mesh_node)

    # ── animations ──
    anims = []
    seq_info = {}
    for si, seq in enumerate(sm.sequences):
        n = seq.numframes
        fps = seq.fps if seq.fps > 0 else 30.0
        seq_info[seq.label] = {"fps": fps, "frames": n, "duration": max(n - 1, 1) / fps}
        frames = np.stack([sm.bone_values(si, f) for f in range(n)])  # (n, bones, 6)
        times = (np.arange(n) / fps).astype("<f4")
        t_all = g.accessor(times, FLOAT, "SCALAR", minmax=True)
        t_one = None
        samplers, channels = [], []
        for b in range(len(bones)):
            tr = frames[:, b, :3].astype("<f4")
            qs = np.stack([angle_quat(a) for a in frames[:, b, 3:]])
            for k in range(1, n):  # keep quaternion signs continuous for slerp
                if np.dot(qs[k], qs[k - 1]) < 0:
                    qs[k] = -qs[k]
            for path, data, is_rot in (("translation", tr, False), ("rotation", qs, True)):
                const = np.allclose(data, data[0], atol=1e-4)
                if const:
                    if t_one is None:
                        t_one = g.accessor(np.zeros(1, "<f4"), FLOAT, "SCALAR", minmax=True)
                    data, tin = data[:1], t_one
                else:
                    tin = t_all
                if is_rot:
                    out = g.accessor(np.round(np.clip(data, -1, 1) * 32767).astype("<i2"), I16, "VEC4", normalized=True)
                else:
                    out = g.accessor(np.ascontiguousarray(data, "<f4"), FLOAT, "VEC3")
                samplers.append({"input": tin, "output": out, "interpolation": "LINEAR"})
                channels.append({"sampler": len(samplers) - 1, "target": {"node": joint_nodes[b], "path": path}})
        anims.append({"name": seq.label, "samplers": samplers, "channels": channels})
    g.doc["animations"] = anims

    # ── metadata ──
    def tag(bone_name: str, offset=(0.0, 0.0, 0.0)):
        return {"bone": bone_name, "offset": [float(v) for v in offset]}

    att = [(names[b], o) for b, o in sm.attachments]
    muzzle = tag(*att[0]) if att else (tag("tag_flash") if "tag_flash" in names else None)
    muzzle_sil = tag(*att[2]) if len(att) > 2 else None
    brass = tag("tag_brass") if "tag_brass" in names else (tag(*att[1]) if len(att) > 1 else None)

    gun_local_all = np.concatenate([p for parts in world_parts.values() for p, *_ in parts]) if world_parts else np.zeros((1, 3))
    if muzzle:
        mb = names.index(muzzle["bone"])
        mw = mats[mb][:3, :3] @ np.array(muzzle["offset"]) + mats[mb][:3, 3]
        muzzle_local = gun_inv[:3, :3] @ mw + gun_inv[:3, 3]
    else:
        muzzle_local = gun_local_all[np.argmin(gun_local_all[:, 0])]
    def tag_local(t):
        if not t:
            return None
        b = names.index(t["bone"])
        w = mats[b][:3, :3] @ np.array(t["offset"]) + mats[b][:3, 3]
        return [float(v) for v in gun_inv[:3, :3] @ w + gun_inv[:3, 3]]

    sight_local = sight_point(gun_local_all, cfg.sight_z)
    if cfg.sight_x is not None:
        sight_local[0] = cfg.sight_x
    sx, sy, sz = sight_local

    # ADS: rotate the bore onto -Z and put the sight point on the view axis, `relief` in front.
    cam_rot = VIEW_TO_CAM @ MIRROR @ gun_m[:3, :3]  # gun-local axes in camera space
    fwd = cam_rot @ np.array([-1.0, 0, 0])
    up = cam_rot @ np.array([0.0, 0, 1])
    right = np.cross(fwd, up)
    have = np.stack([right, up, -fwd], axis=1)  # columns: where the gun's right/up/back point now
    a = np.radians(cfg.sight_pitch)
    pitch = np.array([[1, 0, 0], [0, np.cos(a), -np.sin(a)], [0, np.sin(a), np.cos(a)]])
    q_ads = pitch @ have.T  # rotation taking them to +X/+Y/+Z, then the sight-line tilt
    sight_cam = VIEW_TO_CAM @ MIRROR @ (gun_m[:3, :3] @ sight_local + gun_m[:3, 3]) * SCALE
    p_ads = np.array([0.0, 0.0, -cfg.relief]) - q_ads @ sight_cam

    # Pistol-grip origin for the world model: right palm centre on the centre plane.
    palm = None
    if "j_wrist_ri" in names and "j_mid_ri_0" in names:
        pw = 0.5 * (mats[names.index("j_wrist_ri")][:3, 3] + mats[names.index("j_mid_ri_0")][:3, 3])
        palm = gun_inv[:3, :3] @ pw + gun_inv[:3, 3]
    grip_local = np.array([palm[0], 0.0, palm[2]]) if palm is not None and gid not in ("frag",) else gun_local_all.mean(0)

    meta = {
        "id": gid, "source": cfg.file, "scale": SCALE, "gunBone": "j_gun",
        "roles": roles, "sequences": seq_info, "muzzle": muzzle, "muzzleSil": muzzle_sil, "brass": brass,
        "ads": {"p": [float(v) for v in p_ads], "q": [float(v) for v in mat_quat(q_ads)], "relief": cfg.relief},
        "sightLocal": [float(v) for v in sight_local],
        # Gun-local (j_gun space, model units) points the runtime parents to j_gun.
        "muzzleGun": [float(v) for v in muzzle_local],
        "muzzleSilGun": tag_local(muzzle_sil),
        "brassGun": tag_local(brass),
    }
    g.doc["scenes"][0]["extras"] = meta
    g.write(os.path.join(out_dir, f"vm_{gid}.glb"))

    # ── world model node ──
    wprims = []
    for ti, parts in world_parts.items():
        lp = np.concatenate([p for p, *_ in parts])
        ln = np.concatenate([n for _, n, *_ in parts])
        uv = np.concatenate([u for _, _, u, _ in parts])
        tex = parts[0][3]
        pos = ((GUN_TO_WEAPON @ (lp - grip_local).T).T * SCALE).astype("<f4")
        nrm = (GUN_TO_WEAPON @ ln.T).T.astype("<f4")
        key = np.concatenate([pos, nrm, uv], axis=1).astype("<f4")
        uniq, inv = np.unique(key, axis=0, return_inverse=True)
        inv = inv.reshape(-1)
        wprims.append({
            "attributes": {
                "POSITION": world.accessor(np.ascontiguousarray(uniq[:, 0:3]), FLOAT, "VEC3", ARRAY, minmax=True),
                "NORMAL": world.accessor(np.ascontiguousarray(uniq[:, 3:6]), FLOAT, "VEC3", ARRAY),
                "TEXCOORD_0": world.accessor(np.ascontiguousarray(uniq[:, 6:8]), FLOAT, "VEC2", ARRAY),
            },
            "indices": world.accessor(inv.astype("<u2" if len(uniq) < 65536 else "<u4"),
                                      U16 if len(uniq) < 65536 else U32, "SCALAR", ELEMENTS),
            "material": world.material(tex.name, store.uri(tex.name, tex.image), False),
        })
    world.doc["meshes"].append({"name": f"world-{gid}", "primitives": wprims})
    mz = (GUN_TO_WEAPON @ (muzzle_local - grip_local) * SCALE).tolist()
    sight_w = (GUN_TO_WEAPON @ (sight_local - grip_local) * SCALE).tolist()
    muzzle_node = world.node(name="muzzle", translation=[float(v) for v in mz])
    wnode = world.node(name=f"world-{gid}", mesh=len(world.doc["meshes"]) - 1, children=[muzzle_node],
                       extras={"sight": sight_w})
    world.doc["scenes"][0]["nodes"].append(wnode)

    lo, hi = gun_local_all.min(0) * SCALE, gun_local_all.max(0) * SCALE
    size = os.path.getsize(os.path.join(out_dir, f"vm_{gid}.glb"))
    print(f"{gid:13s} <- {cfg.file:13s} {size / 1e6:5.2f} MB  len {hi[0] - lo[0]:.2f} m  sight {np.round(sight_local, 2)}"
          f"  muzzle {np.round(muzzle_local, 1)}  roles {roles}")
    return meta


def main(src_dir: str, out_dir: str) -> None:
    os.makedirs(out_dir, exist_ok=True)
    store = TextureStore(out_dir)
    world = Gltf()
    only = set(sys.argv[3:])
    for gid, cfg in GUNS.items():
        if only and gid not in only:
            continue
        convert(gid, cfg, src_dir, out_dir, store, world)
    if not only:
        world.write(os.path.join(out_dir, "world.glb"))
        # drop stale textures from earlier runs
        for f in os.listdir(store.dir):
            if f not in store.written:
                os.remove(os.path.join(store.dir, f))
        print(f"world.glb {os.path.getsize(os.path.join(out_dir, 'world.glb')) / 1e6:.2f} MB,"
              f" {len(store.written)} textures")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
