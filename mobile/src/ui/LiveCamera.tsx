import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet } from "react-native";
import { boingPose, type PoseDetector } from "react-native-boing-pose";
import {
  Camera,
  type CameraRef,
  type CameraSessionConfig,
  type Frame,
  useCameraDevice,
  useFrameOutput,
  useVideoOutput,
} from "react-native-vision-camera";
import { Accelerometer, Gyroscope } from "expo-sensors";
import { scheduleOnRN } from "react-native-worklets";
import { bestFps } from "../logic/camera";
import { LiveController, type LiveEvents } from "../logic/live";
import { SampleBuffer } from "../logic/motion";
import { keepClip } from "../native/debug";
import { fromDetect, toFrames } from "../logic/pose";
import { deleteQuietly, modelPath, toPath } from "../native/models";
import { PoseFeed, Skeleton } from "./Skeleton";

export interface CameraInfo {
  /** Frame rate the camera session runs at. */
  fps: number;
  /** "GPU" or "CPU". */
  delegate: string;
}

interface Props {
  facing: "front" | "back";
  events: LiveEvents;
  /** Loading progress and errors, for the status line. */
  onStep: (text: string) => void;
  onError: (e: Error) => void;
  onInfo: (info: CameraInfo) => void;
  /** Receives the controller while the camera runs (null when it stops). */
  controllerRef: React.MutableRefObject<LiveController | null>;
  /** Keep the clips of measured jumps (each in a folder of its own) instead of deleting them. */
  keep: boolean;
  /** A clip was kept: its folder id and file name. */
  onKeptClip?: (id: string, name: string) => void;
}

/** Motion sensors at 100 Hz (Android's limit without extra permission is 200 Hz). */
const SENSOR_MS = 10;

