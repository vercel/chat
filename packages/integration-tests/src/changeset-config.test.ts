import { relative, sep } from "node:path";
import { read } from "@changesets/config";
import { getPackages } from "@manypkg/get-packages";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./documentation-test-utils";

// Example apps must follow this naming convention so the `example-*` glob in
// .changeset/config.json picks them up automatically — see the assertions below.
const EXAMPLE_NAME_CONVENTION = /^example-/;

const toPosix = (path: string): string => path.split(sep).join("/");

describe("changesets config", () => {
  it("ignores every examples/* workspace package", async () => {
    const packages = await getPackages(REPO_ROOT);
    // `read` resolves the `ignore` globs against real package names (and throws
    // if any glob matches nothing), so `config.ignore` is the exact set of
    // package names changesets will skip at release time.
    const config = await read(REPO_ROOT, packages);

    const examplePackages = packages.packages.filter((pkg) =>
      toPosix(relative(REPO_ROOT, pkg.dir)).startsWith("examples/")
    );

    // Guard against the test silently passing if examples move or disappear.
    expect(examplePackages.length).toBeGreaterThan(0);

    for (const pkg of examplePackages) {
      const { name } = pkg.packageJson;
      const dir = toPosix(relative(REPO_ROOT, pkg.dir));

      // Enforce the naming convention the `example-*` glob relies on. An app
      // named e.g. `sample-foo` would not be matched and would silently leak
      // into releases.
      expect(
        name,
        `Example app at ${dir} must be named "example-*" so the changesets "example-*" ignore glob covers it`
      ).toMatch(EXAMPLE_NAME_CONVENTION);

      // The real guarantee: every example app is ignored, so releases never
      // version or publish them.
      expect(
        config.ignore,
        `Example app "${name}" (${dir}) must be ignored by changesets`
      ).toContain(name);
    }
  });
});
