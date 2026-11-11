export type ModelMode = "gateway" | "provider" | "custom";

export interface CodeTab {
  code: string;
  filename: string;
  label: string;
  /** Code for each "Use with" option; `code` holds the gateway version. */
  modes?: Record<ModelMode, string>;
}

/**
 * Builds the AI Gateway, provider, and custom provider versions of an AI SDK
 * example. `__MODEL__` in `body` is replaced with each version's model.
 */
const withModelModes = ({
  imports,
  extraImports = "",
  body,
}: {
  imports: string;
  extraImports?: string;
  body: string;
}): Pick<CodeTab, "code" | "modes"> => {
  const build = (mode: ModelMode) => {
    let aiImports = imports;
    let providerImport = "";
    let setup = "";
    let model = '"anthropic/claude-opus-5.5"';
    if (mode !== "gateway") {
      providerImport = '\nimport { anthropic } from "@ai-sdk/anthropic";';
      model = 'anthropic("claude-opus-5-5")';
    }
    if (mode === "custom") {
      aiImports += ", customProvider";
      setup = `const provider = customProvider({\n  languageModels: { "my-model": ${model} },\n});\n\n`;
      model = 'provider.languageModel("my-model")';
    }
    return `import { ${aiImports} } from "ai";${providerImport}${extraImports}\n\n${setup}${body.replaceAll("__MODEL__", model)}`;
  };
  const modes: Record<ModelMode, string> = {
    gateway: build("gateway"),
    provider: build("provider"),
    custom: build("custom"),
  };
  return { code: modes.gateway, modes };
};

export interface CodeExampleGroup {
  description: string;
  examples: CodeTab[];
  id: string;
  label: string;
}

export const CODE_EXAMPLE_GROUPS: CodeExampleGroup[] = [
  {
    id: "core",
    label: "Chat SDK Core",
    description:
      "A unified API for building event-driven chat bots. Listen for mentions, subscribe to threads, and post rich cards across multiple platforms.",
    examples: [
      {
        label: "Bot Setup",
        filename: "bot.ts",
        code: `import { Chat } from "chat";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createRedisState } from "@chat-adapter/state-redis";

export const bot = new Chat({
  userName: "mybot",
  adapters: {
    slack: createSlackAdapter(),
  },
  state: createRedisState(),
});

bot.onNewMention(async (thread) => {
  await thread.subscribe();
  await thread.post("Hello! I'm listening to this thread now.");
});

bot.onSubscribedMessage(async (thread, message) => {
  await thread.post(\`You said: \${message.text}\`);
});`,
      },
      {
        label: "Event Handlers",
        filename: "handlers.ts",
        code: `bot.onNewMention(async (thread, message) => {
  await thread.subscribe();
  await thread.post("Thanks for the mention!");
});

bot.onReaction(async (event) => {
  if (!event.added) return;
  await event.thread.post(\`Thanks for the \${event.emoji}!\`);
});

bot.onSlashCommand("/status", async (event) => {
  await event.channel.post("All systems operational.");
});`,
      },
      {
        label: "Rich Cards",
        filename: "cards.tsx",
        code: `import { Card, CardText, Actions, Button } from "chat";

bot.onNewMention(async (thread) => {
  await thread.post(
    <Card title="Deploy complete">
      <CardText>Production is ready.</CardText>
      <Actions>
        <Button id="open-dashboard" style="primary">
          Open dashboard
        </Button>
      </Actions>
    </Card>
  );
});`,
      },
      {
        label: "Error Handling",
        filename: "errors.ts",
        code: `bot.onNewMention(async (thread, message) => {
  try {
    const reply = await generateReply(message.text);
    await thread.post(reply);
  } catch (error) {
    await thread.post("Something went wrong. Please try again.");
    console.error(error);
  }
});`,
      },
    ],
  },
  {
    id: "ai",
    label: "AI agents",
    description:
      "Stream AI SDK responses into a thread, and give agents tools to read, post, and react across your chat platforms.",
    examples: [
      {
        label: "Streaming",
        filename: "streaming.ts",
        ...withModelModes({
          imports: "ToolLoopAgent",
          body: `const agent = new ToolLoopAgent({
  model: __MODEL__,
  instructions: "You are a helpful assistant.",
});

bot.onNewMention(async (thread, message) => {
  const result = await agent.stream({ prompt: message.text });
  await thread.post(result.fullStream);
});`,
        }),
      },
      {
        label: "Tool Calling",
        filename: "tools.ts",
        ...withModelModes({
          imports: "generateText",
          extraImports: '\nimport { createChatTools } from "chat/ai";',
          body: `const result = await generateText({
  model: __MODEL__,
  tools: createChatTools({
    chat: bot,
    preset: "messenger",
    scope: "slack:C0123ABC",
  }),
  prompt: "Post a hello in slack:C0123ABC and react with a thumbs up.",
});`,
        }),
      },
    ],
  },
  {
    id: "adapters",
    label: "Adapters",
    description:
      "Run the same handlers on Slack, Teams, Google Chat, and more, and keep thread state in Redis, Postgres, or memory.",
    examples: [
      {
        label: "Multi-platform",
        filename: "adapters.ts",
        code: `export const bot = new Chat({
  userName: "mybot",
  adapters: {
    slack: createSlackAdapter(),
    teams: createTeamsAdapter(),
    gchat: createGoogleChatAdapter(),
  },
  state: createRedisState(),
});

// Same handlers work across every adapter
bot.onNewMention(async (thread) => {
  await thread.post("Running everywhere.");
});`,
      },
      {
        label: "State Adapters",
        filename: "state.ts",
        code: `import { Chat } from "chat";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createRedisState } from "@chat-adapter/state-redis";

export const bot = new Chat({
  userName: "mybot",
  adapters: { slack: createSlackAdapter() },
  state: createRedisState({ url: process.env.REDIS_URL }),
});

await thread.setState({ step: "awaiting-approval" });
const state = await thread.state;`,
      },
    ],
  },
];
