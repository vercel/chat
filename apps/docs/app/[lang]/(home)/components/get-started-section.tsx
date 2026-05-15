import DynamicLink from "fumadocs-core/dynamic-link";
import type { CSSProperties } from "react";
import { codeToTokens } from "shiki";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button";

const COMMAND = "npm i chat";

interface Template {
  code: string;
  description: string;
  link: string;
  title: string;
}

const parseRootStyle = (rootStyle: string): Record<string, string> => {
  const style: Record<string, string> = {};
  for (const decl of rootStyle.split(";")) {
    const idx = decl.indexOf(":");
    if (idx > 0) {
      const prop = decl.slice(0, idx).trim();
      const val = decl.slice(idx + 1).trim();
      if (prop && val) {
        style[prop] = val;
      }
    }
  }
  return style;
};

const CodePreview = async ({ code }: { code: string }) => {
  const { tokens, rootStyle } = await codeToTokens(code, {
    lang: "tsx",
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
  });

  const preStyle: Record<string, string> = {};
  if (rootStyle) {
    Object.assign(preStyle, parseRootStyle(rootStyle));
  }

  return (
    <pre
      className="overflow-hidden bg-background p-3 text-xs leading-relaxed"
      style={{ "--sdm-bg": "#fff", ...preStyle } as CSSProperties}
    >
      <code className="grid min-w-max">
        {tokens.map((line, lineIndex) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static token array from shiki
          <span className="line" key={lineIndex}>
            {line.length > 0
              ? line.map((token, tokenIndex) => {
                  const tokenStyle: Record<string, string> = {};
                  if (token.htmlStyle) {
                    for (const [key, value] of Object.entries(
                      token.htmlStyle
                    )) {
                      if (key === "color" || key === "--shiki-light") {
                        tokenStyle["--sdm-c"] = value;
                      } else if (
                        key === "background-color" ||
                        key === "--shiki-light-bg"
                      ) {
                        tokenStyle["--sdm-tbg"] = value;
                      } else {
                        tokenStyle[key] = value;
                      }
                    }
                  }
                  const hasBg = Boolean(tokenStyle["--sdm-tbg"]);
                  return (
                    <span
                      className={cn(
                        "text-[var(--sdm-c,inherit)]",
                        "dark:text-[var(--shiki-dark,var(--sdm-c,inherit))]",
                        hasBg && "bg-[var(--sdm-tbg)]",
                        hasBg && "dark:bg-[var(--shiki-dark-bg,var(--sdm-tbg))]"
                      )}
                      // biome-ignore lint/suspicious/noArrayIndexKey: static token array from shiki
                      key={tokenIndex}
                      style={tokenStyle as CSSProperties}
                    >
                      {token.content}
                    </span>
                  );
                })
              : "\n"}
          </span>
        ))}
      </code>
    </pre>
  );
};

export const GetStartedSection = ({ data }: { data: Template[] }) => (
  <div>
    <div className="flex flex-col gap-6 px-6 py-12 sm:px-10 sm:py-14 lg:flex-row lg:items-start lg:justify-between lg:gap-12">
      <div
        className="flex flex-col gap-4"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        <h2 className="font-semibold text-[24px] leading-[1.1] tracking-tight sm:text-[32px] md:text-[40px]">
          Build with Chat SDK today
        </h2>
        <p className="max-w-sm text-[18px] text-muted-foreground leading-[1.4]">
          Get started by exploring the docs, following a guide, or using a
          template.
        </p>
      </div>
      <div className="flex flex-col items-stretch gap-3 sm:shrink-0 sm:flex-row sm:items-center">
        <Button asChild className="h-[42px] rounded-full px-5" size="default">
          <DynamicLink href="/[lang]/docs">Visit Documentation</DynamicLink>
        </Button>
        <div className="relative flex h-[42px] items-center rounded-full border bg-background pr-12 pl-4 font-mono text-[13px] leading-5 [&_button]:absolute [&_button]:top-1/2 [&_button]:right-1 [&_button]:size-8 [&_button]:-translate-y-1/2 [&_button]:rounded-full [&_svg]:size-4">
          <span className="select-none text-muted-foreground">$&nbsp;</span>
          <span>{COMMAND}</span>
          <CopyButton code={COMMAND} />
        </div>
      </div>
    </div>
    <div className="grid gap-6 border-t px-6 py-10 sm:px-10 sm:py-12 md:grid-cols-3">
      {data.map((item) => (
        <a
          className="group flex flex-col overflow-hidden rounded-lg border bg-background p-4 transition-colors hover:bg-muted/40"
          href={item.link}
          key={item.title}
        >
          <h3 className="font-semibold tracking-tight">{item.title}</h3>
          <p className="mt-1 line-clamp-2 text-muted-foreground text-sm">
            {item.description}
          </p>
          <div
            className={cn(
              "mt-4 -mr-8 -mb-8 ml-4 aspect-video -rotate-3 overflow-hidden rounded-md border",
              "transition-transform duration-300 group-hover:-rotate-1 group-hover:scale-105"
            )}
          >
            <CodePreview code={item.code} />
          </div>
        </a>
      ))}
    </div>
  </div>
);
