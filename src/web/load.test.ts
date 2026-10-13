import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithProgress, withTimeout } from "./load";

describe("withTimeout", () => {
  it("passes through a value that arrives in time", async () => {
    await expect(withTimeout(Promise.resolve(7), 100, "x")).resolves.toBe(7);
  });
  it("rejects with a named error when the promise hangs", async () => {
    await expect(withTimeout(new Promise(() => {}), 20, "GPU start")).rejects.toThrow(/GPU start.*timed out/);
  });
});

describe("fetchWithProgress", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports progress and returns all bytes", async () => {
    const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];
    const body = new ReadableStream<Uint8Array>({
      start(c) { chunks.forEach((x) => c.enqueue(x)); c.close(); },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { headers: { "content-length": "5" } })));
    const seen: [number, number][] = [];
    const bytes = await fetchWithProgress("https://example.test/model", (got, total) => seen.push([got, total]));
    expect([...bytes]).toEqual([1, 2, 3, 4, 5]);
    expect(seen.at(-1)).toEqual([5, 5]);
  });

  it("fails clearly on an HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    await expect(fetchWithProgress("https://example.test/model", () => {})).rejects.toThrow(/404/);
  });
});
