/** @jsxImportSource chat */
// @ts-nocheck - TypeScript doesn't understand custom JSX runtimes with per-file pragmas
import { createRedisState } from "@chat-adapter/state-redis";
import { ToolLoopAgent } from "ai";
import {
  Actions,
  Button,
  Card,
  CardLink,
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
  CardText as Text,
  TextInput,
} from "chat";
import { buildAdapters } from "./adapters";

const AI_MENTION_REGEX = /\bAI\b/i;
const DISABLE_AI_REGEX = /disable\s*AI/i;
const ENABLE_AI_REGEX = /enable\s*AI/i;
const DM_ME_REGEX = /^dm\s*me$/i;

const state = createRedisState({
  url: process.env.REDIS_URL || "",
  keyPrefix: "chat-sdk-webhooks",
});
const adapters = buildAdapters();

// Define thread state type
interface ThreadState {
  aiMode?: boolean;
}

// Create the bot instance with typed thread state
export const bot = new Chat<typeof adapters, ThreadState>({
  userName: process.env.BOT_USERNAME || "mybot",
  adapters,
  state,
  logger: "debug",
});

// AI agent for AI mode
const agent = new ToolLoopAgent({
  model: "anthropic/claude-4.5-sonnet",
  instructions:
    "You are a helpful assistant in a chat thread. Answer the user's queries in a concise manner.",
});

// Handle new @mentions of the bot
bot.onNewMention(async (thread, message) => {
  await thread.subscribe();

  // Check if user wants to enable AI mode (mention contains "AI")
  if (AI_MENTION_REGEX.test(message.text)) {
    await thread.setState({ aiMode: true });
    await thread.post(
      <Card title={`${emoji.sparkles} AI Mode Enabled`}>
        <Text>
          I'm now in AI mode! I'll use Claude to respond to your messages in
          this thread.
        </Text>
        <Text>Say "disable AI" to turn off AI mode.</Text>
        <Divider />
        <Fields>
          <Field label="Platform" value={thread.adapter.name} />
          <Field label="Mode" value="AI Assistant" />
        </Fields>
      </Card>
    );

    // Also respond to the initial message with AI
    await thread.startTyping("Thinking...");
    const result = await agent.stream({ prompt: message.text });
    await thread.post(result.textStream);
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
        <Button id="feedback">Send Feedback</Button>
        <Button id="messages">Fetch Messages</Button>
        <Button id="channel-post">Channel Post</Button>
        <Button id="report" value="bug">
          Report Bug
        </Button>
        <LinkButton url="https://vercel.com">Open Link</LinkButton>
        <Button id="goodbye" style="danger">
          Goodbye
        </Button>
      </Actions>
    </Card>
  );
});

bot.onAction("ephemeral", async (event) => {
  await event.thread.postEphemeral(
    event.user,
    <Card title={`${emoji.eyes} Ephemeral Message`}>
      <Text>
        Only you can see this message. It will disappear when you reload.
      </Text>
      <Text>Try opening a modal from this ephemeral:</Text>
      <Actions>
        <Button id="ephemeral_modal" style="primary">
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
  event.thread.post(
    <Card title={`${emoji.check} Plan Chosen!`}>
      <Text>You chose plan *{event.value}*</Text>
    </Card>
  );
});

// Handle card button actions
bot.onAction("hello", async (event) => {
  await event.thread.post(`${emoji.wave} Hello, ${event.user.fullName}!`);
});

bot.onAction("info", async (event) => {
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
          value={threadState?.aiMode ? "Enabled" : "Disabled"}
        />
      </Fields>
    </Card>
  );
});

bot.onAction("goodbye", async (event) => {
  await event.thread.post(
    `${emoji.wave} Goodbye, ${event.user.fullName}! See you later.`
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

// Opens feedback modal via /feedback
bot.onSlashCommand("/test-feedback", async (event) => {
  const result = await event.openModal(FeedbackModal);
  if (!result) {
    await event.channel.post(
      `${emoji.warning} Couldn't open the feedback modal. Please try again.`
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

// Demonstrate fetchMessages and allMessages
bot.onAction("messages", async (event) => {
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

  // If AI mode is enabled, use the AI agent
  if (threadState?.aiMode) {
    // Try to fetch message history, fall back to current message if not supported
    let messages: typeof thread.recentMessages;
    try {
      const result = await thread.adapter.fetchMessages(thread.id, {
        limit: 20,
      });
      messages = result.messages;
    } catch {
      // Some adapters (Teams) don't support fetching message history
      messages = thread.recentMessages;
    }
    const history = [...messages]
      .filter((msg) => msg.text.trim()) // Filter out empty messages (cards, system msgs)
      .map((msg) => ({
        role: msg.author.isMe ? ("assistant" as const) : ("user" as const),
        content: msg.text,
      }));
    console.log("history", history);
    await thread.startTyping("Thinking...");
    const result = await agent.stream({ prompt: history });
    await thread.post(result.textStream);
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
  await delay(2000);
  await response.edit(`${emoji.eyes} Just a little bit...`);
  await delay(1000);
  await response.edit(`${emoji.check} Thanks for your message!`);
});

// Handle emoji reactions - respond with a matching emoji or message
bot.onReaction(["thumbs_up", "heart", "fire", "rocket"], async (event) => {
  // Only respond to added reactions, not removed ones
  if (!event.added) {
    return;
  }

  // GChat and Teams bots cannot add reactions via their APIs
  // Respond with a message instead
  if (event.adapter.name === "gchat" || event.adapter.name === "teams") {
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
