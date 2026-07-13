/** @jsxImportSource chat */
import type { SlackAdapter } from "@chat-adapter/slack";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createRedisState } from "@chat-adapter/state-redis";
import { generateText, ToolLoopAgent } from "ai";
import {
  Actions,
  Button,
  Card,
  CardLink,
  Chart,
  Chat,
  Divider,
  emoji,
  Field,
  Fields,
  LinkButton,
  Modal,
  RadioSelect,
  Section,
  Select,
  SelectOption,
  Table,
  CardText as Text,
  TextInput,
  type TranscriptEntry,
} from "chat";
import { type AiMessage, createChatTools, toAiMessages } from "chat/ai";
import { start } from "workflow/api";
import { buttonWorkflow } from "../workflows/button";
import { modalWorkflow } from "../workflows/modal";
import { buildAdapters } from "./adapters";

function getBaseUrl(): string {
  const fromEnv =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL ||
    process.env.NEXT_PUBLIC_BASE_URL;
  if (fromEnv) {
    return fromEnv.startsWith("http") ? fromEnv : `https://${fromEnv}`;
  }
  return "http://localhost:3000";
}

const AI_MENTION_REGEX = /\bAI\b/i;
const DISABLE_AI_REGEX = /disable\s*AI/i;
const ENABLE_AI_REGEX = /enable\s*AI/i;
// Non-anchored: mention text includes the "@bot" prefix (e.g. "@mybot dm me").
const DM_ME_REGEX = /\bdm\s*me\b/i;
const POSTCARD_TRIGGER_REGEX = /^post-card$/i;
const SLACK_PREFIX_REGEX = /^slack:/;

// Hardcoded user key for testing the Transcripts API — every inbound message
// is persisted under this single key, so you can exercise append/list/delete
// without juggling real user identities. Swap the `identity` resolver below
// for `({ author }) => author.email ?? author.userId` in production.
const TEST_USER_KEY = "test-user";

const state = process.env.REDIS_URL
  ? createRedisState({
      url: process.env.REDIS_URL,
      keyPrefix: "chat-sdk-webhooks",
    })
  : createMemoryState();
const adapters = buildAdapters();

// Define thread state type
interface ThreadState {
  aiMode?: boolean;
}

// Create the bot instance with typed thread state
// @ts-expect-error Adapters type lacks string index signature
export const bot = new Chat<typeof adapters, ThreadState>({
  userName: process.env.BOT_USERNAME || "mybot",
  adapters,
  state,
  logger: "debug",

  // Hardcoded for testing — see `TEST_USER_KEY` above.
  identity: () => TEST_USER_KEY,

  // Persist a per-user transcript across every adapter the user talks
  // through. Used below to backfill conversation context for platforms
  // that don't expose server-side message history.
  transcripts: {
    retention: "30d",
    maxPerUser: 100,
  },
});

// AI agent for AI mode
const agent = new ToolLoopAgent({
  model: "anthropic/claude-sonnet-5",
  instructions:
    "You are a helpful assistant in a chat thread. Answer the user's queries in a concise manner.",
});

// Map transcript entries to AI SDK chat-message shape.
function transcriptToAiMessages(entries: TranscriptEntry[]): AiMessage[] {
  return entries.map((entry) => ({
    role: entry.role === "assistant" ? "assistant" : "user",
    content: entry.text,
  }));
}

// Handle new @mentions of the bot
bot.onNewMention(async (thread, message) => {
  await thread.subscribe();

  // Check if user wants to enable AI mode (mention contains "AI")
  if (AI_MENTION_REGEX.test(message.text)) {
    await thread.setState({ aiMode: true });
    // Also respond to the initial message with AI (including any image attachments).
    // No explicit status: on Slack this falls back to the adapter-level
    // `loadingMessages` rotation (see SLACK_AGENT_OPTIONS in adapters.ts).
    await thread.startTyping();
    try {
      const history = await toAiMessages([message]);
      const result = await agent.stream({ prompt: history });
      await thread.post(result.fullStream);
    } catch (err) {
      console.error("Error in AI response:", err);
      await thread.post(
        `${emoji.warning} Error in AI response: ${
          err instanceof Error ? err.message : "Unknown error"
        }`
      );
    }
    return;
  }

  // Default welcome card
  await thread.startTyping();
  await thread.post(
    <Card
      subtitle={`Connected via ${thread.adapter.name}`}
      title={`${emoji.wave} Welcome!`}
    >
      <Text>I'm now listening to this thread. Try these actions:</Text>
      <Text>
        {`${emoji.sparkles} **Mention me with "AI"** to enable AI assistant mode`}
      </Text>
      <CardLink url="https://chat-sdk.dev/docs/cards">
        View documentation
      </CardLink>
      <Divider />
      <Fields>
        <Field label="DM Support" value={thread.isDM ? "Yes" : "No"} />
        <Field label="Platform" value={thread.adapter.name} />
      </Fields>
      <Divider />
      <Actions>
        <Select id="quick_action" label="Quick Action" placeholder="Choose...">
          <SelectOption label="Say Hello" value="greet" />
          <SelectOption label="Show Info" value="info" />
          <SelectOption label="Get Help" value="help" />
        </Select>
        <Button id="hello" style="primary">
          Say Hello
        </Button>
        <Button id="ephemeral">Ephemeral response</Button>
        <Button id="info">Show Info</Button>
        <Button id="choose_plan">Choose Plan</Button>
        <Button id="preferences">Preferences</Button>
        <Button actionType="modal" id="feedback">
          Send Feedback
        </Button>
        <Button id="messages">Fetch Messages</Button>
        <Button id="transcripts">Show Transcripts</Button>
        <Button id="clear-transcripts" style="danger">
          Clear Transcripts
        </Button>
        <Button id="channel-post">Channel Post</Button>
        <Button id="channel-info">Channel Info (Slack)</Button>
        <Button id="pin-message">Pin Message (Slack)</Button>
        <Button id="show-table">Show Table</Button>
        <Button id="show-charts">Show Charts</Button>
        <Button id="agent-demo">Run Agent Demo</Button>
        <Button id="who-am-i">Who Am I</Button>
        <Button actionType="modal" id="report" value="bug">
          Report Bug
        </Button>
        <Button id="workflow_button">Workflow Button</Button>
        <Button actionType="modal" id="workflow_modal">
          Workflow Modal
        </Button>
        <LinkButton url="https://vercel.com">Open Link</LinkButton>
        <Button id="goodbye" style="danger">
          Goodbye
        </Button>
      </Actions>
    </Card>
  );
});

