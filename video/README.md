# The README's films

Motion graphics for the README, made with [Remotion](https://www.remotion.dev) in LockIn's own look: grid paper, the cover label, Barlow Condensed, Spectral and JetBrains Mono (the app's font files, copied into `public/fonts`). It's a project of its own and isn't part of the app's build.

| Composition | What it is | Output in `docs/media` |
|---|---|---|
| `Film` | The product film: what LockIn is, then each thing LockIn Manifest adds (about 80 s) | `manifest-film.webp`, `manifest-film.mp4` |
| `GraphModel` | The graph model, drawing itself | `graph-model.webp` |
| `Setup` | Setup with Docker Compose, then the scenario passing | `setup-film.webp`, `setup-film.mp4` |
| `Banner` | The README banner (a still) | `manifest-banner.png` |

```sh
cd video
npm install
npm run studio     # preview and scrub in the browser
./render.sh        # render everything into ../docs/media (needs ffmpeg with libwebp)
```

`render.sh` uses the Chrome Remotion downloads. To use another one, set `BROWSER=/path/to/chrome-headless-shell`.

The scenes are in `src/scenes-intro.tsx` (LockIn) and `src/scenes-features.tsx` (LockIn Manifest), with timings in `src/Film.tsx`. The tool calls and replies they show are shortened from the real ones in `eval/scenario.mjs`.
