export default function Home() {
  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>Chat SDK Example</h1>
      <p>This is an example Next.js app using chat.</p>

      <h2>Webhook Endpoints</h2>
      <ul>
        <li>
          <code>/api/webhooks/slack</code> - Slack events
        </li>
        <li>
          <code>/api/webhooks/teams</code> - Microsoft Teams events
        </li>
        <li>
          <code>/api/webhooks/gchat</code> - Google Chat events
        </li>
        <li>
          <code>/api/webhooks/github</code> - GitHub PR comment events
        </li>
        <li>
          <code>/api/webhooks/linear</code> - Linear issue comment events
        </li>
      </ul>

      <h2>Features</h2>
      <ul>
        <li>
          <strong>AI Mode</strong> - Mention the bot with &quot;AI&quot; to
          enable AI assistant mode (uses Claude)
        </li>
        <li>
          <strong>Rich Cards</strong> - Interactive cards with buttons
        </li>
        <li>
          <strong>Reactions</strong> - React to bot messages and it reacts back
        </li>
        <li>
          <strong>DM Support</strong> - Say &quot;DM me&quot; to get a direct
          message
        </li>
      </ul>

      <h2>Configuration</h2>
      <p>Set the following environment variables to enable each platform:</p>

      <h3>Slack</h3>
      <pre>
        {`SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...`}
      </pre>

      <h3>Microsoft Teams</h3>
      <pre>
        {`TEAMS_APP_ID=...
TEAMS_APP_PASSWORD=...`}
      </pre>

      <h3>Google Chat</h3>
      <pre>{`GOOGLE_CHAT_CREDENTIALS={"type":"service_account",...}`}</pre>

      <h3>GitHub</h3>
      <pre>
        {`# PAT auth (simple)
GITHUB_TOKEN=ghp_...
GITHUB_WEBHOOK_SECRET=...

# OR GitHub App auth (recommended)
GITHUB_APP_ID=...
GITHUB_PRIVATE_KEY=...
GITHUB_WEBHOOK_SECRET=...`}
      </pre>

      <h3>Linear</h3>
      <pre>
        {`LINEAR_API_KEY=lin_api_...
LINEAR_WEBHOOK_SECRET=...`}
      </pre>
    </main>
  );
}
