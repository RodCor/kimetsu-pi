import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

// Pi leaves messages unchanged when no context handler is registered.
async function modelMessages(cbs: ReturnType<typeof register>, messages: any[], ctx: any = {}) {
  const result: any = await cbs["context"]?.({ messages }, ctx);
  return result?.messages ?? messages;
}

function persistedMessage(result: any) {
  return { role: "custom", ...result.message, timestamp: 1 };
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

afterEach(() => {
  vi.useRealTimers();
});

describe("kimetsu pi extension", () => {
  it("registers lifecycle and context handlers", () => {
    spawnMock.mockImplementation(() => makeChild());
    const registered: string[] = [];
    const pi = { on: (ev: string, _cb: unknown) => registered.push(ev) };
    extension(pi as any);
    expect(registered).toEqual([
      "session_start",
      "before_agent_start",
      "context",
      "session_before_compact",
      "session_before_tree",
      "session_tree",
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

  it("uses Pi's current SessionManager id for distinct sessions", async () => {
    const child = respondingChild(HOOK_OUTPUT);
    spawnMock.mockImplementation(() => child);
    const cbs = register();
    await cbs["before_agent_start"](
      { prompt: "why is the build red" },
      {
        sessionId: "legacy-id",
        sessionManager: { getSessionId: () => "pi-session-84" },
      },
    );
    expect(JSON.parse(child.stdinWrites[0] as string).session_id).toBe("pi-session-84");
  });

  it("returns the hook's additionalContext as an injected message", async () => {
    spawnMock.mockImplementation(() => respondingChild(HOOK_OUTPUT));
    const cbs = register();
    const result: any = await cbs["before_agent_start"]({ prompt: "why is the build red" }, {});
    expect(result?.message?.customType).toBe("kimetsu-brain");
    expect(result?.message?.content).toContain("use thiserror");
  });

  it("replaces earlier injections while preserving conversation and other extensions", async () => {
    spawnMock.mockImplementationOnce(() => respondingChild(HOOK_OUTPUT));
    const cbs = register();
    const old = persistedMessage(await cbs["before_agent_start"]({ prompt: "old build guidance" }, {}));
    spawnMock.mockImplementationOnce(() => respondingChild(HOOK_OUTPUT.replace("use thiserror", "use anyhow")));
    const current = persistedMessage(await cbs["before_agent_start"]({ prompt: "corrected build guidance" }, {}));
    const user = { role: "user", content: "fix the build", timestamp: 2 };
    const other = { role: "custom", customType: "another-extension", content: "keep this", display: false, timestamp: 3 };
    const legacy = { role: "custom", customType: "kimetsu-brain", content: "legacy memory", display: false, timestamp: 0 };
    const history = [legacy, old, user, other, current];

    // Pi passes a deep copy on every model call, including tool continuations.
    expect(await modelMessages(cbs, structuredClone(history))).toEqual([user, other, current]);
    expect(await modelMessages(cbs, structuredClone(history))).toEqual([user, other, current]);
    expect(history).toEqual([legacy, old, user, other, current]);
  });

  it.each(["", "not hook JSON"])("removes old injections when the next retrieval returns %j", async (stdout) => {
    spawnMock.mockImplementationOnce(() => respondingChild(HOOK_OUTPUT));
    const cbs = register();
    const old = persistedMessage(await cbs["before_agent_start"]({ prompt: "old build guidance" }, {}));
    spawnMock.mockImplementationOnce(() => respondingChild(stdout));
    await cbs["before_agent_start"]({ prompt: "a different task" }, {});
    expect(await modelMessages(cbs, [old])).toEqual([]);
  });

  it("does not reactivate a prior injection when a session is resumed", async () => {
    spawnMock.mockImplementation(() => respondingChild(HOOK_OUTPUT));
    const cbs = register();
    const ctx = { sessionId: "resumed-session" };
    const old = persistedMessage(await cbs["before_agent_start"]({ prompt: "old build guidance" }, ctx));
    await cbs["session_start"]({ reason: "resume" }, ctx);
    expect(await modelMessages(cbs, [old], ctx)).toEqual([]);
  });

  it("does not carry an active injection into another session", async () => {
    spawnMock.mockImplementation(() => respondingChild(HOOK_OUTPUT));
    const cbs = register();
    const old = persistedMessage(await cbs["before_agent_start"]({ prompt: "old build guidance" }, { sessionId: "one" }));
    expect(await modelMessages(cbs, [old], { sessionId: "two" })).toEqual([]);
  });

  it("discards a pending retrieval after the session changes", async () => {
    const pending = makeChild();
    spawnMock.mockImplementationOnce(() => pending).mockImplementationOnce(() => respondingChild(""));
    const cbs = register();
    const result = cbs["before_agent_start"]({ prompt: "old build guidance" }, { sessionId: "one" });
    await cbs["session_start"]({ reason: "new" }, { sessionId: "two" });
    pending.stdoutHandlers["data"]?.(HOOK_OUTPUT);
    pending.handlers["close"]?.(0);
    await expect(result).resolves.toBeUndefined();
  });

  it("expires the injection when a queued user message arrives between tool calls", async () => {
    spawnMock.mockImplementation(() => respondingChild(HOOK_OUTPUT));
    const cbs = register();
    const current = persistedMessage(await cbs["before_agent_start"]({ prompt: "old build guidance" }, {}));
    const tool = { role: "toolResult", toolCallId: "build", toolName: "bash", content: [{ type: "text", text: "passed" }], isError: false, timestamp: 2 };
    const correction = { role: "user", content: "That guidance is obsolete; use anyhow.", timestamp: 3 };
    expect(await modelMessages(cbs, [current, tool])).toEqual([current, tool]);
    expect(await modelMessages(cbs, [current, tool, correction])).toEqual([tool, correction]);
    // Expiry survives subsequent context trimming or an automatic retry.
    expect(await modelMessages(cbs, [current, tool])).toEqual([tool]);
  });

  it("excludes memory injections from new compaction summaries without rewriting history", async () => {
    spawnMock.mockImplementation(() => respondingChild(HOOK_OUTPUT));
    const cbs = register();
    const current = persistedMessage(await cbs["before_agent_start"]({ prompt: "build guidance" }, {}));
    const user = { role: "user", content: "fix the build", timestamp: 2 };
    const other = { role: "custom", customType: "other-extension", content: "keep", display: false, timestamp: 3 };
    const history = [current, user, other];
    const preparation = {
      messagesToSummarize: history,
      turnPrefixMessages: [current, user],
      previousSummary: "An existing summary is left intact.",
      firstKeptEntryId: "kept-boundary",
    };
    await cbs["session_before_compact"]?.({ preparation }, {});
    expect(preparation.messagesToSummarize).toEqual([user, other]);
    expect(preparation.turnPrefixMessages).toEqual([user]);
    expect(preparation.firstKeptEntryId).toBe("kept-boundary");
    expect(preparation.previousSummary).toBe("An existing summary is left intact.");
    expect(history).toEqual([current, user, other]);
  });

  it("excludes injections from branch summaries and expires context on tree navigation", async () => {
    spawnMock.mockImplementation(() => respondingChild(HOOK_OUTPUT));
    const cbs = register();
    const current = persistedMessage(await cbs["before_agent_start"]({ prompt: "build guidance" }, {}));
    const memoryEntry = { type: "custom_message", id: "injection", customType: "kimetsu-brain", content: current.content };
    const userEntry = { type: "message", id: "user", message: { role: "user", content: "fix build" } };
    const otherEntry = { type: "custom_message", id: "other", customType: "other-extension", content: "keep" };
    const entries = [memoryEntry, userEntry, otherEntry];
    const preparation = { entriesToSummarize: [...entries], targetId: "user" };
    const summaryInput = preparation.entriesToSummarize;
    await cbs["session_before_tree"]?.({ preparation }, {});
    expect(preparation.entriesToSummarize).toEqual([userEntry, otherEntry]);
    expect(summaryInput).toEqual([userEntry, otherEntry]);
    expect(entries).toEqual([memoryEntry, userEntry, otherEntry]);
    await cbs["session_tree"]?.({ newLeafId: "user" }, {});
    expect(await modelMessages(cbs, [current])).toEqual([]);
  });

  it("allows session saving to finish after the retrieval deadline", async () => {
    vi.useFakeTimers();
    const child = makeChild();
    spawnMock.mockImplementation(() => child);
    const cbs = register();
    let completed = false;
    const saving = cbs["session_shutdown"]({}, {}).then(() => { completed = true; });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(completed).toBe(false);
    expect(child.kill).not.toHaveBeenCalled();
    child.handlers["close"]?.(0);
    await saving;
    expect(completed).toBe(true);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("still bounds a hung session save", async () => {
    vi.useFakeTimers();
    const child = makeChild();
    spawnMock.mockImplementation(() => child);
    const cbs = register();
    let completed = false;
    const saving = cbs["session_shutdown"]({}, {}).then(() => { completed = true; });
    await vi.advanceTimersByTimeAsync(299_999);
    expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await saving;
    expect(completed).toBe(true);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it("keeps the short deadline for prompt retrieval", async () => {
    vi.useFakeTimers();
    const child = makeChild();
    spawnMock.mockImplementation(() => child);
    const cbs = register();
    const retrieving = cbs["before_agent_start"]({ prompt: "why is the build red" }, {});
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(retrieving).resolves.toBeUndefined();
    expect(child.kill).toHaveBeenCalledTimes(1);
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

  it("passes Pi's persisted transcript to Kimetsu lifecycle hooks", async () => {
    const stop = respondingChild("");
    const shutdown = respondingChild("");
    spawnMock.mockImplementationOnce(() => stop).mockImplementationOnce(() => shutdown);
    const cbs = register();
    const ctx = {
      cwd: "/repo",
      sessionManager: {
        getSessionId: () => "pi-session-84",
        getSessionFile: () => "/sessions/pi-session-84.jsonl",
      },
    };

    await cbs["agent_end"]({ messages: [{ role: "assistant", content: "done" }] }, ctx);
    await cbs["session_shutdown"]({}, ctx);

    expect(JSON.parse(stop.stdinWrites[0] as string)).toEqual({
      session_id: "pi-session-84",
      transcript_path: "/sessions/pi-session-84.jsonl",
    });
    expect(JSON.parse(shutdown.stdinWrites[0] as string)).toEqual({
      session_id: "pi-session-84",
      transcript_path: "/sessions/pi-session-84.jsonl",
    });
  });

  it("falls back to Pi's inline messages for an ephemeral session", async () => {
    const child = respondingChild("");
    spawnMock.mockImplementation(() => child);
    const cbs = register();
    const messages = [{ role: "assistant", content: "done" }];

    await cbs["agent_end"]({ messages }, { sessionId: "ephemeral" });

    expect(JSON.parse(child.stdinWrites[0] as string)).toEqual({
      session_id: "ephemeral",
      transcript: messages,
    });
  });
});