// Post a welcome message when the bot is added to a channel
bot.onMemberJoinedChannel(async (event) => {
  // Only post when the bot itself joins
  if (event.userId !== event.adapter.botUserId) {
    return;
  }

  await event.adapter.postMessage(
    event.channelId,
    "*Chat SDK Bot is available in this channel.* Tag @Chat SDK Bot to begin."
  );
});

// Handle direct messages — AI conversation by default
// This fires on every DM, regardless of subscription status
bot.onDirectMessage(async (thread, message, channel) => {
  if (POSTCARD_TRIGGER_REGEX.test(message.text.trim())) {
    await thread.post(
      <Card title={`${emoji.sparkles} Test Menu`}>
        <Text>Test these button actions:</Text>
        <Actions>
          <Button id="hello" style="primary">
            Say Hello
          </Button>
          <Button id="info">Show Info</Button>
          <Button id="who-am-i">Who Am I</Button>
          <Button id="goodbye" style="danger">
            Goodbye
          </Button>
        </Actions>
      </Card>
    );
    return;
  }

  await channel.startTyping("Thinking...");

  // Build history from the user's transcript rather than channel history:
  // channel history only contains user turns (bot replies are threaded —
  // always on some platforms, and on Slack whenever agent_view is enabled),
  // so it can't give the model both sides of the conversation. The transcript
  // records user and assistant turns across thread IDs, which also survives
  // agent_view's one-thread-per-message model.
  await bot.transcripts.append(thread, message);
  let history: AiMessage[] = [];
  if (message.userKey) {
    history = transcriptToAiMessages(
      await bot.transcripts.list({ userKey: message.userKey, limit: 20 })
    );
  }
  if (history.length === 0) {
    history = await toAiMessages([message]);
  }

  try {
    const result = await agent.stream({ prompt: history });
    await thread.post(result.fullStream);
    // Persist the assistant reply so the next turn sees both sides.
    if (message.userKey) {
      await bot.transcripts.append(
        thread,
        { role: "assistant", text: await result.text },
        { userKey: message.userKey }
      );
    }
  } catch (err) {
    console.error("Error in DM AI response:", err);
    await channel.post(
      `${emoji.warning} Error: ${
        err instanceof Error ? err.message : "Unknown error"
      }`
    );
  }
});

bot.onAction("show_channel_help", async (event) => {
  if (!event.thread) {
    return;
  }
  const platforms = Object.keys(adapters).join(", ") || "none configured";
  await event.thread.post(
    <Card title={`${emoji.question} Help`}>
      <Text>{`Here's how I can help:`}</Text>
      <Divider />
      <Section>
        <Text>{`${emoji.star} **Mention me** to start a conversation`}</Text>
        <Text>{`${emoji.sparkles} **Mention me with "AI"** to enable AI assistant mode`}</Text>
        <Text>{`${emoji.eyes} I'll respond to messages in threads where I'm mentioned`}</Text>
        <Text>{`${emoji.fire} React to my messages and I'll react back!`}</Text>
        <Text>{`${emoji.rocket} Active platforms: ${platforms}`}</Text>
      </Section>
    </Card>
  );
});

bot.onAction("ephemeral", async (event) => {
  if (!event.thread) {
    return;
  }
  await event.thread.postEphemeral(
    event.user,
    <Card title={`${emoji.eyes} Ephemeral Message`}>
      <Text>
        Only you can see this message. It will disappear when you reload.
      </Text>
      <Text>Try opening a modal from this ephemeral:</Text>
      <Actions>
        <Button actionType="modal" id="ephemeral_modal" style="primary">
          Open Modal
        </Button>
      </Actions>
    </Card>,
    { fallbackToDM: true }
  );
});

bot.onAction("ephemeral_modal", async (event) => {
  await event.openModal(
    <Modal
      callbackId="ephemeral_modal_form"
      closeLabel="Cancel"
      submitLabel="Submit"
      title="Ephemeral Modal"
    >
      <TextInput
        id="response"
        label="Your Response"
        placeholder="Type something..."
      />
    </Modal>
  );
});

