// Kimetsu brain extension for Pi (earendil-works/pi).
// Published as the `kimetsu-pi` npm package. Shells out to the kimetsu binary
// on Pi lifecycle events to load brain context at session start and record
// audit markers on session end. If kimetsu is not on PATH the exec silently
// fails; Pi startup is unaffected.

import { spawn } from "node:child_process";

function kimetsuExec(args: string[]): Promise<void> {
  return new Promise((resolve) => {
    try {
      const child = spawn("kimetsu", args, {
        stdio: "ignore",
        shell: false,
        windowsHide: true,
      });
      child.on("error", () => resolve()); // binary not on PATH — silent no-op
      child.on("close", () => resolve());
    } catch {
      resolve(); // any unexpected error — silent no-op
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
