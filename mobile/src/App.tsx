import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, PermissionsAndroid, Platform, Pressable, ScrollView, Settings, Share, StyleSheet, Text, View } from "react-native";
import { stopUploads } from "boing-upload";
import { boingPose } from "react-native-boing-pose";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { useCameraPermission } from "react-native-vision-camera";
import { discardFeedback } from "../../src/analysis/discard";
import { entriesForClip, type Entry } from "./logic/jumps";
import { debugPackage, describeLog, diagnosticsReport, poseReport } from "./logic/diagnostics";
import type { LiveController, LiveEvents } from "./logic/live";
import { accepted, cm, REJECT_TEXT, summarize } from "./logic/measure";
import type { Status, Tone } from "./logic/status";
import { measureVideo, type Measured } from "./logic/video";
import { nativeAnalyzer } from "./native/analyze";
import { CONSENT_TITLE, CONSENT_VERSION, consentText, hasConsent, isPhoneId, keepActive, newPhoneId } from "./logic/consent";
import { DEFAULT_SERVER, deleteSessions, keptSummary, loadSettings, markReady, requestErase, saveSettings, startUploading, writeSession } from "./native/debug";
import { announce, announceFailure } from "./native/feedback";
import { deleteQuietly, modelPath, toPath } from "./native/models";
import { Icon } from "./ui/Icon";
import { type CameraInfo, LiveCamera } from "./ui/LiveCamera";
import { JumpDetails, Row, Sheet } from "./ui/Sheets";
import { C } from "./ui/theme";

/** How long the latest height stays on top of the picture. */
const FLASH_MS = 5000;

type Mode = "idle" | "live" | "file";
type Flash = { text: string; measuring: boolean; failed?: boolean } | null;

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Main />
    </SafeAreaProvider>
  );
}

