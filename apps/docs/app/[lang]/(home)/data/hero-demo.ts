/**
 * How each platform delivers a streamed reply in a channel thread, from the
 * catalog's `streaming` support: Slack streams natively, Post+Edit platforms
 * update the message in chunks, and buffered platforms post it once complete.
 * Teams streams natively only in DMs, so a channel thread is buffered.
 */
export type StreamMode = "native" | "edit" | "buffered";

export const PLATFORMS = [
  { slug: "slack", name: "Slack", stream: "native" },
  { slug: "teams", name: "Teams", stream: "buffered" },
  { slug: "gchat", name: "Google Chat", stream: "edit" },
  { slug: "discord", name: "Discord", stream: "edit" },
  { slug: "whatsapp", name: "WhatsApp", stream: "buffered" },
  { slug: "telegram", name: "Telegram", stream: "edit" },
] as const satisfies readonly {
  name: string;
  slug: string;
  stream: StreamMode;
}[];

export type PlatformSlug = (typeof PLATFORMS)[number]["slug"];
export type CardAction = "approve" | "cancel";

export const BOT_NAME = "DeployBot";
// A non-breaking space keeps "PR #103" on one line.
export const QUESTION = "can we ship PR\u00A0#103?";

// Shared by the handler code and the previews so the two can't drift.
export const CARD = {
  title: "Deploy to production?",
  text: "PR #103 passed every check.",
  primary: "Approve",
  secondary: "Cancel",
} as const;

export const CANCEL_REPLY = "Deploy canceled.";

/**
 * The streamed reply to Approve: one paragraph, split into the chunks a
 * Post+Edit platform reveals one update at a time.
 */
export const DEPLOY_CHUNKS = [
  "Deploying PR #103 to production.",
  "Migrations are done and traffic is on the new version.",
  "Production is live.",
] as const;

export const CARD_CODE = `import { Actions, Button, Card, CardText } from "chat";

bot.onNewMention(async (thread) => {
  await thread.post(
    <Card title=${JSON.stringify(CARD.title)}>
      <CardText>${CARD.text}</CardText>
      <Actions>
        <Button id="approve" style="primary">${CARD.primary}</Button>
        <Button id="cancel">${CARD.secondary}</Button>
      </Actions>
    </Card>
  );
});

// deploy() returns an AsyncIterable<string>, so the reply streams
bot.onAction("approve", async (event) => {
  await event.thread?.post(deploy(103));
});

bot.onAction("cancel", async (event) => {
  await event.thread?.post(${JSON.stringify(CANCEL_REPLY)});
});`;
