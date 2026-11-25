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
import { screenFacesDown } from "../logic/blind";
import { bestFps } from "../logic/camera";
import { LiveController, type LiveEvents } from "../logic/live";
import { SampleBuffer } from "../logic/motion";
import { keepClip } from "../native/debug";
import { DarkDetector, type TorchMode, meanBrightness } from "../logic/torch";
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
  /** Re-measure on the CPU instead of the GPU (debug setting, to compare the speed). */
  measureOnCpu?: boolean;
  /** The recording's clock shift remembered for this camera (`LiveOptions.clockShift`), if any. */
  clockShift?: number;
  /** A clock shift to remember for this camera (NaN: forget the remembered one). */
  onClockShift?: (seconds: number) => void;
  /** The screen turned to face below the horizon (`true`) or above it again (blind mode). */
  onScreenDown?: (down: boolean) => void;
  /** The back camera's flashlight: off, automatic (when the picture is dark) or always on. */
  torch?: TorchMode;
  /** The flashlight is lit (or not): for the button. */
  onTorchLit?: (lit: boolean) => void;
  /** What the camera says about the flashlight, for the Settings sheet (diagnostics). */
  onTorchReport?: (text: string) => void;
}

/** Motion sensors at 100 Hz (Android's limit without extra permission is 200 Hz). */
const SENSOR_MS = 10;

/**
 * CPU copies of the pose model sharing the frames of a re-measurement with the first one (Android; fewer on phones with
 * little memory). On a slow tablet (2026-11-25): 239 ms per frame on the GPU alone, 162 with one helper, 142 with two.
 */
const CPU_HELPERS = 2;

