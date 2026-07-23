// Kimetsu brain extension for Pi (earendil-works/pi).
// Published as the `kimetsu-pi` npm package. Shells out to the kimetsu binary
// on Pi lifecycle events to load brain context at session start and record
// audit markers on session end. If kimetsu is not on PATH the exec silently
// fails; Pi startup is unaffected.

import { spawn } from "node:child_process";

function kimetsuExec(args: string[]): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve();
    };
    try {
      const child = spawn("kimetsu", args, {
        stdio: "ignore",
        shell: false,
        windowsHide: true,
      });
      // A hung binary must never stall the lifecycle hook: cap the wait and
      // kill the child if it overruns. unref() so the timer alone can't keep
      // the host process alive.
      timer = setTimeout(() => {
        child.kill();
        done();
      }, 10000);
      if (typeof timer.unref === "function") timer.unref();
      child.on("error", done); // binary not on PATH — silent no-op
      child.on("close", done); // finished, or killed by the timeout above
    } catch {
      done(); // any unexpected error — silent no-op
    }
  });
}

export default function (pi: any) {
  // session_start fires once when Pi starts up or a new session begins.
  pi.on("session_start", async (_event: any, _ctx: any) => {
    await kimetsuExec(["brain", "warm"]);
    await kimetsuExec(["brain", "context-hook"]);
  });

  // agent_end fires after the LLM turn completes (maps to Kimetsu stop-hook).
  pi.on("agent_end", async (_event: any, _ctx: any) => {
    await kimetsuExec(["brain", "stop-hook"]);
  });

  // session_shutdown fires on clean session close (maps to session-end-hook).
  pi.on("session_shutdown", async (_event: any, _ctx: any) => {
    await kimetsuExec(["brain", "session-end-hook"]);
  });
}
