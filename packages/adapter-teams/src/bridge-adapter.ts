/**
 * BridgeHttpAdapter — a virtual IHttpServerAdapter that captures the route
 * handler registered by App.initialize() and exposes dispatch() for
 * handleWebhook() to call.  We never own the HTTP server.
 *
 * Also manages per-request WebhookOptions so event handlers can retrieve
 * the correct options for their activity without shared mutable state.
 */

import type {
  HttpMethod,
  HttpRouteHandler,
  IHttpServerAdapter,
} from "@microsoft/teams.apps";
import type { Logger, WebhookOptions } from "chat";

export class BridgeHttpAdapter implements IHttpServerAdapter {
  private handler: HttpRouteHandler | null = null;
  private readonly webhookOptionsMap = new Map<string, WebhookOptions>();
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
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
    this.logger.debug("Teams webhook raw body", { body });

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

    const activityId = (parsedBody as { id?: string })?.id;
    if (activityId && options) {
      this.webhookOptionsMap.set(activityId, options);
    }

    try {
      const serverResponse = await this.handler({ body: parsedBody, headers });

      return new Response(
        serverResponse.body ? JSON.stringify(serverResponse.body) : "{}",
        {
          status: serverResponse.status,
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (error) {
      this.logger.error("Bridge adapter dispatch error", { error });
      return new Response(JSON.stringify({ error: "Internal error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    } finally {
      if (activityId) {
        this.webhookOptionsMap.delete(activityId);
      }
    }
  }

  getWebhookOptions(
    activityId: string | undefined
  ): WebhookOptions | undefined {
    if (!activityId) {
      return undefined;
    }
    return this.webhookOptionsMap.get(activityId);
  }
}
