import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <main style={{ margin: "0 auto", maxWidth: 640, padding: 16 }}>
      <h1>Chat SDK + TanStack Start</h1>
      <p>
        A Slack bot that replies with TanStack AI through Vercel AI Gateway.
        Point your Slack app's event and interactivity URLs at{" "}
        <code>/api/webhooks/slack</code>, then mention the bot in a channel.
      </p>
      <p>
        To chat in the browser instead, open <a href="/chat">/chat</a>. It uses
        TanStack AI's <code>useChat</code> with the Chat SDK web adapter.
      </p>
    </main>
  );
}
