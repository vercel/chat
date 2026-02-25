"use client";

import { AnimatePresence, motion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { HashIcon } from "lucide-react";

type ChatMessage = {
  id: string;
  author: string;
  initials: string;
  color: string;
  text: string;
};

type ReactionTarget = string | null;
type ActiveHandler =
  | "onNewMention"
  | "onReaction"
  | "onSubscribedMessage"
  | null;

type SerializedToken = {
  content: string;
  htmlStyle?: Record<string, string>;
};

export type SerializedHandler = {
  key: "onNewMention" | "onReaction" | "onSubscribedMessage";
  lines: SerializedToken[][];
};

const MESSAGES: ChatMessage[] = [
  {
    id: "m1",
    author: "Alice",
    initials: "A",
    color: "bg-violet-500",
    text: "Has anyone tried the new API?",
  },
  {
    id: "m2",
    author: "Bob",
    initials: "B",
    color: "bg-blue-500",
    text: "Yeah, docs look great",
  },
  {
    id: "m3",
    author: "Alice",
    initials: "A",
    color: "bg-violet-500",
    text: "@ChatBot summarize this thread",
  },
  {
    id: "m4",
    author: "ChatBot",
    initials: "CB",
    color: "bg-emerald-500",
    text: "Sure! Here's a quick summary...",
  },
  {
    id: "m5",
    author: "ChatBot",
    initials: "CB",
    color: "bg-emerald-500",
    text: "Thanks for the 👍!",
  },
  {
    id: "m6",
    author: "Bob",
    initials: "B",
    color: "bg-blue-500",
    text: "Can you check for updates too?",
  },
  {
    id: "m7",
    author: "ChatBot",
    initials: "CB",
    color: "bg-emerald-500",
    text: "Checking now...",
  },
  {
    id: "m8",
    author: "Alice",
    initials: "A",
    color: "bg-violet-500",
    text: "Thanks, that's super helpful!",
  },
  {
    id: "m9",
    author: "Bob",
    initials: "B",
    color: "bg-blue-500",
    text: "Agreed, nice work 🎉",
  },
];

type TimelineEntry = {
  delay: number;
  visibleCount: number;
  reaction: ReactionTarget;
  handler: ActiveHandler;
};

const TIMELINE: TimelineEntry[] = [
  { delay: 0, visibleCount: 0, reaction: null, handler: null },
  { delay: 800, visibleCount: 1, reaction: null, handler: null },
  { delay: 1200, visibleCount: 2, reaction: null, handler: null },
  {
    delay: 1400,
    visibleCount: 3,
    reaction: null,
    handler: "onNewMention",
  },
  { delay: 1800, visibleCount: 4, reaction: null, handler: null },
  { delay: 1600, visibleCount: 4, reaction: "m4", handler: "onReaction" },
  { delay: 1800, visibleCount: 5, reaction: "m4", handler: null },
  {
    delay: 2000,
    visibleCount: 6,
    reaction: "m4",
    handler: "onSubscribedMessage",
  },
  { delay: 1800, visibleCount: 7, reaction: "m4", handler: null },
  { delay: 1200, visibleCount: 8, reaction: "m4", handler: null },
  { delay: 1200, visibleCount: 9, reaction: "m4", handler: null },
  { delay: 3000, visibleCount: 0, reaction: null, handler: null },
];


const ReactionBadge = () => (
  <motion.span
    animate={{ opacity: 1, scale: 1 }}
    className="mt-1 ml-10.5 inline-flex items-center gap-1 rounded-full border bg-muted px-1.5 py-0.5 text-xs"
    exit={{ opacity: 0, scale: 0.8 }}
    initial={{ opacity: 0, scale: 0.8 }}
    layout
    transition={{ type: "spring", stiffness: 380, damping: 28 }}
  >
    👍 1
  </motion.span>
);

const TokenSpan = ({ token }: { token: SerializedToken }) => {
  const tokenStyle: Record<string, string> = {};

  if (token.htmlStyle) {
    for (const [key, value] of Object.entries(token.htmlStyle)) {
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
      style={tokenStyle as CSSProperties}
    >
      {token.content}
    </span>
  );
};

const HandlerBlock = ({
  handler,
  isActive,
}: {
  handler: SerializedHandler;
  isActive: boolean;
}) => (
  <div className="relative">
    <AnimatePresence>
      {isActive && (
        <motion.div
          animate={{ opacity: 1 }}
          className="absolute inset-0 border-primary border-l-2 bg-primary/10"
          exit={{ opacity: 0 }}
          initial={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        />
      )}
    </AnimatePresence>
    <code className="relative grid min-w-max">
      {handler.lines.map((line, lineIndex) => (
        <span
          className="line px-4"
          // biome-ignore lint/suspicious/noArrayIndexKey: static token array from shiki
          key={lineIndex}
        >
          {line.length > 0
            ? line.map((token, tokenIndex) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static token array from shiki
                <TokenSpan key={tokenIndex} token={token} />
              ))
            : "\n"}
        </span>
      ))}
    </code>
  </div>
);

const ChatPanel = ({
  visibleCount,
  reaction,
}: {
  visibleCount: number;
  reaction: ReactionTarget;
}) => (
  <div className="flex h-[300px] flex-col overflow-hidden rounded-sm border bg-background">
    <div className="flex items-center gap-2 border-b bg-sidebar py-2.5 pl-4 text-muted-foreground">
      <div className="font-normal flex items-center gap-2 text-muted-foreground text-sm">
        <HashIcon className="size-4" /> <span>general</span>
      </div>
    </div>
    <div className="flex min-h-0 flex-1 flex-col justify-end gap-3 overflow-hidden p-3">
      <AnimatePresence initial={false}>
        {MESSAGES.slice(0, visibleCount).map((msg) => (
          <motion.div
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2, ease: "easeIn" } }}
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            key={msg.id}
            layout
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
          >
            <div className="flex items-start gap-2.5">
              <div
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-md font-semibold text-white text-xs",
                  msg.color
                )}
              >
                {msg.initials}
              </div>
              <div className="min-w-0">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-semibold text-foreground text-sm">
                    {msg.author}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    12:00 PM
                  </span>
                </div>
                <p className="text-foreground text-sm">
                  {msg.text.split(/(@ChatBot)/g).map((part) =>
                    part === "@ChatBot" ? (
                      <span
                        className="rounded bg-primary/15 px-0.5 font-medium text-primary"
                        key={part}
                      >
                        @ChatBot
                      </span>
                    ) : (
                      part
                    )
                  )}
                </p>
              </div>
            </div>
            <AnimatePresence>
              {reaction === msg.id && <ReactionBadge />}
            </AnimatePresence>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  </div>
);

