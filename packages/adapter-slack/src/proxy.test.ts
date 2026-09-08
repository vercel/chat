import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { Agent } from "node:https";
import { connect, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { createMockChatInstance, mockLogger } from "@chat-adapter/tests";
import { expect, it, vi } from "vitest";
import { createSlackAdapter } from "./index";

// Real installed Slack HTTP and WebSocket clients, with an agent that routes
// only known test destinations to a loopback HTTP fixture. No external DNS or
// TLS traffic is required. This proves SDK transport selection, not CONNECT
// authentication, TLS trust, or a production proxy's remote DNS policy.
it("routes Web API, OAuth, upload phases and both Socket Mode connections through the agent", async () => {
  const requests: Array<{
    path: string;
    authorization?: string;
    body: string;
  }> = [];
  const destinations: string[] = [];
  const sockets = new Set<Socket>();
  let websocketConnections = 0;
  let firstSocket: Duplex | undefined;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }
    const path = request.url ?? "";
    requests.push({
      path,
      authorization: request.headers.authorization,
      body: Buffer.concat(chunks).toString(),
    });
    let body: Record<string, unknown> = { ok: true };
    switch (path) {
      case "/api/auth.test":
        body = { ok: true, user_id: "U_BOT", bot_id: "B_BOT" };
        break;
      case "/api/oauth.v2.access":
        body = { ok: true, access_token: "xoxb-oauth", team: { id: "T123" } };
        break;
      case "/api/files.getUploadURLExternal":
        body = {
          ok: true,
          upload_url: "https://upload.slack.test/upload",
          file_id: "F123",
        };
        break;
      case "/api/files.completeUploadExternal":
        body = { ok: true, files: [{ id: "F123" }] };
        break;
      case "/api/apps.connections.open":
        body = { ok: true, url: "wss://socket.slack.test/socket" };
        break;
      default:
        break;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (request, socket) => {
    websocketConnections += 1;
    firstSocket ??= socket;
    const accept = createHash("sha1")
      .update(
        `${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`
      )
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    const hello = Buffer.from(
      JSON.stringify({ type: "hello", num_connections: 1 })
    );
    socket.write(Buffer.concat([Buffer.from([0x81, hello.length]), hello]));
    socket.on("data", (data: Buffer) => {
      // Complete the client's close handshake; these short tests never need
      // to wait for heartbeat timers or emulate application event frames.
      if (data[0] === 0x88) {
        socket.end(Buffer.from([0x88, 0]));
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Missing fixture port");
  }
  const agent = new Agent({ keepAlive: false });
  vi.spyOn(agent, "createConnection").mockImplementation((options) => {
    const host = String(options.host);
    destinations.push(host);
    if (
      !["slack.com", "upload.slack.test", "socket.slack.test"].includes(host)
    ) {
      throw new Error(`Unexpected outbound destination: ${host}`);
    }
    return connect({ host: "127.0.0.1", port: address.port });
  });
  const webClientOptions = {
    agent,
    retryConfig: { retries: 0 },
    timeout: 2000,
  };
  const adapter = createSlackAdapter({
    botToken: "xoxb-test",
    appToken: "xapp-test",
    mode: "socket",
    logger: mockLogger,
    webClientOptions,
  });
  const oauth = createSlackAdapter({
    signingSecret: "secret",
    clientId: "client",
    clientSecret: "secret",
    logger: mockLogger,
    webClientOptions,
  });
  try {
    await adapter.initialize(createMockChatInstance());
    await adapter.webClient.chat.postMessage({
      channel: "C123",
      text: "proxy test",
    });
    await oauth.initialize(createMockChatInstance());
    expect(
      (
        await oauth.handleOAuthCallback(
          new Request("https://app.example/oauth?code=test")
        )
      ).teamId
    ).toBe("T123");
    await adapter.webClient.files.uploadV2({
      channel_id: "C123",
      filename: "test.txt",
      file: Buffer.from("uploaded through agent"),
    });
    // Slack requests reconnection periodically; the real SDK must retain the
    // same agent for the new HTTP handshake and WebSocket after its backoff.
    const refresh = Buffer.from(
      JSON.stringify({ type: "disconnect", reason: "refresh_requested" })
    );
    firstSocket?.write(
      Buffer.concat([Buffer.from([0x81, refresh.length]), refresh])
    );
    await vi.waitFor(() => expect(websocketConnections).toBe(2), {
      timeout: 8000,
    });
    let listener: Promise<unknown> | undefined;
    await adapter.startSocketModeListener(
      {
        waitUntil: (promise) => {
          listener = promise;
        },
      },
      1
    );
    await listener;
    expect(requests.map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        "/api/auth.test",
        "/api/chat.postMessage",
        "/api/oauth.v2.access",
        "/api/files.getUploadURLExternal",
        "/upload",
        "/api/files.completeUploadExternal",
      ])
    );
    expect(
      requests.filter(({ path }) => path === "/api/apps.connections.open")
    ).toHaveLength(3);
    expect(
      requests
        .filter(({ path }) => path === "/api/apps.connections.open")
        .every(({ authorization }) => authorization === "Bearer xapp-test")
    ).toBe(true);
    expect(requests.find(({ path }) => path === "/upload")?.body).toContain(
      "uploaded through agent"
    );
    expect(destinations).toContain("upload.slack.test");
    expect(
      destinations.filter((host) => host === "socket.slack.test")
    ).toHaveLength(3);
    expect(websocketConnections).toBe(3);
  } finally {
    await adapter.disconnect();
    agent.destroy();
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    vi.restoreAllMocks();
  }
}, 15_000);
