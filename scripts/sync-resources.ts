import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface Resource {
  description: string;
  href: string;
  title: string;
  type: "guide" | "template";
}

interface ResourcesFile {
  resources: Resource[];
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");
const sourceFile = join(repoRoot, "apps", "docs", "resources-edge-config.json");
const chatPackageRoot = join(repoRoot, "packages", "chat");
const resourcesDir = join(chatPackageRoot, "resources");
const guidesDir = join(resourcesDir, "guides");
const templatesFile = join(resourcesDir, "templates.json");
const skillFile = join(repoRoot, "skills", "chat", "SKILL.md");
const docsPublicDir = join(repoRoot, "apps", "docs", "public");
const scaffoldTemplateDir = join(
  repoRoot,
  "packages",
  "create-chat-sdk",
  "_template"
);

/**
 * Exact copies of {@link skillFile}: two served by the docs site and two
 * bundled into the `create-chat-sdk` scaffold template.
 */
const skillFileCopies = [
  join(docsPublicDir, ".well-known", "agent-skills", "chat-sdk", "SKILL.md"),
  join(docsPublicDir, "AGENTS.md"),
  join(scaffoldTemplateDir, ".agents", "skills", "chat-sdk", "SKILL.md"),
  join(scaffoldTemplateDir, ".claude", "skills", "chat-sdk", "SKILL.md"),
];

const RESOURCES_START = "<!-- RESOURCES:START -->";
const RESOURCES_END = "<!-- RESOURCES:END -->";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_GUIDE_BYTES = 1_000_000;
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

/**
 * Error thrown by {@link fetchGuideMarkdown}, carrying whether the failure is
 * worth retrying.
 */
class FetchError extends Error {
  readonly retryable: boolean;

  /**
   * @param message - Human-readable failure description.
   * @param retryable - `true` for transient failures (5xx), `false` for
   * permanent ones (4xx, bad content-type, oversized body).
   */
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "FetchError";
    this.retryable = retryable;
  }
}

/**
 * Resolves after a delay.
 *
 * @param ms - Milliseconds to wait.
 * @returns A promise that resolves once the delay elapses.
 */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Decides whether a thrown value represents a transient failure. Native fetch
 * rejections (network errors, `AbortError` on timeout) are transient, so
 * anything that is not an explicitly non-retryable {@link FetchError} is
 * retried.
 *
 * @param error - The value thrown by the attempted operation.
 * @returns `true` if the operation should be retried.
 */
const isRetryable = (error: unknown): boolean =>
  !(error instanceof FetchError) || error.retryable;

/**
 * Runs an async operation, retrying transient failures with exponential
 * backoff.
 *
 * @typeParam T - The resolved value of the operation.
 * @param label - Identifier included in retry warnings.
 * @param fn - The operation to run; retried up to {@link RETRY_ATTEMPTS} times.
 * @returns The resolved value of `fn`.
 * @throws The last error if all attempts fail or the error is non-retryable.
 */
const withRetry = async <T>(
  label: string,
  fn: () => Promise<T>
): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === RETRY_ATTEMPTS) {
        throw error;
      }
      const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(
        `Attempt ${attempt}/${RETRY_ATTEMPTS} failed for ${label}: ${reason}. Retrying in ${delay}ms...`
      );
      await sleep(delay);
    }
  }
  throw lastError;
};

/**
 * Type guard for a single {@link Resource} entry.
 *
 * @param value - The parsed value to check.
 * @returns `true` if `value` has the required string fields and a valid `type`.
 */
const isResource = (value: unknown): value is Resource => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.href === "string" &&
    typeof entry.title === "string" &&
    typeof entry.description === "string" &&
    (entry.type === "guide" || entry.type === "template")
  );
};

/**
 * Parses and validates the raw resources-edge-config JSON.
 *
 * @param raw - The file contents to parse.
 * @returns The validated resources payload.
 * @throws If the content is not valid JSON, lacks a `resources` array, or
 * contains an entry that fails {@link isResource}.
 */
const parseResourcesFile = (raw: string): ResourcesFile => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${sourceFile} is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  const resources = (parsed as { resources?: unknown })?.resources;
  if (!Array.isArray(resources)) {
    throw new Error(`${sourceFile} must contain a "resources" array`);
  }
  for (const [index, entry] of resources.entries()) {
    if (!isResource(entry)) {
      throw new Error(
        `Invalid resource at index ${index} in ${sourceFile}: ${JSON.stringify(entry)}`
      );
    }
  }
  return { resources };
};

/**
 * Parses an href and asserts it uses the `https:` protocol.
 *
 * @param href - The URL string to validate.
 * @returns The parsed {@link URL}.
 * @throws If `href` is not a valid URL or does not use `https:`.
 */
const assertHttpsUrl = (href: string): URL => {
  const url = new URL(href);
  if (url.protocol !== "https:") {
    throw new Error(`href must use https: ${href}`);
  }
  return url;
};

/**
 * Derives a kebab-case slug from the last path segment of an href.
 *
 * @param href - The guide URL to derive a slug from.
 * @returns The validated slug.
 * @throws If the href is not https, has no usable path segment, or the segment
 * is not kebab-case `a-z0-9`.
 */
const slugFromHref = (href: string): string => {
  const url = assertHttpsUrl(href);
  const last = url.pathname.split("/").filter(Boolean).pop();
  if (!last) {
    throw new Error(`Cannot derive slug from href: ${href}`);
  }
  if (!SLUG_PATTERN.test(last)) {
    throw new Error(
      `Unexpected slug shape (expected kebab-case a-z0-9): ${last} from ${href}`
    );
  }
  return last;
};

