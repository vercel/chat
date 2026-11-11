"use client";

import { IconArrowUpRightSmall } from "@vercel/geistdocs/assets/icons/icon-arrow-up-right-small";
import { LogoIconMicrosoftTeamsSvg as teams } from "@vercel/geistdocs/assets/logos/logo-icon-microsoft-teams-svg";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import Link from "next/link";
import { type ComponentProps, useEffect, useState } from "react";
import type { ThemedToken } from "shiki";
import { discord, gchat, slack, telegram, whatsapp } from "@/lib/logos-mono";
import { cn } from "@/lib/utils";
import {
  CANCEL_REPLY,
  type CardAction,
  DEPLOY_CHUNKS,
  type PlatformSlug,
  type StreamMode,
} from "../data/hero-demo";
import { CodeWindow } from "./code-window";
import { PLATFORM_PREVIEWS, PreviewContext } from "./platform-previews";

const LOGOS: Record<
  PlatformSlug,
  (
    props: Pick<ComponentProps<"svg">, "aria-hidden" | "className">
  ) => React.JSX.Element
> = { slack, teams, gchat, discord, whatsapp, telegram };

interface Platform {
  name: string;
  slug: PlatformSlug;
  stream: StreamMode;
}

const DEPLOY_REPLY = DEPLOY_CHUNKS.join(" ");
const WORD_PATTERN = /(\s+)/;

/**
 * Schedules the reply to a button click the way the platform delivers it:
 * word by word for native streaming, a chunk per edit for Post+Edit, and all
 * at once for buffered platforms. Cancel posts a plain string, not a stream.
 */
const scheduleReply = (
  action: CardAction,
  mode: StreamMode,
  setReply: (reply: string) => void,
  at: (ms: number, fn: () => void) => void
) => {
  if (action === "cancel") {
    at(400, () => setReply(CANCEL_REPLY));
    return;
  }
  if (mode === "buffered") {
    at(1800, () => setReply(DEPLOY_REPLY));
    return;
  }
  if (mode === "edit") {
    for (const index of DEPLOY_CHUNKS.keys()) {
      at(500 + index * 700, () =>
        setReply(DEPLOY_CHUNKS.slice(0, index + 1).join(" "))
      );
    }
    return;
  }
  const tokens = DEPLOY_REPLY.split(WORD_PATTERN);
  for (const index of tokens.keys()) {
    at(500 + index * 35, () => setReply(tokens.slice(0, index + 1).join("")));
  }
};

// The site's dark theme lifts background-100 to gray; scope it back to the
// page black so the panels sit flush with the page.
const PANEL_CLASS = "dark:[--ds-background-100:var(--ds-background-200)]";

const PlatformTabs = ({
  active,
  onSelect,
  platforms,
}: {
  active: PlatformSlug;
  onSelect: (slug: PlatformSlug) => void;
  platforms: Platform[];
}) => (
  <fieldset className="mx-auto flex min-w-0 flex-wrap items-center justify-center gap-1 border-0 p-0">
    <legend className="sr-only">Platform</legend>
    {platforms.map((platform) => {
      const Logo = LOGOS[platform.slug];
      const isActive = platform.slug === active;
      return (
        <button
          aria-label={platform.name}
          aria-pressed={isActive}
          className={cn(
            "relative flex items-center gap-2 rounded-md px-3 py-2 font-medium text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-700",
            isActive ? "text-gray-1000" : "text-gray-900 hover:text-gray-1000"
          )}
          key={platform.slug}
          onClick={() => onSelect(platform.slug)}
          type="button"
        >
          {isActive ? (
            <motion.span
              className="absolute inset-0 rounded-md border border-gray-400 bg-background-100 shadow-sm"
              layoutId="hero-platform-tab"
              transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
            />
          ) : null}
          <Logo aria-hidden="true" className="relative z-10 size-4" />
          <span className="relative z-10 max-lg:hidden">{platform.name}</span>
        </button>
      );
    })}
  </fieldset>
);

export const DemoClient = ({
  platforms,
  tokens,
}: {
  platforms: Platform[];
  tokens: ThemedToken[][];
}) => {
  const [active, setActive] = useState<PlatformSlug>(
    platforms[0]?.slug ?? "slack"
  );
  const [action, setAction] = useState<CardAction | null>(null);
  const [reply, setReply] = useState("");
  const [reduceMotion, setReduceMotion] = useState(false);
  const platform =
    platforms.find((item) => item.slug === active) ?? platforms[0];
  const mode = platform?.stream ?? "native";

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!action) {
      return;
    }
    if (reduceMotion) {
      setReply(action === "cancel" ? CANCEL_REPLY : DEPLOY_REPLY);
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    scheduleReply(action, mode, setReply, (ms, fn) => {
      timers.push(setTimeout(fn, ms));
    });
    return () => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
    };
  }, [action, mode, reduceMotion]);

  const reset = () => {
    setAction(null);
    setReply("");
  };

  const selectPlatform = (slug: PlatformSlug) => {
    setActive(slug);
    reset();
  };

  const finalReply = action === "cancel" ? CANCEL_REPLY : DEPLOY_REPLY;
  const isDone = action !== null && reply === finalReply;

  if (!platform) {
    return null;
  }

  const Preview = PLATFORM_PREVIEWS[platform.slug];

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex flex-col gap-4">
        <PlatformTabs
          active={platform.slug}
          onSelect={selectPlatform}
          platforms={platforms}
        />
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <CodeWindow
            className={PANEL_CLASS}
            codeClassName="h-[472px] [&_pre]:min-h-[472px]"
            filename="bot.tsx"
            tokens={tokens}
          />
          <section
            aria-label={`${platform.name} preview`}
            className={cn(
              PANEL_CLASS,
              "relative min-h-[440px] overflow-hidden rounded-lg border border-gray-200 bg-background-100 shadow-sm max-lg:order-first"
            )}
          >
            {/* Outgoing and incoming previews overlap and crossfade, so the
                panel is never empty mid-switch. */}
            <AnimatePresence initial={false}>
              <motion.div
                animate={{ opacity: 1, y: 0 }}
                className="absolute inset-x-0 top-0 flex flex-col gap-4 p-6"
                exit={{ opacity: 0 }}
                initial={{ opacity: 0, y: 4 }}
                key={platform.slug}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                <PreviewContext.Provider
                  value={{
                    action,
                    onAction: setAction,
                    reply,
                    typing: action !== null && !reply,
                  }}
                >
                  <Preview />
                </PreviewContext.Provider>
              </motion.div>
            </AnimatePresence>
            {isDone ? (
              <button
                className="absolute right-4 bottom-4 cursor-pointer rounded-md px-2 py-1 font-medium text-gray-900 text-label-12 outline-none transition-colors hover:text-gray-1000 focus-visible:ring-2 focus-visible:ring-blue-700"
                onClick={reset}
                type="button"
              >
                Reset
              </button>
            ) : null}
          </section>
        </div>
        <p className="mx-auto text-copy-14 text-gray-900">
          Same code on every platform.{" "}
          <Link
            className="inline-flex items-center font-medium text-gray-1000 hover:underline hover:underline-offset-4"
            href="/adapters"
            prefetch={true}
          >
            See all adapters
            <IconArrowUpRightSmall aria-hidden="true" />
          </Link>
        </p>
      </div>
    </MotionConfig>
  );
};
