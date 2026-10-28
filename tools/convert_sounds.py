"""Encode the recorded sounds the game references into web-ready MP3s.

    python tools/convert_sounds.py assets-src/sounds public/sounds

The file list comes from sampleFiles() in src/audio/samples.ts (read through Bun), so
only sounds the game actually uses are shipped. Output mirrors the source tree:
assets-src/sounds/weapons/ak47/x.wav -> public/sounds/weapons/ak47/x.mp3.
Mono sources stay mono; everything is resampled to 44.1 kHz.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIST_FILES = "import { sampleFiles } from './src/audio/samples.ts'; console.log(JSON.stringify(sampleFiles()))"


def referenced_files() -> list[str]:
    out = subprocess.run(["bun", "-e", LIST_FILES], cwd=ROOT, check=True, capture_output=True, text=True, shell=os.name == "nt")
    return json.loads(out.stdout)


def main(src: str, dst: str) -> None:
    files = referenced_files()
    if os.path.isdir(dst):
        shutil.rmtree(dst)  # drop sounds the manifest no longer references
    missing = []
    for rel in files:
        wav = os.path.join(src, rel + ".wav")
        if not os.path.isfile(wav):
            missing.append(rel)
            continue
        mp3 = os.path.join(dst, rel + ".mp3")
        os.makedirs(os.path.dirname(mp3), exist_ok=True)
        # VBR ~130 kb/s stereo / ~65 kb/s mono; the LAME header lets browsers trim encoder delay.
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", wav, "-ar", "44100", "-codec:a", "libmp3lame", "-q:a", "4", mp3], check=True)
    total = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(dst) for f in fs)
    print(f"{len(files) - len(missing)} sounds -> {dst} ({total / 1e6:.1f} MB)")
    if missing:
        print("missing source files:\n  " + "\n  ".join(missing))
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
