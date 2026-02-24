import DynamicLink from "fumadocs-core/dynamic-link";
import type { Metadata } from "next";
import { Installer } from "@/components/geistdocs/installer";
import { Button } from "@/components/ui/button";
import { CenteredSection } from "./components/centered-section";
import { CTA } from "./components/cta";
import { Demo } from "./components/demo";
import { Hero } from "./components/hero";
import { OneTwoSection } from "./components/one-two-section";
import { Templates } from "./components/templates";
import { TextGridSection } from "./components/text-grid-section";
import { Usage } from "./components/usage";

const title = "Chat SDK";
const description =
  "A unified TypeScript SDK for building chat bots across Slack, Microsoft Teams, Google Chat, Discord, and more. Write your bot logic once, deploy everywhere.";

export const metadata: Metadata = {
  title,
  description,
};

const templates = [
  {
    title: "Slack bot with Next.js",
    description: "Build a Slack bot from scratch using Chat SDK, Next.js, and Redis.",
    link: "/docs/guides/slack-nextjs",
    code: `const bot = new Chat({
  userName: "my-bot",
  adapters: {
    slack: createSlackAdapter(),
  },
  state: createRedisState(),
});`,
  },
  {
    title: "Discord support bot with Nuxt",
    description: "Build a Discord support bot using Chat SDK, Nuxt, and AI SDK.",
    link: "/docs/guides/discord-nuxt",
    code: `bot.onNewMention(async (thread) => {
  await thread.subscribe();
  await thread.post(
    <Card title="Support">
      <Text>Ask your question and
        I'll do my best to answer.</Text>
      <Actions>
        <Button id="escalate">
          Escalate to Human
        </Button>
      </Actions>
    </Card>
  );
});`,
  },
  {
    title: "Code review bot with Hono",
    description: "Build a GitHub bot that reviews pull requests using AI SDK and Vercel Sandbox.",
    link: "/docs/guides/code-review-hono",
    code: `const sandbox = await Sandbox.create({
  source: {
    type: "git",
    url: \`https://github.com/\${owner}/\${repo}\`,
    username: "x-access-token",
    password: process.env.GITHUB_TOKEN,
  },
});

const { tools } = await createBashTool({
  sandbox,
});`,
  },
];

const textGridSection = [
  {
    id: "1",
    title: "Multi-platform",
    description:
      "Deploy to Slack, Teams, Google Chat, Discord, GitHub, and Linear from a single codebase.",
  },
  {
    id: "2",
    title: "Type-safe",
    description:
      "Full TypeScript support with type-safe adapters, event handlers, and JSX cards.",
  },
  {
    id: "3",
    title: "AI streaming",
    description:
      "First-class support for streaming LLM responses with native platform rendering.",
  },
];

const HomePage = () => (
  <div className="container mx-auto max-w-5xl">
    <Hero
      badge="Chat SDK is now open source and in beta"
      description={description}
      title={title}
    >
      <div className="mx-auto inline-flex w-fit items-center gap-3">
        <Button asChild className="px-4" size="lg">
          <DynamicLink href="/[lang]/docs/getting-started">
            Get Started
          </DynamicLink>
        </Button>
        <Installer command="pnpm add chat" className="w-40 sm:w-32" />
      </div>
    </Hero>
    <div className="grid divide-y border-y sm:border-x">
      <CenteredSection
        description="See how your handlers respond to real-time chat events across any platform."
        title="Event-driven by design"
      >
        <Demo />
      </CenteredSection>
      <TextGridSection data={textGridSection} />
      <OneTwoSection
        description="Install the SDK and pair it with your favorite chat providers and state management solutions."
        title="Usage"
      >
        <Usage />
      </OneTwoSection>
      <Templates
        data={templates}
        description="Step-by-step guides to help you build common patterns with the Chat SDK."
        title="Guides"
      />
      <CTA
        cta="Get started"
        href="/docs/getting-started"
        title="Ship your chatbot today"
      />
    </div>
  </div>
);

export default HomePage;
