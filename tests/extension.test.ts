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
  const stderrHandlers: Record<string, (...a: unknown[]) => void> = {};
  const child = {
    handlers,
    stdoutHandlers,
    stderrHandlers,
    stdinWrites: [] as unknown[],
    kill: vi.fn(),
    stdout: {
      setEncoding: vi.fn(),
      on(ev: string, cb: (...a: unknown[]) => void) {
        stdoutHandlers[ev] = cb;
        return child.stdout;
      },
    },
    stderr: {
      setEncoding: vi.fn(),
      on(ev: string, cb: (...a: unknown[]) => void) {
        stderrHandlers[ev] = cb;
        return child.stderr;
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
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  const pi = {
    on: (ev: string, cb: any) => { cbs[ev] = cb; },
    registerTool: (tool: any) => { tools.set(tool.name, tool); },
    registerCommand: (name: string, options: any) => { commands.set(name, options); },
  };
  extension(pi as any);
  return Object.assign(cbs, { tools, commands });
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
  it("expires user memory without retrieving on a Pi custom-triggered turn", async () => {
    spawnMock.mockImplementation(() => respondingChild(HOOK_OUTPUT));
    const cbs = register();
    const old = persistedMessage(await cbs.before_agent_start({ messageType: "user", prompt: "build guidance" }, {}));
    const custom = { role: "custom", customType: "notification", content: "Background job finished", display: true, timestamp: 2 };
    const result = await cbs.before_agent_start({ messageType: "custom", message: custom }, {});
    expect(result).toBeUndefined();
    expect(await modelMessages(cbs, [old, custom])).toEqual([custom]);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("discards pending user retrieval when a custom turn starts", async () => {
    const child = makeChild();
    spawnMock.mockImplementation(() => child);
    const cbs = register();
    const pending = cbs.before_agent_start({ messageType: "user", prompt: "build guidance" }, {});
    await cbs.before_agent_start({ messageType: "custom", message: { content: "notification" } }, {});
    child.stdoutHandlers.data(HOOK_OUTPUT);
    child.handlers.close();
    await expect(pending).resolves.toBeUndefined();
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("registers lifecycle and context handlers", () => {
    spawnMock.mockImplementation(() => makeChild());
    const registered: string[] = [];
    const pi = {
      on: (ev: string, _cb: unknown) => registered.push(ev),
      registerTool: () => {},
      registerCommand: () => {},
    };
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

  it("does not contact the peer network while preparing a turn", async () => {
    spawnMock.mockImplementation(() => respondingChild(""));
    const cbs = register();
    await cbs["session_start"]({}, { cwd: "/repo" });
    await cbs["before_agent_start"]({ prompt: "why is the build red" }, { cwd: "/repo" });
    const argLists = spawnMock.mock.calls.map((call) => call[1] as string[]);
    expect(argLists.some((args) => args.includes("network") || args.includes("--version"))).toBe(false);
  });
});

const STATUS_JOINED = JSON.stringify({
  compiled: true,
  joined: true,
  listening: false,
  group: "friends",
  role: "founder",
  generation: 2,
  endpoint_id: "abc",
});

const REQUEST_OK = JSON.stringify({
  verified: true,
  digest: "digest-1",
  imported: 2,
  deduped: 1,
  quarantined: 0,
  superseded: 0,
  listening: false,
});

function versionChild(versionLine: string) {
  return () => respondingChild(`${versionLine}\n`);
}

describe("kimetsu peer network", () => {
  it("registers status and request tools without a share tool", () => {
    spawnMock.mockImplementation(() => makeChild());
    const { tools, commands } = register();
    expect([...tools.keys()]).toEqual(["kimetsu_network_status", "kimetsu_network_request"]);
    expect([...commands.keys()]).toEqual([
      "kimetsu-network-status",
      "kimetsu-network-request",
      "kimetsu-network-share",
    ]);
    expect(tools.get("kimetsu_network_status").annotations).toMatchObject({
      readOnlyHint: true,
      openWorldHint: false,
    });
    expect(tools.get("kimetsu_network_request").annotations).toMatchObject({
      readOnlyHint: false,
      openWorldHint: true,
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("reports an older binary and does not run network", async () => {
    spawnMock.mockImplementation(versionChild("kimetsu 2.8.0 (lean, +pi, +openclaw)"));
    const { tools } = register();
    const result = await tools.get("kimetsu_network_status").execute(
      "call", {}, undefined, undefined, { cwd: "/repo" },
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toBe(
      "Peer network needs Kimetsu 2.11.0 or newer. This binary is 2.8.0 (lean, +pi, +openclaw). Nothing is listening.",
    );
    expect(result.details).toMatchObject({ available: false, joined: false, listening: false, compiled: null });
    expect(spawnMock.mock.calls.map((call) => call[1])).toEqual([["--version"]]);
  });

  it("reports a missing binary without throwing", async () => {
    spawnMock.mockImplementation(() => {
      const child = makeChild();
      setTimeout(() => child.handlers["error"]?.(), 0);
      return child;
    });
    const { tools } = register();
    const result = await tools.get("kimetsu_network_status").execute(
      "call", {}, undefined, undefined, { cwd: "/repo" },
    );
    expect(result.content[0].text).toBe("Kimetsu is not on PATH. Nothing is listening.");
    expect(result.details.listening).toBe(false);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("reads status json and does not pass listen or relay flags", async () => {
    spawnMock
      .mockImplementationOnce(versionChild("kimetsu 2.11.0 (lean)"))
      .mockImplementationOnce(() => respondingChild(`${STATUS_JOINED}\n`));
    const { tools } = register();
    const result = await tools.get("kimetsu_network_status").execute(
      "call", {}, undefined, undefined, { cwd: "/repo" },
    );
    expect(result.content[0].text).toBe(
      'Peer network: joined "friends" (founder). Endpoint abc. Nothing is listening.',
    );
    expect(result.details).toMatchObject({
      available: true,
      compiled: true,
      joined: true,
      listening: false,
      group: "friends",
      role: "founder",
      generation: 2,
      endpoint_id: "abc",
    });
    const [bin, args, options] = spawnMock.mock.calls[1] as [string, string[], { stdio: string[]; shell: boolean }];
    expect(bin).toBe("kimetsu");
    expect(args).toEqual(["network", "status", "--json"]);
    expect(options.shell).toBe(false);
    expect(options.stdio).toEqual(["ignore", "pipe", "pipe"]);
    expect(args.join(" ")).not.toMatch(/relay|map-ports|share|request/);
  });

  it("degrades when the build has no peer network and does not request", async () => {
    const offline = JSON.stringify({ compiled: false, joined: false, listening: false });
    spawnMock.mockImplementation((...call: unknown[]) => {
      const args = call[1] as string[];
      if (args[0] === "--version") return respondingChild("kimetsu 2.11.0 (lean)\n");
      return respondingChild(`${offline}\n`);
    });
    const { tools } = register();
    const status = await tools.get("kimetsu_network_status").execute(
      "call", {}, undefined, undefined, { cwd: "/repo" },
    );
    expect(status.content[0].text).toBe("Peer network is not included in this build. Nothing is listening.");
    expect(status.details).toMatchObject({ available: false, compiled: false, listening: false });
    const request = await tools.get("kimetsu_network_request").execute(
      "call",
      { peer: "abc@127.0.0.1:9" },
      undefined,
      undefined,
      { cwd: "/repo" },
    );
    expect(request.isError).toBe(true);
    expect(request.content[0].text).toBe("Peer network is not included in this build. Nothing is listening.");
    expect(request.details.listening).toBe(false);
    const commands = spawnMock.mock.calls.map((call) => (call[1] as string[])[1]);
    expect(commands).not.toContain("request");
  });

  it("requests a repo pack only with an explicit peer and the secure defaults", async () => {
    spawnMock
      .mockImplementationOnce(versionChild("kimetsu 2.11.0 (lean)"))
      .mockImplementationOnce(() => respondingChild(`${JSON.stringify({ compiled: true, joined: true, listening: false })}\n`))
      .mockImplementationOnce(() => respondingChild(`${REQUEST_OK}\n`));
    const { tools } = register();
    const result = await tools.get("kimetsu_network_request").execute(
      "call",
      { peer: " abc@127.0.0.1:9 " },
      undefined,
      undefined,
      { cwd: "/repo" },
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toBe(
      "Verified the signature. Imported 2, already had 1, quarantined 0, superseded 0. Nothing is listening now.",
    );
    expect(result.details).toMatchObject({
      available: true,
      verified: true,
      listening: false,
      imported: 2,
      deduped: 1,
      quarantined: 0,
      superseded: 0,
      digest: "digest-1",
    });
    expect(spawnMock.mock.calls[2][1]).toEqual([
      "network", "request", "--json", "--no-mdns", "--workspace", "/repo", "--peer", "abc@127.0.0.1:9",
    ]);
  });

  it("refuses a request that names neither a peer nor discovery", async () => {
    spawnMock.mockImplementation(versionChild("kimetsu 2.11.0 (lean)"));
    const { tools } = register();
    const result = await tools.get("kimetsu_network_request").execute(
      "call", {}, undefined, undefined, { cwd: "/repo" },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      "Pass peer (endpoint-id@host:port) or set discover to true. Nothing was contacted.",
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("rejects a peer value that could be another flag", async () => {
    spawnMock.mockImplementation(versionChild("kimetsu 2.11.0 (lean)"));
    const { tools } = register();
    const result = await tools.get("kimetsu_network_request").execute(
      "call", { peer: "--map-ports" }, undefined, undefined, { cwd: "/repo" },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Nothing was contacted");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("enables discovery or port mapping only when the caller sets them", async () => {
    spawnMock.mockImplementation((...call: unknown[]) => {
      const args = call[1] as string[];
      if (args[0] === "--version") return respondingChild("kimetsu 2.11.0 (lean)\n");
      if (args[1] === "status") {
        return respondingChild(`${JSON.stringify({ compiled: true, joined: true, listening: false })}\n`);
      }
      return respondingChild(`${REQUEST_OK}\n`);
    });
    const { tools } = register();
    await tools.get("kimetsu_network_request").execute(
      "call",
      { discover: true, map_ports: true },
      undefined,
      undefined,
      { cwd: "/repo" },
    );
    const requestArgs = spawnMock.mock.calls.map((call) => call[1] as string[]).find((args) => args[1] === "request");
    expect(requestArgs).toEqual([
      "network", "request", "--json", "--workspace", "/repo", "--map-ports",
    ]);
  });

  it("returns the CLI error when a request cannot reach a peer", async () => {
    const child = makeChild();
    spawnMock.mockImplementation((...call: unknown[]) => {
      const args = call[1] as string[];
      if (args[0] === "--version") return respondingChild("kimetsu 2.11.0 (lean)\n");
      if (args[1] === "status") {
        return respondingChild(`${JSON.stringify({ compiled: true, joined: false, listening: false })}\n`);
      }
      setTimeout(() => {
        child.stderrHandlers["data"]?.("Error: not on a network. Run `kimetsu network join <code>`. Nothing was contacted.\n");
        child.handlers["close"]?.(1);
      }, 0);
      return child;
    });
    const { tools } = register();
    const result = await tools.get("kimetsu_network_request").execute(
      "call", { peer: "abc@127.0.0.1:9" }, undefined, undefined, { cwd: "/repo" },
    );
    expect(result.isError).toBe(true);
    expect(result.details.verified).toBe(false);
    expect(result.details.listening).toBe(false);
    expect(result.content[0].text).toContain("Nothing was contacted");
  });

  it("kills a hung request after its own deadline and not the retrieval deadline", async () => {
    vi.useFakeTimers();
    const version = makeChild();
    const status = makeChild();
    const hung = makeChild();
    spawnMock.mockImplementation((...call: unknown[]) => {
      const args = call[1] as string[];
      if (args[0] === "--version") return version;
      if (args[1] === "status") return status;
      return hung;
    });
    const { tools } = register();
    const pending = tools.get("kimetsu_network_request").execute(
      "call", { peer: "abc@127.0.0.1:9" }, undefined, undefined, { cwd: "/repo" },
    );
    version.stdoutHandlers["data"]?.("kimetsu 2.11.0 (lean)\n");
    version.handlers["close"]?.(0);
    await Promise.resolve();
    status.stdoutHandlers["data"]?.(
      `${JSON.stringify({ compiled: true, joined: true, listening: false })}\n`,
    );
    status.handlers["close"]?.(0);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(hung.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50_000);
    const result = await pending;
    expect(hung.kill).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      "The peer request timed out and the socket was closed. Nothing is listening.",
    );
  });

  it("closes the request socket when Pi aborts the call", async () => {
    const hung = makeChild();
    const controller = new AbortController();
    spawnMock.mockImplementation((...call: unknown[]) => {
      const args = call[1] as string[];
      if (args[0] === "--version") return respondingChild("kimetsu 2.11.0 (lean)\n");
      if (args[1] === "status") {
        return respondingChild(`${JSON.stringify({ compiled: true, joined: true, listening: false })}\n`);
      }
      setTimeout(() => controller.abort(), 0);
      return hung;
    });
    const { tools } = register();
    const result = await tools.get("kimetsu_network_request").execute(
      "call", { peer: "abc@127.0.0.1:9" }, controller.signal, undefined, { cwd: "/repo" },
    );
    expect(hung.kill).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toBe(
      "The peer request was cancelled and the socket was closed. Nothing is listening.",
    );
  });

  it("keeps sharing as an explicit command that does not spawn kimetsu", async () => {
    spawnMock.mockImplementation(versionChild("kimetsu 2.11.0 (lean)"));
    const { commands } = register();
    const notes: string[] = [];
    await commands.get("kimetsu-network-share").handler("", {
      cwd: "/repo",
      ui: { notify: (message: string) => notes.push(message) },
    });
    expect(spawnMock).not.toHaveBeenCalled();
    expect(notes).toEqual([
      "Sharing stays off until you run it yourself. In this project directory, run: kimetsu network share\nThat command listens until you press Ctrl-C. The relay stays off. Only this repo's memories are sent, after they are signed and scrubbed. Do not add --map-ports unless you want the router to open a UDP port. Nothing is listening now.",
    ]);
  });

  it("runs a slash-command request with the same secure defaults", async () => {
    spawnMock.mockImplementation((...call: unknown[]) => {
      const args = call[1] as string[];
      if (args[0] === "--version") return respondingChild("kimetsu 2.11.0 (lean)\n");
      if (args[1] === "status") {
        return respondingChild(`${JSON.stringify({ compiled: true, joined: true, listening: false })}\n`);
      }
      return respondingChild(`${REQUEST_OK}\n`);
    });
    const { commands } = register();
    const notes: Array<{ message: string; type?: string }> = [];
    await commands.get("kimetsu-network-request").handler("abc@127.0.0.1:9", {
      cwd: "/repo",
      ui: { notify: (message: string, type?: string) => notes.push({ message, type }) },
    });
    expect(spawnMock.mock.calls.map((call) => call[1])).toContainEqual([
      "network", "request", "--json", "--no-mdns", "--workspace", "/repo", "--peer", "abc@127.0.0.1:9",
    ]);
    expect(notes[0]?.message).toContain("Verified the signature");
    expect(notes[0]?.type).toBe("info");
  });
});
