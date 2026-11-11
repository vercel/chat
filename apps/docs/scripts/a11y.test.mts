import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./a11y.mts", import.meta.url));
const CLEAN_PAGE = `<!doctype html>
<html lang="en"><head><title>Accessibility fixture</title>
<style>body { color: #000; background: #fff; }</style></head>
<body><main><h1>Documentation</h1><p>Readable content.</p></main></body></html>`;
const DARK_VIOLATION_PAGE = CLEAN_PAGE.replace(
  "</main>",
  `<style>.unnamed { display: none; }
  @media (prefers-color-scheme: dark) { .unnamed { display: block; } }</style>
  <button class="unnamed" type="button"></button></main>`
);
const SECTION_BUTTON =
  '<button type="button" aria-label="Back to all documentation sections">Official Adapters</button>';
const KNOWN_SIDEBAR = `<div id="nd-docs-layout">
  <nav aria-label="Documentation" data-geistdocs-sidebar-scroll="true">
  <div data-sidebar-pane="section">${SECTION_BUTTON}</div></nav></div>`;
const KNOWN_PAGE = CLEAN_PAGE.replace("</main>", `${KNOWN_SIDEBAR}</main>`);
const PROGRESS_LINE = /^\[\d+\/\d+\] [✓✗] .+ \((?:light|dark)\)$/gm;

interface ResponseFixture {
  body: string;
  status?: number;
}

let responses = new Map<string, ResponseFixture>();
let requests = new Map<string, number>();
const server = createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  requests.set(path, (requests.get(path) ?? 0) + 1);
  const fixture = responses.get(path);
  response.writeHead(fixture?.status ?? (fixture ? 200 : 404), {
    "content-type": path === "/sitemap.md" ? "text/markdown" : "text/html",
  });
  response.end(fixture?.body ?? "Not found");
});

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

function setFixtures(
  sitemap: ResponseFixture,
  pages: Record<string, ResponseFixture> = {}
) {
  requests = new Map();
  responses = new Map([
    ["/sitemap.md", sitemap],
    ["/", { body: CLEAN_PAGE }],
    ["/adapters", { body: CLEAN_PAGE }],
    ["/resources", { body: CLEAN_PAGE }],
    ...Object.entries(pages),
  ]);
}

async function runAudit() {
  const child = spawn(process.execPath, [SCRIPT, baseUrl], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
  });
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    output += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    output += chunk;
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, signal) => {
      if (signal) {
        reject(new Error(`Audit terminated with ${signal}:\n${output}`));
      } else {
        resolve(exitCode);
      }
    });
  });
  return { code, output };
}

test("checks each discovered page once per theme and accepts accessible pages", async () => {
  setFixtures(
    {
      body: "# Sitemap\n- [Guide](/docs/guide)\n- [Duplicate](/docs/guide)\n- [Home](/)",
    },
    { "/docs/guide": { body: CLEAN_PAGE } }
  );
  const { code, output } = await runAudit();
  assert.equal(code, 0, output);
  assert.ok(output.includes("All 8 page checks passed."), output);
  assert.ok(
    output.includes("KNOWN_VIOLATIONS entries no longer match anything"),
    output
  );
  assert.ok(output.includes("label-content-name-mismatch on"), output);
  const progress = output.match(PROGRESS_LINE) ?? [];
  assert.equal(progress.length, 8, output);
  for (const path of ["/", "/adapters", "/resources", "/docs/guide"]) {
    for (const theme of ["light", "dark"]) {
      assert.equal(
        progress.filter((line) => line.endsWith(`✓ ${path} (${theme})`)).length,
        1,
        output
      );
    }
    assert.equal(requests.get(path), 2, `${path}: ${output}`);
  }
});

test("fails for a dark-only axe violation and HTTP errors while checking other pages", async () => {
  setFixtures(
    { body: "- [Broken](/docs/broken)\n- [Missing](/docs/missing)" },
    {
      "/docs/broken": { body: DARK_VIOLATION_PAGE },
      "/docs/missing": { body: CLEAN_PAGE, status: 404 },
    }
  );
  const { code, output } = await runAudit();
  assert.equal(code, 1, output);
  assert.ok(output.includes("✓ /docs/broken (light)"), output);
  assert.ok(
    output.includes("✗ /docs/broken (dark)\n  [critical] button-name:"),
    output
  );
  for (const theme of ["light", "dark"]) {
    assert.ok(output.includes(`✗ /docs/missing (${theme}): HTTP 404`), output);
    assert.ok(output.includes(`✓ /resources (${theme})`), output);
  }
  assert.ok(output.includes("3 of 10 page checks failed."), output);
});

