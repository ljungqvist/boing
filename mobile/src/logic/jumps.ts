/**
 * One kept clip is one upload: a folder `<id>` on the phone (the clip, session.json with just that
 * clip's entries, and a `.ready` file once complete), sent as `<id>_<phoneId>` (see consent.ts).
 */

export type Entry = Record<string, unknown>;

/** `base` if no folder has that id yet, else `base-2`, `base-3`, … (two clips can end in one second). */
export function uniqueId(base: string, exists: (id: string) => boolean): string {
  if (!exists(base)) return base;
  for (let n = 2; ; n++) if (!exists(`${base}-${n}`)) return `${base}-${n}`;
}

/** The log entries of one clip: its measured jumps (an entry names its clip). */
export function entriesForClip(logs: Entry[], clip: string): Entry[] {
  return logs.filter((e) => e.clip === clip);
}
