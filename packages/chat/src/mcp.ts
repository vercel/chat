/**
 * MCP (Model Context Protocol) client manager implementation.
 */

import { ChatError } from "./errors";
import type { Logger } from "./logger";
import type {
  McpContentBlock,
  McpHeaders,
  McpManager,
  McpServerConfig,
  McpTool,
  McpToolResult,
  McpTransportConfig,
} from "./mcp-types";

interface ConnectedServer {
  client: McpClient;
  name: string;
  tools: McpTool[];
  transport: McpTransport;
}

// Minimal interfaces for the MCP SDK types we use, to avoid importing at module level.
// These are intentionally loose — the real SDK types are richer but we only use a subset.
interface McpClient {
  callTool(params: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<{
    content: unknown[];
    isError?: boolean;
  }>;
  close(): Promise<void>;
  connect(transport: McpTransport): Promise<void>;
  listTools(): Promise<{
    tools: Array<{ name: string; description?: string; inputSchema?: unknown }>;
  }>;
}

interface McpTransport {
  close(): Promise<void>;
}

interface McpSdk {
  Client: new (info: { name: string; version: string }) => McpClient;
  SSEClientTransport: new (
    url: URL,
    options?: Record<string, unknown>
  ) => McpTransport;
  StreamableHTTPClientTransport: new (
    url: URL,
    options?: Record<string, unknown>
  ) => McpTransport;
}

async function loadMcpSdk(): Promise<McpSdk> {
  try {
    const [clientMod, sseMod, httpMod] = await Promise.all([
      import("@modelcontextprotocol/sdk/client/index.js"),
      import("@modelcontextprotocol/sdk/client/sse.js"),
      import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
    ]);
    return {
      Client: clientMod.Client as McpSdk["Client"],
      SSEClientTransport:
        sseMod.SSEClientTransport as McpSdk["SSEClientTransport"],
      StreamableHTTPClientTransport:
        httpMod.StreamableHTTPClientTransport as McpSdk["StreamableHTTPClientTransport"],
    };
  } catch {
    throw new ChatError(
      "MCP support requires @modelcontextprotocol/sdk. Install it with: pnpm add @modelcontextprotocol/sdk",
      "MCP_SDK_NOT_INSTALLED"
    );
  }
}

function resolveHeaders(
  headers: McpHeaders | undefined
): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }
  if (typeof headers === "function") {
    const result = headers();
    // If it returns a promise, we can't resolve it synchronously — return undefined
    // Dynamic headers are handled per-request via custom fetch
    if (result instanceof Promise) {
      return undefined;
    }
    return result;
  }
  return headers;
}

function createCustomFetch(headers: McpHeaders): typeof globalThis.fetch {
  return async (input, init) => {
    const resolved = typeof headers === "function" ? await headers() : headers;
    const mergedHeaders = {
      ...resolved,
      ...(init?.headers as Record<string, string>),
    };
    return globalThis.fetch(input, { ...init, headers: mergedHeaders });
  };
}

function needsCustomFetch(
  headers: McpHeaders | undefined
): headers is McpHeaders {
  return typeof headers === "function";
}

async function createTransport(
  config: McpTransportConfig,
  sdk: McpSdk
): Promise<McpTransport> {
  const url = new URL(config.url);

  if (config.type === "sse") {
    const options: Record<string, unknown> = {};
    if (needsCustomFetch(config.headers)) {
      options.eventSourceInit = { fetch: createCustomFetch(config.headers) };
    } else {
      const staticHeaders = resolveHeaders(config.headers);
      if (staticHeaders) {
        options.requestInit = { headers: staticHeaders };
      }
    }
    return new sdk.SSEClientTransport(url, options);
  }

  // Streamable HTTP
  const options: Record<string, unknown> = {};
  if (needsCustomFetch(config.headers)) {
    // StreamableHTTPClientTransport doesn't support custom fetch natively,
    // but we can pass headers via requestInit for static resolution
    const resolved =
      typeof config.headers === "function"
        ? await config.headers()
        : config.headers;
    options.requestInit = { headers: resolved };
  } else {
    const staticHeaders = resolveHeaders(config.headers);
    if (staticHeaders) {
      options.requestInit = { headers: staticHeaders };
    }
  }
  return new sdk.StreamableHTTPClientTransport(url, options);
}

/**
 * MCP client manager that connects to multiple MCP servers
 * and provides unified tool discovery and invocation.
 */
export class McpClientManager implements McpManager {
  private readonly configs: McpServerConfig[];
  private readonly logger: Logger;
  private servers: ConnectedServer[] = [];

  constructor(configs: McpServerConfig[], logger: Logger) {
    this.configs = configs;
    this.logger = logger;
  }

  async initialize(): Promise<void> {
    const sdk = await loadMcpSdk();

    const results = await Promise.allSettled(
      this.configs.map(async (config) => {
        const client = new sdk.Client({ name: "chat-sdk", version: "1.0.0" });
        const transport = await createTransport(config.transport, sdk);
        await client.connect(transport);

        const { tools } = await client.listTools();
        const mappedTools: McpTool[] = tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: (t.inputSchema as Record<string, unknown>) ?? {},
          serverName: config.name,
        }));

        this.logger.debug(`MCP server "${config.name}" connected`, {
          tools: mappedTools.length,
        });

        return {
          name: config.name,
          client,
          transport,
          tools: mappedTools,
        } as ConnectedServer;
      })
    );

    for (const [i, result] of results.entries()) {
      if (result.status === "fulfilled") {
        this.servers.push(result.value);
      } else {
        this.logger.warn(
          `Failed to connect to MCP server "${this.configs[i].name}"`,
          {
            error: result.reason,
          }
        );
      }
    }

    this.logger.info("MCP initialized", {
      connected: this.servers.length,
      total: this.configs.length,
    });
  }

  async listTools(): Promise<McpTool[]> {
    return this.servers.flatMap((s) => s.tools);
  }

  async callTool(
    name: string,
    args?: Record<string, unknown>
  ): Promise<McpToolResult> {
    const server = this.servers.find((s) =>
      s.tools.some((t) => t.name === name)
    );
    if (!server) {
      throw new ChatError(
        `MCP tool "${name}" not found on any connected server`,
        "MCP_TOOL_NOT_FOUND"
      );
    }

    const result = await server.client.callTool({ name, arguments: args });
    return {
      content: result.content as McpContentBlock[],
      isError: result.isError,
    };
  }

  async refresh(): Promise<void> {
    const results = await Promise.allSettled(
      this.servers.map(async (server) => {
        const { tools } = await server.client.listTools();
        server.tools = tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: (t.inputSchema as Record<string, unknown>) ?? {},
          serverName: server.name,
        }));
      })
    );

    for (const [i, result] of results.entries()) {
      if (result.status === "rejected") {
        this.logger.warn(
          `Failed to refresh tools from MCP server "${this.servers[i].name}"`,
          {
            error: result.reason,
          }
        );
      }
    }
  }

  async close(): Promise<void> {
    await Promise.allSettled(
      this.servers.map(async (server) => {
        try {
          await server.client.close();
        } catch {
          // Ignore close errors
        }
      })
    );
    this.servers = [];
  }
}

/**
 * No-op MCP manager used when no MCP servers are configured.
 */
export class NoopMcpManager implements McpManager {
  async listTools(): Promise<McpTool[]> {
    return [];
  }

  async callTool(name: string): Promise<McpToolResult> {
    throw new ChatError(
      `MCP is not configured. Cannot call tool "${name}"`,
      "MCP_NOT_CONFIGURED"
    );
  }

  async refresh(): Promise<void> {
    // No-op
  }
}
