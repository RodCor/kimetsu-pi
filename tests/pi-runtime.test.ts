import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { compact, DefaultResourceLoader, ExtensionRunner, SessionManager, type ModelRegistry } from "@earendil-works/pi-coding-agent";

async function loadExtension() {
  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: process.cwd(),
    additionalExtensionPaths: [resolve("extensions/kimetsu.ts")],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  return loader.getExtensions();
}

describe("current Pi runtime", () => {
  it("loads the extension and recognizes every lifecycle hook", async () => {
    const loaded = await loadExtension();

    expect(loaded.errors).toEqual([]);
    expect(loaded.extensions).toHaveLength(1);
    expect([...loaded.extensions[0].handlers.keys()]).toEqual([
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

  it("filters the real compaction preparation before Pi sends summary requests", async () => {
    const loaded = await loadExtension();
    const session = SessionManager.inMemory(process.cwd());
    const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, process.cwd(), session, {} as ModelRegistry);
    const errors: unknown[] = [];
    runner.onError((error) => errors.push(error));
    const oldMemory = { role: "custom" as const, customType: "kimetsu-brain", content: "OBSOLETE_PORT_3000", display: false, timestamp: 1 };
    const preparation: Parameters<typeof compact>[0] = {
      firstKeptEntryId: "keep-this-boundary",
      messagesToSummarize: [oldMemory, { role: "user", content: "Verified production port is 4000.", timestamp: 2 }],
      turnPrefixMessages: [oldMemory, { role: "user", content: "Keep working on the verified configuration.", timestamp: 3 }],
      isSplitTurn: true,
      tokensBefore: 4000,
      fileOps: { read: new Set(["config.toml"]), written: new Set(), edited: new Set() },
      settings: { enabled: true, reserveTokens: 1024, keepRecentTokens: 1024 },
    };
    await runner.emit({ type: "session_before_compact", preparation, branchEntries: [], reason: "manual", willRetry: false, signal: new AbortController().signal });

    // Only the external model is replaced. Pi builds both real summary requests.
    const requests: string[] = [];
    const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
    const streamFn = async (_model: unknown, context: { messages: unknown[] }) => {
      requests.push(JSON.stringify(context.messages));
      const response = { role: "assistant", content: [{ type: "text", text: "Verified configuration summary." }], stopReason: "stop", timestamp: 4, usage };
      return { async *[Symbol.asyncIterator]() { yield { type: "done" }; }, result: async () => response };
    };
    const model = { id: "test", provider: "test", api: "openai-responses", maxTokens: 1024 } as Parameters<typeof compact>[1];
    const result = await compact(preparation, model, "", undefined, undefined, undefined, undefined, streamFn as unknown as Parameters<typeof compact>[7]);
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(2);
    expect(requests.join("\n")).not.toContain("OBSOLETE_PORT_3000");
    expect(requests[0]).toContain("Verified production port is 4000.");
    expect(requests[1]).toContain("Keep working on the verified configuration.");
    expect(result.firstKeptEntryId).toBe("keep-this-boundary");
    expect(result.summary).toContain("config.toml");
  });
});