bot.onModalSubmit("ephemeral_modal_form", async (event) => {
  await event.relatedMessage?.edit(
    <Card title={`${emoji.check} Submitted!`}>
      <Text>Your response: **{event.values.response}**</Text>
      <Text>The original ephemeral message was updated.</Text>
    </Card>
  );
});

bot.onAction("quick_action", async (event) => {
  if (!event.thread) {
    return;
  }
  const action = event.value;
  if (action === "greet") {
    await event.thread.post(`${emoji.wave} Hello, ${event.user.fullName}!`);
  } else if (action === "info") {
    await event.thread.post(
      `${emoji.memo} You're on **${event.adapter.name}** in thread \`${event.threadId}\``
    );
  } else if (action === "help") {
    await event.thread.post(
      `${emoji.question} Try mentioning me with "AI" to enable AI assistant mode!`
    );
  }
});

bot.onAction("choose_plan", (event) => {
  if (!event.thread) {
    return;
  }
  event.thread.post(
    <Card title="Choose Plan">
      <Actions>
        <RadioSelect id="plan_selected" label="Choose Plan">
          <SelectOption
            description="Headers, body text, labels, and placeholders"
            label="*All text elements*"
            value="all_text"
          />
          <SelectOption
            description="Keep body text in the current system font"
            label="*Headers and titles only*"
            value="headers_titles"
          />
          <SelectOption
            description="Only the composer textarea and its placeholder"
            label="*Input fields and placeholders*"
            value="input_fields"
          />
          <SelectOption
            description="All text, but leave button labels unchanged"
            label="*Everything except buttons*"
            value="except_buttons"
          />
        </RadioSelect>
      </Actions>
    </Card>
  );
});
bot.onAction("plan_selected", (event) => {
  if (!event.thread) {
    return;
  }
  event.thread.post(
    <Card title={`${emoji.check} Plan Chosen!`}>
      <Text>You chose plan *{event.value}*</Text>
    </Card>
  );
});

bot.onAction("preferences", (event) => {
  if (!event.thread) {
    return;
  }
  event.thread.post(
    <Card title="Set Preferences">
      <Text>Choose your theme and notification settings:</Text>
      <Actions>
        <Select id="theme_selected" label="Theme" placeholder="Pick a theme...">
          <SelectOption label="Light" value="light" />
          <SelectOption label="Dark" value="dark" />
          <SelectOption label="System" value="system" />
        </Select>
        <RadioSelect id="notifications_selected" label="Notifications">
          <SelectOption label="All notifications" value="all" />
          <SelectOption label="Mentions only" value="mentions" />
          <SelectOption label="None" value="none" />
        </RadioSelect>
      </Actions>
    </Card>
  );
});

bot.onAction("theme_selected", (event) => {
  if (!event.thread) {
    return;
  }
  event.thread.post(`${emoji.sparkles} Theme set to **${event.value}**`);
});

bot.onAction("notifications_selected", (event) => {
  if (!event.thread) {
    return;
  }
  event.thread.post(`${emoji.bell} Notifications set to **${event.value}**`);
});

// Handle card button actions
bot.onAction("hello", async (event) => {
  if (!event.thread) {
    return;
  }
  await event.thread.post(`${emoji.wave} Hello, ${event.user.fullName}!`);
});

bot.onAction("info", async (event) => {
  if (!event.thread) {
    return;
  }
  const threadState = await event.thread.state;
  await event.thread.post(
    <Card title="Bot Information">
      <Fields>
        <Field label="User" value={event.user.fullName} />
        <Field label="User ID" value={event.user.userId} />
        <Field label="Platform" value={event.adapter.name} />
        <Field label="Thread ID" value={event.threadId} />
        <Field
          label="AI Mode"
          // @ts-expect-error ThreadState generic not propagated through event
          value={threadState?.aiMode ? "Enabled" : "Disabled"}
        />
      </Fields>
    </Card>
  );
});

bot.onAction("who-am-i", async (event) => {
  if (!event.thread) {
    return;
  }
  try {
    const user = await bot.getUser(event.user);
    if (!user) {
      await event.thread.post(
        `${emoji.warning} Could not find your user profile.`
      );
      return;
    }
    await event.thread.post(
      <Card title={`${emoji.eyes} Who Am I`}>
        <Fields>
          <Field label="Name" value={user.fullName} />
          <Field label="Username" value={user.userName} />
          <Field label="User ID" value={user.userId} />
          <Field label="Email" value={user.email ?? "Not available"} />
          <Field label="Bot" value={user.isBot ? "Yes" : "No"} />
        </Fields>
      </Card>
    );
  } catch {
    await event.thread.post(
      `${emoji.warning} User lookup is not supported on this platform.`
    );
  }
});

bot.onAction("goodbye", async (event) => {
  if (!event.thread) {
    return;
  }
  await event.thread.post(
    `${emoji.wave} Goodbye, ${event.user.fullName}! See you later.`
  );
});

bot.onAction("workflow_button", async (event) => {
  if (!event.thread) {
    return;
  }
  await start(buttonWorkflow, [event.thread]);
});

