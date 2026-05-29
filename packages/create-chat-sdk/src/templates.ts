import type { ProjectConfig } from "./types.js";

export function botTs(config: ProjectConfig): string {
  const imports: string[] = [];

  for (const a of config.platformAdapters) {
    imports.push(`import { ${a.factoryFn} } from "${a.package}";`);
  }
  imports.push(
    `import { ${config.stateAdapter.factoryFn} } from "${config.stateAdapter.package}";`
  );
  imports.push('import { Chat } from "chat";');

  const adapterEntries = config.platformAdapters
    .map((a) => `    ${a.value}: ${a.factoryFn}(),`)
    .join("\n");

  const adaptersBlock = adapterEntries ? `{\n${adapterEntries}\n  }` : "{}";

  return `${imports.join("\n")}

export const bot = new Chat({
  userName: process.env.BOT_USERNAME || "${config.name}",
  adapters: ${adaptersBlock},
  state: ${config.stateAdapter.factoryFn}(),
});

bot.onNewMention(async (thread, message) => {
  await thread.subscribe();
  await thread.post(\`Hello, \${message.author.fullName}! I'm listening to this thread.\`);
});

bot.onSubscribedMessage(async (thread, message) => {
  await thread.post(\`You said: \${message.text}\`);
});
`;
}
