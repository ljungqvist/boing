# react-native-boing-pose

Local [Nitro](https://nitro.margelo.com) module for the Boing app: MediaPipe pose landmarks for

- live [VisionCamera](https://visioncamera.margelo.com) frames (`PoseDetector.detect(frame)`, synchronous, for the
  frame-output worklet), and
- video files (`analyzeVideo`), decoding **every** frame with its own presentation time
  (Android: `MediaExtractor` + `MediaCodec`; iOS: `AVAssetReader`).

The spec is `src/specs/BoingPose.nitro.ts`. After changing it, regenerate the bindings:

```
npx nitrogen
```

The generated code in `nitrogen/generated/` is committed.