bot.onAction("workflow_modal", async (event) => {
  if (!event.thread) {
    return;
  }
  const token = `modal-${event.user.userId}-${Date.now()}`;
  const callbackUrl = `${getBaseUrl()}/api/modal-callback/${token}`;

  // Open modal FIRST — Slack's trigger_id expires after ~3 seconds, so we
  // can't afford to wait on workflow startup before this call.
  await event.openModal(
    <Modal
      callbackId="workflow_modal_form"
      callbackUrl={callbackUrl}
      submitLabel="Submit"
      title="Workflow Modal Demo"
    >
      <TextInput
        id="message"
        label="Your message"
        placeholder="Anything you'd like..."
      />
    </Modal>
  );

  // Start the workflow that awaits the modal submission via the hook token.
  // User typing + clicking Submit takes seconds, plenty of time for the
  // workflow to register the hook.
  await start(modalWorkflow, [event.thread, token, event.user.fullName]);
});

bot.onAction("show-table", async (event) => {
  if (!event.thread) {
    return;
  }
  await event.thread.post(
    <Card title={`${emoji.memo} Team Directory`}>
      <Text>Here's the current team roster:</Text>
      <Table
        caption="Team roster"
        headers={["Name", "Role", "Location", "Status"]}
        pageSize={3}
        rows={[
          ["Alice Chen", "Engineering Lead", "San Francisco", "Active"],
          ["Bob Smith", "Designer", "New York", "Active"],
          ["Carol Wu", "Product Manager", "London", "On Leave"],
          ["Dan Lee", "Backend Engineer", "Tokyo", "Active"],
          ["Eve Park", "Frontend Engineer", "Seoul", "Active"],
        ]}
      />
    </Card>
  );
});

bot.onAction("show-charts", async (event) => {
  if (!event.thread) {
    return;
  }
  await event.thread.post(
    <Card title={`${emoji.chart_up} Usage Report`}>
      <Text>Native charts on Slack, text tables everywhere else:</Text>
      <Chart
        chart={{
          type: "pie",
          segments: [
            { label: "Web", value: 45 },
            { label: "Mobile", value: 35 },
            { label: "API", value: 20 },
          ],
        }}
        title="Traffic by Platform"
      />
      <Chart
        chart={{
          type: "line",
          categories: ["Mon", "Tue", "Wed", "Thu", "Fri"],
          series: [
            {
              name: "Web",
              data: [
                { label: "Mon", value: 120 },
                { label: "Tue", value: 135 },
                { label: "Wed", value: 128 },
                { label: "Thu", value: 150 },
                { label: "Fri", value: 142 },
              ],
            },
            {
              name: "Mobile",
              data: [
                { label: "Mon", value: 80 },
                { label: "Tue", value: 95 },
                { label: "Wed", value: 90 },
                { label: "Thu", value: 105 },
                { label: "Fri", value: 98 },
              ],
            },
          ],
          xLabel: "Day",
          yLabel: "Users",
        }}
        title="Daily Active Users"
      />
    </Card>
  );
});

// Feedback modal component
const FeedbackModal = (
  <Modal
    callbackId="feedback_form"
    closeLabel="Cancel"
    notifyOnClose
    submitLabel="Send"
    title="Send Feedback"
  >
    <TextInput
      id="message"
      label="Your Feedback"
      multiline
      placeholder="Tell us what you think..."
    />
    <Select id="category" label="Category" placeholder="Select a category">
      <SelectOption label="Bug Report" value="bug" />
      <SelectOption label="Feature Request" value="feature" />
      <SelectOption label="General Feedback" value="general" />
      <SelectOption label="Other" value="other" />
    </Select>
    <TextInput
      id="email"
      label="Email (optional)"
      optional
      placeholder="your@email.com"
    />
  </Modal>
);

// Open feedback modal
bot.onAction("feedback", async (event) => {
  await event.openModal(FeedbackModal);
});

// Native feedback buttons appended to streamed Slack replies (see the
// `feedbackButtons` adapter config in adapters.ts). In a real app you'd
// persist this signal for evals; here we just acknowledge it.
bot.onAction("ai_feedback", async (event) => {
  if (!event.thread) {
    return;
  }
  const positive = event.value === "positive";
  await event.thread.post(
    positive
      ? `${emoji.sparkles} Thanks for the positive feedback!`
      : `${emoji.wrench} Thanks — I'll try to do better.`
  );
});

bot.onSlashCommand("/ping", async (event) => {
  await event.channel.post(
    `Pong! Command invoked by ${event.user.fullName}${event.text ? `: ${event.text}` : ""}`
  );
});

// Opens feedback modal via /feedback
bot.onSlashCommand("/test-feedback", async (event) => {
  const result = await event.openModal(FeedbackModal);
  if (!result) {
    await event.channel.post(
      `${emoji.warning} Couldn't open the feedback modal. Please try again.`
    );
  }
});

// Demonstrates `chat/ai` tools end-to-end. The agent reads a few recent
// messages, reacts to the trigger card, and posts a short summary card —
// all by calling Chat SDK tools rather than direct adapter methods.
//
// Approval is disabled here so the demo runs to completion without UI
// gating. In production you'd typically leave the default
// (`requireApproval: true`) and present an approval card for write tools.
bot.onAction("agent-demo", async (event) => {
  const thread = event.thread;
  if (!thread) {
    return;
  }

  const tools = createChatTools({
    chat: bot,
    preset: "messenger",
    requireApproval: false,
  });

  await thread.startTyping("Running agent...");
  try {
    const result = await generateText({
      model: "anthropic/claude-sonnet-5",
      tools,
      stopWhen: ({ steps }) => steps.length >= 6,
      system: [
        "You are demoing the Chat SDK `chat/ai` tools inside a chat thread.",
        `The active thread id is "${thread.id}".`,
        "Do exactly the following, in order:",
        "1. Add a `:eyes:` reaction to the most recent message in this thread using `addReaction`.",
        "2. Call `fetchMessages` to load up to the 5 most recent messages in this thread.",
        "3. Call `postMessage` with a single short markdown summary (one to three sentences) of what you saw, prefixed with `Agent demo summary:`.",
        "Stop after posting the summary. Do not ask follow-up questions.",
      ].join("\n"),
      prompt: `User ${event.user.fullName} clicked the "Run Agent Demo" button.`,
    });

    if (result.steps.length === 0) {
      await thread.post(
        `${emoji.warning} Agent finished without calling any tools.`
      );
    }
  } catch (err) {
    console.error("agent-demo error:", err);
    await thread.post(
      `${emoji.warning} Agent demo failed: ${
        err instanceof Error ? err.message : "Unknown error"
      }`
    );
  }
});

