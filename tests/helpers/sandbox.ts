import { execFileSync } from "node:child_process";
import { lstatSync, mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

export function createTestSandbox(parent: NodeJS.ProcessEnv = process.env) {
  // The native Windows resolver expands 8.3 aliases (e.g. RUNNER~1) too.
  const realPath = realpathSync.native;
  const root = realPath(mkdtempSync(join(tmpdir(), "kimetsu-pi-test-")));
  const workspace = join(root, "project");
  mkdirSync(workspace);
  // Allow only executable lookup and Windows process essentials. In particular,
  // never inherit Git redirection, Kimetsu overrides, or provider credentials.
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(parent)) {
    if (/^(PATH|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT)$/i.test(key)) env[key.toUpperCase()] = value;
  }
  const home = join(root, "home");
  const temp = join(root, "tmp");
  for (const dir of [home, temp]) mkdirSync(dir);
  Object.assign(env, {
    HOME: home, USERPROFILE: home,
    APPDATA: join(home, "AppData", "Roaming"), LOCALAPPDATA: join(home, "AppData", "Local"),
    XDG_CONFIG_HOME: join(home, "config"), XDG_CACHE_HOME: join(home, "cache"), XDG_DATA_HOME: join(home, "data"),
    TMPDIR: temp, TMP: temp, TEMP: temp,
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(home, ".gitconfig"), GIT_CEILING_DIRECTORIES: root,
    KIMETSU_USER_BRAIN_DIR: join(root, "user-brain"), KIMETSU_USER_BRAIN: "0", KIMETSU_EMBED_DAEMON: "0",
  });
  const cleanup = () => {
    if (!root.startsWith(realPath(tmpdir()) + sep) || lstatSync(root).isSymbolicLink()) throw new Error("Unsafe test cleanup path");
    rmSync(root, { recursive: true, force: true });
  };
  const assertWorkspace = () => {
    if (realPath(workspace) !== workspace || !lstatSync(join(workspace, ".git")).isDirectory() || lstatSync(join(workspace, ".git")).isSymbolicLink()) throw new Error("Unsafe test workspace");
    const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: workspace, env, encoding: "utf8", windowsHide: true }).trim();
    // Git and Node may disagree on the drive letter's case on Windows.
    // path.relative compares paths using the current platform's semantics.
    if (relative(realPath(gitRoot), realPath(workspace)) !== "") throw new Error(`Unsafe test workspace: Git resolved ${gitRoot}, expected ${workspace}`);
  };
  try {
    execFileSync("git", ["init", "--quiet", "--template=", workspace], { env, windowsHide: true });
    assertWorkspace();
    return { root, workspace, env, assertWorkspace, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}
