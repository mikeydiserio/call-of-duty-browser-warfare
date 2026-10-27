"""Minimal Valve VPK (v1/v2, single-file / embedded data) reader."""
from __future__ import annotations

import struct


def _cstr(buf: bytes, off: int) -> tuple[str, int]:
    end = buf.index(b"\x00", off)
    return buf[off:end].decode("utf-8", "replace"), end + 1


def read_vpk(path: str) -> dict[str, bytes]:
    """Returns {lower-case path with forward slashes: file bytes}."""
    with open(path, "rb") as f:
        buf = f.read()
    sig, version, tree_size = struct.unpack_from("<III", buf, 0)
    assert sig == 0x55AA1234, "not a VPK"
    off = 28 if version == 2 else 12
    data_base = off + tree_size
    files: dict[str, bytes] = {}
    while True:
        ext, off = _cstr(buf, off)
        if not ext:
            break
        while True:
            folder, off = _cstr(buf, off)
            if not folder:
                break
            while True:
                name, off = _cstr(buf, off)
                if not name:
                    break
                _crc, preload, archive, entry_off, length, _term = struct.unpack_from("<IHHIIH", buf, off)
                off += 18
                data = buf[off:off + preload]
                off += preload
                if archive != 0x7FFF:
                    raise ValueError(f"{folder}/{name}.{ext} lives in an external _NNN.vpk archive")
                data += buf[data_base + entry_off:data_base + entry_off + length]
                full = f"{folder}/{name}.{ext}" if folder.strip() else f"{name}.{ext}"
                files[full.lower().replace("\\", "/")] = data
    return files
