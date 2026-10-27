"""Reader for Source engine studio models (MDL v44-49 + VVD v4 + VTX v7), LOD0 only.

Just enough to pull a skinned triangle mesh out: bones, body parts / sub-models,
materials, skin families, vertices with up to 3 bone weights, and triangles.
"""
from __future__ import annotations

import struct
from dataclasses import dataclass, field


def _cstr(buf: bytes, off: int) -> str:
    end = buf.index(b"\x00", off)
    return buf[off:end].decode("latin-1")


@dataclass
class Bone:
    name: str
    parent: int
    pos: tuple[float, float, float]
    quat: tuple[float, float, float, float]  # x, y, z, w (parent space)
    pose_to_bone: list[float]  # 3x4 row-major


@dataclass
class Mesh:
    material: int
    vertex_offset: int  # relative to the owning model's first vertex
    num_vertices: int
    tris: list[int] = field(default_factory=list)  # absolute VVD vertex indices


@dataclass
class Model:
    name: str
    vertex_start: int  # absolute index into the VVD vertex array
    num_vertices: int
    meshes: list[Mesh]


@dataclass
class BodyPart:
    name: str
    models: list[Model]


@dataclass
class Vertex:
    weights: tuple[float, float, float]
    bones: tuple[int, int, int]
    num_bones: int
    pos: tuple[float, float, float]
    normal: tuple[float, float, float]
    uv: tuple[float, float]


@dataclass
class StudioModel:
    name: str
    bones: list[Bone]
    materials: list[str]
    material_dirs: list[str]
    skins: list[list[int]]  # skin family -> material index per reference slot
    body_parts: list[BodyPart]
    vertices: list[Vertex]


