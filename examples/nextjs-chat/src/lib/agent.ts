import { anthropic } from "@ai-sdk/anthropic";
import { ToolLoopAgent } from "ai";

export const agent = new ToolLoopAgent({
  model: "anthropic/claude-opus-4.5",
  instructions:
    "You are a helpful assistant. Answer questions concisely and to the point.",
  tools: { webSearch: anthropic.tools.webSearch_20260209({ maxUses: 3 }) },
});
