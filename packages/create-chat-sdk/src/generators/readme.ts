import { getAdapterConnectSpec } from "../catalog/index.js";
import type { ProjectConfig } from "../types.js";

const hasAdapter = (config: ProjectConfig, slug: string): boolean =>
  config.platformAdapters.some((adapter) => adapter.slug === slug);

const connectSection = (config: ProjectConfig): string => {
  if (config.useConnect !== true) {
    return "";
  }
  const connectAdapters = config.platformAdapters.flatMap((adapter) => {
    const connect = getAdapterConnectSpec(adapter.slug);
    return connect ? [{ adapter, connect }] : [];
  });
  const [first] = connectAdapters;
  if (!first) {
    return "";
  }
  const names = connectAdapters.map((entry) => entry.adapter.name).join(", ");
  const triggerNames = connectAdapters
    .filter((entry) => entry.connect.inbound !== "native")
    .map((entry) => entry.adapter.name)
    .join(", ");
  const nativeNames = connectAdapters
    .filter((entry) => entry.connect.inbound === "native")
    .map((entry) => entry.adapter.name)
    .join(", ");
  const exampleVar = first.connect.connectorEnvVar;
  const lines = [
    "## Authentication (Vercel Connect)",
    "",
    `This project uses [Vercel Connect](https://chat-sdk.dev/docs/vercel-connect) for outbound credentials for ${names}.`,
    "",
    "1. Create a connector for each provider in the [Vercel dashboard](https://vercel.com/d?to=%2F%5Bteam%5D%2F~%2Fconnect) and link it to this project.",
  ];
  let step = 2;
  if (triggerNames) {
    lines.push(
      `${step}. Enable Connect trigger forwarding for ${triggerNames} so inbound webhooks reach your deployment.`
    );
    step += 1;
  }
  if (nativeNames) {
    lines.push(
      `${step}. Configure native webhook subscriptions for ${nativeNames}; Connect supplies outbound credentials but does not forward those webhooks.`
    );
    step += 1;
  }
  lines.push(
    `${step}. Pull the runtime OIDC token for local development:`,
    "",
    "```bash",
    "vercel link",
    "vercel env pull .env.local",
    "```",
    "",
    `${step + 1}. Set each connector UID (for example \`${exampleVar}\`) and any listed native webhook verification secrets in your environment.`,
    "",
    ""
  );
  if (triggerNames) {
    lines.splice(
      -2,
      0,
      "> Vercel Connect forwards inbound webhooks only to deployed URLs, so test trigger delivery against a Vercel deployment (such as a preview) rather than localhost.",
      ""
    );
  }
  return lines.join("\n");
};

const webhookLines = (config: ProjectConfig): string[] => {
  const lines = config.platformAdapters.map(
    (adapter) => `- ${adapter.name}: \`/api/webhooks/${adapter.slug}\``
  );
  if (hasAdapter(config, "web")) {
    lines.push("- Web chat API: `/api/chat`");
  }
  if (hasAdapter(config, "discord")) {
    lines.push(
      "- Discord Gateway (cron): `/api/discord/gateway` - keeps the Gateway connection alive so message and reaction events reach the bot. Scheduled in `vercel.json`, authenticated with `CRON_SECRET`, and requires Vercel Pro or Enterprise."
    );
  }
  return lines.length > 0 ? lines : ["- No platform webhooks selected yet."];
};

/**
 * Generate the scaffolded project README.
 *
 * @param config - Resolved project configuration.
 * @returns Markdown README contents.
 */
export function generateReadme(config: ProjectConfig): string {
  return `# ${config.name}\n\n${config.description || "A chat bot built with Chat SDK."}\n\n## Getting Started\n\n1. Copy the example environment file and fill in your credentials:\n\n\`\`\`bash\ncp .env.example .env.local\n\`\`\`\n\n2. Start the dev server:\n\n\`\`\`bash\n${config.packageManager} run dev\n\`\`\`\n\n3. Expose your local server to the internet and configure platform webhook URLs.\n\n${connectSection(config)}## Endpoints\n\n${webhookLines(config).join("\n")}\n\n## Project Structure\n\n\`\`\`\nsrc/\n  lib/bot.ts                              Bot configuration and handlers\n  app/api/webhooks/[platform]/route.ts    Webhook endpoint for platform adapters\n  app/api/chat/route.ts                   Web adapter endpoint when selected\n.env.example                              Required environment variables\n\`\`\`\n\n## Scripts\n\n| Command | Description |\n| --- | --- |\n| \`${config.packageManager} run dev\` | Start the development server |\n| \`${config.packageManager} run build\` | Create a production build |\n| \`${config.packageManager} run start\` | Start the production server |\n| \`${config.packageManager} run typecheck\` | Type-check the project |\n\n## Learn More\n\n- [Chat SDK Documentation](https://chat-sdk.dev/docs)\n- [Adapter Setup Guides](https://chat-sdk.dev/adapters)\n- [GitHub Repository](https://github.com/vercel/chat)\n`;
}
