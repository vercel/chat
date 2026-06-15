import type { CatalogAdapter } from "chat/adapters";
import {
  getCliScaffoldSpec,
  type ScaffoldInvocation,
} from "../catalog/index.js";
import type { ProjectConfig } from "../types.js";

const INDENT = "  ";

const quote = (value: string): string => JSON.stringify(value);

const renderValue = (
  value:
    | { kind: "env"; name: string; fallback: string }
    | { kind: "literal"; code: string }
    | { kind: "placeholder"; code: string; comment?: string }
): string => {
  if (value.kind === "env") {
    return `process.env.${value.name} ?? ${value.fallback}`;
  }
  return value.code;
};

const renderObjectInvocation = (
  factoryExport: string,
  invocation: Extract<ScaffoldInvocation, { kind: "object" }>
): string => {
  const lines = invocation.properties.flatMap((property) => {
    const rendered = `${INDENT.repeat(3)}${property.key}: ${renderValue(property.value)},`;
    if (property.value.kind === "placeholder" && property.value.comment) {
      return [
        `${INDENT.repeat(3)}// TODO: ${property.value.comment}`,
        rendered,
      ];
    }
    return [rendered];
  });

  return `${factoryExport}({\n${lines.join("\n")}\n${INDENT.repeat(2)}})`;
};

const renderFactoryCall = (
  adapter: CatalogAdapter,
  invocation: ScaffoldInvocation
): string => {
  if (invocation.kind === "zero-arg") {
    return `${adapter.factoryExport}()`;
  }
  if (invocation.kind === "empty-object") {
    return `${adapter.factoryExport}({})`;
  }
  if (invocation.kind === "web-server") {
    return `${adapter.factoryExport}({\n${INDENT.repeat(3)}userName: process.env.BOT_USERNAME ?? ${quote(adapter.name)},\n${INDENT.repeat(3)}getUser,\n${INDENT.repeat(2)}})`;
  }
  return renderObjectInvocation(adapter.factoryExport, invocation);
};

const importLine = (adapter: CatalogAdapter): string =>
  `import { ${adapter.factoryExport} } from ${quote(adapter.packageName)};`;

/**
 * Generate the contents of `src/lib/bot.ts`.
 *
 * @param config - Resolved project configuration.
 * @returns TypeScript source for the bot entry point.
 */
export function generateBotTs(config: ProjectConfig): string {
  const selectedAdapters = [...config.platformAdapters, config.stateAdapter];
  const imports = selectedAdapters.map(importLine);
  imports.push('import { Chat } from "chat";');

  const usesWeb = config.platformAdapters.some(
    (adapter) => adapter.slug === "web"
  );
  if (usesWeb) {
    imports.push('import { getUser } from "./auth-stub";');
  }

  const adapterEntries = config.platformAdapters
    .map((adapter) => {
      const spec = getCliScaffoldSpec(adapter.slug);
      const call = renderFactoryCall(adapter, spec.invocation);
      return `${INDENT.repeat(2)}${adapter.slug}: ${call},`;
    })
    .join("\n");

  const stateSpec = getCliScaffoldSpec(config.stateAdapter.slug);
  const stateCall = renderFactoryCall(
    config.stateAdapter,
    stateSpec.invocation
  );
  const adaptersBlock = adapterEntries
    ? `{\n${adapterEntries}\n${INDENT}}`
    : "{}";
  const handlers = [
    "bot.onNewMention(async (thread, message) => {",
    `${INDENT}await thread.subscribe();`,
    `${INDENT}await thread.post(\`Hello, \${message.author.fullName}! I'm listening to this thread.\`);`,
    "});",
    "",
    "bot.onSubscribedMessage(async (thread, message) => {",
    `${INDENT}await thread.post(\`You said: \${message.text}\`);`,
    "});",
  ];

  if (usesWeb) {
    handlers.push(
      "",
      "bot.onDirectMessage(async (thread, message) => {",
      `${INDENT}await thread.post(\`You said: \${message.text}\`);`,
      "});"
    );
  }

  return `${imports.join("\n")}\n\nexport const bot = new Chat({\n${INDENT}userName: process.env.BOT_USERNAME ?? ${quote(config.name)},\n${INDENT}adapters: ${adaptersBlock},\n${INDENT}state: ${stateCall},\n});\n\n${handlers.join("\n")}\n`;
}
