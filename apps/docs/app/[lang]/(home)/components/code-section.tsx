import DynamicLink from "fumadocs-core/dynamic-link";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { discord, gchat, slack, teams, whatsapp } from "@/lib/logos";

const supported: {
  icon: (props: ComponentProps<"svg">) => React.JSX.Element;
  name: string;
}[] = [
  { icon: slack, name: "Slack" },
  { icon: teams, name: "Teams" },
  { icon: gchat, name: "Google Chat" },
  { icon: discord, name: "Discord" },
  { icon: whatsapp, name: "WhatsApp" },
];

export const CodeSection = ({ children }: { children: ReactNode }) => (
  <div
    className="grid items-start gap-12 px-6 py-14 sm:px-10 sm:py-16 lg:grid-cols-3 lg:gap-16"
    style={{ fontFamily: "var(--font-sans)" }}
  >
    <div className="flex flex-col gap-10 lg:order-2 lg:col-span-2">
      {children}
    </div>
    <div className="flex flex-col gap-8 lg:order-1">
      <div className="flex flex-col gap-3">
        <h2 className="font-semibold text-[24px] leading-[1.1] tracking-tight sm:text-[32px]">
          Chat SDK Core
        </h2>
        <p className="text-balance text-[16px] text-muted-foreground leading-[1.4]">
          A unified API for building event-driven chat bots. Listen for
          mentions, subscribe to threads, and post rich cards across multiple
          platforms.
        </p>
      </div>
      <Button asChild className="w-fit rounded-full" size="lg">
        <DynamicLink href="/[lang]/docs">Visit Documentation</DynamicLink>
      </Button>
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">Supports</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
          <div className="flex items-center -space-x-3">
            {supported.map((item) => (
              <div
                aria-label={item.name}
                className="flex size-10 items-center justify-center rounded-full border bg-background shadow-sm"
                key={item.name}
                role="img"
              >
                <item.icon className="size-4" />
              </div>
            ))}
          </div>
          <span className="font-mono text-muted-foreground text-sm">
            +{" "}
            <DynamicLink
              className="whitespace-nowrap text-foreground hover:underline hover:underline-offset-4"
              href="/[lang]/adapters"
            >
              more adapters
            </DynamicLink>
          </span>
        </div>
      </div>
    </div>
  </div>
);
