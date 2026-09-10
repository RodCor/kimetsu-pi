import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { convertToLlm, SessionManager } from "@earendil-works/pi-coding-agent";
import extension from "../extensions/kimetsu.ts";
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
    const ctx = { cwd: workspace, sessionManager: session };
    const handlers: Record<string, (event: any, context: any) => Promise<any>> = {};
    extension({ on: (name: string, handler: any) => { handlers[name] = handler; } } as any);
    const prompt = "What is the Orchid production gateway port?";
    session.appendMessage({ role: "user", content: prompt, timestamp: 1 });
    const first = await handlers.before_agent_start({ prompt }, ctx);
    expect(first?.message?.content).toContain("3000");
    session.appendCustomMessageEntry(first.message.customType, first.message.content, false, first.message.details);

    cli("brain", "memory", "edit", memoryId, "--text", correctedText);
    session.appendMessage({ role: "user", content: "The production configuration was corrected. " + prompt, timestamp: 2 });
    const second = await handlers.before_agent_start({ prompt }, ctx);
    expect(second?.message?.content).toContain("4000");
    session.appendCustomMessageEntry(second.message.customType, second.message.content, false, second.message.details);
    const history = session.buildSessionContext().messages;
    const filtered = await handlers.context({ messages: structuredClone(history) }, ctx);
    const modelInput = JSON.stringify(convertToLlm(filtered.messages));
    expect(modelInput).toContain("4000");
    expect(modelInput).not.toContain("3000");
    expect(JSON.stringify(history)).toContain("3000");

    // Flush an actual Pi JSONL transcript for the session-end hook to consume.
    session.appendMessage({
      role: "assistant", content: [{ type: "text", text: "Verified Orchid production gateway port is 4000." }],
      api: "openai-responses", provider: "test", model: "test", stopReason: "stop", timestamp: 3,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    });
    cli("brain", "cite", "--memory-id", memoryId, "--query", prompt, "--note", "The corrected memory answered the port question.");
    const schedule = JSON.parse(cli("brain", "maintain", "--status", "--json"));
    expect(schedule.every((pass: { due: boolean }) => !pass.due)).toBe(true);
    await handlers.session_shutdown({}, ctx);
    const resume = cli("resume", "--task-id", session.getSessionId());
    expect(resume).toContain("Saved:");
    expect(resume).toContain("4000");
  }, 60_000);
});
