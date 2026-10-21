# Boing — native app (React Native)

The web app's jump measurement, as an Android/iOS app that records at the camera's highest frame rate
(up to 240 fps) and measures each jump again from **every recorded frame**.
Design: `../docs/superpowers/specs/2026-10-14-react-native-app-design.md`.

- Expo (continuous native generation: `android/` and `ios/` are generated, not committed)
- Camera: [VisionCamera 5](https://visioncamera.margelo.com) (preview + video recording + frame output)
- Pose: MediaPipe Pose Landmarker (same models as the web app), in the local Nitro module
  `modules/react-native-boing-pose` (live frames and video files)
- Analysis: the web app's `../src/analysis` (shared, unchanged)

## Build and run (Android)

Needs JDK 17 and the Android SDK (`brew install openjdk@17 && brew install --cask android-commandlinetools`;
the NDK and CMake are downloaded by Gradle on the first build).

```
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
npm install
npx expo prebuild --platform android --clean   # generates android/
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
adb install -r app/build/outputs/apk/release/app-release.apk
```

The release APK is signed with the debug key (fine for installing on your own phone).

CI builds every push to `main` and `dev` and publishes the APK on a rolling GitHub release,
downloadable without a GitHub login:

- main: https://github.com/ljungqvist/boing/releases/latest/download/boing.apk
- dev: https://github.com/ljungqvist/boing/releases/download/dev-latest/boing-dev.apk
For development with hot reload: `npx expo run:android` (debug build + Metro).

## iOS

Needs iPadOS/iOS 16.4 or later (Expo SDK 57). Built and tested in CI on a macOS runner
(`.github/workflows/ios.yml`, on every push that touches `mobile/`): prebuild, `pod install`, a
simulator build, then the app analyses two generated test videos in an iPad simulator and must
measure their known 30 cm jump within ±1.5 cm (stored upright and stored sideways with a rotation,
like an iPhone portrait video). The run also uploads an unsigned device build
(`Boing-unsigned.ipa`) that can be signed and installed with a free Apple ID (Sideloadly, AltStore).

On a Mac with Xcode:

```
npm install
npx expo prebuild --platform ios
npx expo run:ios --device          # or: cd ios && pod install && open Boing.xcworkspace
scripts/make-test-jump.sh videos   # the CI test videos (needs ffmpeg)
scripts/analyze-on-simulator.sh videos/jump-upright.mp4   # app installed on a booted simulator
```

`analyze-on-simulator.sh` restarts the app with the launch argument `-boingAnalyze <url>` (links
would wait for an "Open in Boing?" prompt) and reads the result from the app's
`Documents/boing-file-result.json` (iOS release builds don't log). The app's status lines go to
`Documents/boing-test-log.txt` meanwhile.

- The simulator runs MediaPipe on the CPU: its GPU path aborts there. Devices try the GPU first.
- Not yet tried on a device: the live camera (preview, skeleton overlay, 120/240 fps formats) and
  the GPU path.
- iPhone slow-motion videos: files store no capture rate (Android does), so a slow-motion export
  is measured as if it were real time (the flight looks longer: heights far too high).

## Frame rates

The app asks for the highest frame rate the camera offers (capped at 240) and shows the selected rate in
the menu.

- **iPhone:** 120/240 fps formats are available to apps.
- **Android:** VisionCamera uses CameraX in normal (not "high-speed") sessions, so expect 30 or 60 fps.
  For 120/240 fps, record with the phone's own slow-motion mode and open the file with the film button:
  Android slow-motion files are converted to real time from their metadata.

## Testing

```
npm test                    # (repo root) unit tests, including mobile/src/logic
npm run typecheck           # (mobile/)
scripts/analyze-on-device.sh <video.mp4>   # analyse a file with the installed app (adb), prints JSON
```

`analyze-on-device.sh` serves the video from this computer over `adb reverse`, opens the app's
`boing://analyze?url=http://localhost:8765/…` link (the app downloads and analyses it) and reads the
result from the log (`BOING_FILE …`). Live jumps log `BOING_LIVE` and `BOING_LOG` lines.
Results against the web app: `../docs/evaluation/2026-10-14-native-app.md`.

On an Apple-silicon Mac, use an Android 13 emulator image with `-gpu host`: newer images advertise
CPU features (SME) the hypervisor doesn't provide, and MediaPipe's CPU path crashes (SIGILL).

## Debug recordings and the local dev server

```
python3 tools/devserver.py        # http://<this computer>:8765/ on the local network
```

- Put an APK into `../boing-data/apk/` and open the address on the phone to download and install it.
- Menu → "Keep recordings of measured jumps": from the next Start, each re-measured jump's clip stays on
  the phone with a `session.json` (diagnostics, pose per frame, accelerometer/gyroscope around the jump).
  "Move to computer" uploads them to the server (`../boing-data/uploads/<session>/`) and frees the phone.
- `npx tsx tools/review/pose_import.ts` turns pose data into landmark files for the review tools.

## Native module

After changing `modules/react-native-boing-pose/src/specs/BoingPose.nitro.ts`, run `npm run specs`
(Nitrogen) and rebuild.
