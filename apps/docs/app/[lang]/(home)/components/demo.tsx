import { SiTypescript } from "@icons-pack/react-simple-icons";
import type { CSSProperties } from "react";
import { codeToTokens } from "shiki";
import { cn } from "@/lib/utils";
import { DemoClient, type SerializedHandler } from "./demo-client";

const HANDLER_CODE = [
  {
    key: "onNewMention" as const,
    code: `bot.onNewMention(async (thread) => {
  await thread.subscribe();
  await thread.post("Sure! Here's a quick summary...");
});`,
  },
  {
    key: "onReaction" as const,
    code: `bot.onReaction(async (thread, reaction) => {
  await thread.post(\`Thanks for the \${reaction.emoji}!\`);
});`,
  },
  {
    key: "onSubscribedMessage" as const,
    code: `bot.onSubscribedMessage(async (thread, msg) => {
  await thread.post("Checking now...");
});`,
  },
];

const fullCode = HANDLER_CODE.map((h) => h.code).join("\n\n");

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

export const Demo = async () => {
  const { tokens: allTokens, rootStyle } = await codeToTokens(fullCode, {
    lang: "tsx",
    themes: {
      light: "github-light",
      dark: "github-dark",
    },
    defaultColor: false,
  });

  const preStyle: Record<string, string> = {};
  if (rootStyle) {
    Object.assign(preStyle, parseRootStyle(rootStyle));
  }

  // Split tokens into handler blocks by finding blank lines between them
  const handlers: SerializedHandler[] = [];
  let currentLines: typeof allTokens = [];
  let handlerIdx = 0;

  for (const line of allTokens) {
    const isBlank =
      line.length === 0 ||
      (line.length === 1 && line[0].content.trim() === "");

    if (isBlank && currentLines.length > 0) {
      const def = HANDLER_CODE[handlerIdx];
      if (def) {
        handlers.push({
          key: def.key,
          lines: currentLines.map((line) =>
            line.map((token) => ({
              content: token.content,
              htmlStyle: token.htmlStyle as
                | Record<string, string>
                | undefined,
            }))
          ),
        });
        handlerIdx++;
        currentLines = [];
      }
    } else {
      currentLines.push(line);
    }
  }

  // Push the last handler
  if (currentLines.length > 0 && handlerIdx < HANDLER_CODE.length) {
    const def = HANDLER_CODE[handlerIdx];
    if (def) {
      handlers.push({
        key: def.key,
        lines: currentLines.map((line) =>
          line.map((token) => ({
            content: token.content,
            htmlStyle: token.htmlStyle as
              | Record<string, string>
              | undefined,
          }))
        ),
      });
    }
  }

  return (
    <DemoClient
      codeHeader={
        <div className="flex items-center gap-2 border-b bg-sidebar py-2.5 pr-1.5 pl-4 text-muted-foreground">
          <SiTypescript className="size-4" />
          <span className="flex-1 font-mono font-normal text-sm tracking-tight">
            bot.ts
          </span>
        </div>
      }
      codeStyle={
        {
          "--sdm-bg": "#fff",
          ...preStyle,
        } as CSSProperties
      }
      handlers={handlers}
    />
  );
};
