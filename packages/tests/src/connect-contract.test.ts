import type { Adapter } from "chat";
import { vi } from "vitest";
import {
  type ConnectWebhookVerifier,
  connectWebhookContract,
} from "./connect-contract";
import { createMockAdapter } from "./factories";

/**
 * Minimal adapter that honors the Connect webhook-verifier contract. Used to
 * self-test the shared runner without depending on a real adapter package.
 */
function createFakeConnectAdapter(options: {
  webhookVerifier: ConnectWebhookVerifier;
}): Adapter {
  return createMockAdapter("fake", {
    initialize: vi.fn().mockResolvedValue(undefined),
    handleWebhook: async (request: Request) => {
      const body = await request.text();
      try {
        const verified = await options.webhookVerifier(request, body);
        return new Response(verified ? "ok" : "unauthorized", {
          status: verified ? 200 : 401,
        });
      } catch {
        return new Response("unauthorized", { status: 401 });
      }
    },
  });
}

const makeWebhookRequest = () =>
  new Request("https://example.com/api/webhooks/fake", {
    method: "POST",
    body: "{}",
  });

// Running the contract against a compliant fake exercises every assertion and
// proves the runner works (and documents the expected adapter shape).
connectWebhookContract({
  name: "fake",
  createAdapter: createFakeConnectAdapter,
  createAdapterWithSecretAndVerifier: createFakeConnectAdapter,
  makeWebhookRequest,
});
