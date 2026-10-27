import { Directory, File, Paths } from "expo-file-system";
import { startUploads } from "boing-upload";
import { uniqueId } from "../logic/jumps";

/**
 * Debug recordings: each kept clip of measured jumps gets a folder with the clip and a session.json
 * (diagnostics with pose and motion data), and a `.ready` file once complete. Android's upload
 * service (modules/boing-upload) sends ready folders to the public server on Kapsi (server/kapsi/)
 * in the background and deletes them. Kept and sent only with consent (logic/consent.ts).
 */

/** Default server for the recording uploads. */
export const DEFAULT_SERVER = "https://ljungqvist.info/boing";

/**
 * Shared upload key for the Kapsi server, built into the APK by CI from the GitHub secret
 * BOING_UPLOAD_KEY. Anyone who unpacks the APK can read it: it only keeps out casual abuse.
 */
const UPLOAD_KEY = process.env.EXPO_PUBLIC_BOING_UPLOAD_KEY ?? "";
const root = () => new Directory(Paths.document, "debug");

function sessionDir(id: string): Directory {
  const d = new Directory(root(), id);
  if (!d.exists) d.create({ intermediates: true });
  return d;
}

/** A new session id: the local start time, usable as a folder name. */
export function newSessionId(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

/** Moves a recorded clip into a new folder of its own; the folder id and the file name, or null if that failed. */
export function keepClip(path: string): { id: string; name: string } | null {
  try {
    const f = new File(path.startsWith("file://") ? path : `file://${path}`);
    const id = uniqueId(newSessionId(), (x) => new Directory(root(), x).exists);
    f.moveSync(sessionDir(id));
    return { id, name: f.name };
  } catch {
    return null;
  }
}

/** Marks the folder complete: the upload service takes it from here. */
export function markReady(id: string): void {
  try {
    const f = new File(sessionDir(id), ".ready");
    if (!f.exists) f.create();
  } catch {
    // Debug data only; the folder is marked at the next start.
  }
}

/** Writes (replaces) the session's session.json. */
export function writeSession(id: string, json: string): void {
  try {
    const f = new File(sessionDir(id), "session.json");
    if (f.exists) f.delete();
    f.create();
    f.write(json);
  } catch {
    // Debug data only; never break measuring.
  }
}

const sessions = (): Directory[] =>
  root().exists ? (root().list().filter((x) => x instanceof Directory) as Directory[]) : [];

const visible = (d: Directory): File[] => d.list().filter((x) => x instanceof File && !x.name.startsWith(".")) as File[];

/** Recordings waiting on the phone: jumps, files and size in MB. */
export function keptSummary(): { sessions: number; files: number; mb: number } {
  let files = 0, bytes = 0;
  for (const d of sessions()) for (const f of visible(d)) { files++; bytes += f.size ?? 0; }
  return { sessions: sessions().length, files, mb: Math.round(bytes / 1e5) / 10 };
}

const headers = (): Record<string, string> => (UPLOAD_KEY ? { "X-Boing-Key": UPLOAD_KEY } : {});

/**
 * Wakes the upload service: it sends every ready folder (PUT <server>/upload?session=<id>_<phoneId>
 * &name=…, then POST <server>/done) and deletes it. Folders that have a session.json but no `.ready`
 * (kept by an older version, or interrupted) are marked first. Call it while the app is in the
 * foreground: a clip was kept, or the app started.
 */
export function startUploading(phoneId: string, server = DEFAULT_SERVER): void {
  for (const d of sessions()) if (new File(d, "session.json").exists) markReady(d.name);
  const dir = decodeURIComponent(root().uri.replace(/^file:\/\//, "")).replace(/\/+$/, "");
  startUploads(dir, server.replace(/\/+$/, ""), phoneId, UPLOAD_KEY);
}

/** Asks the server to delete everything this phone has sent (POST <server>/erase?phone=…). */
export async function requestErase(server: string, phoneId: string): Promise<void> {
  const r = await fetch(`${server.replace(/\/+$/, "")}/erase?phone=${phoneId}`, { method: "POST", headers: headers() });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
}

/** Deletes every kept session. */
export function deleteSessions(): void {
  for (const d of sessions()) d.delete();
}

const settingsFile = () => new File(Paths.document, "settings.json");

/** Small persistent settings (debug options). */
export function loadSettings(): Record<string, unknown> {
  try {
    const f = settingsFile();
    return f.exists ? JSON.parse(f.textSync()) : {};
  } catch {
    return {};
  }
}

export function saveSettings(s: Record<string, unknown>): void {
  try {
    const f = settingsFile();
    if (f.exists) f.delete();
    f.create();
    f.write(JSON.stringify(s));
  } catch {
    // not critical
  }
}
