import { ArrowUpRightIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
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
  className,
}: {
  href: string;
  title: ReactNode;
  description: string;
  children: ReactNode;
  className?: string;
}) => (
  <div className={cn("group relative p-8 sm:p-10", className)}>
    <Link
      className="absolute inset-0 focus:outline-hidden"
      href={href}
      rel="noopener"
      target="_blank"
    >
      <span aria-hidden="true" className="absolute inset-0" />
    </Link>
    <div className="relative flex h-full flex-col justify-between gap-6">
      <div>
        <p className="font-medium font-mono text-[16px]">{title}</p>
        <p className="mt-3 text-[14px] text-muted-foreground leading-[1.4] sm:text-[16px]">
          {description}
        </p>
      </div>
      <div className="relative z-10">{children}</div>
    </div>
    <span className="pointer-events-none absolute top-0 right-0 overflow-hidden bg-muted p-2">
      <PlusIcon className="size-3.5 text-muted-foreground transition-all duration-200 group-hover:scale-0 group-hover:opacity-0" />
      <ArrowUpRightIcon className="absolute top-2 right-2 size-3.5 -translate-x-[6px] translate-y-[6px] scale-0 text-muted-foreground opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100" />
    </span>
  </div>
);

export const IntegrationsSection = () => (
  <div
    className="grid lg:grid-cols-3 lg:grid-rows-[1fr_1fr]"
    style={{ fontFamily: "var(--font-sans)" }}
  >
    <div className="flex flex-col gap-4 border-b p-8 sm:p-10 lg:row-span-2 lg:border-r lg:border-b-0">
      <h2 className="font-semibold text-[16px] leading-[1.2] tracking-tight sm:text-[24px]">
        Scale with confidence
      </h2>
      <p className="text-[16px] text-muted-foreground leading-[1.4]">
        Plug Chat SDK into an entire ecosystem designed for AI-native chat
        experiences that scale.
      </p>
    </div>
    <IntegrationCard
      className="border-b lg:border-r"
      description={integrations[0].description}
      href={integrations[0].href}
      title={integrations[0].title}
    >
      <Snippet text={integrations[0].pkg} />
    </IntegrationCard>
    <IntegrationCard
      className="border-b"
      description={integrations[1].description}
      href={integrations[1].href}
      title={integrations[1].title}
    >
      <Snippet text={integrations[1].pkg} />
    </IntegrationCard>
    <IntegrationCard
      className="border-b lg:border-r lg:border-b-0"
      description={integrations[2].description}
      href={integrations[2].href}
      title={integrations[2].title}
    >
      <Snippet text={integrations[2].pkg} />
    </IntegrationCard>
    <IntegrationCard
      description={integrations[3].description}
      href={integrations[3].href}
      title={integrations[3].title}
    >
      <Snippet text={integrations[3].pkg} />
    </IntegrationCard>
  </div>
);