function Main() {
  const insets = useSafeAreaInsets();
  const permission = useCameraPermission();
  const [mode, setMode] = useState<Mode>("idle");
  const [facing, setFacing] = useState<"front" | "back">("front");
  const [status, setStatus] = useState<Status>({ text: "Press Start", tone: "idle" });
  const [results, setResults] = useState<Measured[]>([]);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [flash, setFlash] = useState<Flash>(null);
  const [sound, setSound] = useState(true);
  const [details, setDetails] = useState<number | null>(null);
  const [menu, setMenu] = useState(false);
  const [info, setInfo] = useState<CameraInfo | null>(null);
  /** The last camera info, kept after Stop for the shared diagnostics. */
  const lastInfo = useRef<CameraInfo | null>(null);
  if (info) lastInfo.current = info;
  /** The report of a crash in the previous run (shown once, then cleared). */
  const [crash, setCrash] = useState(() => {
    try {
      return boingPose.lastCrash();
    } catch {
      return "";
    }
  });
  /** How each live jump was measured (newest first), for the menu's diagnostics. */
  const [logs, setLogs] = useState<Record<string, unknown>[]>([]);
  const [session, setSession] = useState(0); // remounts the camera on Start/flip
  const controller = useRef<LiveController | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const run = useRef(0); // cancels a file analysis when something else starts
  /** Set by the testing hook: status lines then also go to a file (see `reportFile`). */
  const testing = useRef(false);
  useEffect(() => {
    if (testing.current) appendTestLog(status.text);
  }, [status]);
  // Debug: keep the clips of measured jumps with the session's data and send them to the developer,
  // only with consent (logic/consent.ts).
  const [settings, setSettings] = useState<Record<string, unknown>>(() => {
    const s = loadSettings();
    if (isPhoneId(s.phoneId)) return s;
    const next = { ...s, phoneId: newPhoneId() };
    saveSettings(next);
    return next;
  });
  const phoneId = settings.phoneId as string;
  const keep = keepActive(settings);
  const updateSettings = (patch: Record<string, unknown>) =>
    setSettings((old) => {
      const next = { ...old, ...patch };
      saveSettings(next);
      return next;
    });
  /** Clips of measured jumps are kept (and sent) in this run: decided at Start. */
  const [keepNow, setKeepNow] = useState(false);
  /** The log entries of this run that no kept clip has taken yet. */
  const clipLogs = useRef<Entry[]>([]);
  const [kept, setKept] = useState(() => keptSummary());
  const [sendStatus, setSendStatus] = useState("");
  const [ask, setAsk] = useState<"consent" | "withdraw" | null>(null);
  const [eraseSent, setEraseSent] = useState(true);

  // Recordings are sent as they come; at every start (and when switched on) whatever is still waiting
  // is handed to the upload service again, and the list of waiting jumps follows it.
  useEffect(() => {
    if (!keep) return;
    if (Platform.OS === "android" && Number(Platform.Version) >= 33) {
      // Only for the "Uploading" notification; the upload runs without it.
      void PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => {});
    }
    startUploading(phoneId);
    const t = setInterval(() => setKept(keptSummary()), 5000);
    return () => clearInterval(t);
  }, [keep, phoneId]);

  // A deletion request that couldn't be sent when consent was withdrawn (the old recording ID):
  // retried at every start.
  useEffect(() => {
    const old = settings.pendingErase;
    if (!isPhoneId(old)) return;
    requestErase(DEFAULT_SERVER, old)
      .then(() => updateSettings({ pendingErase: null }))
      .catch(() => {});
    // Once per start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new recording ID after withdrawing: anything sent with the old one can be deleted for good,
  // even if the person agrees again later.
  const withdraw = (eraseAll: boolean) => {
    const old = phoneId;
    stopUploads();
    deleteSessions();
    setKept(keptSummary());
    updateSettings({ keep: false, consent: null, phoneId: newPhoneId(), pendingErase: eraseAll ? old : null });
    setAsk(null);
    if (!eraseAll) return setSendStatus("Consent withdrawn. Recordings on this phone deleted.");
    setSendStatus("Consent withdrawn. Sending the deletion request…");
    requestErase(DEFAULT_SERVER, old)
      .then(() => {
        updateSettings({ pendingErase: null });
        setSendStatus("Consent withdrawn. Deletion requested: everything you sent is deleted within 30 days.");
      })
      .catch(() => setSendStatus("Consent withdrawn. The deletion request is sent the next time Boing starts with a connection."));
  };

  const showFlash = useCallback((f: Flash, ms = FLASH_MS) => {
    clearTimeout(flashTimer.current);
    setFlash(f);
    if (f && !f.measuring) flashTimer.current = setTimeout(() => setFlash(null), ms);
  }, []);

  const clear = useCallback(() => {
    setResults([]);
    setIgnored([]);
    setLogs([]);
    setFlash(null);
    setDetails(null);
  }, []);

  /** Shows (and for live jumps announces) a result; resolves once it has been said. */
  const addResult = useCallback((m: Measured, live: boolean): Promise<void> => {
    const j = m.jump;
    if (!accepted(j)) {
      const reason = j.flags.map((f) => REJECT_TEXT[f]).filter(Boolean).join(", ");
      setIgnored((xs) => [`at ${j.tOff.toFixed(1)} s: ${reason} (${(j.hPrimary * 100).toFixed(0)} cm)`, ...xs]);
      if (live) {
        // Say so only if the recording was re-measured and still gave no height; live rejects stay silent.
        const feedback = discardFeedback({ refined: m.refined, pending: controller.current?.pending ?? 0 });
        if (feedback === "failure") {
          showFlash({ text: "Couldn't measure", measuring: false, failed: true });
          return announceFailure(soundRef.current);
        } else if (feedback === "clear-measuring") setFlash((f) => (f?.measuring ? null : f));
      }
      return Promise.resolve();
    }
    setResults((xs) => [...xs, m]);
    if (live) {
      showFlash({ text: `${m.approximate ? "≈" : ""}${cm(j.hPrimary)}`, measuring: false });
      return announce(j.hPrimary, soundRef.current);
    }
    return Promise.resolve();
  }, [showFlash]);

  const events: LiveEvents = {
    status: (s) => setStatus((old) => (old.text === s.text && old.tone === s.tone ? old : s)),
    measuring: () => showFlash({ text: "Measuring…", measuring: true }),
    result: (m) => {
      console.log(`BOING_LIVE ${JSON.stringify({ h: m.jump.hPrimary, hFlight: m.jump.hFlight, fps: m.fps, refined: m.refined, approximate: m.approximate, flags: m.jump.flags })}`);
      // The live analysis resumes once this has been said (see LiveController).
      return addResult(m, true);
    },
    log: (e) => {
      if (keepNow) clipLogs.current.push(e);
      console.log(`BOING_LOG ${JSON.stringify({ ...e, pose: undefined, motion: undefined })}`);
      setLogs((xs) => {
        const next = [e, ...xs].slice(0, 50);
        return next;
      });
    },
  };

  const stopLive = useCallback(() => {
    setMode("idle");
    setInfo(null);
    deactivateKeepAwake();
    setStatus({ text: "Stopped", tone: "idle" });
  }, []);

  const startLive = useCallback(async () => {
    run.current++;
    if (!permission.hasPermission && !(await permission.requestPermission())) {
      setStatus({ text: "Camera permission needed", tone: "error" });
      return;
    }
    clear();
    clipLogs.current = [];
    setKeepNow(keep);
    setSession((n) => n + 1);
    setMode("live");
    setStatus({ text: "Starting the camera…", tone: "idle" });
    void activateKeepAwakeAsync().catch(() => {});
  }, [permission, clear, keep]);

  const fail = useCallback((e: unknown) => {
    console.warn(e);
    setMode("idle");
    deactivateKeepAwake();
    setStatus({ text: `Error: ${String((e as Error)?.message ?? e)}`, tone: "error" });
  }, []);

  /** Measures every jump in a video file (a file:// URI or a plain path). */
  const analyzeFile = useCallback(async (uri: string, cleanup?: () => void) => {
    const me = ++run.current;
    clear();
    setMode("file");
    setStatus({ text: "Loading…", tone: "idle" });
    try {
      const step = (text: string) => me === run.current && setStatus({ text, tone: "idle" });
      const model = await modelPath("heavy", step);
      const findModel = await modelPath("full", step);
      const fileUri = uri.startsWith("file://") ? uri : `file://${uri}`;
      const v = boingPose.videoInfo(toPath(fileUri));
      const t0 = Date.now();
      const r = await measureVideo(
        { duration: v.duration, fps: v.fps, peakFps: v.peakFps, captureFps: v.captureFps },
        nativeAnalyzer(fileUri, model, findModel),
        (p) => me === run.current && setStatus({ text: `Analysing · ${Math.round(p * 100)} %`, tone: "idle" }),
      );
      if (me !== run.current) return;
      reportFile({
        uri, ms: Date.now() - t0, info: v, timeScale: r.timeScale, fps: r.fps,
        jumps: r.jumps.map((m) => ({
          tOff: m.jump.tOff, tOn: m.jump.tOn, h: m.jump.hPrimary, hFlight: m.jump.hFlight, frames: m.jump.airborneFrames,
          fps: m.fps, refined: m.refined, approximate: m.approximate, flags: m.jump.flags,
        })),
      });
      for (const m of r.jumps) void addResult(m, false);
      const ok = r.jumps.filter((m) => accepted(m.jump));
      const how = r.timeScale < 1 ? ` · slow motion, captured at ${Math.round(v.captureFps)} fps` : ` · ${Math.round(r.fps)} fps`;
      setStatus({ text: `${ok.length} jump${ok.length === 1 ? "" : "s"} found${how}`, tone: ok.length ? "ready" : "idle" });
      if (ok.length) showFlash({ text: cm(Math.max(...ok.map((m) => m.jump.hPrimary))), measuring: false });
    } catch (e) {
      reportFile({ uri, error: String((e as Error)?.message ?? e) });
      if (me === run.current) fail(e);
    } finally {
      if (me === run.current) setMode("idle");
      cleanup?.();
    }
  }, [clear, fail, showFlash]);

  const openFile = useCallback(async () => {
    if (mode === "live") stopLive();
    const res = await DocumentPicker.getDocumentAsync({ type: "video/*", copyToCacheDirectory: true });
    if (res.canceled || !res.assets[0]) return;
    const uri = res.assets[0].uri;
    await analyzeFile(uri, () => deleteQuietly(uri)); // the picker's copy
  }, [mode, stopLive, analyzeFile]);

  // Testing hook: boing://analyze?url=http://localhost:8765/x.mp4 downloads a video and analyses it
  // (scripts/analyze-on-device.sh); boing://analyze?path=… analyses a file the app can read.
  // iOS simulator: the launch argument `-boingAnalyze <url or path>` does the same
  // (scripts/analyze-on-simulator.sh), as links there wait for an "Open in Boing?" prompt.
  useEffect(() => {
    const handle = async (url: string | null) => {
      const m = url?.match(/^boing:\/\/analyze\?(path|url)=(.+)$/);
      if (!m) return;
      const target = decodeURIComponent(m[2]);
      testing.current = true;
      appendTestLog(`open ${url}`);
      if (m[1] === "path") return analyzeFile(target);
      try {
        setStatus({ text: "Downloading video…", tone: "idle" });
        const dest = new File(Paths.cache, `download-${Date.now()}.mp4`);
        await File.downloadFileAsync(target, dest);
        await analyzeFile(dest.uri, () => deleteQuietly(dest.uri));
      } catch (e) {
        reportFile({ uri: target, error: String((e as Error)?.message ?? e) });
        fail(e);
      }
    };
    void Linking.getInitialURL().then(handle);
    const arg = Platform.OS === "ios" ? (Settings.get("boingAnalyze") as string | undefined) : undefined;
    if (arg) void handle(`boing://analyze?${arg.includes("://") ? "url" : "path"}=${encodeURIComponent(arg)}`);
    const sub = Linking.addEventListener("url", (e) => void handle(e.url));
    return () => sub.remove();
  }, [analyzeFile, fail]);

  const heights = results.map((m) => m.jump.hPrimary);
  const sum = summarize(heights);
  const live = mode === "live";

  return (
    <View style={s.root}>
      <View style={s.viewer}>
        {live && (
          <LiveCamera
            key={`${session}-${facing}`}
            facing={facing}
            events={events}
            controllerRef={controller}
            onStep={(text) => setStatus({ text, tone: "idle" })}
            onError={fail}
            onInfo={setInfo}
            keep={keepNow}
            measureOnCpu={settings.measureOnCpu === true}
            onKeptClip={(id, name) => {
              // The clip's log entries are all in by now (the controller logs before it keeps the clip).
              const mine = entriesForClip(clipLogs.current, name);
              clipLogs.current = clipLogs.current.filter((e) => !mine.includes(e));
              writeSession(id, debugPackage({ ...deviceContext(facing, lastInfo.current), phoneId, consent: settings.consent }, mine, [name]));
              markReady(id);
              setKept(keptSummary());
              startUploading(phoneId);
            }}
          />
        )}
        {!live && results.length === 0 && mode !== "file" && (
          <View style={s.placeholder}>
            <Icon name="logo" size={72} />
            <Text style={s.placeholderText}>
              Place the phone so your whole body, <Text style={s.b}>including your feet</Text>, is in view.
              {"\n"}Then press <Text style={s.b}>Start</Text> and jump with hands on hips.
            </Text>
          </View>
        )}

        <View style={[s.top, { paddingTop: insets.top + 8 }]}>
          <View style={s.brand}>
            <Icon name="logo" size={22} />
            <Text style={s.brandText}>Boing</Text>
          </View>
          <View style={[s.pill, pillStyle(status.tone)]}>
            <Text style={[s.pillText, pillText(status.tone)]} numberOfLines={1}>{status.text}</Text>
          </View>
          <View style={s.topActions}>
            <Pressable onPress={() => setSound((x) => !x)} hitSlop={8} accessibilityLabel="Spoken result on/off">
              <Icon name={sound ? "soundOn" : "soundOff"} />
            </Pressable>
            <Pressable onPress={() => setMenu(true)} hitSlop={8} accessibilityLabel="Menu">
              <Icon name="menu" />
            </Pressable>
          </View>
        </View>

        {flash && (
          <View style={s.flashWrap} pointerEvents="none">
            <View style={s.flashBox}>
              {flash.measuring || flash.failed ? (
                <Text style={flash.failed ? s.flashFailed : s.flashMeasuring}>{flash.text}</Text>
              ) : (
                <Text style={s.flash}>
                  {flash.text}
                  <Text style={s.flashUnit}> cm</Text>
                </Text>
              )}
            </View>
          </View>
        )}

        <View style={[s.bottom, { paddingBottom: insets.bottom + 12 }]}>
          {results.length > 0 && (
            <View style={s.session}>
              <Text style={s.summary}>
                <Text style={s.b}>{sum.count}</Text> jump{sum.count === 1 ? "" : "s"} · Best <Text style={s.b}>{cm(sum.best)}</Text> · Average{" "}
                <Text style={s.b}>{cm(sum.average)}</Text> cm
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {results.map((m, i) => (
                  <Pressable
                    key={i}
                    onPress={() => setDetails(i)}
                    style={[s.chip, m.jump.hPrimary === sum.best && s.chipBest, i === results.length - 1 && s.chipLatest]}
                  >
                    <Text style={[s.chipText, m.jump.hPrimary === sum.best && { color: C.accent }]}>
                      {m.approximate ? "≈" : ""}
                      {cm(m.jump.hPrimary)}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}
          <View style={s.controls}>
            <Pressable style={s.round} onPress={openFile} accessibilityLabel="Analyse a video" disabled={mode === "file"}>
              <Icon name="film" />
            </Pressable>
            <Pressable
              style={[s.shutter, live && s.shutterRunning]}
              onPress={() => (live ? stopLive() : void startLive())}
              accessibilityLabel={live ? "Stop" : "Start"}
            >
              <Text style={s.shutterText}>{live ? "Stop" : "Start"}</Text>
            </Pressable>
            <Pressable
              style={s.round}
              onPress={() => setFacing((f) => (f === "back" ? "front" : "back"))}
              accessibilityLabel="Switch camera"
            >
              <Icon name="flip" />
            </Pressable>
          </View>
        </View>
      </View>

      {details !== null && results[details] && (
        <JumpDetails m={results[details]} index={details} count={results.length} onClose={() => setDetails(null)} />
      )}
      {crash !== "" && (
        <Sheet
          title="Boing crashed last time"
          onClose={() => {
            boingPose.clearCrash();
            setCrash("");
          }}
        >
          <Text style={s.hint}>Please share this report so the problem can be fixed.</Text>
          <Pressable style={s.wide} onPress={() => void Share.share({ message: crash })}>
            <Text style={s.wideText}>Share report</Text>
          </Pressable>
          <Text selectable style={s.trace}>{crash}</Text>
        </Sheet>
      )}
      {menu && (
        <Sheet title="Settings" onClose={() => setMenu(false)}>
          <Row label="Build" value={BUILD} />
          <Row label="Camera" value={facing === "back" ? "Back" : "Front"} />
          {info && <Row label="Camera frame rate" value={info.fps ? `${Math.round(info.fps)} fps` : "–"} />}
          {info && <Row label="Pose model" value={`full · ${info.delegate || "–"}`} />}
          {live && <Row label="Live analysis" value={`${controller.current?.fps ?? 0} fps`} />}
          <Pressable style={s.wide} onPress={() => updateSettings({ measureOnCpu: settings.measureOnCpu !== true })}>
            <Text style={s.wideText}>Re-measure jumps on: {settings.measureOnCpu === true ? "CPU" : "GPU"}</Text>
          </Pressable>
          <Text style={s.hint}>For comparing the speed; applies from the next Start.</Text>
          {logs.length > 0 && (
            <>
              <Text style={s.sectionTitle}>Diagnostics (latest first)</Text>
              <Pressable style={s.wide} onPress={() => void shareDiagnostics(facing, lastInfo.current, logs)}>
                <Text style={s.wideText}>Share diagnostics</Text>
              </Pressable>
              {logs.some((e) => e.pose) && (
                <Pressable style={s.wide} onPress={() => void shareDiagnostics(facing, lastInfo.current, logs, true)}>
                  <Text style={s.wideText}>Share pose data (latest 8 jumps)</Text>
                </Pressable>
              )}
              {logs.map((e, i) => (
                <Text key={i} style={s.diag}>{describeLog(e)}</Text>
              ))}
            </>
          )}
          <Text style={s.sectionTitle}>Debug recordings</Text>
          {ask === "consent" ? (
            <>
              <Text style={s.consentTitle}>{CONSENT_TITLE}</Text>
              {consentText(phoneId).map((p, i) => (
                <Text key={i} style={s.consent}>{p}</Text>
              ))}
              <View style={s.choices}>
                <Pressable style={[s.wide, s.choice, s.secondary]} onPress={() => setAsk(null)}>
                  <Text style={s.secondaryText}>Disagree</Text>
                </Pressable>
                <Pressable
                  style={[s.wide, s.choice]}
                  onPress={() => {
                    updateSettings({ keep: true, consent: { version: CONSENT_VERSION, at: new Date().toISOString() } });
                    setAsk(null);
                  }}
                >
                  <Text style={s.wideText}>Agree</Text>
                </Pressable>
              </View>
            </>
          ) : ask === "withdraw" ? (
            <>
              <Text style={s.consentTitle}>Withdraw consent?</Text>
              <Text style={s.consent}>
                Boing stops keeping recordings and deletes the ones on this phone that haven't been sent.
              </Text>
              <Pressable style={s.check} onPress={() => setEraseSent(!eraseSent)}>
                <Text style={s.checkBox}>{eraseSent ? "☑" : "☐"}</Text>
                <Text style={s.consent}>Also delete everything I've already sent (recording ID {phoneId})</Text>
              </Pressable>
              <View style={s.choices}>
                <Pressable style={[s.wide, s.choice, s.secondary]} onPress={() => setAsk(null)}>
                  <Text style={s.secondaryText}>Cancel</Text>
                </Pressable>
                <Pressable style={[s.wide, s.choice]} onPress={() => withdraw(eraseSent)}>
                  <Text style={s.wideText}>Withdraw</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <Pressable
              style={s.wide}
              onPress={() => (keep ? updateSettings({ keep: false }) : hasConsent(settings) ? updateSettings({ keep: true }) : setAsk("consent"))}
            >
              <Text style={s.wideText}>Keep recordings of measured jumps: {keep ? "on" : "off"}</Text>
            </Pressable>
          )}
          <Text style={s.hint}>
            {keep ? "From the next Start, each measured jump's video, pose and motion data are sent in the background. " : ""}
            {kept.sessions === 0 ? "Nothing waiting to be sent." : `Waiting to be sent: ${kept.sessions} jump${kept.sessions === 1 ? "" : "s"}, ${kept.mb} MB.`}
          </Text>
          {kept.files > 0 && (
            <>
              <Pressable
                style={s.wide}
                onPress={() => {
                  deleteSessions();
                  setKept(keptSummary());
                  setSendStatus("");
                }}
              >
                <Text style={s.wideText}>Delete kept recordings</Text>
              </Pressable>
            </>
          )}
          {sendStatus !== "" && <Text style={s.hint}>{sendStatus}</Text>}
          {hasConsent(settings) && ask === null && (
            <Pressable onPress={() => { setEraseSent(true); setAsk("withdraw"); }}>
              <Text style={[s.hint, { color: C.accent }]}>Withdraw consent · recording ID {phoneId}</Text>
            </Pressable>
          )}
          {ignored.length > 0 && (
            <>
              <Text style={s.sectionTitle}>{ignored.length} other movement{ignored.length > 1 ? "s" : ""} ignored</Text>
              {ignored.map((x, i) => (
                <Text key={i} style={s.hint}>{x}</Text>
              ))}
            </>
          )}
          <Text style={s.hint}>
            Boing measures the height of a countermovement jump from the camera. Every recorded frame around
            a jump is analysed again, at the camera's full frame rate.
          </Text>
          <Pressable onPress={() => void Linking.openURL("https://github.com/ljungqvist/boing")}>
            <Text style={[s.hint, { color: C.accent }]}>About Boing</Text>
          </Pressable>
        </Sheet>
      )}
    </View>
  );
}

/**
 * The result of a file analysis, for the test scripts: logged (Android logcat) and written to
 * Documents/boing-file-result.json (iOS release builds don't log; the simulator's app container
 * is readable from the Mac).
 */
function reportFile(r: Record<string, unknown>) {
  const line = JSON.stringify(r);
  console.log(`BOING_FILE ${line}`);
  try {
    new File(Paths.document, "boing-file-result.json").write(line);
  } catch {
    // only for tests
  }
}

/** Appends a line to Documents/boing-test-log.txt (testing hook only). */
function appendTestLog(text: string) {
  try {
    const f = new File(Paths.document, "boing-test-log.txt");
    if (!f.exists) f.create();
    f.write(`${new Date().toISOString()} ${text}\n`, { append: true });
  } catch {
    // only for tests
  }
}

/** Shares the diagnostics as text (e.g. to a chat or e-mail); `pose`: the re-measured jumps' pose data instead. */
async function shareDiagnostics(facing: string, info: CameraInfo | null, logs: Record<string, unknown>[], pose = false) {
  const context = deviceContext(facing, info);
  await Share.share({ message: pose ? poseReport(context, logs) : diagnosticsReport(context, logs) }).catch(() => {});
}

const pillStyle = (t: Tone) =>
  ({ idle: {}, ready: { backgroundColor: C.ok }, adjust: { backgroundColor: C.warn }, air: { backgroundColor: C.accent }, error: { backgroundColor: C.error } })[t];
const pillText = (t: Tone) =>
  ({ idle: {}, ready: { color: "#04130a" }, adjust: { color: "#1d1500" }, air: { color: "#1f0d00" }, error: {} })[t];

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  viewer: { flex: 1, backgroundColor: "#000" },
  placeholder: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", padding: 32, gap: 24 },
  placeholderText: { color: C.muted, textAlign: "center", lineHeight: 22, fontSize: 15 },
  b: { color: C.text, fontWeight: "600" },
  top: {
    position: "absolute", left: 0, right: 0, top: 0, flexDirection: "row", alignItems: "center",
    paddingHorizontal: 12, paddingBottom: 12, gap: 8, backgroundColor: "rgba(0,0,0,0.35)",
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 6 },
  brandText: { color: C.text, fontWeight: "700", fontSize: 17 },
  pill: {
    flex: 1, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: C.surface, borderColor: C.line, borderWidth: 1, alignItems: "center",
  },
  pillText: { color: C.text, fontSize: 14, fontWeight: "600" },
  topActions: { flexDirection: "row", gap: 14 },
  flashWrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  flashBox: { backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 16, paddingHorizontal: 20, paddingVertical: 6 },
  flash: { color: C.text, fontSize: 88, fontWeight: "800", fontVariant: ["tabular-nums"] },
  flashUnit: { fontSize: 28, fontWeight: "500", color: C.muted },
  flashMeasuring: { color: C.muted, fontSize: 36, fontWeight: "600", paddingVertical: 8 },
  flashFailed: { color: C.text, fontSize: 36, fontWeight: "700", paddingVertical: 8, textAlign: "center" },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 12, backgroundColor: "rgba(0,0,0,0.35)" },
  session: {
    backgroundColor: C.surface, borderColor: C.line, borderWidth: 1, borderRadius: 16,
    padding: 10, marginTop: 10,
  },
  summary: { color: C.muted, fontSize: 14, marginBottom: 6, marginLeft: 4, fontVariant: ["tabular-nums"] },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: C.line,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  chipBest: { borderColor: C.accent },
  chipLatest: { backgroundColor: "rgba(255,255,255,0.16)" },
  chipText: { color: C.text, fontWeight: "600", fontVariant: ["tabular-nums"] },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "space-evenly", paddingTop: 14 },
  round: {
    width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center",
    backgroundColor: C.surface, borderColor: C.line, borderWidth: 1,
  },
  shutter: {
    width: 84, height: 84, borderRadius: 42, borderWidth: 4, borderColor: "#fff",
    backgroundColor: C.accent, alignItems: "center", justifyContent: "center",
  },
  shutterRunning: { backgroundColor: "#fff" },
  shutterText: { color: "#1f0d00", fontWeight: "800", fontSize: 16 },
  sectionTitle: { color: C.text, fontWeight: "600", marginTop: 16, marginBottom: 4 },
  hint: { color: C.muted, fontSize: 13, marginTop: 12, lineHeight: 19 },
  diag: { color: C.muted, fontSize: 12, marginTop: 6, fontVariant: ["tabular-nums"] },
  wide: { marginTop: 12, paddingVertical: 12, borderRadius: 12, backgroundColor: C.accent, alignItems: "center" },
  wideText: { color: "#1f0d00", fontWeight: "700", fontSize: 15 },
  consentTitle: { color: C.text, fontWeight: "700", fontSize: 16, marginTop: 12 },
  consent: { color: C.text, fontSize: 14, lineHeight: 20, marginTop: 8, flexShrink: 1 },
  choices: { flexDirection: "row", gap: 10 },
  choice: { flex: 1 },
  secondary: { backgroundColor: "transparent", borderWidth: 1, borderColor: C.muted },
  secondaryText: { color: C.text, fontWeight: "700", fontSize: 15 },
  check: { flexDirection: "row", gap: 10, alignItems: "flex-start", marginTop: 8 },
  checkBox: { color: C.accent, fontSize: 20, marginTop: 6 },
  trace: { color: C.text, fontSize: 11, marginTop: 12, fontFamily: "monospace" },
});

/** CI build number, commit and branch (app.config.js, android.yml); "local" for other builds. */
const BUILD = process.env.EXPO_PUBLIC_BOING_BUILD
  ? `${process.env.EXPO_PUBLIC_BOING_BUILD} (${process.env.EXPO_PUBLIC_BOING_COMMIT ?? "?"}, ${process.env.EXPO_PUBLIC_BOING_BRANCH ?? "?"})`
  : "local";

/** Phone, camera and time, at the top of diagnostics and debug packages. */
function deviceContext(facing: string, info: CameraInfo | null): Record<string, unknown> {
  const c = Platform.constants as Record<string, unknown>;
  // Android: brand and model; iOS only tells phone or tablet ("pad").
  const device = [c.Brand, c.Model].filter(Boolean).join(" ") || [Platform.OS, c.interfaceIdiom].filter(Boolean).join(" ");
  return {
    build: BUILD,
    time: new Date().toISOString(),
    device: `${device} (${Platform.OS} ${c.Release ?? Platform.Version})`,
    camera: facing,
    "camera frame rate": info?.fps ? `${Math.round(info.fps)} fps` : "–",
    "pose delegate": info?.delegate || "–",
  };
}
