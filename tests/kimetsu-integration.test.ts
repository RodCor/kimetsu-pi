import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
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

  it("checks kimetsu --version and does not listen when the binary has no peer network", async () => {
    sandbox = createTestSandbox();
    const { root: scratch, workspace, env } = sandbox;
    env.PATH = dirname(resolve(binary!)) + delimiter + env.PATH;
    for (const key of new Set([...Object.keys(process.env), ...Object.keys(env)])) vi.stubEnv(key, env[key]);
    const version = execFileSync(binary!, ["--version"], { cwd: workspace, env, encoding: "utf8", timeout: 30_000, windowsHide: true });
    const numbers = version.match(/(\d+)\.(\d+)\.(\d+)/);
    expect(numbers).not.toBeNull();
    const [major, minor, patch] = numbers!.slice(1).map(Number);
    const supportsNetwork = major > 2 || (major === 2 && (minor > 11 || (minor === 11 && patch >= 0)));
    const loader = new DefaultResourceLoader({
      cwd: workspace, agentDir: join(scratch, "agent"),
      additionalExtensionPaths: [resolve("extensions/kimetsu.ts")],
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    });
    await loader.reload();
    const loaded = loader.getExtensions();
    expect(loaded.errors).toEqual([]);
    const statusTool = loaded.extensions[0].tools.get("kimetsu_network_status")!;
    const requestTool = loaded.extensions[0].tools.get("kimetsu_network_request")!;
    const ctx = { cwd: workspace };
    const status = await statusTool.definition.execute("status", {}, undefined, undefined, ctx as never);
    const request = await requestTool.definition.execute(
      "request", { peer: "abc@127.0.0.1:9" }, undefined, undefined, ctx as never,
    );
    const text = (block: { type: string; text?: string } | undefined) => block?.type === "text" ? block.text ?? "" : "";
    const statusText = text(status.content[0]);
    const requestText = text(request.content[0]);
    expect(String(status.details && (status.details as { listening?: boolean }).listening)).toBe("false");
    expect(String(request.details && (request.details as { listening?: boolean }).listening)).toBe("false");
    const probe = spawnSync(binary!, ["network", "status", "--json"], {
      cwd: workspace, env, encoding: "utf8", timeout: 30_000, windowsHide: true,
    });
    if (!supportsNetwork) {
      expect(version).toContain("2.");
      expect(statusText).toContain("2.11.0");
      expect(statusText).toContain("Nothing is listening");
      expect(request.isError).toBe(true);
      expect(requestText).toContain("Nothing is listening");
      expect(probe.status).not.toBe(0);
      return;
    }
    const report = JSON.parse(probe.stdout);
    expect(report.listening).toBe(false);
    expect(statusText).toContain("Nothing is listening");
    if (report.compiled === false) {
      expect(request.isError).toBe(true);
      expect(requestText).toContain("Nothing is listening");
      return;
    }
    expect(report.compiled).toBe(true);
    expect(request.isError).toBe(true);
    expect(requestText.toLowerCase()).toMatch(/nothing was contacted|not on a network|nothing is listening/);
  }, 60_000);
});
