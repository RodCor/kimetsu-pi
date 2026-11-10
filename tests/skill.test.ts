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
    expect(md).toContain("kimetsu_network_status");
    expect(md).toContain("kimetsu_network_request");
    expect(md).toContain("Do not run `kimetsu network share` unless the user explicitly asks");
    expect(md).toContain("2.11.0");
    expect(md).toContain("Nothing listens until");
  });
});

describe("peer network docs", () => {
  it("documents install, usage, and the 0.2.0 changelog", () => {
    const readme = readFileSync("README.md", "utf8");
    const changelog = readFileSync("CHANGELOG.md", "utf8");
    expect(readme).toContain("## Peer network");
    expect(readme).toContain("kimetsu network invite");
    expect(readme).toContain("kimetsu network join");
    expect(readme).toContain("kimetsu network status");
    expect(readme).toContain("kimetsu network leave");
    expect(readme).toContain("kimetsu network share");
    expect(readme).toContain("kimetsu network request");
    expect(readme).toContain("/kimetsu-network-share");
    expect(readme).toContain("2.11.0");
    expect(changelog).toContain("## 0.2.0");
    expect(changelog).toContain("peer network");
  });
});