/** The live camera: preview, recording, and pose on as many frames as the phone manages. */
export function LiveCamera({ facing, events, onStep, onError, onInfo, controllerRef, keep, onKeptClip, measureOnCpu = false, clockShift, onClockShift, onScreenDown, torch = "off", onTorchLit, onTorchReport }: Props) {
  const wide = useCameraDevice(facing, { physicalDevices: ["wide-angle"] });
  // On phones with several back cameras the single wide-angle lens reports no flash unit (the flash
  // belongs to the combined back camera). With the flashlight on or auto, use the default back camera
  // then, which has it; with it off, nothing changes.
  const combined = useCameraDevice(facing);
  const device = torch !== "off" && facing === "back" && wide?.hasTorch !== true && combined?.hasTorch === true ? combined : wide;
  const fps = useMemo(() => (device ? bestFps(device.supportedFPSRanges) : 30), [device]);
  const videoOutput = useVideoOutput({ enableAudio: false });
  const [detector, setDetector] = useState<PoseDetector | null>(null);
  const model = useRef<string | null>(null);
  /** Model for re-measuring jumps from the recording: heavy (steadier feet). */
  const measureModel = useRef<string | null>(null);
  const clockShiftRef = useRef(onClockShift);
  clockShiftRef.current = onClockShift;
  const info = useRef<CameraInfo>({ fps: 0, delegate: "" });
  const cameraRef = useRef<CameraRef>(null);
  const maxFps = useMemo(() => (device ? Math.max(0, ...device.supportedFPSRanges.map((r) => r.max)) : 0), [device]);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const debugRef = useRef({ keep, onKeptClip });
  debugRef.current = { keep, onKeptClip };

  const screenDownRef = useRef(onScreenDown);
  screenDownRef.current = onScreenDown;

  // Flashlight (back camera only). Automatic mode watches the picture's brightness and, once it has
  // been dark for a while, lights the torch for the rest of this run (see DarkDetector).
  const [dark, setDark] = useState(false);
  const darkDetector = useMemo(() => new DarkDetector(), []);
  const hasTorch = facing === "back" && device?.hasTorch === true;
  const lit = hasTorch && (torch === "on" || (torch === "auto" && dark));
  const torchLitRef = useRef(onTorchLit);
  torchLitRef.current = onTorchLit;
  useEffect(() => {
    if (torch !== "auto") {
      darkDetector.reset();
      setDark(false);
    }
  }, [torch, darkDetector]);
  useEffect(() => {
    torchLitRef.current?.(lit);
    return () => torchLitRef.current?.(false);
  }, [lit]);
  const litRef = useRef(lit);
  litRef.current = lit;
  const reportRef = useRef(onTorchReport);
  reportRef.current = onTorchReport;
  // Watchdog: the camera may drop the torch when it reconfigures (rebinding), and the prop only
  // acts on changes. Every 1.5 s compare with what the camera reports and set it again if needed.
  // The outcome also goes to the Settings sheet, to see why a light stays off.
  useEffect(() => {
    const report = (t: string) => reportRef.current?.(t);
    if (facing !== "back") return report("");
    if (!device) return;
    if (!device.hasTorch) return report(`no flash unit on camera ${device.id}`);
    const tick = () => {
      const c = cameraRef.current?.controller;
      const want = litRef.current ? "on" : "off";
      if (!c) return report("camera not ready yet");
      let have: string;
      try { have = c.torchMode; } catch (e) { return report(`can't read: ${String((e as Error)?.message ?? e)}`); }
      if (have === want) return report(`${have} (as wanted), camera ${device.id}`);
      c.setTorchMode(want).then(
        () => report(`set ${want} (was ${have})`),
        (e) => report(`setting ${want} failed: ${String((e as Error)?.message ?? e)}`),
      );
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => clearInterval(id);
  }, [facing, device]);
  /** Whether frames are checked for darkness: automatic mode, light not on yet. */
  const sense = hasTorch && torch === "auto" && !dark;

  // The phone's tilt and movement around each jump: accelerometer and gyroscope, last 60 s.
  const acc = useMemo(() => new SampleBuffer(60), []);
  const gyro = useMemo(() => new SampleBuffer(60), []);
  useEffect(() => {
    Accelerometer.setUpdateInterval(SENSOR_MS);
    Gyroscope.setUpdateInterval(SENSOR_MS);
    // Where "up" is in the phone's axes, smoothed (≈ 0.2 s), for blind mode. Android reports the
    // reaction to gravity (+z with the screen up), iOS gravity itself.
    const sign = Platform.OS === "ios" ? -1 : 1;
    let up: { x: number; y: number; z: number } | null = null;
    let down = false;
    const SMOOTH = 0.05;
    const subs = [
      Accelerometer.addListener((e) => {
        acc.add([e.timestamp, e.x, e.y, e.z]);
        const [x, y, z] = [sign * e.x, sign * e.y, sign * e.z];
        up = up ? { x: up.x + SMOOTH * (x - up.x), y: up.y + SMOOTH * (y - up.y), z: up.z + SMOOTH * (z - up.z) } : { x, y, z };
        const now = screenFacesDown(up, down);
        if (now !== down) {
          down = now;
          screenDownRef.current?.(now);
        }
      }),
      Gyroscope.addListener((e) => gyro.add([e.timestamp, e.x, e.y, e.z])),
    ];
    return () => {
      subs.forEach((x) => x.remove());
      if (down) screenDownRef.current?.(false);
    };
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
        // Loaded ahead of each jump, so measuring doesn't wait for it.
        modelPath("heavy").then((h) => {
          if (!alive) return;
          measureModel.current = h;
          boingPose.prepare(toPath(h), !measureOnCpu, true);
        }, () => {});
      })
      .catch((e) => alive && onError(e));
    return () => {
      alive = false;
      setDetector(null);
      boingPose.releasePrepared();
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
        async analyzeClip(path, from, to, perFrame) {
          // Frame by frame, CPU copies of the model share the frames with the first one (fewer on phones with little memory).
          const run = (m: string) => boingPose.analyzeVideo(path, {
            modelPath: toPath(m), from, to, minInterval: 0, preferGpu: !measureOnCpu, perFrame, cpuHelpers: perFrame ? CPU_HELPERS : 0,
          }, () => {});
          let heavy = measureModel.current;
          let r;
          try {
            r = await run(heavy ?? model.current!);
          } catch (e) {
            if (!heavy) throw e;
            // A heavy model that won't load (damaged download): stay with the live model from now on.
            measureModel.current = heavy = null;
            boingPose.releasePrepared();
            r = await run(model.current!);
          }
          const facts = { ...clipFacts(path), model: heavy ? "heavy" : "full", mode: perFrame ? "image" : "video" };
          return {
            frames: toFrames(r), size: { width: r.width, height: r.height }, video: facts,
            timing: { ...r.timing, delegate: r.delegate },
          };
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
        result: (m, measuring) => eventsRef.current.result(m, measuring),
        log: (e) => eventsRef.current.log?.(e),
        // While a jump is measured, no pose on the camera frames: the phone's power goes to the measurement.
        paused: (on) => { detector.minInterval = on ? Infinity : 0; },
        clockShift: (x) => clockShiftRef.current?.(x),
      },
      // The heavy model takes several seconds per jump on a mid-range phone.
      { timeoutMs: 60_000, clockShift },
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
  const onPose = useCallback((a: number[], brightness: number) => {
    if (Number.isFinite(brightness) && darkDetector.update(brightness, Date.now() / 1000)) setDark(true);
    const { frame, size } = fromDetect(a);
    if (!controller) return;
    controller.push(frame, size);
    // No skeleton while a jump is measured ("not ready").
    feed.emit({ lm: controller.measuring ? null : frame.lm, size, air: controller.airborne });
  }, [controller, feed, darkDetector]);

  const onFrame = useCallback((frame: Frame) => {
    "worklet";
    try {
      if (detector) {
        const a = detector.detect(frame);
        // Empty: skipped (live analysis paused while measuring).
        if (a.length > 0) {
          const brightness = sense && frame.hasPixelBuffer
            ? meanBrightness(new Uint8Array(frame.getPixelBuffer()), frame.width, frame.height, frame.bytesPerRow)
            : NaN;
          scheduleOnRN(onPose, a, brightness);
        }
      }
    } finally {
      frame.dispose();
    }
  }, [detector, onPose, sense]);

  const frameOutput = useFrameOutput({
    pixelFormat: "rgb",
    enablePhysicalBufferRotation: true,
    dropFramesWhileBusy: true,
    onFrame,
  });

  /** The flashlight failing (no flash unit, busy) must never stop the camera. */
  const onCameraError = useCallback((e: Error) => {
    if (/torch|flash/i.test(String(e?.message ?? e))) {
      reportRef.current?.(`camera error: ${String(e?.message ?? e)}`);
      return;
    }
    onError(e);
  }, [onError]);

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
        key={device.id}
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        isActive
        device={device}
        outputs={outputs}
        constraints={constraints}
        onSessionConfigSelected={onConfig}
        // No torchMode prop: its errors ("Camera is not active" while the camera is still opening)
        // reach onError and stopped the whole camera. The torch is set by the watchdog above.
        onError={onCameraError}
        resizeMode="cover"
        // The app is portrait only. With the default ("device") a phone lying on the floor reads as
        // landscape at random: the clips got a ±90° rotation tag and were re-measured sideways.
        orientationSource="interface"
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
