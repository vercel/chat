"use client";

import { useChat } from "@chat-adapter/web/react";
import { type FormEvent, useEffect, useRef, useState } from "react";

export default function ChatPage() {
  const { messages, sendMessage, status, stop, error } = useChat();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const busy = status === "submitted" || status === "streaming";

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new messages and status changes
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, status]);

  const onSubmit = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const text = input.trim();
    if (!text || busy) {
      return;
    }
    sendMessage({ text });
    setInput("");
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }
  };

  return (
    <main className="mx-auto flex h-screen max-w-2xl flex-col px-4">
      <div
        aria-live="polite"
        className="hide-scrollbar flex-1 space-y-5 overflow-y-auto pt-12 pb-4"
        ref={scrollRef}
      >
        {messages.length === 0 && !busy ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              What can I help you with?
            </p>
          </div>
        ) : (
          <>
            {messages.map((message) => {
              const text = message.parts
                .filter((part) => part.type === "text")
                .map((part) => (part as { text: string }).text)
                .join("");
              const isUser = message.role === "user";
              const isLastAssistant = !isUser && message === messages.at(-1);
              const isStreaming = isLastAssistant && status === "streaming";

              return (
                <div key={message.id}>
                  {isUser ? (
                    <div
                      className="rounded-lg px-3.5 py-3 text-sm"
                      style={{ background: "var(--muted)", opacity: 0.8 }}
                    >
                      {text}
                    </div>
                  ) : (
                    <div
                      className="whitespace-pre-wrap py-2 text-sm leading-relaxed"
                      style={{ color: "var(--foreground)" }}
                    >
                      {text}
                      {isStreaming && !text && (
                        <span
                          className="inline-block h-4 w-0.5"
                          style={{
                            background: "var(--muted-foreground)",
                            animation: "blink 1s ease-in-out infinite",
                          }}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {status === "submitted" && (
              <div
                className="py-2 text-sm"
                style={{
                  color: "var(--muted-foreground)",
                  animation: "breathe 2s ease-in-out infinite",
                }}
              >
                Thinking...
              </div>
            )}
          </>
        )}
      </div>

      {error && (
        <div
          className="mb-3 rounded-lg px-3.5 py-2.5 text-sm"
          style={{
            background: "rgba(239, 68, 68, 0.08)",
            color: "#f87171",
            border: "1px solid rgba(239, 68, 68, 0.15)",
          }}
        >
          {error.message}
        </div>
      )}

      <div className="pt-2 pb-6">
        <form
          className="relative overflow-hidden rounded-xl"
          onSubmit={onSubmit}
          style={{
            background: "var(--muted)",
            border: "1px solid var(--border)",
          }}
        >
          <textarea
            aria-label="Message"
            className="w-full resize-none bg-transparent px-3.5 pt-3.5 pb-12 text-sm outline-none disabled:opacity-50"
            disabled={busy}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              messages.length === 0 ? "What can I help you with?" : "Reply..."
            }
            rows={1}
            style={{
              color: "var(--foreground)",
              minHeight: messages.length === 0 ? "120px" : "56px",
              maxHeight: "200px",
            }}
            value={input}
          />
          <div className="absolute right-3 bottom-3 flex items-center gap-2">
            {busy ? (
              <button
                className="rounded-lg px-3 py-1.5 text-xs transition-colors hover:opacity-80"
                onClick={() => stop()}
                style={{
                  background: "var(--border)",
                  color: "var(--muted-foreground)",
                }}
                type="button"
              >
                Stop
              </button>
            ) : (
              <button
                className="rounded-lg px-3 py-1.5 font-medium text-xs transition-opacity disabled:opacity-30"
                disabled={!input.trim()}
                style={{
                  background: "var(--foreground)",
                  color: "var(--background)",
                }}
                type="submit"
              >
                Send
              </button>
            )}
          </div>
        </form>
      </div>
    </main>
  );
}
