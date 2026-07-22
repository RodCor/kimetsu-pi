import { describe, it, expect } from "vitest";
import pkg from "../package.json" with { type: "json" };

describe("pi package manifest", () => {
  it("declares the pi-package keyword", () => {
    expect(pkg.keywords).toContain("pi-package");
  });
  it("declares extensions and skills paths", () => {
    expect(pkg.pi.extensions).toEqual(["./extensions"]);
    expect(pkg.pi.skills).toEqual(["./skills"]);
  });
});
