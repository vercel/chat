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
import { type Browser, chromium } from "playwright";

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

// Violations that cannot be fixed yet, such as ones that come from a
// dependency. They are reported as warnings instead of failing the job. Each
// entry maps an axe rule ID to the pages it is allowed on, or "*" for every
// page. Remove an entry once it is fixed; the script prints entries that no
// longer match anything.
const KNOWN_VIOLATIONS: Record<string, "*" | string[]> = {};

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

function isKnown(ruleId: string, path: string): boolean {
  const allowed = KNOWN_VIOLATIONS[ruleId];
  return allowed === "*" || (allowed?.includes(path) ?? false);
}

async function getPaths(): Promise<string[]> {
  const response = await fetch(`${baseUrl}/sitemap.md`);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${baseUrl}/sitemap.md: ${response.status} ${response.statusText}`
    );
  }
  const sitemap = await response.text();
  const paths = new Set(EXTRA_PATHS);
  for (const match of sitemap.matchAll(SITEMAP_LINK)) {
    paths.add(match[1]);
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
      if (isKnown(violation.id, path)) {
        result.known.push(violation);
      } else {
        result.violations.push(violation);
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
      seen.add(`${violation.id} ${result.path}`);
      seen.add(`${violation.id} *`);
    }
  }
  if (counts.size > 0) {
    process.stdout.write("\nKnown violations (not failing the check):\n");
    for (const [id, count] of [...counts].sort()) {
      process.stdout.write(`  ${id}: ${count} page checks\n`);
    }
  }
  const stale = Object.entries(KNOWN_VIOLATIONS).flatMap(([id, allowed]) =>
    (allowed === "*" ? ["*"] : allowed)
      .filter((path) => !seen.has(`${id} ${path}`))
      .map((path) => `${id} on ${path}`)
  );
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
