import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("kimetsu-brain skill", () => {
  it("has valid frontmatter with name and description", () => {
    const md = readFileSync("skills/kimetsu-brain/SKILL.md", "utf8");
    const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    expect(m).not.toBeNull();
    expect(m![1]).toContain("name: kimetsu-brain");
    expect(m![1]).toMatch(/description: .+/);
    expect(md).toContain("kimetsu brain memory add --scope project");
    expect(md).not.toContain("kimetsu brain record");
  });
});
