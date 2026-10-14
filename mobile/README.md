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

`analyze-on-device.sh` uses the app's `boing://analyze?path=…` link (a file in the app's external files
folder) and reads the result from the log (`BOING_FILE …`). Live jumps log `BOING_LIVE` and
`BOING_LOG` lines.

## Native module

After changing `modules/react-native-boing-pose/src/specs/BoingPose.nitro.ts`, run `npm run specs`
(Nitrogen) and rebuild.
