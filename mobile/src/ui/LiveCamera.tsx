import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet } from "react-native";
import { boingPose, type PoseDetector } from "react-native-boing-pose";
import {
  Camera,
  type CameraSessionConfig,
  type Frame,
  useCameraDevice,
  useFrameOutput,
  useVideoOutput,
} from "react-native-vision-camera";
import { scheduleOnRN } from "react-native-worklets";
import { bestFps } from "../logic/camera";
import { LiveController, type LiveEvents } from "../logic/live";
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
}

/** The live camera: preview, recording, and pose on as many frames as the phone manages. */
export function LiveCamera({ facing, events, onStep, onError, onInfo, controllerRef }: Props) {
  const device = useCameraDevice(facing, { physicalDevices: ["wide-angle"] });
  const fps = useMemo(() => (device ? bestFps(device.supportedFPSRanges) : 30), [device]);
  const videoOutput = useVideoOutput({ enableAudio: false });
  const [detector, setDetector] = useState<PoseDetector | null>(null);
  const model = useRef<string | null>(null);
  const info = useRef<CameraInfo>({ fps: 0, delegate: "" });
  const eventsRef = useRef(events);
  eventsRef.current = events;

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
          const r = await boingPose.analyzeVideo(
            path,
            { modelPath: toPath(model.current!), from, to, minInterval: 0, preferGpu: true },
            () => {},
          );
          return { frames: toFrames(r), size: { width: r.width, height: r.height }, video: clipFacts(path) };
        },
        deleteClip(path) {
          deleteQuietly(path);
        },
      },
      {
        status: (s) => eventsRef.current.status(s),
        measuring: () => eventsRef.current.measuring(),
        result: (m) => eventsRef.current.result(m),
        log: (e) => eventsRef.current.log?.(e),
      },
    );
  }, [detector, videoOutput]);

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
