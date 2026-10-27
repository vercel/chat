// Runs axe-core accessibility checks against every page of a running docs site.
//
// Usage: node scripts/a11y.mts [base-url]
//
// The base URL defaults to http://localhost:3000. Pages come from the site's
// /sitemap.md, plus a few top-level routes that the sitemap does not list. Each
// page is checked in light and dark mode, since the two themes use different
// colors. The script exits non-zero when a page has a WCAG 2.2 A or AA
// violation that is not listed in KNOWN_VIOLATIONS.

import { AxeBuilder } from "@axe-core/playwright";
import { type Browser, chromium, type Page } from "playwright";

const WCAG_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22a",
  "wcag22aa",
];
const COLOR_SCHEMES = ["light", "dark"] as const;
const EXTRA_PATHS = ["/", "/adapters", "/resources"];
// Pages spend most of their time loading, so this can exceed the CPU count.
const CONCURRENCY = 6;
const SITEMAP_LINK = /\]\((\/[^)\s]*)\)/g;
const TRAILING_SLASH = /\/$/;

// Each exception applies only to matching nodes on matching paths. Other
// nodes reported under the same rule still fail. Remove an entry once its
// dependency is fixed; the summary reports entries that no longer match.
const KNOWN_VIOLATIONS: Record<string, { paths: RegExp; selector: string }> = {
  // @vercel/geistdocs 2.13.2 owns this section button and its accessible name.
  // Its aria-label omits the visible section name, and no public option lets
  // the app change it. Keep this warning until the package fixes the label.
  "label-content-name-mismatch": {
    paths: /^\/adapters\/(?:official|community|vendor-official)\/[^/]+\/?$/,
    selector:
      '#nd-docs-layout nav[data-geistdocs-sidebar-scroll="true"] [data-sidebar-pane="section"] button[aria-label="Back to all documentation sections"]',
  },
};

type ColorScheme = (typeof COLOR_SCHEMES)[number];

interface Violation {
  help: string;
  helpUrl: string;
  id: string;
  impact?: string | null;
  nodes: { target: unknown[] }[];
}

interface PageResult {
  colorScheme: ColorScheme;
  error?: string;
  known: Violation[];
  path: string;
  violations: Violation[];
}

const baseUrl = (process.argv[2] ?? "http://localhost:3000").replace(
  TRAILING_SLASH,
  ""
);

async function isKnown(
  page: Page,
  ruleId: string,
  path: string,
  node: Violation["nodes"][number]
): Promise<boolean> {
  const allowed = KNOWN_VIOLATIONS[ruleId];
  if (
    !allowed?.paths.test(path) ||
    node.target.length !== 1 ||
    typeof node.target[0] !== "string"
  ) {
    return false;
  }
  // Frame and shadow-root targets are excluded above. Resolve the direct
  // selector and check the actual element, rather than trusting axe's choice
  // of selector text or suppressing every node in the violation.
  return await page.evaluate(
    ({ target, selector }) => {
      const elements = document.querySelectorAll(target);
      return elements.length === 1 && elements[0].matches(selector);
    },
    { target: node.target[0], selector: allowed.selector }
  );
}

