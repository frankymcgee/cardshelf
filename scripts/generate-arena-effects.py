#!/usr/bin/env python3
"""Rebuild the twelve original Arena cues and their integrity records.

Standard-library synthesis only: no downloads, borrowed melodies or samples.
Run from any directory with Python 3. Bundled WAVs need no runtime generator.
"""
import hashlib
import json
import math
from pathlib import Path
import random
import struct
import wave

ROOT = Path(__file__).resolve().parents[1] / "public/audio/arena"
RATE = 22050


def cue(name, duration, tones=(), sweeps=(), noises=()):
    samples = [0.0] * round(RATE * duration)
    rng = random.Random(name)
    for start, length, first, last, gain in [
        *[(start, length, frequency, frequency, gain) for start, length, frequency, gain in tones],
        *sweeps,
    ]:
        phase = 0.0
        for i in range(round(RATE * length)):
            t = i / RATE
            phase += 2 * math.pi * (first + (last - first) * t / length) / RATE
            envelope = min(1, t / .008) * min(1, (length - t) / .025)
            index = round(start * RATE) + i
            if index < len(samples):
                samples[index] += gain * envelope * (math.sin(phase) + .15 * math.sin(2 * phase))
    for start, length, gain in noises:
        previous = 0.0
        for i in range(round(RATE * length)):
            t = i / RATE
            # A filtered, seeded paper-like brush with tapered edges.
            previous = .55 * previous + .45 * rng.uniform(-1, 1)
            envelope = min(1, t / .005) * (1 - t / length) ** 2
            index = round(start * RATE) + i
            if index < len(samples):
                samples[index] += gain * envelope * previous
    peak = max(abs(sample) for sample in samples) or 1
    gain = min(1, .62 / peak)
    payload = struct.pack("<" + "h" * len(samples), *[
        round(max(-1, min(1, sample * gain)) * 32767) for sample in samples
    ])
    with wave.open(str(ROOT / (name + ".wav")), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(RATE)
        output.writeframes(payload)


cue("draw", .18, tones=[(.025, .11, 740, .12)], noises=[(0, .11, .45)])
cue("energy", .32, sweeps=[(0, .24, 260, 900, .25)], tones=[(.17, .13, 1320, .12)])
cue("bench", .22, sweeps=[(0, .1, 300, 110, .28)], noises=[(0, .06, .3)], tones=[(.085, .11, 520, .12)])
cue("evolve", .55, tones=[(0, .19, 330, .18), (.1, .2, 495, .18), (.22, .26, 660, .18)], sweeps=[(.1, .35, 220, 1320, .1)])
cue("trainer", .26, noises=[(0, .07, .35)], tones=[(.03, .1, 480, .18), (.12, .11, 720, .18)])
cue("switch", .3, sweeps=[(0, .12, 800, 260, .17), (.13, .14, 260, 800, .17)], noises=[(0, .25, .25)])
cue("prize", .42, tones=[(0, .14, 880, .2), (.11, .15, 1100, .18), (.23, .17, 1320, .17)])
cue("ability", .38, sweeps=[(0, .15, 400, 1200, .19), (.14, .19, 1200, 600, .15)], tones=[(.21, .15, 900, .12)])
cue("heal", .46, tones=[(0, .2, 528, .17), (.12, .22, 660, .17), (.25, .19, 792, .15)])
cue("damage", .22, sweeps=[(0, .17, 180, 65, .27)], noises=[(0, .12, .55)])
cue("miss", .28, sweeps=[(0, .22, 650, 240, .13)], noises=[(0, .17, .22)])
cue("shuffle", .32, noises=[(0, .07, .45), (.07, .07, .45), (.14, .07, .45), (.21, .07, .45)])

manifest_path = ROOT / "manifest.json"
manifest = json.loads(manifest_path.read_text())
names = {name + ".wav" for name in ["draw", "energy", "bench", "evolve", "trainer", "switch", "prize", "ability", "heal", "damage", "miss", "shuffle"]}
manifest["files"] = [entry for entry in manifest["files"] if entry["file"] not in names]
for name in sorted(names):
    data = (ROOT / name).read_bytes()
    manifest["files"].append({"file": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "source": "Original synthesized CardShelf audio; scripts/generate-arena-effects.py"})
manifest["files"].sort(key=lambda entry: entry["file"])
manifest["release"] = "0.52.4"
manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
