import DynamicLink from "fumadocs-core/dynamic-link";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { discord, gchat, slack, teams, whatsapp } from "@/lib/logos";
import { CodeShowcase } from "./code-showcase";

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

export const CodeSection = () => (
  <div className="grid grid-cols-12 gap-x-8 gap-y-10 py-10 lg:gap-x-12 lg:py-12">
    {/* Sidebar sits left of the code from lg, but follows it in the DOM, so
        both are pinned with col-start on the same row. */}
    <div className="@container col-span-12 lg:col-span-8 lg:col-start-7 lg:row-start-1">
      <CodeShowcase />
    </div>
    <div className="col-span-12 lg:col-span-4 lg:col-start-1 lg:row-start-1">
      <div className="flex flex-col gap-10">
        <div className="flex flex-col gap-3">
          <h2 className="text-heading-20 sm:text-heading-24 md:text-heading-32">
            Chat SDK Core
          </h2>
          <p className="text-balance text-copy-16 text-gray-900">
            A unified API for building event-driven chat bots. Listen for
            mentions, subscribe to threads, and post rich cards across multiple
            platforms.
          </p>
        </div>
        <Button asChild className="w-fit rounded-full" size="lg">
          <DynamicLink href="/[lang]/docs">Visit Documentation</DynamicLink>
        </Button>
        <div className="flex flex-col gap-3">
          <p className="text-copy-16 text-gray-900">Supports</p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
            <div className="flex items-center -space-x-3">
              {supported.map((item) => (
                <div
                  aria-label={item.name}
                  className="flex size-12 items-center justify-center rounded-full border bg-background shadow-sm"
                  key={item.name}
                  role="img"
                >
                  <item.icon className="size-5" />
                </div>
              ))}
            </div>
            <span className="text-copy-16 text-gray-900">
              +{" "}
              <DynamicLink
                className="whitespace-nowrap hover:underline hover:underline-offset-4"
                href="/[lang]/adapters"
              >
                more adapters
              </DynamicLink>
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
);