// Free-form agent invocation: `/agent <prompt>` lets you exercise the
// `chat/ai` tools with arbitrary natural-language instructions inside the
// channel where the command was invoked.
//
// The reply streams in incrementally — `thread.post(result.fullStream)`
// renders model tokens as they arrive while the underlying tool loop keeps
// running in the background.
bot.onSlashCommand("/agent", async (event) => {
  const prompt = event.text.trim();
  if (!prompt) {
    await event.channel.post(
      `${emoji.warning} Usage: \`/agent <instructions>\` - e.g. \`/agent summarize the last 10 messages in this channel\``
    );
    return;
  }

  const tools = createChatTools({
    chat: bot,
    preset: ["reader", "messenger"],
    requireApproval: false,
  });

  const toolAgent = new ToolLoopAgent({
    model: "anthropic/claude-sonnet-5",
    tools,
    stopWhen: ({ steps }) => steps.length >= 8,
    instructions: [
      "You are an assistant operating inside a chat workspace via Chat SDK `chat/ai` tools.",
      `The active channel id is "${event.channel.id}". Use it with channel tools such as fetchChannelMessages or postChannelMessage.`,
      "Do not pass a channel id as a threadId. Use thread ids only with thread tools such as fetchMessages, postMessage, addReaction, and startTyping.",
      "Your final assistant text is streamed back to the channel. Do not call postChannelMessage just to answer the slash command.",
      "If you need recent channel context, call `fetchChannelMessages` first.",
    ].join("\n"),
  });

  // `startTyping` on Slack only renders status text inside a thread
  // (assistant.threads.setStatus requires thread_ts). Slash commands
  // dispatch in the channel scope, so post an explicit placeholder so
  // the user sees something while the model warms up. The streamed
  // reply lands as a follow-up message.
  await event.channel.startTyping("Agent thinking...");
  const placeholder = await event.channel.post(
    `${emoji.sparkles} Agent thinking...`
  );
  try {
    const result = await toolAgent.stream({ prompt });
    await event.channel.post(result.fullStream);
    await placeholder.delete();
  } catch (err) {
    console.error("/agent error:", err);
    await placeholder.edit(
      `${emoji.warning} Agent failed: ${
        err instanceof Error ? err.message : "Unknown error"
      }`
    );
  }
});

// Open bug report modal with privateMetadata carrying context from button value
bot.onAction("report", async (event) => {
  await event.openModal(
    <Modal
      callbackId="report_form"
      privateMetadata={JSON.stringify({
        reportType: event.value,
        threadId: event.threadId,
        reporter: event.user.userId,
      })}
      submitLabel="Submit"
      title="Report Bug"
    >
      <TextInput
        id="title"
        label="Bug Title"
        placeholder="Brief description of the issue"
      />
      <TextInput
        id="steps"
        label="Steps to Reproduce"
        multiline
        placeholder="1. Go to...\n2. Click on..."
      />
      <Select id="severity" label="Severity">
        <SelectOption label="Low" value="low" />
        <SelectOption label="Medium" value="medium" />
        <SelectOption label="High" value="high" />
        <SelectOption label="Critical" value="critical" />
      </Select>
    </Modal>
  );
});

// Handle bug report modal — reads context from privateMetadata
bot.onModalSubmit("report_form", async (event) => {
  console.log("report_form privateMetadata:", event.privateMetadata);
  const metadata = event.privateMetadata
    ? JSON.parse(event.privateMetadata)
    : {};
  const { title, steps, severity } = event.values;

  if (!title || title.length < 3) {
    return {
      action: "errors" as const,
      errors: { title: "Title must be at least 3 characters" },
    };
  }

  await event.relatedThread?.post(
    <Card title={`${emoji.memo} Bug Report Filed`}>
      <Fields>
        <Field label="Title" value={title} />
        <Field label="Severity" value={severity} />
        <Field label="Reporter" value={event.user.fullName} />
        <Field label="Report Type" value={metadata.reportType || "unknown"} />
        <Field label="Thread" value={metadata.threadId || "unknown"} />
      </Fields>
      <Divider />
      <Text>{`**Steps to Reproduce:**\n${steps}`}</Text>
    </Card>
  );
});