test("rejects a failed sitemap request before scanning pages", async () => {
  setFixtures({ body: "Unavailable", status: 503 });
  const { code, output } = await runAudit();
  assert.equal(code, 1, output);
  assert.ok(
    output.includes(`Failed to fetch ${baseUrl}/sitemap.md: 503`),
    output
  );
  assert.equal(requests.size, 1);
  assert.equal(requests.get("/sitemap.md"), 1);
});

test("warns for the dependency sidebar button on adapter detail pages", async () => {
  const paths = ["official", "community", "vendor-official"].map(
    (group) => `/adapters/${group}/fixture`
  );
  setFixtures(
    { body: paths.map((path) => `- [Adapter](${path})`).join("\n") },
    Object.fromEntries(paths.map((path) => [path, { body: KNOWN_PAGE }]))
  );
  const { code, output } = await runAudit();
  assert.equal(code, 0, output);
  assert.ok(output.includes("All 12 page checks passed."), output);
  assert.ok(
    output.includes("Known violations (not failing the check):"),
    output
  );
  assert.ok(
    output.includes("label-content-name-mismatch: 6 page checks"),
    output
  );
  assert.ok(!output.includes("no longer match anything"), output);
});

test("fails other nodes under the known rule and the same button outside adapter details", async () => {
  const mixedPage = KNOWN_PAGE.replace(
    "</main>",
    `<button id="unexpected-label" type="button" aria-label="Go back">Delete item</button>
    <div id="outside-sidebar">${SECTION_BUTTON}</div></main>`
  );
  setFixtures(
    {
      body: "- [Mixed](/adapters/official/mixed)\n- [Guide](/docs/guide)\n- [Index](/adapters/official)",
    },
    {
      "/adapters/official/mixed": { body: mixedPage },
      "/docs/guide": { body: KNOWN_PAGE },
      "/adapters/official": { body: KNOWN_PAGE },
    }
  );
  const { code, output } = await runAudit();
  assert.equal(code, 1, output);
  assert.ok(
    output.includes("label-content-name-mismatch: 2 page checks"),
    output
  );
  assert.ok(output.includes("- #unexpected-label"), output);
  assert.ok(output.includes("#outside-sidebar"), output);
  for (const path of [
    "/adapters/official/mixed",
    "/docs/guide",
    "/adapters/official",
  ]) {
    for (const theme of ["light", "dark"]) {
      assert.ok(
        output.includes(
          `✗ ${path} (${theme})\n  [serious] label-content-name-mismatch:`
        ),
        output
      );
    }
  }
  assert.ok(output.includes("6 of 12 page checks failed."), output);
});

test("does not accept frame or shadow targets that resemble the dependency button", async () => {
  const page = KNOWN_PAGE.replace(
    "</main>",
    `<iframe id="embedded" title="Embedded example"></iframe><div id="shadow-host"></div>
    <script>
    document.querySelector('#embedded').srcdoc = ${JSON.stringify(KNOWN_PAGE)};
    document.querySelector('#shadow-host').attachShadow({mode: 'open'}).innerHTML = ${JSON.stringify(KNOWN_SIDEBAR)};
    </script></main>`
  );
  setFixtures(
    { body: "- [Embedded](/adapters/official/embedded)" },
    { "/adapters/official/embedded": { body: page } }
  );
  const { code, output } = await runAudit();
  assert.equal(code, 1, output);
  assert.ok(
    output.includes("label-content-name-mismatch: 2 page checks"),
    output
  );
  assert.ok(output.includes("- #embedded "), output);
  assert.ok(output.includes("#shadow-host"), output);
  for (const theme of ["light", "dark"]) {
    assert.ok(
      output.includes(
        `✗ /adapters/official/embedded (${theme})\n  [serious] label-content-name-mismatch:`
      ),
      output
    );
  }
  assert.ok(output.includes("2 of 8 page checks failed."), output);
});

for (const [name, body] of [
  ["empty", ""],
  ["HTML fallback", CLEAN_PAGE],
  [
    "unrecognized links",
    "# Sitemap\n- [Guide](https://example.com/docs/guide)",
  ],
]) {
  test(`rejects an ${name} sitemap instead of passing only extra routes`, async () => {
    setFixtures({ body });
    const { code, output } = await runAudit();
    assert.equal(code, 1, output);
    assert.ok(output.includes("sitemap.md"), output);
    assert.ok(output.includes("No page paths"), output);
    assert.equal(requests.size, 1);
    assert.equal(requests.get("/sitemap.md"), 1);
  });
}
