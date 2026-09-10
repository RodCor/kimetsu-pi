import { afterEach, expect, it } from "vitest";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { createTestSandbox } from "./helpers/sandbox.ts";

const fixtures: ReturnType<typeof createTestSandbox>[] = [];
afterEach(() => { for (const fixture of fixtures.splice(0).reverse()) fixture.cleanup(); });
const fixture = (parent?: NodeJS.ProcessEnv) => {
  const sandbox = createTestSandbox(parent);
  fixtures.push(sandbox);
  return sandbox;
};

it("keeps subprocess homes, caches, Git configuration and credentials inside the test boundary", () => {
  const sandbox = fixture({ PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, OPENAI_API_KEY: "test-secret", KIMETSU_TEST_OVERRIDE: "outside" });
  expect(sandbox.env.OPENAI_API_KEY).toBeUndefined();
  expect(sandbox.env.KIMETSU_TEST_OVERRIDE).toBeUndefined();
  for (const key of ["HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "KIMETSU_USER_BRAIN_DIR"]) {
    expect(sandbox.env[key]).toContain(sandbox.root);
  }
});

it("ignores inherited Git redirection before initialization and leaves the other repository intact", () => {
  const outside = fixture();
  const config = join(outside.workspace, ".git", "config");
  const before = readFileSync(config);
  const sentinel = join(outside.workspace, "keep.txt");
  writeFileSync(sentinel, "original");
  const sandbox = fixture({ ...process.env, GIT_DIR: join(outside.workspace, ".git"), GIT_WORK_TREE: outside.workspace });
  expect(existsSync(join(sandbox.workspace, ".git", "config"))).toBe(true);
  expect(readFileSync(config)).toEqual(before);
  expect(readFileSync(sentinel, "utf8")).toBe("original");
});

it("refuses ancestor repository discovery if the workspace Git anchor disappears", () => {
  const sandbox = fixture();
  execFileSync("git", ["init", "--quiet", sandbox.root], { env: sandbox.env, windowsHide: true });
  renameSync(join(sandbox.workspace, ".git"), join(sandbox.workspace, "git-backup"));
  expect(() => sandbox.assertWorkspace()).toThrow();
});
