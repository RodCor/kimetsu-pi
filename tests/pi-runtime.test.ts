import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

describe("current Pi runtime", () => {
  it("loads the extension and recognizes every lifecycle hook", async () => {
    const extensionPath = resolve("extensions/kimetsu.ts");
    const loader = new DefaultResourceLoader({
      cwd: process.cwd(),
      agentDir: process.cwd(),
      additionalExtensionPaths: [extensionPath],
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });

    await loader.reload();
    const loaded = loader.getExtensions();

    expect(loaded.errors).toEqual([]);
    expect(loaded.extensions).toHaveLength(1);
    expect([...loaded.extensions[0].handlers.keys()]).toEqual([
      "session_start",
      "before_agent_start",
      "agent_end",
      "session_shutdown",
    ]);
  });
});
