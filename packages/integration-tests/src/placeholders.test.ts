import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DOCS_CONTENT_DIR, REPO_ROOT } from "./documentation-test-utils";

describe("Contributor package templates", () => {
  it.each([
    "building",
    "documenting",
    "publishing",
  ])("%s uses explicit package placeholders", (guide) => {
    const content = readFileSync(
      join(DOCS_CONTENT_DIR, "docs/contributing", `${guide}.mdx`),
      "utf-8"
    );

    expect(content).not.toContain("chat-adapter-matrix");
    expect(content).toContain("YOUR_PUBLISHED_ADAPTER_PACKAGE");
  });

  it("uses an explicit package placeholder in the adapter scaffold", () => {
    const content = readFileSync(
      join(REPO_ROOT, ".agents/skills/add-adapter/assets/adapter.mdx"),
      "utf-8"
    );

    expect(content).not.toContain("@foo/chat-sdk-adapter");
    expect(content).toContain('packageName: "YOUR_PUBLISHED_ADAPTER_PACKAGE"');
    expect(content).toContain('from "YOUR_PUBLISHED_ADAPTER_PACKAGE"');
  });
});
