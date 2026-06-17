import type {
  AdapterEnvSpec,
  CatalogAdapter,
  EnvGroup,
  EnvVar,
} from "chat/adapters";
import { getCliScaffoldSpec } from "../catalog/index.js";
import type { ProjectConfig } from "../types.js";
import { needsDiscordGateway } from "./routes.js";

const discordGatewayLines = (config: ProjectConfig): string[] => {
  if (!needsDiscordGateway(config)) {
    return [];
  }
  return [
    "# Discord Gateway (serverless cron)",
    "# Secret used to authenticate Vercel cron requests to the Gateway route.",
    "CRON_SECRET=",
    "",
  ];
};

const envLine = (envVar: EnvVar): string[] => {
  const labels = [envVar.description];
  if (envVar.secret) {
    labels.push("secret");
  }
  if (envVar.aliases?.length) {
    labels.push(`aliases: ${envVar.aliases.join(", ")}`);
  }
  return [`# ${labels.join(" - ")}`, `${envVar.key}=`];
};

const groupLines = (group: EnvGroup): string[] => [
  `# ${group.label}`,
  ...group.vars.flatMap(envLine),
];

const envSpecLines = (envSpec: AdapterEnvSpec): string[] => {
  const lines: string[] = [];
  if (envSpec.notes) {
    lines.push(`# ${envSpec.notes}`);
  }
  if (envSpec.config?.length) {
    lines.push(`# Constructor config: ${envSpec.config.join(", ")}`);
  }
  if (envSpec.required?.length) {
    lines.push("# Required");
    lines.push(...envSpec.required.flatMap(envLine));
  }
  if (envSpec.credentialModes?.length) {
    lines.push("# Credential modes");
    for (const group of envSpec.credentialModes) {
      lines.push(...groupLines(group));
    }
  }
  if (envSpec.optional?.length) {
    lines.push("# Optional");
    lines.push(...envSpec.optional.flatMap(envLine));
  }
  return lines;
};

/**
 * Env vars the generated `src/lib/bot.ts` reads for this adapter beyond the
 * ones the adapter package documents itself (e.g. REDIS_URL passed explicitly
 * to createIoRedisState, which has no env auto-detection).
 */
const scaffoldEnvLines = (
  adapter: CatalogAdapter,
  existing: readonly string[]
): string[] => {
  const { invocation } = getCliScaffoldSpec(adapter.slug);
  if (invocation.kind !== "object") {
    return [];
  }
  return invocation.properties
    .flatMap((property) =>
      property.value.kind === "env" ? [`${property.value.name}=`] : []
    )
    .filter((line) => !existing.includes(line));
};

const adapterSection = (adapter: CatalogAdapter): string[] => {
  const lines = envSpecLines(adapter.env);
  lines.push(...scaffoldEnvLines(adapter, lines));
  if (lines.length === 0) {
    return [];
  }
  return [`# ${adapter.name}`, ...lines];
};

/**
 * Generate `.env.example` for the selected project.
 *
 * @param config - Resolved project configuration.
 * @returns Example environment file contents.
 */
export function generateEnvExample(config: ProjectConfig): string {
  const sections = [
    "# Bot Configuration",
    `BOT_USERNAME=${config.name}`,
    "",
    ...config.platformAdapters.flatMap((adapter) => [
      ...adapterSection(adapter),
      "",
    ]),
    ...discordGatewayLines(config),
    ...adapterSection(config.stateAdapter),
  ].filter((line, index, lines) => !(line === "" && lines[index - 1] === ""));

  return `${sections.join("\n").trimEnd()}\n`;
}
