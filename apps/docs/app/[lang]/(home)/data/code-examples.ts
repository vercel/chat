export interface CodeTab {
  code: string;
  filename: string;
  label: string;
}

export const CORE_TABS: CodeTab[] = [
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
    label: "Streaming",
    filename: "streaming.ts",
    code: `import { ToolLoopAgent } from "ai";

const agent = new ToolLoopAgent({
  model: "anthropic/claude-4.5-sonnet",
  instructions: "You are a helpful assistant.",
});

bot.onNewMention(async (thread, message) => {
  const result = await agent.stream({ prompt: message.text });
  await thread.post(result.fullStream);
});`,
  },
  {
    label: "Tool Calling",
    filename: "tools.ts",
    code: `import { createChatTools } from "chat/ai";
import { generateText } from "ai";

const result = await generateText({
  model: "anthropic/claude-sonnet-4.6",
  tools: createChatTools({
    chat: bot,
    preset: "messenger",
  }),
  prompt: "Post a hello in slack:C0123ABC and react with a thumbs up.",
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
];