def _read_mdl(buf: bytes):
    ident, version = struct.unpack_from("<4si", buf, 0)
    assert ident == b"IDST" and 44 <= version <= 49, f"unsupported MDL {ident!r} v{version}"
    name = buf[12:76].split(b"\x00")[0].decode("latin-1")
    (bone_count, bone_off) = struct.unpack_from("<ii", buf, 156)
    (tex_count, tex_off, texdir_count, texdir_off) = struct.unpack_from("<iiii", buf, 204)
    (skinref_count, skinfam_count, skin_off) = struct.unpack_from("<iii", buf, 220)
    (bp_count, bp_off) = struct.unpack_from("<ii", buf, 232)

    bones = []
    for i in range(bone_count):
        o = bone_off + i * 216
        name_idx, parent = struct.unpack_from("<ii", buf, o)
        pos = struct.unpack_from("<3f", buf, o + 32)
        quat = struct.unpack_from("<4f", buf, o + 44)
        p2b = list(struct.unpack_from("<12f", buf, o + 96))
        bones.append(Bone(_cstr(buf, o + name_idx), parent, pos, quat, p2b))

    materials = []
    for i in range(tex_count):
        o = tex_off + i * 64
        (name_idx,) = struct.unpack_from("<i", buf, o)
        materials.append(_cstr(buf, o + name_idx))
    material_dirs = []
    for i in range(texdir_count):
        (p,) = struct.unpack_from("<i", buf, texdir_off + i * 4)
        material_dirs.append(_cstr(buf, p))

    skins = []
    for f in range(skinfam_count):
        skins.append(list(struct.unpack_from(f"<{skinref_count}h", buf, skin_off + f * skinref_count * 2)))

    body_parts = []
    for i in range(bp_count):
        o = bp_off + i * 16
        name_idx, nmodels, _base, model_idx = struct.unpack_from("<iiii", buf, o)
        models = []
        for m in range(nmodels):
            mo = o + model_idx + m * 148
            mname = buf[mo:mo + 64].split(b"\x00")[0].decode("latin-1")
            (_type, _rad, nmeshes, mesh_idx, nverts, vert_idx) = struct.unpack_from("<ifiiii", buf, mo + 64)
            meshes = []
            for k in range(nmeshes):
                eo = mo + mesh_idx + k * 116
                material, _mi, mnv, mvo = struct.unpack_from("<iiii", buf, eo)
                meshes.append(Mesh(material, mvo, mnv))
            models.append(Model(mname, vert_idx // 48, nverts, meshes))
        body_parts.append(BodyPart(_cstr(buf, o + name_idx), models))
    return name, bones, materials, material_dirs, skins, body_parts


def _read_vvd(buf: bytes) -> list[Vertex]:
    ident, version, _ck, num_lods = struct.unpack_from("<4siii", buf, 0)
    assert ident == b"IDSV" and version == 4, f"unsupported VVD {ident!r} v{version}"
    lod_verts = struct.unpack_from("<8i", buf, 16)
    num_fixups, fixup_off, vert_off, _tan_off = struct.unpack_from("<iiii", buf, 48)

    def vert(i: int) -> Vertex:
        o = vert_off + i * 48
        w = struct.unpack_from("<3f", buf, o)
        b = struct.unpack_from("<3B", buf, o + 12)
        (n,) = struct.unpack_from("<B", buf, o + 15)
        p = struct.unpack_from("<3f", buf, o + 16)
        nrm = struct.unpack_from("<3f", buf, o + 28)
        uv = struct.unpack_from("<2f", buf, o + 40)
        return Vertex(w, b, n, p, nrm, uv)

    if num_fixups == 0:
        return [vert(i) for i in range(lod_verts[0])]
    out = []
    for f in range(num_fixups):
        lod, src, count = struct.unpack_from("<iii", buf, fixup_off + f * 12)
        if lod >= 0:
            out.extend(vert(src + j) for j in range(count))
    return out


def _read_vtx(buf: bytes, body_parts: list[BodyPart]) -> None:
    version, = struct.unpack_from("<i", buf, 0)
    assert version == 7, f"unsupported VTX v{version}"
    num_bp, bp_off = struct.unpack_from("<ii", buf, 28)
    assert num_bp == len(body_parts)

    def strip_group_size(sg_off: int, count: int) -> int:
        """Older branches use 25-byte strip groups, CS:GO-era ones 33 (topology fields)."""
        for size in (25, 33):
            ok = True
            for k in range(count):
                nv, vo, ni, io, ns, so = struct.unpack_from("<6i", buf, sg_off + k * size)
                if not (0 <= nv < 1 << 20 and 0 <= ni < 1 << 22 and 0 <= ns < 1 << 16 and ni % 3 == 0):
                    ok = False
                    break
            if ok:
                return size
        raise ValueError("cannot determine VTX strip group layout")

    for b, part in enumerate(body_parts):
        bo = bp_off + b * 8
        nmodels, model_off = struct.unpack_from("<ii", buf, bo)
        for m, model in enumerate(part.models[:nmodels]):
            mo = bo + model_off + m * 8
            _nlods, lod_off = struct.unpack_from("<ii", buf, mo)
            lo = mo + lod_off  # LOD 0
            nmeshes, mesh_off = struct.unpack_from("<ii", buf, lo)
            for k, mesh in enumerate(model.meshes[:nmeshes]):
                eo = lo + mesh_off + k * 9
                nsg, sg_off = struct.unpack_from("<ii", buf, eo)
                if nsg == 0:
                    continue
                size = strip_group_size(eo + sg_off, nsg)
                base = model.vertex_start + mesh.vertex_offset
                for g in range(nsg):
                    so = eo + sg_off + g * size
                    nv, vo, ni, io, _ns, _sto = struct.unpack_from("<6i", buf, so)
                    orig = [struct.unpack_from("<H", buf, so + vo + v * 9 + 4)[0] for v in range(nv)]
                    idx = struct.unpack_from(f"<{ni}H", buf, so + io)
                    # Source winds clockwise; flip to counter-clockwise for glTF/three.
                    for t in range(0, ni, 3):
                        a, c, d = idx[t], idx[t + 1], idx[t + 2]
                        mesh.tris.extend((base + orig[a], base + orig[d], base + orig[c]))


def parse(mdl: bytes, vvd: bytes, vtx: bytes) -> StudioModel:
    name, bones, materials, dirs, skins, parts = _read_mdl(mdl)
    verts = _read_vvd(vvd)
    _read_vtx(vtx, parts)
    return StudioModel(name, bones, materials, dirs, skins, parts, verts)


def load(stem: str) -> StudioModel:
    """stem: path without extension; reads <stem>.mdl, .vvd, .dx90.vtx."""
    files = []
    for ext in (".mdl", ".vvd", ".dx90.vtx"):
        with open(stem + ext, "rb") as f:
            files.append(f.read())
    return parse(*files)


if __name__ == "__main__":
    import sys

    sm = load(sys.argv[1])
    print(sm.name, "bones", len(sm.bones), "verts", len(sm.vertices))
    print("materials", sm.materials, "dirs", sm.material_dirs)
    print("skins", sm.skins)
    for bp in sm.body_parts:
        print("bodypart", bp.name)
        for m in bp.models:
            tris = sum(len(e.tris) for e in m.meshes) // 3
            print("   model", repr(m.name), "verts", m.num_vertices, "tris", tris, "mats", [e.material for e in m.meshes])
    for i, b in enumerate(sm.bones):
        print(i, b.name, b.parent, [round(x, 2) for x in b.pos])
