import type { Adapter, ChatInstance } from "chat";
import { describe, expect, it, vi } from "vitest";
import { createMockChatInstance } from "./factories";

/**
 * Webhook verifier shape shared by Vercel Connect-capable adapters: it
 * receives the incoming request and its raw body; a truthy result accepts the
 * request, while a thrown error or a falsy result rejects it (the adapter
 * responds `401`). Used in place of the platform's native signature/secret
 * check when webhooks arrive via Vercel Connect trigger forwarding.
 */
export type ConnectWebhookVerifier = (
  request: Request,
  body: string
) => Promise<unknown> | unknown;

/**
 * Per-adapter hooks the {@link connectWebhookContract} runner needs.
 *
 * The contract only exercises inbound verification, so `createAdapter` should
 * stub any outbound token (e.g. `accessToken: () => Promise.resolve("t")`) and
 * pre-seed whatever the adapter needs to dispatch without hitting the network.
 */
export interface ConnectWebhookContractDescriptor {
  /**
   * Build the adapter in Vercel Connect mode using the supplied verifier and
   * no native webhook secret.
   */
  createAdapter(options: { webhookVerifier: ConnectWebhookVerifier }): Adapter;
  /**
   * Optionally build the adapter with BOTH a native secret and a verifier, to
   * assert the verifier takes precedence. Omit if there is no secret mode.
   */
  createAdapterWithSecretAndVerifier?(options: {
    webhookVerifier: ConnectWebhookVerifier;
  }): Adapter;
  /** Mock chat instance to initialize against. Defaults to `createMockChatInstance()`. */
  createChat?(): ChatInstance;
  /**
   * Build an inbound webhook request the adapter should accept once verified
   * (no native signature header — the verifier is the only gate).
   */
  makeWebhookRequest(): Promise<Request> | Request;
  /** Label for the describe block, typically the adapter name. */
  name: string;
}

/**
 * Shared Vitest suite for an adapter's Vercel Connect webhook verification.
 *
 * Call it at the top level of an adapter's test file with a descriptor that
 * knows how to build the adapter in Connect mode and craft an inbound webhook.
 * It asserts the behavior every Connect-capable adapter shares: a
 * `webhookVerifier` replaces the native signature/secret check and gates
 * inbound requests — accept (`200`) on a truthy result, reject (`401`) on a
 * thrown error or a falsy result — and is invoked with the request and raw body.
 *
 * ```ts
 * connectWebhookContract({
 *   name: "github",
 *   createAdapter: ({ webhookVerifier }) =>
 *     new GitHubAdapter({ installationToken: "t", webhookVerifier, botUserId: 1, logger }),
 *   makeWebhookRequest: () =>
 *     makeWebhookRequest(JSON.stringify(payload), "issue_comment"),
 * });
 * ```
 */
export function connectWebhookContract(
  descriptor: ConnectWebhookContractDescriptor
): void {
  async function build(options: {
    verifier: ConnectWebhookVerifier;
    withSecret?: boolean;
  }): Promise<Adapter> {
    const chat = descriptor.createChat?.() ?? createMockChatInstance();
    const factory =
      options.withSecret && descriptor.createAdapterWithSecretAndVerifier
        ? descriptor.createAdapterWithSecretAndVerifier
        : descriptor.createAdapter;
    const adapter = factory({ webhookVerifier: options.verifier });
    await adapter.initialize(chat);
    return adapter;
  }

  describe(`Vercel Connect webhook contract (${descriptor.name})`, () => {
    it("constructs with a webhookVerifier and no native secret", () => {
      expect(() =>
        descriptor.createAdapter({ webhookVerifier: () => true })
      ).not.toThrow();
    });

    it("accepts the request (200) when the verifier passes", async () => {
      const verifier = vi.fn(() => true);
      const adapter = await build({ verifier });
      const response = await adapter.handleWebhook(
        await descriptor.makeWebhookRequest()
      );
      expect(response.status).toBe(200);
      expect(verifier).toHaveBeenCalled();
    });

    it("invokes the verifier with the request and raw body", async () => {
      const verifier = vi.fn(() => true);
      const adapter = await build({ verifier });
      await adapter.handleWebhook(await descriptor.makeWebhookRequest());
      expect(verifier).toHaveBeenCalledWith(
        expect.any(Request),
        expect.any(String)
      );
    });

    it("rejects (401) when the verifier throws", async () => {
      const adapter = await build({
        verifier: () => {
          throw new Error("invalid token");
        },
      });
      const response = await adapter.handleWebhook(
        await descriptor.makeWebhookRequest()
      );
      expect(response.status).toBe(401);
    });

    it("rejects (401) when the verifier returns falsy", async () => {
      const adapter = await build({ verifier: () => false });
      const response = await adapter.handleWebhook(
        await descriptor.makeWebhookRequest()
      );
      expect(response.status).toBe(401);
    });

    if (descriptor.createAdapterWithSecretAndVerifier) {
      it("uses the verifier in place of a configured native secret", async () => {
        const verifier = vi.fn(() => true);
        const adapter = await build({ verifier, withSecret: true });
        const response = await adapter.handleWebhook(
          await descriptor.makeWebhookRequest()
        );
        expect(response.status).toBe(200);
        expect(verifier).toHaveBeenCalled();
      });
    }
  });
}