// Handle modal submission
bot.onModalSubmit("feedback_form", async (event) => {
  const { message, category, email } = event.values;

  // Validate message
  if (!message || message.length < 5) {
    return {
      action: "errors" as const,
      errors: { message: "Feedback must be at least 5 characters" },
    };
  }

  // Log the feedback
  console.log("Received feedback:", {
    message,
    category,
    email,
    user: event.user.userName,
  });
  await event.relatedMessage?.edit(`${emoji.check} **Feedback received!**`);
  const target = event.relatedChannel || event.relatedThread;
  await target?.postEphemeral(
    event.user,
    <Card title={`${emoji.check} Feedback received!`}>
      <Text>Thank you for your feedback!</Text>
      <Fields>
        <Field label="User" value={event.user.fullName} />
        <Field label="Category" value={category} />
        <Field label="Message" value={message} />
        <Field label="Email" value={email} />
      </Fields>
    </Card>,
    { fallbackToDM: false }
  );
});

// Handle modal close (cancel)
bot.onModalClose("feedback_form", (event) => {
  console.log(`${event.user.userName} cancelled the feedback form`);
});

// Demonstrate bot.transcripts.list / count / delete
bot.onAction("transcripts", async (event) => {
  if (!event.thread) {
    return;
  }
  const entries = await bot.transcripts.list({
    userKey: TEST_USER_KEY,
    limit: 50,
  });

  if (entries.length === 0) {
    await event.thread.post(
      <Card title={`${emoji.memo} Transcripts`}>
        <Text>No entries stored yet for `{TEST_USER_KEY}`.</Text>
        <Text>
          Mention the bot with "AI" to enable AI mode, then send a few messages
          — they'll be persisted here.
        </Text>
      </Card>
    );
    return;
  }

  const truncate = (s: string, n = 80) =>
    s.length > n ? `${s.slice(0, n)}…` : s;
  const lines = entries
    .map(
      (e, i) =>
        `${i + 1}. **[${e.role}]** \`${e.platform}\` — ${truncate(e.text)}`
    )
    .join("\n");

  await event.thread.post(
    <Card
      subtitle={`userKey: ${TEST_USER_KEY}`}
      title={`${emoji.memo} Transcripts (${entries.length})`}
    >
      <Text>{lines}</Text>
    </Card>
  );
});

bot.onAction("clear-transcripts", async (event) => {
  if (!event.thread) {
    return;
  }
  const { deleted } = await bot.transcripts.delete({
    userKey: TEST_USER_KEY,
  });
  await event.thread.post(
    <Card title={`${emoji.check} Transcripts cleared`}>
      <Text>{`Removed ${deleted} entr${deleted === 1 ? "y" : "ies"} for \`${TEST_USER_KEY}\`.`}</Text>
    </Card>
  );
});

bot.onAction("messages", async (event) => {
  if (!event.thread) {
    return;
  }
  const { thread } = event;

  // Helper to get display text for a message (handles empty text from cards)
  const getDisplayText = (text: string, hasAttachments?: boolean) => {
    if (text?.trim()) {
      const truncated = text.slice(0, 30);
      return text.length > 30 ? `${truncated}...` : truncated;
    }
    // Empty text - likely a card or attachment-only message
    return hasAttachments ? "[Attachment]" : "[Card]";
  };

  try {
    // 1. fetchMessages with backward direction (default) - gets most recent messages
    const recentResult = await thread.adapter.fetchMessages(thread.id, {
      limit: 5,
      direction: "backward",
    });

    // 2. fetchMessages with forward direction - gets oldest messages first
    const oldestResult = await thread.adapter.fetchMessages(thread.id, {
      limit: 5,
      direction: "forward",
    });

    // 3. allMessages iterator - iterate through all messages (uses forward direction)
    const allMessages: string[] = [];
    let count = 0;
    for await (const msg of thread.allMessages) {
      const displayText = getDisplayText(
        msg.text,
        msg.attachments && msg.attachments.length > 0
      );
      allMessages.push(
        `Msg ${count + 1}: ${msg.author.userName} - ${displayText}`
      );
      count++;
    }

    // Format results
    const formatMessages = (msgs: typeof recentResult.messages) =>
      msgs.length > 0
        ? msgs
            .map((m, i) => {
              const displayText = getDisplayText(
                m.text,
                m.attachments && m.attachments.length > 0
              );
              return `Msg ${i + 1}: ${m.author.userName} - ${displayText}`;
            })
            .join("\n\n")
        : "(no messages)";

    await thread.post(
      <Card title={`${emoji.memo} Message Fetch Results`}>
        <Section>
          <Text>**fetchMessages (backward, limit: 5)**</Text>
          <Text>Gets most recent messages, cursor points to older</Text>
          <Text>{formatMessages(recentResult.messages)}</Text>
          <Text>{`Next cursor: ${
            recentResult.nextCursor ? "yes" : "none"
          }`}</Text>
        </Section>
        <Divider />
        <Section>
          <Text>**fetchMessages (forward, limit: 5)**</Text>
          <Text>Gets oldest messages first, cursor points to newer</Text>
          <Text>{formatMessages(oldestResult.messages)}</Text>
          <Text>{`Next cursor: ${
            oldestResult.nextCursor ? "yes" : "none"
          }`}</Text>
        </Section>
        <Divider />
        <Section>
          <Text>**allMessages iterator**</Text>
          <Text>Iterates from oldest to newest using forward direction</Text>
          <Text>
            {allMessages.length > 0
              ? allMessages.join("\n\n")
              : "(no messages)"}
          </Text>
        </Section>
      </Card>
    );
  } catch (err) {
    await thread.post(
      `${emoji.warning} Error fetching messages: ${
        err instanceof Error ? err.message : "Unknown error"
      }`
    );
  }
});

