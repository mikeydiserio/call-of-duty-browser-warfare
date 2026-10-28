"""
Minimal GoldSrc (Half-Life 1 / CS 1.6) studio model reader — MDL version 10.

Everything lives in the one file: bones, sequences + animation, textures (8-bit
paletted) and triangle-command meshes whose vertices are stored in bone space.
Only what the weapon converter needs: bone poses for a chosen frame, posed
meshes with per-vertex bone/texture/UV, and decoded textures.

Usage: python tools/goldsrc_mdl.py <file.mdl>   (prints a summary)
"""
from __future__ import annotations

import struct
import sys
from dataclasses import dataclass

import numpy as np
from PIL import Image

NF_CHROME = 0x02
NF_FULLBRIGHT = 0x04
NF_ADDITIVE = 0x20
NF_MASKED = 0x40


@dataclass
class Bone:
    name: str
    parent: int
    value: list[float]  # px py pz rx ry rz (defaults)
    scale: list[float]


@dataclass
class Sequence:
    label: str
    fps: float
    numframes: int
    animindex: int
    seqgroup: int


@dataclass
class Texture:
    name: str
    flags: int
    width: int
    height: int
    image: Image.Image  # RGBA (index 255 -> transparent when masked)


@dataclass
class Mesh:
    """Triangle list in bone space."""
    texture: int
    bone: np.ndarray  # (n,) bone index per corner
    pos: np.ndarray  # (n, 3) bone-local
    norm: np.ndarray  # (n, 3) bone-local
    uv: np.ndarray  # (n, 2) texels


@dataclass
class Model:
    bodypart: str
    name: str
    meshes: list[Mesh]


def _cstr(b: bytes) -> str:
    return b.split(b"\0", 1)[0].decode("latin-1")


def angle_matrix(a) -> np.ndarray:
    """GoldSrc AngleQuaternion order: R = Rz(a2) @ Ry(a1) @ Rx(a0)."""
    cx, sx = np.cos(a[0]), np.sin(a[0])
    cy, sy = np.cos(a[1]), np.sin(a[1])
    cz, sz = np.cos(a[2]), np.sin(a[2])
    rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return rz @ ry @ rx


