"use client";

import { useChat } from "@chat-adapter/web/react";
import { type FormEvent, useState } from "react";

export default function ChatPage() {
  const { messages, sendMessage, status, stop, error } = useChat();
  const [input, setInput] = useState("");

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = input.trim();
    if (!text) {
      return;
    }
    sendMessage({ text });
    setInput("");
  };

  const busy = status === "submitted" || status === "streaming";

  return (
    <main
      style={{
        padding: "2rem",
        maxWidth: 720,
        margin: "0 auto",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ marginTop: 0 }}>Chat SDK — Web Demo</h1>
      <p style={{ color: "#555" }}>
        Talk to the same bot that powers the Slack/Teams/etc. webhooks. The
        message goes through <code>bot.onDirectMessage(...)</code> on the
        server.
      </p>

      <div
        aria-live="polite"
        style={{
          border: "1px solid #ddd",
          borderRadius: 8,
          padding: "1rem",
          marginBottom: "1rem",
          minHeight: 240,
          background: "#fafafa",
        }}
      >
        {messages.length === 0 ? (
          <p style={{ color: "#888", margin: 0 }}>
            Send a message to get started.
          </p>
        ) : (
          messages.map((message) => {
            const text = message.parts
              .filter((part) => part.type === "text")
              .map((part) => (part as { text: string }).text)
              .join("");
            const isUser = message.role === "user";
            return (
              <div
                key={message.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: isUser ? "flex-end" : "flex-start",
                  marginBottom: "0.75rem",
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    color: "#888",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  {message.role}
                </span>
                <div
                  style={{
                    background: isUser ? "#0070f3" : "#fff",
                    color: isUser ? "#fff" : "#222",
                    padding: "0.5rem 0.75rem",
                    borderRadius: 8,
                    border: isUser ? "none" : "1px solid #e5e5e5",
                    whiteSpace: "pre-wrap",
                    maxWidth: "80%",
                  }}
                >
                  {text || "…"}
                </div>
              </div>
            );
          })
        )}
      </div>

      {error && (
        <div
          style={{
            padding: "0.5rem 0.75rem",
            marginBottom: "0.75rem",
            borderRadius: 8,
            background: "#fef2f2",
            color: "#991b1b",
            border: "1px solid #fecaca",
            fontSize: 14,
          }}
        >
          {error.message}
        </div>
      )}

      <form
        onSubmit={onSubmit}
        style={{ display: "flex", gap: "0.5rem", alignItems: "stretch" }}
      >
        <input
          aria-label="Message"
          disabled={busy}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Type a message…"
          style={{
            flex: 1,
            padding: "0.5rem 0.75rem",
            borderRadius: 8,
            border: "1px solid #ccc",
            fontSize: 14,
          }}
          value={input}
        />
        {busy ? (
          <button
            onClick={() => stop()}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: 8,
              border: "1px solid #ccc",
              background: "#fff",
              cursor: "pointer",
            }}
            type="button"
          >
            Stop
          </button>
        ) : (
          <button
            disabled={!input.trim()}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: 8,
              border: "none",
              background: "#0070f3",
              color: "#fff",
              cursor: "pointer",
              opacity: input.trim() ? 1 : 0.5,
            }}
            type="submit"
          >
            Send
          </button>
        )}
      </form>
      <p style={{ color: "#888", fontSize: 12, marginTop: "0.5rem" }}>
        Status: {status}
      </p>
    </main>
  );
}