const CodePanel = ({
  activeHandler,
  handlers,
  header,
  style,
}: {
  activeHandler: ActiveHandler;
  handlers: SerializedHandler[];
  header: ReactNode;
  style: CSSProperties;
}) => (
  <div className="not-prose flex h-full flex-col overflow-hidden rounded-sm border">
    {header}
    <pre
      className="flex-1 overflow-x-auto bg-background py-3 text-sm"
      style={style}
    >
      <div className="min-w-max space-y-3">
        {handlers.map((handler) => (
          <HandlerBlock
            handler={handler}
            isActive={activeHandler === handler.key}
            key={handler.key}
          />
        ))}
      </div>
    </pre>
  </div>
);

const LAST_STEP = TIMELINE.length - 2;

export const DemoClient = ({
  handlers,
  codeHeader,
  codeStyle,
}: {
  handlers: SerializedHandler[];
  codeHeader: ReactNode;
  codeStyle: CSSProperties;
}) => {
  const [step, setStep] = useState(0);
  const isMobile = useIsMobile();
  const containerRef = useRef<HTMLDivElement>(null);
  const isVisibleRef = useRef(true);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimeouts = useCallback(() => {
    for (const t of timeoutsRef.current) {
      clearTimeout(t);
    }
    timeoutsRef.current = [];
  }, []);

  const run = useCallback(() => {
    clearTimeouts();

    const lastIdx = isMobile ? LAST_STEP : TIMELINE.length - 1;

    let elapsed = 0;
    for (let i = 0; i <= lastIdx; i++) {
      elapsed += TIMELINE[i].delay;
      const idx = i;
      timeoutsRef.current.push(
        setTimeout(() => {
          if (!isVisibleRef.current) {
            return;
          }

          if (!isMobile && idx === TIMELINE.length - 1) {
            setStep(0);
            timeoutsRef.current.push(
              setTimeout(() => {
                if (isVisibleRef.current) {
                  run();
                }
              }, TIMELINE[idx].delay)
            );
          } else {
            setStep(idx);
          }
        }, elapsed)
      );
    }
  }, [clearTimeouts, isMobile]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        const wasVisible = isVisibleRef.current;
        isVisibleRef.current = entry.isIntersecting;

        if (entry.isIntersecting && !wasVisible) {
          setStep(0);
          run();
        } else if (!entry.isIntersecting && wasVisible) {
          clearTimeouts();
        }
      },
      { threshold: 0.3 }
    );

    observer.observe(el);
    run();

    return () => {
      observer.disconnect();
      clearTimeouts();
    };
  }, [run, clearTimeouts]);

  const current = TIMELINE[step];

  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:h-[300px]" ref={containerRef}>
      <ChatPanel
        reaction={current.reaction}
        visibleCount={current.visibleCount}
      />
      <CodePanel
        activeHandler={current.handler}
        handlers={handlers}
        header={codeHeader}
        style={codeStyle}
      />
    </div>
  );
};
