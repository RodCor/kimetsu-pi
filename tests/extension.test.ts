import { describe, it, expect, vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawn: () => {
    const handlers: Record<string, () => void> = {};
    const child = { on: (ev: string, cb: () => void) => { handlers[ev] = cb; return child; } };
    // Simulate "binary not on PATH": fire 'error' asynchronously.
    setTimeout(() => handlers["error"]?.(), 0);
    return child as any;
  },
}));

import extension from "../extensions/kimetsu.ts";

describe("kimetsu pi extension", () => {
  it("registers the three lifecycle handlers", () => {
    const registered: string[] = [];
    const pi = { on: (ev: string, _cb: unknown) => registered.push(ev) };
    extension(pi as any);
    expect(registered).toEqual(["session_start", "agent_end", "session_shutdown"]);
  });

  it("does not throw when the binary is missing", async () => {
    const cbs: Record<string, (e: unknown, c: unknown) => Promise<void>> = {};
    const pi = { on: (ev: string, cb: any) => { cbs[ev] = cb; } };
    extension(pi as any);
    await expect(cbs["session_start"]({}, {})).resolves.toBeUndefined();
  });
});
