"""Renders the demo's narration with Chatterbox TTS, one WAV per line.

    python video/demo/narrate.py <out dir> [id ...]

Reads video/demo/narration.json. Each line has its own `exaggeration`
(how much expression Chatterbox puts in: about 0.5 is even, 0.7 is lively).
Runs on CPU; roughly five seconds of compute per second of speech.
"""

import json
import pathlib
import sys
import time

import torch
import torchaudio as ta

# Chatterbox watermarks its audio with an optional library; when that library
# can't load, fall back to its no-op watermarker rather than failing.
import perth

if getattr(perth, "PerthImplicitWatermarker", None) is None:
    perth.PerthImplicitWatermarker = perth.DummyWatermarker

from chatterbox.tts import ChatterboxTTS  # noqa: E402

torch.set_num_threads(4)
torch.manual_seed(7)

out = pathlib.Path(sys.argv[1])
only = set(sys.argv[2:])
out.mkdir(parents=True, exist_ok=True)
lines = json.loads((pathlib.Path(__file__).parent / "narration.json").read_text())

model = ChatterboxTTS.from_pretrained(device="cpu")
for line in lines:
    if only and line["id"] not in only:
        continue
    t = time.time()
    wav = model.generate(line["text"], exaggeration=line["exaggeration"], cfg_weight=0.45, temperature=0.7)
    ta.save(str(out / f"{line['id']}.wav"), wav, model.sr)
    print(f"{line['id']}: {wav.shape[-1] / model.sr:.1f}s audio in {time.time() - t:.0f}s", flush=True)
