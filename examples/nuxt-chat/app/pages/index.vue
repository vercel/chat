<template>
  <main class="home">
    <h1>Chat SDK Nuxt Example</h1>
    <p>
      A lightweight Nuxt 4 app using
      <a href="https://chat-sdk.dev" rel="noopener" target="_blank">Chat SDK</a>
      with the Slack and web adapters.
    </p>

    <h2>Endpoints</h2>
    <ul>
      <li>
        <code>POST /api/webhooks/slack</code> — Slack events (set this as the
        request URL in your Slack app)
      </li>
      <li>
        <code>POST /api/chat</code> — web adapter endpoint, used by the
        <NuxtLink to="/chat">browser chat UI</NuxtLink>
      </li>
    </ul>

    <h2>Features</h2>
    <ul>
      <li>
        <strong>Web chat</strong> — talk to the bot at
        <NuxtLink to="/chat">/chat</NuxtLink>, streamed with the AI SDK
      </li>
      <li>
        <strong>AI mode</strong> — mention the bot with "AI" (or say "enable
        AI" in a subscribed thread) for AI-assisted replies
      </li>
      <li>
        <strong>Welcome card</strong> — mention the bot to get an interactive
        card with buttons
      </li>
    </ul>

    <h2>Configuration</h2>
    <p>Set these environment variables (see <code>.env.example</code>):</p>
    <pre><code>BOT_USERNAME=mybot

# Slack (optional)
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...

# Redis state (optional, in-memory without it)
REDIS_URL=redis://localhost:6379

# AI Gateway key for local dev (OIDC on Vercel)
AI_GATEWAY_API_KEY=...</code></pre>
  </main>
</template>
