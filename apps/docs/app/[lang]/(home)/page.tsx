import type { Metadata } from "next";
import type { ComponentProps } from "react";
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
import { discord, gchat, slack, teams } from "@/lib/logos";
import { CenteredSection } from "./components/centered-section";
import { CTA } from "./components/cta";
import { Demo } from "./components/demo";
import { Hero } from "./components/hero";
import { OneTwoSection } from "./components/one-two-section";
import { ResourcesSection } from "./components/resources-section";
import { TextGridSection } from "./components/text-grid-section";
import { Usage } from "./components/usage";

const LogoChip = ({
  icon: Icon,
  name,
  suffix,
}: {
  icon: (props: ComponentProps<"svg">) => React.JSX.Element;
  name: string;
  suffix?: string;
}) => (
  <span className="ml-[2px] whitespace-nowrap">
    <span className="relative inline-block h-0 w-[1em] align-middle">
      <Icon className="absolute top-1/2 left-0 size-[1em] -translate-y-1/2" />
    </span>
    <span className="ml-[calc(0.25em+2px)]">{name}</span>
    {suffix}
  </span>
);

const COMMAND_FOR_HUMANS = "npm install chat";
const COMMAND_FOR_AGENTS = "npx skills add vercel/chat";

const title = "Chat SDK";
const textDescription =
  "A unified TypeScript SDK for building chat bots across Slack, Microsoft Teams, Google Chat, Discord, and more. Write your bot logic once, deploy everywhere.";
const heroDescription = (
  <>
    A unified TypeScript SDK for building chat bots across{" "}
    <LogoChip icon={slack} name="Slack" suffix="," />{" "}
    <LogoChip icon={teams} name="Microsoft Teams" suffix="," />{" "}
    <LogoChip icon={gchat} name="Google Chat" suffix="," />{" "}
    <LogoChip icon={discord} name="Discord" suffix="," />{" "}
    <a className="underline" href="/adapters">
      and more
    </a>
    . Write your bot logic once, deploy everywhere.
  </>
);

export const metadata: Metadata = {
  title,
  description: textDescription,
  twitter: {
    card: "summary_large_image",
  },
};

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

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareSourceCode",
  name: "Chat SDK",
  description: textDescription,
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
    <Hero
      badge="Chat SDK is now open source and in beta"
      description={heroDescription}
      title={title}
    >
      <CommandPromptRoot className="mt-6" defaultValue="humans">
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
        description={
          <>
            Install the SDK and pair it with your favorite{" "}
            <a className="underline" href="/adapters">
              adapters
            </a>{" "}
            and state management solutions.
          </>
        }
        title="Usage"
      >
        <Usage />
      </OneTwoSection>
      <ResourcesSection />
      <CTA
        cta="Get started"
        href="/docs/getting-started"
        title="Ship your chatbot today"
      />
    </div>
  </div>
);

export default HomePage;
