import { ArrowUpRightIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "./copy-button";

interface Integration {
  description: string;
  href: string;
  pkg: string;
  title: ReactNode;
}

const integrations: Integration[] = [
  {
    title: "AI SDK",
    description:
      "Build AI agents with streaming, tool calls, and structured outputs.",
    pkg: "npm i ai",
    href: "https://ai-sdk.dev",
  },
  {
    title: "Vercel AI Gateway",
    description: "Access 100+ models with one API key and no markup.",
    pkg: "npm i ai",
    href: "https://vercel.com/ai-gateway",
  },
  {
    title: "Vercel Sandbox",
    description:
      "Build knowledge agents with persistent filesystems to search, index, and read files.",
    pkg: "npm i @vercel/sandbox",
    href: "https://vercel.com/sandbox",
  },
  {
    title: (
      <span className="flex items-center gap-2">
        Workflows <Badge>NEW</Badge>
      </span>
    ),
    description:
      "Build durable chat agents that suspend, resume, and survive function timeouts.",
    pkg: "npm i workflow",
    href: "https://vercel.com/workflow",
  },
];

const Snippet = ({ text }: { text: string }) => (
  <div className="relative w-full rounded-md border bg-background py-[10px] pr-12 pl-3 font-mono text-[13px] leading-5 [&_button]:absolute [&_button]:top-1/2 [&_button]:right-1 [&_button]:size-8 [&_button]:-translate-y-1/2 [&_button]:rounded-md [&_svg]:size-4">
    <span className="select-none text-muted-foreground">$ </span>
    {text}
    <CopyButton code={text} />
  </div>
);

const IntegrationCard = ({
  href,
  title,
  description,
  children,
}: {
  href: string;
  title: ReactNode;
  description: string;
  children: ReactNode;
}) => (
  <>
    <Link
      className="focus:outline-hidden"
      href={href}
      rel="noopener"
      target="_blank"
    >
      <span aria-hidden="true" className="absolute inset-0" />
    </Link>
    <div className="flex h-full flex-col justify-between gap-6">
      <div>
        <p className="font-medium font-mono text-base">{title}</p>
        <p className="mt-3 text-copy-14 text-gray-900 sm:text-copy-16">
          {description}
        </p>
      </div>
      <div className="relative z-10">{children}</div>
    </div>
    <span className="pointer-events-none absolute top-0 right-0 overflow-hidden bg-gray-100 p-2">
      <PlusIcon className="size-3.5 text-gray-900 transition-all duration-200 group-hover:scale-0 group-hover:opacity-0" />
      <ArrowUpRightIcon className="absolute top-2 right-2 size-3.5 -translate-x-[6px] translate-y-[6px] scale-0 text-gray-900 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100" />
    </span>
  </>
);

export const IntegrationsSection = () => (
  <div className="home-grid home-grid-integrations" data-home-grid>
    <div className="home-grid-cell">
      <div className="flex flex-col gap-4">
        <h3 className="text-heading-16 sm:text-heading-24">
          Scale with confidence
        </h3>
        <p className="text-copy-16 text-gray-900">
          Plug Chat SDK into an entire ecosystem designed for AI-native chat
          experiences that scale.
        </p>
      </div>
    </div>
    {integrations.map((integration) => (
      <div className="home-grid-cell group relative" key={integration.href}>
        <IntegrationCard
          description={integration.description}
          href={integration.href}
          title={integration.title}
        >
          <Snippet text={integration.pkg} />
        </IntegrationCard>
      </div>
    ))}
    <div aria-hidden className="home-grid-guides home-grid-guides-sm">
      <div
        className="home-grid-guide"
        style={{ "--guide-x": 1, "--guide-y": 1 } as CSSProperties}
      />
      <div
        className="home-grid-guide"
        style={{ "--guide-x": 1, "--guide-y": 2 } as CSSProperties}
      />
      <div
        className="home-grid-guide"
        style={{ "--guide-x": 1, "--guide-y": 3 } as CSSProperties}
      />
      <div
        className="home-grid-guide"
        style={{ "--guide-x": 1, "--guide-y": 4 } as CSSProperties}
      />
      <div
        className="home-grid-guide"
        style={{ "--guide-x": 1, "--guide-y": 5 } as CSSProperties}
      />
    </div>
    <div aria-hidden className="home-grid-guides home-grid-guides-lg">
      <div
        className="home-grid-guide"
        style={{ "--guide-x": 1, "--guide-y": 1 } as CSSProperties}
      />
      <div
        className="home-grid-guide"
        style={{ "--guide-x": 2, "--guide-y": 1 } as CSSProperties}
      />
      <div
        className="home-grid-guide"
        style={{ "--guide-x": 3, "--guide-y": 1 } as CSSProperties}
      />
      <div
        className="home-grid-guide"
        style={{ "--guide-x": 1, "--guide-y": 2 } as CSSProperties}
      />
      <div
        className="home-grid-guide"
        style={{ "--guide-x": 2, "--guide-y": 2 } as CSSProperties}
      />
      <div
        className="home-grid-guide"
        style={{ "--guide-x": 3, "--guide-y": 2 } as CSSProperties}
      />
    </div>
  </div>
);
