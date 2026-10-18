#!/usr/bin/env bash
# Renders the README's motion graphics into ../docs/media: MP4s at full size,
# and animated WebP copies small enough for GitHub to show inline.
#   BROWSER=/path/to/chrome-headless-shell ./render.sh
set -euo pipefail
cd "$(dirname "$0")"
B=${BROWSER:+--browser-executable=$BROWSER}
OUT=../docs/media
mkdir -p out "$OUT"

npx remotion still src/index.ts Banner "$OUT/manifest-banner.png" $B --log=error
for id in Film GraphModel Setup; do
  npx remotion render src/index.ts "$id" "out/$id.mp4" --codec=h264 --crf=20 $B --log=error
done

webp() { # in out width fps
  ffmpeg -y -loglevel error -i "$1" -vf "fps=$4,scale=$3:-1:flags=lanczos" -c:v libwebp_anim -lossless 0 -q:v 80 -compression_level 6 -loop 0 "$2"
}
webp out/Film.mp4 "$OUT/manifest-film.webp" 960 15
webp out/GraphModel.mp4 "$OUT/graph-model.webp" 960 15
webp out/Setup.mp4 "$OUT/setup-film.webp" 960 15
cp out/Film.mp4 "$OUT/manifest-film.mp4"
cp out/Setup.mp4 "$OUT/setup-film.mp4"
ls -la "$OUT"
