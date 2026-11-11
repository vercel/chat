"use client";

import { createContext, type ReactNode, useContext } from "react";
import { cn } from "@/lib/utils";
import {
  BOT_NAME,
  CARD,
  type CardAction,
  type PlatformSlug,
  QUESTION,
} from "../data/hero-demo";

export interface PreviewState {
  /** The button the reader clicked, if any. */
  action: CardAction | null;
  onAction: (action: CardAction) => void;
  /** The reply text revealed so far. */
  reply: string;
  /** True while the bot is working on a reply that hasn't appeared yet. */
  typing: boolean;
}

export const PreviewContext = createContext<PreviewState>({
  action: null,
  onAction: () => undefined,
  reply: "",
  typing: false,
});

const ActionButton = ({
  action,
  className,
  filled = false,
}: {
  action: CardAction;
  className?: string;
  filled?: boolean;
}) => {
  const state = useContext(PreviewContext);
  const isChosen = state.action === action;
  return (
    <button
      className={cn(
        "inline-flex h-7 cursor-pointer items-center justify-center rounded-md px-3 font-medium text-label-13 outline-none transition-[opacity,box-shadow,background-color] focus-visible:ring-2 focus-visible:ring-blue-700 disabled:cursor-default",
        filled
          ? "bg-gray-1000 text-background-100 hover:opacity-90"
          : "bg-background-100 text-gray-1000 shadow-[0_0_0_1px_var(--ds-gray-alpha-400)] hover:bg-gray-100",
        state.action && !isChosen && "opacity-40",
        className
      )}
      disabled={state.action !== null}
      onClick={() => state.onAction(action)}
      type="button"
    >
      {action === "approve" ? CARD.primary : CARD.secondary}
    </button>
  );
};

const Mention = () => (
  <span className="rounded-[4px] bg-blue-200 px-1 font-medium text-blue-900">
    @{BOT_NAME}
  </span>
);

const Avatar = ({
  bot = false,
  square = false,
}: {
  bot?: boolean;
  square?: boolean;
}) => (
  <span
    className={cn(
      "flex size-7 shrink-0 items-center justify-center font-medium text-label-12",
      square ? "rounded-md" : "rounded-full",
      bot ? "bg-gray-1000 text-background-100" : "bg-gray-200 text-gray-1000"
    )}
  >
    {bot ? "D" : "A"}
  </span>
);

const Row = ({
  bot = false,
  children,
  square = false,
  tag,
}: {
  bot?: boolean;
  children: ReactNode;
  square?: boolean;
  tag?: string;
}) => (
  <div className="flex items-start gap-2.5">
    <Avatar bot={bot} square={square} />
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5">
        <span className="font-medium text-gray-1000 text-label-13">
          {bot ? BOT_NAME : "Alice"}
        </span>
        {tag ? (
          <span className="rounded-[4px] bg-gray-200 px-1 py-px font-medium text-[10px] text-gray-900 uppercase leading-none tracking-wide">
            {tag}
          </span>
        ) : null}
        <span className="text-gray-900 text-label-12">9:41 AM</span>
      </div>
      <div className="mt-0.5 text-pretty text-copy-13 text-gray-1000">
        {children}
      </div>
    </div>
  </div>
);

const MentionRow = ({ square = false }: { square?: boolean }) => (
  <Row square={square}>
    <Mention /> {QUESTION}
  </Row>
);

const TypingDots = () => (
  <span aria-label="Typing" className="inline-flex gap-1 py-1.5" role="img">
    {[0, 150, 300].map((delay) => (
      <span
        className="size-1.5 animate-pulse rounded-full bg-gray-700"
        key={delay}
        style={{ animationDelay: `${delay}ms` }}
      />
    ))}
  </span>
);

const ReplyText = () => {
  const { reply, typing } = useContext(PreviewContext);
  return typing && !reply ? <TypingDots /> : <p>{reply}</p>;
};

/** The bot's reply to a button click, as a chat row. */
const ReplyRow = ({
  square = false,
  tag,
}: {
  square?: boolean;
  tag?: string;
}) => {
  const { action } = useContext(PreviewContext);
  return action ? (
    <div aria-live="polite">
      <Row bot square={square} tag={tag}>
        <ReplyText />
      </Row>
    </div>
  ) : null;
};

const Bubble = ({
  children,
  className,
  outgoing = false,
}: {
  children: ReactNode;
  className?: string;
  outgoing?: boolean;
}) => (
  <div
    className={cn(
      "max-w-[85%] text-pretty rounded-xl px-3 py-2 text-copy-13",
      outgoing
        ? "self-end rounded-br-sm bg-gray-1000 text-background-100"
        : "rounded-bl-sm bg-gray-100 text-gray-1000",
      className
    )}
  >
    {children}
  </div>
);

