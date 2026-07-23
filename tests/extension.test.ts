import { describe, it, expect, vi, beforeEach } from "vitest";

// Controllable spawn mock: each test sets the child's behaviour.
const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import extension from "../extensions/kimetsu.ts";

function makeChild() {
  const handlers: Record<string, (...a: unknown[]) => void> = {};
  const child = {
    handlers,
    kill: vi.fn(),
    on(ev: string, cb: (...a: unknown[]) => void) {
      handlers[ev] = cb;
      return child;
    },
  };
  return child;
}

beforeEach(() => {
  spawnMock.mockReset();
});

describe("kimetsu pi extension", () => {
  it("registers the three lifecycle handlers", () => {
    spawnMock.mockImplementation(() => makeChild());
    const registered: string[] = [];
    const pi = { on: (ev: string, _cb: unknown) => registered.push(ev) };
    extension(pi as any);
    expect(registered).toEqual(["session_start", "agent_end", "session_shutdown"]);
  });

  it("does not throw when the binary is missing", async () => {
    // Simulate "binary not on PATH": fire 'error' asynchronously.
    spawnMock.mockImplementation(() => {
      const child = makeChild();
      setTimeout(() => child.handlers["error"]?.(), 0);
      return child;
    });
    const cbs: Record<string, (e: unknown, c: unknown) => Promise<void>> = {};
    const pi = { on: (ev: string, cb: any) => { cbs[ev] = cb; } };
    extension(pi as any);
    await expect(cbs["session_start"]({}, {})).resolves.toBeUndefined();
  });

  it("resolves and kills the child if the binary hangs", async () => {
    vi.useFakeTimers();
    // A child that never fires 'error' or 'close' — a hung binary.
    const child = makeChild();
    spawnMock.mockImplementation(() => child);
    const cbs: Record<string, (e: unknown, c: unknown) => Promise<void>> = {};
    const pi = { on: (ev: string, cb: any) => { cbs[ev] = cb; } };
    extension(pi as any);
    // agent_end runs a single kimetsuExec call.
    const p = cbs["agent_end"]({}, {});
    await vi.advanceTimersByTimeAsync(10000);
    await expect(p).resolves.toBeUndefined();
    expect(child.kill).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
