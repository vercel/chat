import type {
  AdapterEnvSpec,
  CatalogAdapter,
  EnvGroup,
  EnvVar,
} from "chat/adapters";
import {
  type AdapterConnectSpec,
  getAdapterConnectSpec,
  getCliScaffoldSpec,
} from "../catalog/index.js";
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

const connectAdapterSection = (
  adapter: CatalogAdapter,
  connect: AdapterConnectSpec
): string[] => {
  const lines = [
    `# ${adapter.name} (Vercel Connect)`,
    `# Vercel Connect connector UID (for example: ${adapter.slug}/your-connector)`,
    `${connect.connectorEnvVar}=`,
  ];
  for (const extra of connect.extraEnv ?? []) {
    lines.push(`# ${extra.description}`, `${extra.key}=`);
  }
  return lines;
};

const usesConnect = (config: ProjectConfig): boolean =>
  config.useConnect === true &&
  config.platformAdapters.some((adapter) =>
    getAdapterConnectSpec(adapter.slug)
  );

const connectNoteLines = (config: ProjectConfig): string[] => {
  if (!usesConnect(config)) {
    return [];
  }
  return [
    "# Vercel Connect",
    "# Adapters marked (Vercel Connect) below authenticate with a connector",
    "# instead of stored secrets. Vercel injects VERCEL_OIDC_TOKEN at runtime;",
    "# for local development run `vercel env pull` to populate it. Set each",
    "# connector UID below (or in your Vercel project's environment variables).",
    "",
  ];
};

const platformSection = (
  adapter: CatalogAdapter,
  config: ProjectConfig
): string[] => {
  const connect =
    config.useConnect === true
      ? getAdapterConnectSpec(adapter.slug)
      : undefined;
  return connect
    ? connectAdapterSection(adapter, connect)
    : adapterSection(adapter);
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
    ...connectNoteLines(config),
    ...config.platformAdapters.flatMap((adapter) => [
      ...platformSection(adapter, config),
      "",
    ]),
    ...discordGatewayLines(config),
    ...adapterSection(config.stateAdapter),
  ].filter((line, index, lines) => !(line === "" && lines[index - 1] === ""));

  return `${sections.join("\n").trimEnd()}\n`;
}
