import { afterEach, beforeEach, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve("mobile/scripts/tag-play-release.sh");
let dir: string, work: string, remote: string, first: string, second: string;

function git(...args: string[]) {
  const result = spawnSync("git", args, { cwd: work, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function tag(commit = first, check = false) {
  return spawnSync("bash", [script, ...(check ? ["--check"] : []), "0.2.0", "3", commit], {
    cwd: work, encoding: "utf8",
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "boing-release-tag-"));
  remote = join(dir, "origin.git");
  work = dir;
  git("init", "--bare", remote);
  work = join(dir, "work");
  const clone = spawnSync("git", ["clone", remote, work], { encoding: "utf8" });
  if (clone.status !== 0) throw new Error(clone.stderr);
  git("config", "user.name", "Release test");
  git("config", "user.email", "test@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "tag.gpgsign", "false");
  writeFileSync(join(work, "app"), "first");
  git("add", "app");
  git("commit", "-m", "First build");
  first = git("rev-parse", "HEAD");
  writeFileSync(join(work, "app"), "second");
  git("commit", "-am", "Later source");
  second = git("rev-parse", "HEAD");
  git("push", "origin", "HEAD:refs/heads/main");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("publishes an annotated version tag on the built commit, not the branch tip", () => {
  const result = tag();
  expect(result.status, result.stderr).toBe(0);
  expect(git("--git-dir", remote, "rev-parse", "v0.2.0^{commit}")).toBe(first);
  expect(git("--git-dir", remote, "cat-file", "-t", "refs/tags/v0.2.0")).toBe("tag");
  expect(git("--git-dir", remote, "for-each-ref", "--format=%(contents)", "refs/tags/v0.2.0"))
    .toContain("version code 3");
});

test("rerunning for an existing tag on the same commit succeeds without replacing it", () => {
  git("tag", "-a", "v0.2.0", first, "-m", "Original build");
  git("push", "origin", "refs/tags/v0.2.0");
  const original = git("rev-parse", "v0.2.0");
  git("tag", "-d", "v0.2.0"); // As on a fresh Actions checkout.
  const result = tag();
  expect(result.status, result.stderr).toBe(0);
  expect(git("--git-dir", remote, "rev-parse", "v0.2.0")).toBe(original);
});

test("refuses to move an existing version tag to different source", () => {
  git("tag", "v0.2.0", first);
  git("push", "origin", "refs/tags/v0.2.0");
  const result = tag(second);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Bump the app version");
  expect(git("--git-dir", remote, "rev-parse", "v0.2.0^{commit}")).toBe(first);
});

test("preflight checks do not publish a tag before the AAB succeeds", () => {
  const result = tag(first, true);
  expect(result.status, result.stderr).toBe(0);
  expect(git("ls-remote", "--tags", "origin")).toBe("");
});

test("fails when the remote cannot be checked", () => {
  git("remote", "set-url", "origin", join(dir, "missing.git"));
  expect(tag().status).not.toBe(0);
  expect(git("--git-dir", remote, "for-each-ref", "refs/tags")).toBe("");
});
