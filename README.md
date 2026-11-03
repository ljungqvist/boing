# Boing

Measures the height of a countermovement jump (two feet, hands on hips) from video,
in the browser, on a laptop or a phone.

Pose estimation (MediaPipe) finds your hips and toes in every frame. During flight
the body is in free fall, so the hips follow a parabola. Boing fits that parabola and
computes the height from **timing only**: takeoff → highest point, `h = g/2·t²`.
Because only times are used, camera distance, zoom and angle don't matter, as long as
your whole body, including the feet, is visible.

Two numbers are shown per jump:

- **Height** (large): rise from takeoff to the highest point, comparable to a force plate.
- **Flight-time height**: `g·T²/8` from takeoff to landing, comparable to contact mats
  and the My Jump app. It differs from the first when the body is lower at landing than at takeoff.

The app only gives instructions about the setup (hands on hips, body and feet in view).
How the jump is performed is up to the athlete and their coach.

## Use

1. Put the phone (or laptop) 2–3 m away, so your whole body including the feet is in view.
   Lying on the floor tilted up works.
2. Press **Start** (the round button). When the status turns green (**Ready**), jump with
   hands on hips. After the landing the video shows "Measuring…", then the height, which is
   also spoken out loud (speaker icon to turn off). The camera switch button flips between
   front and back camera.

   While live, the app records the camera continuously (in overlapping 6-second pieces) and
   measures each detected jump again from **every recorded frame**, so a slow phone gets as
   many frames in the air as a fast one. A "≈" in front of a height means only the live
   analysis could be used (fewer frames). Debug: `?refine=off` turns this off.
3. **Film icon**: analyse a recording frame by frame. Most accurate with the phone's
   slow-motion mode (120/240 fps). Android slow-motion files are converted to real time
   automatically.

Accuracy (see `docs/evaluation/`): about ±2–4 cm at 30 fps. Higher frame rates
should be considerably better, but this hasn't been measured against a reference yet.
HEVC (H.265) videos play in Safari and in Chrome on most Macs and phones, but not in Firefox.

## Run locally

```
npm install
npm run dev            # https://localhost:5173 (self-signed certificate)
npm run dev -- --host  # also reachable from a phone on the same Wi-Fi
```

Phones only allow the camera over HTTPS, so accept the certificate warning on the phone.

## Static build / GitHub Pages

```
npm run build          # static site in dist/, open from any web server
```

Two versions are published on GitHub Pages by `.github/workflows/pages.yml`:

| Branch | Address | Purpose |
|---|---|---|
| `main` | https://ljungqvist.github.io/boing/ | stable |
| `dev` | https://ljungqvist.github.io/boing/dev/ | testing |

A push to either branch rebuilds and publishes both. A broken `dev` build never blocks
`main`. Work goes to `dev` first and is merged into `main` when it's good.
`tools/kapsi.sh web` also builds and publishes it at https://ljungqvist.info/boing/ (the
APK links moved to `/boing/apk`). `boing.ljungqvist.info` has no DNS record.
The pose models are downloaded from Google's MediaPipe model storage at runtime.

## Development

```
npm test               # unit tests (analysis, MP4 metadata)
npm run e2e            # end-to-end in Google Chrome with a fake camera; needs ../boing-data
npm run evaluate       # offline evaluation over the test videos (see docs/evaluation)
```

Offline tools (Python, `requirements.txt`): `tools/extract_pose.py` (landmarks per frame),
`tools/plot_jumps.py`, `tools/make_y4m.py` (fake-camera input). Test videos are not in
the repository; `testdata/videos.json` lists their sources.
