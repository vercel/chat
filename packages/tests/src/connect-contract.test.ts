import type { Adapter } from "chat";
import { describe, expect, it } from "vitest";
import type { ConnectWebhookVerifier } from "./connect-contract";
import { collectContractTests, getCase } from "./contract-harness";
import { createMockAdapter } from "./factories";

type HandleWebhook = (
  request: Request,
  verifier: ConnectWebhookVerifier
) => Promise<Response>;

/** Accepts on a truthy verifier result, rejects on a throw or falsy result. */
const compliant: HandleWebhook = async (request, verifier) => {
  const body = await request.text();
  try {
    const verified = await verifier(request, body);
    return new Response(null, { status: verified ? 200 : 401 });
  } catch {
    return new Response(null, { status: 401 });
  }
};

function fakeAdapter(handle: HandleWebhook) {
  return (options: { webhookVerifier: ConnectWebhookVerifier }): Adapter =>
    createMockAdapter("fake", {
      handleWebhook: (request: Request) =>
        handle(request, options.webhookVerifier),
    });
}

// Whitespace makes a re-serialized body observably different from the raw one.
const RAW_BODY = '{ "event": "message" }';

const ACCEPTS = "accepts the request (200) when the verifier passes";
const RAW_BODY_CASE = "invokes the verifier with the request and raw body";
const REJECTS_THROW = "rejects (401) when the verifier throws";
const REJECTS_FALSY = "rejects (401) when the verifier returns falsy";
const SECRET = "uses the verifier in place of a configured native secret";

function collect(options: {
  handle: HandleWebhook;
  handleWithSecret?: HandleWebhook;
}) {
  return collectContractTests(
    () => import("./connect-contract"),
    ({ connectWebhookContract }) =>
      connectWebhookContract({
        name: "fake",
        createAdapter: fakeAdapter(options.handle),
        createAdapterWithSecretAndVerifier: fakeAdapter(
          options.handleWithSecret ?? options.handle
        ),
        makeWebhookRequest: () =>
          new Request("https://example.com/api/webhooks/fake", {
            method: "POST",
            body: RAW_BODY,
          }),
      })
  );
}

describe("connectWebhookContract", () => {
  it("passes every case for a compliant adapter", async () => {
    const tests = await collect({ handle: compliant });
    expect([...tests.keys()]).toEqual([
      ACCEPTS,
      RAW_BODY_CASE,
      REJECTS_THROW,
      REJECTS_FALSY,
      SECRET,
    ]);
    for (const run of tests.values()) {
      await run();
    }
  });

  it("fails the reject cases when the adapter ignores the verifier", async () => {
    const tests = await collect({
      handle: async () => new Response(null, { status: 200 }),
    });
    await expect(getCase(tests, REJECTS_THROW)()).rejects.toThrow();
    await expect(getCase(tests, REJECTS_FALSY)()).rejects.toThrow();
  });

  it("fails the reject cases when the 401 comes from another gate", async () => {
    // A native signature check left in front of the verifier rejects every
    // Connect request. The reject cases must not count that 401 as a pass.
    const tests = await collect({
      handle: async () => new Response(null, { status: 401 }),
    });
    await expect(getCase(tests, REJECTS_THROW)()).rejects.toThrow();
    await expect(getCase(tests, REJECTS_FALSY)()).rejects.toThrow();
  });

  it("fails when the verifier receives a re-serialized body", async () => {
    const tests = await collect({
      handle: async (request, verifier) => {
        const parsed: unknown = await request.json();
        await verifier(request, JSON.stringify(parsed));
        return new Response(null, { status: 200 });
      },
    });
    await expect(getCase(tests, RAW_BODY_CASE)()).rejects.toThrow();
  });

  it("fails when a configured native secret takes precedence over the verifier", async () => {
    const tests = await collect({
      handle: compliant,
      handleWithSecret: async () => new Response(null, { status: 401 }),
    });
    await expect(getCase(tests, SECRET)()).rejects.toThrow();
  });
});