/** The live camera: preview, recording, and pose on as many frames as the phone manages. */
export function LiveCamera({ facing, events, onStep, onError, onInfo, controllerRef, keep, onKeptClip }: Props) {
  const device = useCameraDevice(facing, { physicalDevices: ["wide-angle"] });
  const fps = useMemo(() => (device ? bestFps(device.supportedFPSRanges) : 30), [device]);
  const videoOutput = useVideoOutput({ enableAudio: false });
  const [detector, setDetector] = useState<PoseDetector | null>(null);
  const model = useRef<string | null>(null);
  /** Model for re-measuring jumps from the recording: heavy (steadier feet, see docs/evaluation). */
  const measureModel = useRef<string | null>(null);
  const info = useRef<CameraInfo>({ fps: 0, delegate: "" });
  const cameraRef = useRef<CameraRef>(null);
  const maxFps = useMemo(() => (device ? Math.max(0, ...device.supportedFPSRanges.map((r) => r.max)) : 0), [device]);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const debugRef = useRef({ keep, onKeptClip });
  debugRef.current = { keep, onKeptClip };

  // The phone's tilt and movement around each jump: accelerometer and gyroscope, last 60 s.
  const acc = useMemo(() => new SampleBuffer(60), []);
  const gyro = useMemo(() => new SampleBuffer(60), []);
  useEffect(() => {
    Accelerometer.setUpdateInterval(SENSOR_MS);
    Gyroscope.setUpdateInterval(SENSOR_MS);
    const subs = [
      Accelerometer.addListener((e) => acc.add([e.timestamp, e.x, e.y, e.z])),
      Gyroscope.addListener((e) => gyro.add([e.timestamp, e.x, e.y, e.z])),
    ];
    return () => subs.forEach((x) => x.remove());
  }, [acc, gyro]);

  // Pose model (downloaded on first use) and the live detector.
  useEffect(() => {
    let alive = true;
    let det: PoseDetector | null = null;
    modelPath("full", onStep)
      .then((uri) => {
        if (!alive) return;
        model.current = uri;
        onStep("Starting pose model…");
        det = boingPose.createDetector(toPath(uri), true);
        info.current = { ...info.current, delegate: det.delegate };
        onInfo(info.current);
        setDetector(det);
        // In the background; until it's there (or if it can't be loaded), re-measure with the live model.
        modelPath("heavy").then((h) => { if (alive) measureModel.current = h; }, () => {});
      })
      .catch((e) => alive && onError(e));
    return () => {
      alive = false;
      setDetector(null);
      // Let a frame being analysed finish before freeing the model.
      setTimeout(() => det?.close(), 500);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The controller: live tracking, recording in clips, re-measuring each jump.
  const controller = useMemo(() => {
    if (!detector) return null;
    return new LiveController(
      {
        async startClip() {
          const recorder = await videoOutput.createRecorder({});
          let finish!: (path: string) => void;
          let fail!: (e: Error) => void;
          const finished = new Promise<string>((ok, no) => { finish = ok; fail = no; });
          await recorder.startRecording((path) => finish(path), (e) => fail(e));
          return {
            async stop() {
              await recorder.stopRecording();
              return finished;
            },
          };
        },
        async analyzeClip(path, from, to) {
          const run = (m: string) =>
            boingPose.analyzeVideo(path, { modelPath: toPath(m), from, to, minInterval: 0, preferGpu: true }, () => {});
          let heavy = measureModel.current;
          let r;
          try {
            r = await run(heavy ?? model.current!);
          } catch (e) {
            if (!heavy) throw e;
            // A heavy model that won't load (damaged download): stay with the live model from now on.
            measureModel.current = heavy = null;
            r = await run(model.current!);
          }
          const facts = { ...clipFacts(path), model: heavy ? "heavy" : "full" };
          return { frames: toFrames(r), size: { width: r.width, height: r.height }, video: facts };
        },
        deleteClip(path, hasJumps) {
          const { keep: keepIt, onKeptClip: kept } = debugRef.current;
          const k = keepIt && hasJumps ? keepClip(path) : null;
          if (k) kept?.(k.id, k.name);
          else deleteQuietly(path);
        },
        motion: (from, to) => ({ acc: acc.window(from, to), gyro: gyro.window(from, to) }),
        camera: () => {
          const c = cameraRef.current?.controller;
          return {
            fps: info.current.fps, maxFps,
            ...(c ? { exposureS: c.exposureDuration, iso: c.iso, exposureMode: c.exposureMode } : {}),
          };
        },
      },
      {
        status: (s) => eventsRef.current.status(s),
        measuring: () => eventsRef.current.measuring(),
        result: (m) => eventsRef.current.result(m),
        log: (e) => eventsRef.current.log?.(e),
      },
      // The heavy model takes several seconds per jump on a mid-range phone.
      { timeoutMs: 60_000 },
    );
  }, [detector, videoOutput, acc, gyro, maxFps]);

  useEffect(() => {
    controllerRef.current = controller;
    return () => {
      if (controllerRef.current === controller) controllerRef.current = null;
      void controller?.stop();
    };
  }, [controller, controllerRef]);

  const feed = useMemo(() => new PoseFeed(), []);
  const onPose = useCallback((a: number[]) => {
    const { frame, size } = fromDetect(a);
    if (!controller) return;
    controller.push(frame, size);
    feed.emit({ lm: frame.lm, size, air: controller.airborne });
  }, [controller, feed]);

  const onFrame = useCallback((frame: Frame) => {
    "worklet";
    try {
      if (detector) scheduleOnRN(onPose, detector.detect(frame));
    } finally {
      frame.dispose();
    }
  }, [detector, onPose]);

  const frameOutput = useFrameOutput({
    pixelFormat: "rgb",
    enablePhysicalBufferRotation: true,
    dropFramesWhileBusy: true,
    onFrame,
  });

  const onConfig = useCallback((c: CameraSessionConfig) => {
    info.current = { ...info.current, fps: c.selectedFPS ?? 0 };
    onInfo(info.current);
  }, [onInfo]);

  const outputs = useMemo(() => [videoOutput, frameOutput], [videoOutput, frameOutput]);
  const constraints = useMemo(() => [{ fps }, { resolutionBias: videoOutput }], [fps, videoOutput]);

  if (!device) return null;
  return (
    <>
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        isActive
        device={device}
        outputs={outputs}
        constraints={constraints}
        onSessionConfigSelected={onConfig}
        onError={onError}
        resizeMode="cover"
      />
      {/* The front camera's preview is mirrored. Its analysed frames are too on iOS (VisionCamera
          mirrors the rotated buffers), not on Android, where the skeleton must be flipped. */}
      <Skeleton feed={feed} mirrored={facing === "front" && Platform.OS === "android"} />
    </>
  );
}

/** The recorded file as stored (size, rotation, frame rate), for the diagnostics. */
function clipFacts(path: string): Record<string, unknown> {
  try {
    const v = boingPose.videoInfo(path);
    return { width: v.width, height: v.height, rotation: v.rotation, fps: v.fps, peakFps: v.peakFps, duration: v.duration, frames: v.frameCount };
  } catch (e) {
    return { error: String((e as Error)?.message ?? e) };
  }
}