// Demonstrate channel abstraction: read channel messages and post summary
bot.onAction("channel-post", async (event) => {
  if (!event.thread) {
    return;
  }
  const { thread } = event;
  const channel = thread.channel;

  try {
    // Fetch channel info for the name
    const info = await channel.fetchMetadata();
    const channelName = info.name || channel.id;

    // Get the last 3 top-level channel messages using the backward iterator
    const recent: string[] = [];
    for await (const msg of channel.messages) {
      const preview = msg.text?.trim()
        ? msg.text.slice(0, 50)
        : "[Card/Attachment]";
      recent.push(`- ${msg.author.userName}: ${preview}`);
      if (recent.length >= 3) {
        break;
      }
    }

    const summary =
      recent.length > 0 ? recent.join("\n\n") : "(no top-level messages found)";

    await channel.post(
      <Card title={`${emoji.memo} Channel Summary`}>
        <Section>
          <Text>{`Channel: ${channelName}`}</Text>
          <Text>**Last 3 top-level messages:**</Text>
          <Text>{summary}</Text>
        </Section>
      </Card>
    );
  } catch (err) {
    await thread.post(
      `${emoji.warning} Error reading channel: ${
        err instanceof Error ? err.message : "Unknown error"
      }`
    );
  }
});

// Demonstrate direct Slack WebClient access via adapter.client.
// `conversations.info` requires the `channels:read` (or `groups:read`) scope.
bot.onAction("channel-info", async (event) => {
  if (!event.thread) {
    return;
  }
  const { thread } = event;

  if (event.adapter.name !== "slack") {
    await thread.post(
      `${emoji.warning} This demo uses the Slack \`WebClient\` directly. Try it from a Slack thread.`
    );
    return;
  }

  // Strip the "slack:" prefix to get the raw Slack channel ID.
  const channelId = thread.channel.id.replace(SLACK_PREFIX_REGEX, "");

  try {
    const slack = (event.adapter as SlackAdapter).client;
    const result = await slack.conversations.info({
      channel: channelId,
      include_num_members: true,
    });
    const channel = result.channel as
      | {
          created?: number;
          creator?: string;
          id?: string;
          is_archived?: boolean;
          is_general?: boolean;
          is_private?: boolean;
          name?: string;
          num_members?: number;
          purpose?: { value?: string };
          topic?: { value?: string };
        }
      | undefined;

    if (!channel) {
      await thread.post(
        `${emoji.warning} Slack returned no channel info for \`${channelId}\`.`
      );
      return;
    }

    const created = channel.created
      ? new Date(channel.created * 1000).toISOString()
      : "unknown";

    await thread.post(
      <Card title={`${emoji.memo} Channel Info`}>
        <Text>
          {`Fetched via \`bot.getAdapter("slack").client.conversations.info\``}
        </Text>
        <Table
          headers={["Field", "Value"]}
          rows={[
            ["Name", channel.name ? `#${channel.name}` : "—"],
            ["ID", channel.id ?? channelId],
            [
              "Members",
              typeof channel.num_members === "number"
                ? String(channel.num_members)
                : "—",
            ],
            ["Created", created],
            ["Creator", channel.creator ?? "—"],
            ["Private", channel.is_private ? "Yes" : "No"],
            ["Archived", channel.is_archived ? "Yes" : "No"],
            ["Default channel", channel.is_general ? "Yes" : "No"],
            ["Topic", channel.topic?.value?.trim() || "(no topic set)"],
            ["Purpose", channel.purpose?.value?.trim() || "(no purpose set)"],
          ]}
        />
      </Card>
    );
  } catch (err) {
    await thread.post(
      `${emoji.warning} Error fetching channel info: ${
        err instanceof Error ? err.message : "Unknown error"
      }`
    );
  }
});

// Pin the card containing this button via the Slack WebClient.
// `pins.add` requires the `pins:write` scope.
bot.onAction("pin-message", async (event) => {
  if (!event.thread) {
    return;
  }
  const { thread } = event;

  if (event.adapter.name !== "slack") {
    await thread.post(
      `${emoji.warning} This demo uses the Slack \`WebClient\` directly. Try it from a Slack thread.`
    );
    return;
  }

  const channelId = thread.channel.id.replace(SLACK_PREFIX_REGEX, "");

  try {
    const slack = (event.adapter as SlackAdapter).client;
    await slack.pins.add({ channel: channelId, timestamp: event.messageId });
    await thread.post(
      `${emoji.pin} Pinned the welcome card via \`bot.getAdapter("slack").client.pins.add\`.`
    );
  } catch (err) {
    await thread.post(
      `${emoji.warning} Error pinning message: ${
        err instanceof Error ? err.message : "Unknown error"
      }`
    );
  }
});

// Helper to delay execution
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Handle messages matching a pattern
bot.onNewMessage(/help/i, async (thread, message) => {
  const platforms = Object.keys(adapters).join(", ") || "none configured";
  await thread.post(
    <Card title={`${emoji.question} Help`}>
      <Text>{`Hi ${message.author.userName}! Here's how I can help:`}</Text>
      <Divider />
      <Section>
        <Text>{`${emoji.star} **Mention me** to start a conversation`}</Text>
        <Text>{`${emoji.sparkles} **Mention me with "AI"** to enable AI assistant mode`}</Text>
        <Text>{`${emoji.eyes} I'll respond to messages in threads where I'm mentioned`}</Text>
        <Text>{`${emoji.fire} React to my messages and I'll react back!`}</Text>
        <Text>{`${emoji.rocket} Active platforms: ${platforms}`}</Text>
      </Section>
    </Card>
  );
});