/** The bot's reply to a button click, as a chat bubble. */
const ReplyBubble = () => {
  const { action } = useContext(PreviewContext);
  return action ? (
    <div aria-live="polite" className="flex">
      <Bubble>
        <ReplyText />
      </Bubble>
    </div>
  ) : null;
};

// Block Kit: header block, section text, and an actions block.
const SlackPreview = () => (
  <>
    <MentionRow square />
    <Row bot square tag="App">
      <p className="mt-1 font-semibold text-copy-14">{CARD.title}</p>
      <p className="mt-1 text-gray-900">{CARD.text}</p>
      <div className="mt-2.5 flex gap-2">
        <ActionButton action="approve" filled />
        <ActionButton action="cancel" />
      </div>
    </Row>
    <ReplyRow square tag="App" />
  </>
);

// Adaptive Card: a framed card with equal-width actions.
const TeamsPreview = () => (
  <>
    <MentionRow />
    <Row bot>
      <div className="mt-1.5 rounded-lg p-3 shadow-[0_0_0_1px_var(--ds-gray-alpha-400)]">
        <p className="font-semibold text-copy-14">{CARD.title}</p>
        <p className="mt-1 text-gray-900">{CARD.text}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <ActionButton action="approve" filled />
          <ActionButton action="cancel" />
        </div>
      </div>
    </Row>
    <ReplyRow />
  </>
);

// Google Chat card: header, divider, text paragraph, and a button list.
// Buttons without a style render as text buttons.
const GoogleChatPreview = () => (
  <>
    <MentionRow />
    <Row bot tag="App">
      <div className="mt-1.5 overflow-hidden rounded-xl shadow-[0_0_0_1px_var(--ds-gray-alpha-400)]">
        <p className="px-3 pt-3 pb-2.5 font-medium text-copy-14">
          {CARD.title}
        </p>
        <div className="border-gray-alpha-400 border-t px-3 pt-2.5 pb-3">
          <p className="text-gray-900">{CARD.text}</p>
          <div className="mt-2.5 flex gap-1">
            <ActionButton action="approve" className="rounded-full" filled />
            <ActionButton
              action="cancel"
              className="rounded-full bg-transparent shadow-none"
            />
          </div>
        </div>
      </div>
    </Row>
    <ReplyRow tag="App" />
  </>
);

// Discord: an embed with a color bar, then a row of button components.
const DiscordPreview = () => (
  <>
    <MentionRow />
    <Row bot tag="App">
      <div className="mt-1.5 flex overflow-hidden rounded-[4px] bg-gray-100">
        <span className="w-1 shrink-0 bg-gray-500" />
        <div className="px-3 py-2.5">
          <p className="font-semibold text-copy-14">{CARD.title}</p>
          <p className="mt-1 text-gray-900">{CARD.text}</p>
        </div>
      </div>
      <div className="mt-2 flex gap-2">
        <ActionButton action="approve" className="rounded-[4px]" filled />
        <ActionButton
          action="cancel"
          className="rounded-[4px] bg-gray-200 shadow-none"
        />
      </div>
    </Row>
    <ReplyRow tag="App" />
  </>
);

// WhatsApp has no mentions, so the question arrives as a DM. Cards become an
// interactive message: bold title in the body, reply buttons below. Reply
// buttons have no styles, so both look the same.
const WhatsAppPreview = () => (
  <>
    <Bubble outgoing>
      {QUESTION.charAt(0).toUpperCase()}
      {QUESTION.slice(1)}
    </Bubble>
    <div className="flex max-w-[85%] flex-col gap-1">
      <Bubble className="max-w-none">
        <p className="font-semibold">{CARD.title}</p>
        <p className="mt-0.5">{CARD.text}</p>
      </Bubble>
      <ActionButton action="approve" className="h-8 rounded-lg" />
      <ActionButton action="cancel" className="h-8 rounded-lg" />
    </div>
    <ReplyBubble />
  </>
);

// Telegram: MarkdownV2 text with an inline keyboard, which has no styles.
const TelegramPreview = () => (
  <>
    <Bubble outgoing>
      @{BOT_NAME} {QUESTION}
    </Bubble>
    <div className="flex max-w-[85%] flex-col gap-1">
      <Bubble className="max-w-none">
        <p className="font-semibold">{CARD.title}</p>
        <p className="mt-0.5">{CARD.text}</p>
      </Bubble>
      <div className="grid grid-cols-2 gap-1">
        <ActionButton
          action="approve"
          className="rounded-lg bg-gray-200 shadow-none"
        />
        <ActionButton
          action="cancel"
          className="rounded-lg bg-gray-200 shadow-none"
        />
      </div>
    </div>
    <ReplyBubble />
  </>
);

export const PLATFORM_PREVIEWS: Record<PlatformSlug, () => ReactNode> = {
  slack: SlackPreview,
  teams: TeamsPreview,
  gchat: GoogleChatPreview,
  discord: DiscordPreview,
  whatsapp: WhatsAppPreview,
  telegram: TelegramPreview,
};
