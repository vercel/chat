// biome-ignore-all lint/style/noDoneCallback: node:test passes a TestContext, not a completion callback.
// biome-ignore-all lint/suspicious/noMisplacedAssertion: node:assert also validates fixture helpers and workflow loading.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const workflow = readFileSync(
  new URL("../workflows/ci.yml", import.meta.url),
  "utf8"
);
const STEP_PATTERN =
  / {6}- name: Check if docs inputs changed\n[\s\S]*? {8}run: \|\n((?: {10}[^\n]*\n|\n)+)/;
const INDENT_PATTERN = /^ {10}/gm;
const match = workflow.match(STEP_PATTERN);
assert.ok(match, "The docs change detection run block must exist");
const script = match[1].replace(INDENT_PATTERN, "");
assert.ok(script.includes("git diff"), "Run the real change detection script");

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function write(cwd, path, contents = path) {
  const target = join(cwd, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function commit(cwd, message) {
  git(cwd, "add", ".");
  git(cwd, "-c", "commit.gpgsign=false", "commit", "-m", message);
}

function fixture(t, paths) {
  const root = mkdtempSync(join(tmpdir(), "docs-changes-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const origin = join(root, "origin");
  const checkout = join(root, "checkout");
  git(root, "init", "--initial-branch=main", origin);
  git(origin, "config", "user.name", "Test");
  git(origin, "config", "user.email", "test@example.com");
  write(origin, "README.md");
  write(origin, "apps/docs/existing.mdx");
  commit(origin, "Base");
  git(origin, "checkout", "-b", "feature");
  for (const path of paths) {
    write(origin, path);
  }
  commit(origin, "Feature");
  git(origin, "checkout", "main");
  write(origin, "unrelated-base.txt");
  commit(origin, "Base before merge");
  const baseSha = git(origin, "rev-parse", "HEAD");
  git(origin, "checkout", "-b", "merge");
  git(origin, "merge", "--no-ff", "feature", "-m", "PR merge");
  git(root, "clone", pathToFileURL(origin).href, checkout);
  git(checkout, "checkout", "--detach");
  git(checkout, "config", "user.name", "Test");
  git(checkout, "config", "user.email", "test@example.com");
  return { baseSha, checkout, origin, root };
}

function detect(f, { baseSha = f.baseSha, event = "pull_request" } = {}) {
  const output = join(f.root, "output");
  writeFileSync(output, "");
  const result = spawnSync(
    "bash",
    ["--noprofile", "--norc", "-eo", "pipefail", "-c", script],
    {
      cwd: f.checkout,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        BASE_REF: "main",
        BASE_SHA: baseSha,
        EVENT_NAME: event,
        GITHUB_OUTPUT: output,
      },
      timeout: 10_000,
    }
  );
  assert.ifError(result.error);
  return { ...result, output: readFileSync(output, "utf8") };
}

function expectChanged(result, changed) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, `changed=${changed}\n`);
}

for (const path of [
  "apps/docs/content/docs/new.mdx",
  "packages/catalog/src/new.ts",
  "packages/adapter-slack/README.md",
  "pnpm-lock.yaml",
  ".github/workflows/ci.yml",
]) {
  test(`checks docs when ${path} changes`, (t) => {
    expectChanged(detect(fixture(t, [path])), true);
  });
}

test("skips unrelated code changes", (t) => {
  expectChanged(detect(fixture(t, ["packages/chat/src/new.ts"])), false);
});

test("uses the event base when the remote base has advanced", (t) => {
  const f = fixture(t, ["apps/docs/new.mdx"]);
  git(f.origin, "checkout", "main");
  write(f.origin, "later-base.txt");
  commit(f.origin, "Base after merge");
  git(f.checkout, "fetch", "origin", "main");
  assert.notEqual(git(f.checkout, "rev-parse", "origin/main"), f.baseSha);
  expectChanged(detect(f), true);
});

test("checks docs when a page is renamed outside the docs directory", (t) => {
  const f = fixture(t, ["unrelated-feature.txt"]);
  mkdirSync(join(f.checkout, "archive"));
  git(f.checkout, "mv", "apps/docs/existing.mdx", "archive/existing.mdx");
  commit(f.checkout, "Archive page");
  expectChanged(detect(f), true);
});

test("fails instead of skipping when the diff cannot be computed", (t) => {
  const result = detect(fixture(t, ["apps/docs/new.mdx"]), {
    baseSha: "missing-base",
  });
  assert.notEqual(result.status, 0);
  assert.equal(result.output, "");
});

test("checks non-PR events without reading a Git repository", (t) => {
  const root = mkdtempSync(join(tmpdir(), "docs-changes-push-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  expectChanged(detect({ root, checkout: root }, { event: "push" }), true);
});