// Handle messages in subscribed threads
bot.onSubscribedMessage(async (thread, message) => {
  if (!(thread.adapter.name === "telegram" || message.isMention)) {
    return;
  }
  // Get thread state to check AI mode
  const threadState = await thread.state;

  // Check if user wants to disable AI mode
  if (DISABLE_AI_REGEX.test(message.text)) {
    await thread.setState({ aiMode: false });
    await thread.post(`${emoji.check} AI mode disabled for this thread.`);
    return;
  }

  // Check if user wants to enable AI mode
  if (ENABLE_AI_REGEX.test(message.text)) {
    await thread.setState({ aiMode: true });
    await thread.post(`${emoji.sparkles} AI mode enabled for this thread!`);
    return;
  }

  // If AI mode is enabled (or this is a DM), use the AI agent
  if (threadState?.aiMode) {
    // Capture the user's message in their cross-platform transcript so we can
    // backfill context on platforms without server-side history.
    await bot.transcripts.append(thread, message);

    // Build conversation history: try fetchMessages first, then fall back to
    // the user's stored transcript (filtered to this thread) for platforms
    // without a message history API.
    let history: AiMessage[];
    try {
      const result = await thread.adapter.fetchMessages(thread.id, {
        limit: 20,
      });
      history =
        result.messages.length > 0
          ? await toAiMessages(result.messages)
          : transcriptToAiMessages(
              await bot.transcripts.list({
                userKey: message.userKey ?? "",
                threadId: thread.id,
                limit: 20,
              })
            );
    } catch {
      history = transcriptToAiMessages(
        await bot.transcripts.list({
          userKey: message.userKey ?? "",
          threadId: thread.id,
          limit: 20,
        })
      );
    }

    // No explicit status: on Slack this falls back to the adapter-level
    // `loadingMessages` rotation (see SLACK_AGENT_OPTIONS in adapters.ts).
    await thread.startTyping();
    try {
      const result = await agent.stream({ prompt: history });
      await thread.post(result.fullStream);
      const responseText = await result.text;
      // Persist the assistant reply alongside the user message, so the next
      // turn can read both sides of the conversation from the transcript.
      if (message.userKey) {
        await bot.transcripts.append(
          thread,
          { role: "assistant", text: responseText },
          { userKey: message.userKey }
        );
      }
    } catch (err) {
      console.error("Error in AI response:", err);
      await thread.post(
        `${emoji.warning} Error: ${
          err instanceof Error ? err.message : "Unknown error"
        }`
      );
    }
    return;
  }

  // Check if user wants a DM
  if (DM_ME_REGEX.test(message.text.trim())) {
    try {
      const dmThread = await bot.openDM(message.author);
      await dmThread.post(
        <Card title={`${emoji.speech_bubble} Private Message`}>
          <Text>{`Hi ${message.author.fullName}! You requested a DM from the thread.`}</Text>
          <Divider />
          <Text>This is a private conversation between us.</Text>
        </Card>
      );
      await thread.post(`${emoji.check} I've sent you a DM!`);
    } catch (err) {
      await thread.post(
        `${emoji.warning} Sorry, I couldn't send you a DM. Error: ${
          err instanceof Error ? err.message : "Unknown error"
        }`
      );
    }
    return;
  }

  // Check if message has attachments
  if (message.attachments && message.attachments.length > 0) {
    const attachmentInfo = message.attachments
      .map(
        (a) =>
          `- ${a.name || "unnamed"} (${a.type}, ${a.mimeType || "unknown"})`
      )
      .join("\n");

    await thread.post(
      <Card title={`${emoji.eyes} Attachments Received`}>
        <Text>{`You sent ${message.attachments.length} file(s):`}</Text>
        <Text>{attachmentInfo}</Text>
      </Card>
    );
    return;
  }

  // Default response for other messages
  await thread.startTyping();
  await delay(1000);
  const response = await thread.post(`${emoji.thinking} Processing...`);
  try {
    await delay(2000);
    await response.edit(`${emoji.eyes} Just a little bit...`);
    await delay(1000);
    await response.edit(`${emoji.check} Thanks for your message!`);
  } catch {
    // Some platforms (WhatsApp) don't support editing — send a follow-up instead
    await thread.post(`${emoji.check} Thanks for your message!`);
  }
});

// Handle emoji reactions - respond with a matching emoji or message
bot.onReaction(["thumbs_up", "heart", "fire", "rocket"], async (event) => {
  // Only respond to added reactions, not removed ones
  if (!event.added) {
    return;
  }

  // GChat, Teams, and Messenger bots cannot add reactions via their APIs
  // Respond with a message instead
  if (
    event.adapter.name === "gchat" ||
    event.adapter.name === "teams" ||
    event.adapter.name === "messenger"
  ) {
    await event.adapter.postMessage(
      event.threadId,
      `Thanks for the ${event.rawEmoji}!`
    );
    return;
  }

  // React to the same message with the same emoji
  // Adapters auto-convert normalized emoji to platform-specific format
  await event.adapter.addReaction(
    event.threadId,
    event.messageId,
    emoji.raised_hands
  );
});
