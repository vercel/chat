import type { Metadata } from "next";
import {
  CommandPromptContent,
  CommandPromptCopy,
  CommandPromptList,
  CommandPromptPrefix,
  CommandPromptRoot,
  CommandPromptSurface,
  CommandPromptTrigger,
  CommandPromptTriggerDivider,
  CommandPromptViewport,
} from "@/components/ui/command-prompt";
import { CodeSection } from "./components/code-section";
import { Demo } from "./components/demo";
import { GetStartedSection } from "./components/get-started-section";
import { Hero } from "./components/hero";
import { IntegrationsSection } from "./components/integrations-section";
import { OssStatsSection } from "./components/oss-stats-section";
import { SupportedPlatforms } from "./components/supported-platforms";
import { Usage } from "./components/usage";

const COMMAND_FOR_HUMANS = "npm install chat";
const COMMAND_FOR_AGENTS = "npx skills add vercel/chat";

const metadataTitle = "Chat SDK";
const heroTitle = "Universal chat layer for building bots and agents";
const heroDescription =
  "A unified TypeScript SDK for building chat bots with type-safe handlers, JSX cards, and multi-platform support—powered by Vercel";

export const metadata: Metadata = {
  title: metadataTitle,
  description: heroDescription,
  twitter: {
    card: "summary_large_image",
  },
};

const templates = [
  {
    title: "Slack Agent Guide",
    description: "Stream agent responses and tool calls into Slack threads.",
    link: "https://vercel.com/kb/guide/how-to-build-an-ai-agent-for-slack-with-chat-sdk-and-ai-sdk",
    code: `bot.onNewMention(async (thread, msg) => {
  await thread.subscribe();
  const result = await agent.stream({
    prompt: msg.text,
  });
  await thread.post(result.fullStream);
});`,
  },
  {
    title: "Knowledge Agent Template",
    description:
      "Answer questions from synced docs and repos with file-system search.",
    link: "https://vercel.com/templates/nuxt/chat-sdk-knowledge-agent",
    code: `const savoir = createSavoir({
  apiUrl: process.env.SAVOIR_URL,
  apiKey: process.env.SAVOIR_API_KEY,
});

const { text } = await generateText({
  model,
  tools: savoir.tools,
  maxSteps: 10,
  prompt: "How do I configure auth?",
});`,
  },
  {
    title: "Code Review Bot Guide",
    description: "Review pull requests with sandboxed AI analysis on GitHub.",
    link: "https://vercel.com/kb/guide/ship-a-github-code-review-bot-with-hono-and-redis",
    code: `bot.onNewMention(async (thread, msg) => {
  const { data: pr } = await octokit.pulls.get({
    owner, repo, pull_number,
  });
  await thread.post("Starting code review...");
  const review = await reviewPullRequest({
    owner, repo,
    prBranch: pr.head.ref,
  });
  await thread.post(review);
});`,
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareSourceCode",
  name: "Chat SDK",
  description: heroDescription,
  url: "https://chat-sdk.dev",
  codeRepository: "https://github.com/vercel/chat",
  programmingLanguage: "TypeScript",
  runtimePlatform: "Node.js",
  license: "https://opensource.org/licenses/Apache-2.0",
  author: {
    "@type": "Organization",
    name: "Vercel",
    url: "https://vercel.com",
  },
};

const HomePage = () => (
  <div className="container mx-auto max-w-5xl">
    <script
      // biome-ignore lint/security/noDangerouslySetInnerHtml: static JSON-LD, not user input
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      type="application/ld+json"
    />
    <Hero description={heroDescription} title={heroTitle}>
      <CommandPromptRoot className="mt-2" defaultValue="humans">
        <CommandPromptList>
          <CommandPromptTrigger className="min-w-[90px]" value="humans">
            For humans
          </CommandPromptTrigger>
          <CommandPromptTriggerDivider />
          <CommandPromptTrigger className="min-w-[84px]" value="agents">
            For agents
          </CommandPromptTrigger>
        </CommandPromptList>
        <CommandPromptSurface>
          <CommandPromptPrefix>$</CommandPromptPrefix>
          <CommandPromptViewport>
            <CommandPromptContent copyValue={COMMAND_FOR_HUMANS} value="humans">
              {COMMAND_FOR_HUMANS}
            </CommandPromptContent>
            <CommandPromptContent copyValue={COMMAND_FOR_AGENTS} value="agents">
              {COMMAND_FOR_AGENTS}
            </CommandPromptContent>
          </CommandPromptViewport>
          <CommandPromptCopy />
        </CommandPromptSurface>
      </CommandPromptRoot>
      <div className="mx-auto mt-12 max-w-4xl px-4 text-left sm:mt-16">
        <Demo />
      </div>
    </Hero>
    <div className="grid divide-y border-y sm:border-x">
      <OssStatsSection />
      <SupportedPlatforms />
      <CodeSection>
        <Usage />
      </CodeSection>
      <IntegrationsSection />
      <GetStartedSection data={templates} />
    </div>
  </div>
);

export default HomePage;
