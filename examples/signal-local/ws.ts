/**
 * WebSocket helper for signal-cli-rest-api json-rpc mode.
 *
 * Connects to ws://<host>/v1/receive/<number> and feeds incoming
 * JSON-RPC messages through the adapter's handleWebhook method.
 */
import type { SignalAdapter } from "@chat-adapter/signal";

export function connectSignalWebSocket(
  signal: SignalAdapter,
  serviceUrl: string,
  phoneNumber: string
): { close: () => void } {
  const wsUrl = serviceUrl
    .replace(/^http:/, "ws:")
    .replace(/^https:/, "wss:")
    .replace(/\/+$/, "");

  const endpoint = `${wsUrl}/v1/receive/${encodeURIComponent(phoneNumber)}`;
  console.log(`🔌 Connecting WebSocket: ${endpoint}`);

  const ws = new WebSocket(endpoint);

  ws.addEventListener("open", () => {
    console.log("🟢 WebSocket connected\n");
  });

  ws.addEventListener("message", (event) => {
    const body = typeof event.data === "string" ? event.data : String(event.data);

    // Feed the JSON-RPC message through handleWebhook as a synthetic Request
    const request = new Request("http://localhost/ws-receive", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    signal.handleWebhook(request).catch((err) => {
      console.error("⚠️  handleWebhook error:", (err as Error).message);
    });
  });

  ws.addEventListener("error", (event) => {
    console.error("🔴 WebSocket error:", event);
  });

  ws.addEventListener("close", (event) => {
    console.log(`🔴 WebSocket closed (code=${event.code}, reason=${event.reason})`);
  });

  return {
    close: () => ws.close(),
  };
}