/**
 * Fetches a guide's markdown by appending `.md` to its href.
 *
 * @param href - The guide URL (without the `.md` suffix).
 * @returns The markdown body.
 * @throws A {@link FetchError} on non-2xx responses, a non-`text/markdown`
 * content-type, or a body exceeding {@link MAX_GUIDE_BYTES}.
 */
const fetchGuideMarkdown = async (href: string): Promise<string> => {
  assertHttpsUrl(href);
  const url = `${href}.md`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new FetchError(
      `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
      response.status >= 500
    );
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/markdown")) {
    throw new FetchError(
      `Unexpected content-type for ${url}: ${contentType}. Expected text/markdown.`,
      false
    );
  }
  const body = await response.text();
  if (body.length > MAX_GUIDE_BYTES) {
    throw new FetchError(
      `Guide exceeds ${MAX_GUIDE_BYTES} bytes (${body.length}): ${url}`,
      false
    );
  }
  return body;
};

/**
 * Renders the marker-delimited resources block embedded in the skill file.
 *
 * @param guides - Resources of type `guide`.
 * @param templates - Resources of type `template`.
 * @returns The block, bounded by {@link RESOURCES_START} and
 * {@link RESOURCES_END}.
 */
const renderSkillBlock = (
  guides: Resource[],
  templates: Resource[]
): string => {
  const guideLines = guides
    .map(
      (g) =>
        `- \`node_modules/chat/resources/guides/${slugFromHref(g.href)}.md\` — ${g.description}`
    )
    .join("\n");
  const templateLines = templates
    .map((t) => `- **${t.title}** — ${t.description} (${t.href})`)
    .join("\n");
  return [
    RESOURCES_START,
    "",
    "### Guides",
    "",
    guideLines,
    "",
    "### Templates",
    "",
    "Listed in `node_modules/chat/resources/templates.json`:",
    "",
    templateLines,
    "",
    RESOURCES_END,
  ].join("\n");
};

/**
 * Rewrites the resources block in {@link skillFile} and mirrors the result to
 * {@link skillFileCopies}.
 *
 * @param guides - Resources of type `guide`.
 * @param templates - Resources of type `template`.
 * @throws If the start/end markers are missing or out of order in the skill
 * file.
 */
const updateSkillFile = async (guides: Resource[], templates: Resource[]) => {
  const existing = await readFile(skillFile, "utf8");
  const startIdx = existing.indexOf(RESOURCES_START);
  const endIdx = existing.indexOf(RESOURCES_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(
      `Cannot find ${RESOURCES_START}/${RESOURCES_END} markers in ${skillFile}`
    );
  }
  const before = existing.slice(0, startIdx);
  const after = existing.slice(endIdx + RESOURCES_END.length);
  const next = `${before}${renderSkillBlock(guides, templates)}${after}`;
  if (next !== existing) {
    await writeFile(skillFile, next, "utf8");
    console.log(`Updated ${skillFile}`);
  }
  await syncSkillFileCopies(next);
};

/**
 * Writes the skill-file content to every path in {@link skillFileCopies},
 * creating parent directories and skipping paths already in sync.
 *
 * @param content - The exact skill-file content to mirror.
 */
const syncSkillFileCopies = async (content: string) => {
  for (const copyPath of skillFileCopies) {
    await mkdir(dirname(copyPath), { recursive: true });
    const current = await readFile(copyPath, "utf8").catch(() => null);
    if (current !== content) {
      await writeFile(copyPath, content, "utf8");
      console.log(`Updated ${copyPath}`);
    }
  }
};

/**
 * Syncs the KB resources: validates the config, derives collision-free slugs,
 * fetches every guide into memory before touching disk, then writes guides,
 * templates, and the skill file (with its copies).
 *
 * @throws If validation fails, two guides resolve to the same slug, or a guide
 * fetch fails after retries.
 */
const main = async () => {
  const raw = await readFile(sourceFile, "utf8");
  const { resources } = parseResourcesFile(raw);

  const guides = resources.filter((r) => r.type === "guide");
  const templates = resources.filter((r) => r.type === "template");

  const guidesBySlug = new Map<string, Resource>();
  for (const guide of guides) {
    const slug = slugFromHref(guide.href);
    const existing = guidesBySlug.get(slug);
    if (existing) {
      throw new Error(
        `Duplicate guide slug "${slug}" from ${existing.href} and ${guide.href}`
      );
    }
    guidesBySlug.set(slug, guide);
  }

  const fetchedGuides: { slug: string; markdown: string }[] = [];
  for (const [slug, guide] of guidesBySlug) {
    const markdown = await withRetry(guide.href, () =>
      fetchGuideMarkdown(guide.href)
    );
    fetchedGuides.push({ slug, markdown });
  }

  await rm(resourcesDir, { recursive: true, force: true });
  await mkdir(guidesDir, { recursive: true });

  for (const { slug, markdown } of fetchedGuides) {
    const outPath = join(guidesDir, `${slug}.md`);
    await writeFile(outPath, markdown, "utf8");
    console.log(`Wrote ${outPath}`);
  }

  const templatesPayload = {
    templates: templates.map(({ title, description, href }) => ({
      title,
      description,
      href,
    })),
  };
  await writeFile(
    templatesFile,
    `${JSON.stringify(templatesPayload, null, 2)}\n`,
    "utf8"
  );
  console.log(`Wrote ${templatesFile}`);

  await updateSkillFile(guides, templates);
};

await main();
