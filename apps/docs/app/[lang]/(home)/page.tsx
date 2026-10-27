import type { Metadata } from "next";
import { JsonLd } from "@/components/geistdocs/json-ld";
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
import {
  absoluteUrl,
  jsonLdGraph,
  MIT_LICENSE_URL,
  npmPackageUrl,
  ORGANIZATION_ID,
  REPOSITORY_URL,
  SITE_NAME,
  SITE_URL,
  SOFTWARE_ID,
  webPageNode,
} from "@/lib/geistdocs/jsonld";
import { CodeSection } from "./components/code-section";
import { Demo } from "./components/demo";
import { GetStartedSection } from "./components/get-started-section";
import { Hero } from "./components/hero";
import { IntegrationsSection } from "./components/integrations-section";
import { OssStatsSection } from "./components/oss-stats-section";
import { SupportedPlatforms } from "./components/supported-platforms";

const COMMAND_FOR_HUMANS = "npm install chat";
const COMMAND_FOR_AGENTS = "npx skills add vercel/chat";

const metadataTitle = "Chat SDK";
const heroTitleDisplay = (
  <>
    Universal chat layer for
    <br className="hidden sm:block" /> building bots and agents
  </>
);
const heroDescription =
  "A unified TypeScript SDK for building chat bots with type-safe handlers, JSX cards, and multi-platform support—powered by Vercel";

export const metadata: Metadata = {
  title: { absolute: metadataTitle },
  description: heroDescription,
  openGraph: {
    title: { absolute: metadataTitle },
    images: "/opengraph-image.png",
  },
  twitter: {
    card: "summary_large_image",
  },
};

const templates = [
  {
    title: "Vercel Connect Guide",
    description:
      "Authenticate a Slack bot with Vercel Connect instead of stored secrets.",
    link: "https://vercel.com/kb/guide/build-a-slack-bot-with-vercel-connect",
    code: `const slack = createSlackAdapter({
  // Credentials come from Vercel Connect
  // instead of stored secrets
  ...connectSlackAdapter("slack/acme-slack"),
});

export const bot = new Chat({
  userName: "mybot",
  adapters: { slack },
  state: createRedisState(),
});`,
  },
  {
    title: "Knowledge Agent Template",
    description:
      "Answer questions from synced docs and repos with file-system search.",
    link: "https://vercel.com/templates/nuxt/chat-sdk-knowledge-agent",
    code: `// Search synced docs and repos
const savoir = createSavoir({
  apiUrl: process.env.SAVOIR_URL,
  apiKey: process.env.SAVOIR_API_KEY,
});

const { text } = await generateText({
  model,
  tools: savoir.tools,
  prompt: "How do I configure auth?",
});`,
  },
  {
    title: "eve Integration Guide",
    description:
      "Send Chat SDK messages to an eve agent and stream its replies back to the thread.",
    link: "https://vercel.com/docs/chat-sdk/eve",
    code: `const { bot, send } = chatSdkChannel({
  userName: "my-agent",
  adapters: { slack },
  state: createRedisState(),
});

bot.onNewMention(async (thread, message) => {
  await thread.subscribe();
  await send(message.text, { thread });
});`,
  },
];

const jsonLd = jsonLdGraph([
  webPageNode({
    description: heroDescription,
    hasBreadcrumb: false,
    image: absoluteUrl("/opengraph-image.png"),
    mainEntityId: SOFTWARE_ID,
    name: metadataTitle,
    url: absoluteUrl("/"),
  }),
  {
    "@type": "SoftwareSourceCode",
    "@id": SOFTWARE_ID,
    name: SITE_NAME,
    description: heroDescription,
    url: SITE_URL,
    image: absoluteUrl("/opengraph-image.png"),
    codeRepository: REPOSITORY_URL,
    programmingLanguage: "TypeScript",
    runtimePlatform: "Node.js",
    license: MIT_LICENSE_URL,
    author: { "@id": ORGANIZATION_ID },
    publisher: { "@id": ORGANIZATION_ID },
    sameAs: [REPOSITORY_URL, npmPackageUrl("chat")],
  },
]);

const HomePage = () => (
  // Single gutter for the whole page; sections are flush so their content lines
  // up with the navbar's content edges.
  <div className="mx-auto w-full max-w-[1448px] px-4 pb-12 sm:px-6 sm:pb-16">
    <JsonLd data={jsonLd} />
    <Hero description={heroDescription} title={heroTitleDisplay}>
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
      <div className="mx-auto mt-16 w-full max-w-4xl text-left md:mt-20">
        <Demo />
      </div>
    </Hero>
    <OssStatsSection />
    <SupportedPlatforms />
    <CodeSection />
    <IntegrationsSection />
    <GetStartedSection data={templates} />
  </div>
);

export default HomePage;
