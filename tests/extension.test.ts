import { describe, it, expect, vi, beforeEach } from "vitest";

// Controllable spawn mock: each test sets the child's behaviour.
const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import extension from "../extensions/kimetsu.ts";

/**
 * Minimal stand-in for a ChildProcess: records `on` handlers, exposes a
 * stdout stream the extension can subscribe to, and captures whatever the
 * extension writes to stdin.
 */
function makeChild() {
  const handlers: Record<string, (...a: unknown[]) => void> = {};
  const stdoutHandlers: Record<string, (...a: unknown[]) => void> = {};
  const child = {
    handlers,
    stdoutHandlers,
    stdinWrites: [] as unknown[],
    kill: vi.fn(),
    stdout: {
      setEncoding: vi.fn(),
      on(ev: string, cb: (...a: unknown[]) => void) {
        stdoutHandlers[ev] = cb;
        return child.stdout;
      },
    },
    stdin: {
      on: vi.fn(),
      end(chunk?: unknown) {
        child.stdinWrites.push(chunk);
      },
    },
    on(ev: string, cb: (...a: unknown[]) => void) {
      handlers[ev] = cb;
      return child;
    },
  };
  return child;
}

/** A child that emits `stdout` then closes on the next tick. */
function respondingChild(stdout: string) {
  const child = makeChild();
  setTimeout(() => {
    child.stdoutHandlers["data"]?.(stdout);
    child.handlers["close"]?.();
  }, 0);
  return child;
}

function register() {
  const cbs: Record<string, (e: any, c: any) => Promise<unknown>> = {};
  const pi = { on: (ev: string, cb: any) => { cbs[ev] = cb; } };
  extension(pi as any);
  return cbs;
}

const HOOK_OUTPUT = JSON.stringify({
  continue: true,
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: "Kimetsu brain relevant knowledge for this task:\nuse thiserror",
  },
});

beforeEach(() => {
  spawnMock.mockReset();
});

describe("kimetsu pi extension", () => {
  it("registers the four lifecycle handlers", () => {
    spawnMock.mockImplementation(() => makeChild());
    const registered: string[] = [];
    const pi = { on: (ev: string, _cb: unknown) => registered.push(ev) };
    extension(pi as any);
    expect(registered).toEqual([
      "session_start",
      "before_agent_start",
      "agent_end",
      "session_shutdown",
    ]);
  });

  it("does not throw when the binary is missing", async () => {
    // Simulate "binary not on PATH": fire 'error' asynchronously.
    spawnMock.mockImplementation(() => {
      const child = makeChild();
      setTimeout(() => child.handlers["error"]?.(), 0);
      return child;
    });
    const cbs = register();
    await expect(cbs["session_start"]({}, {})).resolves.toBeUndefined();
    await expect(cbs["before_agent_start"]({ prompt: "why is the build red" }, {}))
      .resolves.toBeUndefined();
  });

  it("resolves and kills the child if the binary hangs", async () => {
    vi.useFakeTimers();
    // A child that never fires 'error' or 'close' — a hung binary.
    const child = makeChild();
    spawnMock.mockImplementation(() => child);
    const cbs = register();
    // agent_end runs a single kimetsu invocation.
    const p = cbs["agent_end"]({}, {});
    await vi.advanceTimersByTimeAsync(10000);
    await expect(p).resolves.toBeUndefined();
    expect(child.kill).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  // The regression this file exists for: the extension used to spawn with
  // stdio:"ignore", so the hook got an empty stdin (bailing on its
  // minimum-prompt guard) and its output went to /dev/null. Kimetsu was
  // effectively write-only on Pi.
  it("pipes stdio so the hook can be fed and read", async () => {
    const child = respondingChild(HOOK_OUTPUT);
    spawnMock.mockImplementation(() => child);
    const cbs = register();
    await cbs["before_agent_start"]({ prompt: "why is the build red" }, {});
    const [, , options] = spawnMock.mock.calls[0] as [string, string[], any];
    expect(options.stdio).toEqual(["pipe", "pipe", "ignore"]);
  });

  it("writes the hook payload (prompt + session id) to the child's stdin", async () => {
    const child = respondingChild(HOOK_OUTPUT);
    spawnMock.mockImplementation(() => child);
    const cbs = register();
    await cbs["before_agent_start"](
      { prompt: "why is the build red" },
      { sessionId: "sess-42" },
    );
    expect(child.stdinWrites).toHaveLength(1);
    expect(JSON.parse(child.stdinWrites[0] as string)).toEqual({
      session_id: "sess-42",
      prompt: "why is the build red",
    });
  });

  it("returns the hook's additionalContext as an injected message", async () => {
    spawnMock.mockImplementation(() => respondingChild(HOOK_OUTPUT));
    const cbs = register();
    const result: any = await cbs["before_agent_start"]({ prompt: "why is the build red" }, {});
    expect(result?.message?.customType).toBe("kimetsu-brain");
    expect(result?.message?.content).toContain("use thiserror");
  });

  it("requests the first-turn warm start and passes the workspace", async () => {
    spawnMock.mockImplementation(() => respondingChild(HOOK_OUTPUT));
    const cbs = register();
    await cbs["before_agent_start"]({ prompt: "why is the build red" }, { cwd: "/repo" });
    const [bin, args] = spawnMock.mock.calls[0] as [string, string[]];
    expect(bin).toBe("kimetsu");
    expect(args).toEqual([
      "brain",
      "context-hook",
      "--warm-on-first-prompt",
      "--workspace",
      "/repo",
    ]);
  });

  it("injects nothing when the brain has nothing relevant", async () => {
    // `skipped` bundles print no output at all — the zero-token path.
    spawnMock.mockImplementation(() => respondingChild(""));
    const cbs = register();
    await expect(cbs["before_agent_start"]({ prompt: "why is the build red" }, {}))
      .resolves.toBeUndefined();
  });

  it("injects nothing when the output is not parseable hook JSON", async () => {
    spawnMock.mockImplementation(() => respondingChild("warning: something\nnot json at all"));
    const cbs = register();
    await expect(cbs["before_agent_start"]({ prompt: "why is the build red" }, {}))
      .resolves.toBeUndefined();
  });
});
