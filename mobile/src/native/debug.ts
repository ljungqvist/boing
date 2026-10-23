import { Directory, File, Paths } from "expo-file-system";
import { uploadFolder } from "../logic/consent";

/**
 * Debug sessions: the recorded clips of measured jumps and a session.json (diagnostics with pose and
 * motion data), kept on the phone until they're sent to a server: the public one on Kapsi
 * (server/kapsi/). Kept and sent only with consent (logic/consent.ts).
 */

/** Default server for "Send recordings". */
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

/** Moves a recorded clip into the session's folder; its file name, or null if that failed. */
export function keepClip(path: string, id: string): string | null {
  try {
    const f = new File(path.startsWith("file://") ? path : `file://${path}`);
    f.moveSync(sessionDir(id));
    return f.name;
  } catch {
    return null;
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

/** Kept sessions on the phone: count and size in MB. */
export function keptSummary(): { sessions: number; files: number; mb: number } {
  let files = 0, bytes = 0;
  for (const d of sessions()) for (const f of d.list()) if (f instanceof File) { files++; bytes += f.size ?? 0; }
  return { sessions: sessions().length, files, mb: Math.round(bytes / 1e5) / 10 };
}

const headers = (): Record<string, string> => (UPLOAD_KEY ? { "X-Boing-Key": UPLOAD_KEY } : {});

/**
 * Uploads every kept session to `server` (PUT <server>/upload?session=…&name=…, the file as body,
 * into the folder `<session>_<phoneId>`), then marks it complete (POST <server>/done?session=…) and
 * deletes it from the phone. Returns the number of files sent.
 */
export async function sendSessions(
  server: string,
  phoneId: string,
  onProgress: (done: number, total: number) => void,
): Promise<number> {
  const base = server.replace(/\/+$/, "");
  const all = sessions().map((d) => ({ d, files: d.list().filter((x) => x instanceof File) as File[] }));
  const total = all.reduce((n, s) => n + s.files.length, 0);
  let done = 0;
  onProgress(done, total);
  for (const { d, files } of all) {
    const folder = encodeURIComponent(uploadFolder(d.name, phoneId));
    for (const f of files) {
      const url = `${base}/upload?session=${folder}&name=${encodeURIComponent(f.name)}`;
      const r = await f.upload(url, { httpMethod: "PUT", headers: headers() });
      if (r.status < 200 || r.status >= 300) throw new Error(`${f.name}: HTTP ${r.status} ${r.body.slice(0, 80)}`);
      onProgress(++done, total);
    }
    const r = await fetch(`${base}/done?session=${folder}`, { method: "POST", headers: headers() });
    if (!r.ok) throw new Error(`done: HTTP ${r.status}`);
    d.delete();
  }
  return done;
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
