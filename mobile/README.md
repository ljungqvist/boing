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
For development with hot reload: `npx expo run:android` (debug build + Metro).

## iOS

Not built yet: this needs Xcode (or a cloud build, e.g. `eas build -p ios`, which needs an Expo account
and an Apple developer account). Then `npx expo prebuild --platform ios && npx expo run:ios --device`.
The Swift code in `modules/react-native-boing-pose/ios` has not been compiled yet.

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