async function getPaths(): Promise<string[]> {
  const response = await fetch(`${baseUrl}/sitemap.md`);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${baseUrl}/sitemap.md: ${response.status} ${response.statusText}`
    );
  }
  const sitemap = await response.text();
  const paths = new Set<string>();
  for (const match of sitemap.matchAll(SITEMAP_LINK)) {
    paths.add(match[1]);
  }
  if (paths.size === 0) {
    throw new Error(`No page paths found in ${baseUrl}/sitemap.md`);
  }
  for (const path of EXTRA_PATHS) {
    paths.add(path);
  }
  return [...paths].sort();
}

async function checkPage(
  browser: Browser,
  path: string,
  colorScheme: ColorScheme
): Promise<PageResult> {
  const result: PageResult = { path, colorScheme, violations: [], known: [] };
  const context = await browser.newContext({ colorScheme });
  const page = await context.newPage();
  try {
    const response = await page.goto(`${baseUrl}${path}`, {
      waitUntil: "load",
    });
    if (!response?.ok()) {
      result.error = `HTTP ${response?.status() ?? "no response"}`;
      return result;
    }
    const { violations } = await new AxeBuilder({ page })
      .withTags(WCAG_TAGS)
      .analyze();
    for (const violation of violations) {
      const knownNodes: Violation["nodes"] = [];
      const unexpectedNodes: Violation["nodes"] = [];
      for (const node of violation.nodes) {
        if (await isKnown(page, violation.id, path, node)) {
          knownNodes.push(node);
        } else {
          unexpectedNodes.push(node);
        }
      }
      if (knownNodes.length > 0) {
        result.known.push({ ...violation, nodes: knownNodes });
      }
      if (unexpectedNodes.length > 0) {
        result.violations.push({ ...violation, nodes: unexpectedNodes });
      }
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    // Closing fails if the browser crashed; the error is already recorded.
    await context.close().catch(() => undefined);
  }
  return result;
}

function printViolation(violation: Violation) {
  process.stdout.write(
    `  [${violation.impact ?? "unknown"}] ${violation.id}: ${violation.help}\n    ${violation.helpUrl}\n`
  );
  for (const node of violation.nodes.slice(0, 5)) {
    process.stdout.write(`    - ${node.target.join(" ")}\n`);
  }
  if (violation.nodes.length > 5) {
    process.stdout.write(
      `    … and ${violation.nodes.length - 5} more elements\n`
    );
  }
}

function printKnownSummary(results: PageResult[]) {
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  for (const result of results) {
    for (const violation of result.known) {
      counts.set(violation.id, (counts.get(violation.id) ?? 0) + 1);
      seen.add(violation.id);
    }
  }
  if (counts.size > 0) {
    process.stdout.write("\nKnown violations (not failing the check):\n");
    for (const [id, count] of [...counts].sort()) {
      process.stdout.write(`  ${id}: ${count} page checks\n`);
    }
  }
  const stale = Object.entries(KNOWN_VIOLATIONS)
    .filter(([id]) => !seen.has(id))
    .map(([id, allowed]) => `${id} on ${allowed.paths}: ${allowed.selector}`);
  if (stale.length > 0) {
    process.stdout.write(
      "\nThese KNOWN_VIOLATIONS entries no longer match anything and can be removed:\n"
    );
    for (const entry of stale) {
      process.stdout.write(`  ${entry}\n`);
    }
  }
}

async function main() {
  const paths = await getPaths();
  const jobs = paths.flatMap((path) =>
    COLOR_SCHEMES.map((colorScheme) => ({ path, colorScheme }))
  );
  process.stdout.write(
    `Checking ${paths.length} pages in ${COLOR_SCHEMES.length} color schemes against ${baseUrl}\n`
  );

  const browser = await chromium.launch();
  const results: PageResult[] = [];
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next];
      next += 1;
      const result = await checkPage(browser, job.path, job.colorScheme);
      results.push(result);
      const passed = !result.error && result.violations.length === 0;
      process.stdout.write(
        `[${results.length}/${jobs.length}] ${passed ? "✓" : "✗"} ${result.path} (${result.colorScheme})\n`
      );
    }
  };
  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  } finally {
    await browser.close();
  }

  results.sort(
    (a, b) =>
      a.path.localeCompare(b.path) || a.colorScheme.localeCompare(b.colorScheme)
  );
  const failed = results.filter(
    (result) => result.error || result.violations.length > 0
  );
  for (const result of failed) {
    const label = `${result.path} (${result.colorScheme})`;
    if (result.error) {
      process.stdout.write(`\n✗ ${label}: ${result.error}\n`);
      continue;
    }
    process.stdout.write(`\n✗ ${label}\n`);
    for (const violation of result.violations) {
      printViolation(violation);
    }
  }
  printKnownSummary(results);

  if (failed.length > 0) {
    process.stdout.write(
      `\n${failed.length} of ${results.length} page checks failed.\n`
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`\nAll ${results.length} page checks passed.\n`);
}

await main();