class StudioModel:
    def __init__(self, data: bytes):
        self.d = data
        if data[:4] != b"IDST":
            raise ValueError("not a studio model")
        ver = self._i(4)
        if ver != 10:
            raise ValueError(f"unsupported MDL version {ver}")
        self.name = _cstr(data[8:72])
        h = struct.unpack_from("<27i", data, 140)
        (numbones, boneindex, _nbc, _bci, _nhb, _hbi, numseq, seqindex, _nsg, _sgi,
         numtex, texindex, _texdata, numskinref, numskinfam, skinindex,
         numbodyparts, bodypartindex, numattach, attachindex, *_rest) = h
        self.bones = []
        for i in range(numbones):
            o = boneindex + i * 112
            name = _cstr(data[o:o + 32])
            parent = self._i(o + 32)
            vals = list(struct.unpack_from("<6f", data, o + 64))
            scl = list(struct.unpack_from("<6f", data, o + 88))
            self.bones.append(Bone(name, parent, vals, scl))
        self.sequences = []
        for i in range(numseq):
            o = seqindex + i * 176
            self.sequences.append(Sequence(
                _cstr(data[o:o + 32]), struct.unpack_from("<f", data, o + 32)[0],
                self._i(o + 56), self._i(o + 124), self._i(o + 156)))
        self.textures = []
        for i in range(numtex):
            o = texindex + i * 80
            name = _cstr(data[o:o + 64])
            flags, w, hgt, idx = struct.unpack_from("<4i", data, o + 64)
            px = np.frombuffer(data, np.uint8, w * hgt, idx).reshape(hgt, w)
            pal = np.frombuffer(data, np.uint8, 768, idx + w * hgt).reshape(256, 3)
            rgba = np.empty((hgt, w, 4), np.uint8)
            rgba[..., :3] = pal[px]
            rgba[..., 3] = 255
            if flags & NF_MASKED:
                rgba[..., 3][px == 255] = 0
            self.textures.append(Texture(name, flags, w, hgt, Image.fromarray(rgba, "RGBA")))
        skins = np.frombuffer(data, "<i2", numskinref * max(numskinfam, 1), skinindex) if numskinref else np.zeros(0, np.int16)
        self.skinref = skins[:numskinref].astype(int)  # family 0
        self.attachments = []
        for i in range(numattach):
            o = attachindex + i * 88
            bone = self._i(o + 36)
            org = struct.unpack_from("<3f", data, o + 40)
            self.attachments.append((bone, np.array(org)))
        self.models: list[Model] = []
        for i in range(numbodyparts):
            o = bodypartindex + i * 76
            bpname = _cstr(data[o:o + 64])
            nummodels, _base, modelindex = struct.unpack_from("<3i", data, o + 64)
            for m in range(nummodels):
                self.models.append(self._model(bpname, modelindex + m * 112))

    def _i(self, o: int) -> int:
        return struct.unpack_from("<i", self.d, o)[0]

    def _model(self, bpname: str, o: int) -> Model:
        d = self.d
        name = _cstr(d[o:o + 64])
        (_typ, _rad, nummesh, meshindex, numverts, vertinfo, vertindex,
         numnorms, norminfo, normindex) = struct.unpack_from("<if8i", d, o + 64)
        vbone = np.frombuffer(d, np.uint8, numverts, vertinfo)
        verts = np.frombuffer(d, "<f4", numverts * 3, vertindex).reshape(-1, 3)
        nbone = np.frombuffer(d, np.uint8, numnorms, norminfo)
        norms = np.frombuffer(d, "<f4", numnorms * 3, normindex).reshape(-1, 3)
        meshes = []
        for k in range(nummesh):
            numtris, triindex, skinref, _nn, _ni = struct.unpack_from("<5i", d, meshindex + k * 20)
            tex = int(self.skinref[skinref]) if skinref < len(self.skinref) else skinref
            corners = []  # (v, n, s, t)
            p = triindex
            while True:
                cnt = struct.unpack_from("<h", d, p)[0]
                p += 2
                if cnt == 0:
                    break
                fan = cnt < 0
                cnt = abs(cnt)
                cmd = np.frombuffer(d, "<i2", cnt * 4, p).reshape(cnt, 4)
                p += cnt * 8
                for j in range(2, cnt):
                    if fan:
                        tri = (cmd[0], cmd[j - 1], cmd[j])
                    elif j % 2:
                        tri = (cmd[j - 1], cmd[j - 2], cmd[j])
                    else:
                        tri = (cmd[j - 2], cmd[j - 1], cmd[j])
                    corners.extend(tri)
            if not corners:
                continue
            c = np.array(corners, np.int32)
            meshes.append(Mesh(tex, vbone[c[:, 0]].astype(int), verts[c[:, 0]].copy(),
                               norms[c[:, 1]].copy(), c[:, 2:4].astype(np.float32)))
        return Model(bpname, name, meshes)

    # ── animation ──
    def _anim_value(self, base: int, frame: int) -> float:
        d = self.d
        p = base
        k = frame
        while True:
            valid, total = d[p], d[p + 1]
            if total == 0:  # malformed run; bail
                return 0.0
            if total > k:
                break
            k -= total
            p += (valid + 1) * 2
        if valid > k:
            return struct.unpack_from("<h", d, p + (k + 1) * 2)[0]
        return struct.unpack_from("<h", d, p + valid * 2)[0]

    def bone_values(self, seq: int, frame: int) -> np.ndarray:
        s = self.sequences[seq]
        if s.seqgroup != 0:
            raise ValueError(f"sequence {s.label} lives in an external group file")
        frame = max(0, min(frame, s.numframes - 1))
        out = np.zeros((len(self.bones), 6))
        for b, bone in enumerate(self.bones):
            a = s.animindex + b * 12
            offs = struct.unpack_from("<6H", self.d, a)
            for j in range(6):
                v = bone.value[j]
                if offs[j]:
                    v += self._anim_value(a + offs[j], frame) * bone.scale[j]
                out[b, j] = v
        return out

    def bone_matrices(self, seq: int = 0, frame: int = 0) -> np.ndarray:
        """4x4 bone->model transforms for a sequence frame."""
        vals = self.bone_values(seq, frame)
        mats = np.zeros((len(self.bones), 4, 4))
        for b, bone in enumerate(self.bones):
            m = np.eye(4)
            m[:3, :3] = angle_matrix(vals[b, 3:])
            m[:3, 3] = vals[b, :3]
            mats[b] = mats[bone.parent] @ m if bone.parent >= 0 else m
        return mats


def summary(path: str) -> None:
    sm = StudioModel(open(path, "rb").read())
    print(f"== {path}  ({sm.name})")
    print("bones:", ", ".join(f"{i}:{b.name}<{b.parent}" for i, b in enumerate(sm.bones)))
    print("seqs:", ", ".join(f"{s.label}({s.numframes}@{s.fps:g})" for s in sm.sequences))
    print("textures:", ", ".join(f"{t.name}[{t.width}x{t.height} f{t.flags:x}]" for t in sm.textures))
    mats = sm.bone_matrices(0, 0)
    for m in sm.models:
        for me in m.meshes:
            world = np.einsum("nij,nj->ni", mats[me.bone][:, :3, :3], me.pos) + mats[me.bone][:, :3, 3]
            bones = sorted({sm.bones[i].name for i in np.unique(me.bone)})
            lo, hi = world.min(0), world.max(0)
            print(f"  {m.bodypart}/{m.name} tex={sm.textures[me.texture].name} tris={len(me.pos) // 3}"
                  f" lo={np.round(lo, 1)} hi={np.round(hi, 1)} bones={bones}")


if __name__ == "__main__":
    for p in sys.argv[1:]:
        summary(p)
