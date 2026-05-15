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

const RESOURCES_START = "<!-- RESOURCES:START -->";
const RESOURCES_END = "<!-- RESOURCES:END -->";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_GUIDE_BYTES = 1_000_000;

const assertHttpsUrl = (href: string): URL => {
  const url = new URL(href);
  if (url.protocol !== "https:") {
    throw new Error(`href must use https: ${href}`);
  }
  return url;
};

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

const fetchGuideMarkdown = async (href: string): Promise<string> => {
  assertHttpsUrl(href);
  const url = `${href}.md`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: ${response.status} ${response.statusText}`
    );
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/markdown")) {
    throw new Error(
      `Unexpected content-type for ${url}: ${contentType}. Expected text/markdown.`
    );
  }
  const body = await response.text();
  if (body.length > MAX_GUIDE_BYTES) {
    throw new Error(
      `Guide exceeds ${MAX_GUIDE_BYTES} bytes (${body.length}): ${url}`
    );
  }
  return body;
};

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
};

const main = async () => {
  const raw = await readFile(sourceFile, "utf8");
  const { resources } = JSON.parse(raw) as ResourcesFile;

  const guides = resources.filter((r) => r.type === "guide");
  const templates = resources.filter((r) => r.type === "template");

  await rm(resourcesDir, { recursive: true, force: true });
  await mkdir(guidesDir, { recursive: true });

  for (const guide of guides) {
    const slug = slugFromHref(guide.href);
    const markdown = await fetchGuideMarkdown(guide.href);
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
