import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { convertToLlm, DefaultResourceLoader, ExtensionRunner, SessionManager, type ModelRegistry } from "@earendil-works/pi-coding-agent";
import { createTestSandbox } from "./helpers/sandbox.ts";

const binary = process.env.KIMETSU_TEST_BINARY;
if (process.env.KIMETSU_INTEGRATION_REQUIRED === "1" && !binary) {
  throw new Error("KIMETSU_TEST_BINARY is required for the CLI integration gate");
}
if (binary && !isAbsolute(binary)) throw new Error("KIMETSU_TEST_BINARY must be an absolute executable path");
let sandbox: ReturnType<typeof createTestSandbox> | undefined;

afterEach(() => {
  vi.unstubAllEnvs();
  sandbox?.cleanup();
  sandbox = undefined;
});

describe.skipIf(!binary)("real Kimetsu CLI", () => {
  it("retrieves a corrected memory and saves a Pi work episode in an isolated brain", async () => {
    sandbox = createTestSandbox();
    const { root: scratch, workspace, env } = sandbox;
    env.PATH = dirname(resolve(binary!)) + delimiter + env.PATH;
    // The extension spawns the CLI itself. Isolate its inherited environment
    // too; Vitest restores every key before fixture cleanup.
    for (const key of new Set([...Object.keys(process.env), ...Object.keys(env)])) vi.stubEnv(key, env[key]);
    const cli = (...args: string[]) => {
      sandbox!.assertWorkspace();
      return execFileSync(binary!, args, { cwd: workspace, env, encoding: "utf8", timeout: 30_000, windowsHide: true });
    };
    cli("init");
    cli("config", "set", "embedder.enabled", "false");
    // Session-end launches overdue upkeep detached. Run it synchronously first
    // so no background writer can race fixture cleanup after the hook exits.
    const upkeep = JSON.parse(cli("brain", "maintain", "--json"));
    expect(upkeep.length).toBeGreaterThan(0);
    expect(upkeep.every((pass: { ok: boolean }) => pass.ok)).toBe(true);
    const oldText = "Orchid production gateway port is 3000.";
    const correctedText = "Orchid production gateway port is 4000.";
    cli("brain", "memory", "add", "--scope", "project", "--kind", "fact", oldText);
    const rows = JSON.parse(cli("brain", "memory", "list", "--json"));
    const memoryId = rows.find((row: { text: string }) => row.text === oldText)?.memory_id;
    expect(memoryId).toBeTruthy();

    const session = SessionManager.create(workspace, join(scratch, "sessions"));
    const loader = new DefaultResourceLoader({
      cwd: workspace, agentDir: join(scratch, "agent"),
      additionalExtensionPaths: [resolve("extensions/kimetsu.ts")],
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    });
    await loader.reload();
    const loaded = loader.getExtensions();
    expect(loaded.errors).toEqual([]);
    const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, workspace, session, {} as ModelRegistry);
    const errors: unknown[] = [];
    runner.onError((error) => errors.push(error));
    const prompt = "What is the Orchid production gateway port?";
    session.appendMessage({ role: "user", content: prompt, timestamp: 1 });
    const first = (await runner.emitBeforeAgentStart({ messageType: "user", prompt }, { cwd: workspace })).messages[0];
    expect(first?.content).toContain("3000");
    session.appendCustomMessageEntry(first.customType, first.content, false, first.details);

    cli("brain", "memory", "edit", memoryId, "--text", correctedText);
    session.appendMessage({ role: "user", content: "The production configuration was corrected. " + prompt, timestamp: 2 });
    const second = (await runner.emitBeforeAgentStart({ messageType: "user", prompt }, { cwd: workspace })).messages[0];
    expect(second?.content).toContain("4000");
    session.appendCustomMessageEntry(second.customType, second.content, false, second.details);
    const history = session.buildSessionContext().messages;
    const filtered = await runner.emitContext(structuredClone(history));
    const modelInput = JSON.stringify(convertToLlm(filtered));
    expect(modelInput).toContain("4000");
    expect(modelInput).not.toContain("3000");
    expect(JSON.stringify(history)).toContain("3000");

    const custom = { role: "custom" as const, customType: "background", content: "Background task completed.", display: true, timestamp: 4 };
    const customResult = await runner.emitBeforeAgentStart({ messageType: "custom", message: custom }, { cwd: workspace });
    expect(customResult.messages).toEqual([]);
    const customInput = await runner.emitContext([...structuredClone(history), custom]);
    expect(customInput.filter((m) => m.role === "custom" && m.customType === "kimetsu-brain")).toEqual([]);
    expect(customInput).toContainEqual(custom);

    // Flush an actual Pi JSONL transcript for the session-end hook to consume.
    session.appendMessage({
      role: "assistant", content: [{ type: "text", text: "Verified Orchid production gateway port is 4000." }],
      api: "openai-responses", provider: "test", model: "test", stopReason: "stop", timestamp: 3,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    });
    cli("brain", "cite", "--memory-id", memoryId, "--query", prompt, "--note", "The corrected memory answered the port question.");
    const schedule = JSON.parse(cli("brain", "maintain", "--status", "--json"));
    expect(schedule.every((pass: { due: boolean }) => !pass.due)).toBe(true);
    await runner.emit({ type: "session_shutdown", reason: "quit" });
    expect(errors).toEqual([]);
    const resume = cli("resume", "--task-id", session.getSessionId());
    expect(resume).toContain("Saved:");
    expect(resume).toContain("4000");
  }, 60_000);
});
