/**
 * BridgeHttpAdapter — a virtual IHttpServerAdapter that captures the route
 * handler registered by App.initialize() and exposes dispatch() for
 * handleWebhook() to call.  We never own the HTTP server.
 *
 * Also scopes WebhookOptions to each request, so event handlers get their
 * own request's options even when an edit reuses its message's activity id.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import type {
  HttpMethod,
  HttpRouteHandler,
  IHttpServerAdapter,
} from "@microsoft/teams.apps";
import type { Logger, WebhookOptions } from "chat";
import type { TeamsWebhookVerifier } from "./types";

export class BridgeHttpAdapter implements IHttpServerAdapter {
  private handler: HttpRouteHandler | null = null;
  private readonly webhookOptions = new AsyncLocalStorage<
    WebhookOptions | undefined
  >();
  private readonly logger: Logger;

  private readonly webhookVerifier?: TeamsWebhookVerifier;

  constructor(logger: Logger, webhookVerifier?: TeamsWebhookVerifier) {
    this.logger = logger;
    this.webhookVerifier = webhookVerifier;
  }

  registerRoute(
    _method: HttpMethod,
    _path: string,
    handler: HttpRouteHandler
  ): void {
    this.handler = handler;
  }

  async dispatch(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    const body = await request.text();
    this.logger.debug("Teams webhook received", {
      bodyLength: Buffer.byteLength(body),
    });

    if (this.webhookVerifier) {
      try {
        if (!(await this.webhookVerifier(request, body))) {
          return new Response("Unauthorized", { status: 401 });
        }
      } catch {
        return new Response("Unauthorized", { status: 401 });
      }
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(body);
    } catch (e) {
      this.logger.error("Failed to parse request body", { error: e });
      return new Response("Invalid JSON", { status: 400 });
    }

    if (!this.handler) {
      return new Response(JSON.stringify({ error: "No handler registered" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const handler = this.handler;
    try {
      const serverResponse = await this.webhookOptions.run(options, () =>
        handler({ body: parsedBody, headers })
      );

      const hasBody =
        serverResponse.body !== undefined && serverResponse.body !== null;
      return new Response(
        hasBody ? JSON.stringify(serverResponse.body) : null,
        {
          status: serverResponse.status,
          headers: hasBody ? { "Content-Type": "application/json" } : undefined,
        }
      );
    } catch (error) {
      this.logger.error("Bridge adapter dispatch error", { error });
      return new Response(JSON.stringify({ error: "Internal error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  getWebhookOptions(): WebhookOptions | undefined {
    return this.webhookOptions.getStore();
  }
}
