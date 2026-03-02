import { beforeEach, describe, expect, it, vi } from "vitest";
import { Chat } from "./chat";
import { ChatError } from "./errors";
import { McpClientManager, NoopMcpManager } from "./mcp";
import type { McpServerConfig } from "./mcp-types";
import { createMockAdapter, createMockState, mockLogger } from "./mock-adapter";
import type { Adapter, StateAdapter } from "./types";

// Mock MCP SDK
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockListTools = vi.fn().mockResolvedValue({
  tools: [
    {
      name: "search_issues",
      description: "Search issues",
      inputSchema: { type: "object" },
    },
    {
      name: "get_event",
      description: "Get event details",
      inputSchema: { type: "object" },
    },
  ],
});
const mockCallTool = vi.fn().mockResolvedValue({
  content: [{ type: "text", text: "result" }],
  isError: false,
});
const mockClientClose = vi.fn().mockResolvedValue(undefined);
const mockTransportClose = vi.fn().mockResolvedValue(undefined);

const MockClient = vi.fn().mockImplementation(() => ({
  connect: mockConnect,
  listTools: mockListTools,
  callTool: mockCallTool,
  close: mockClientClose,
}));

const MockSSETransport = vi.fn().mockImplementation(() => ({
  close: mockTransportClose,
}));

const MockHTTPTransport = vi.fn().mockImplementation(() => ({
  close: mockTransportClose,
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: MockClient,
}));

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: MockSSETransport,
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: MockHTTPTransport,
}));

const serverConfigs: McpServerConfig[] = [
  {
    name: "sentry",
    transport: { type: "http", url: "https://mcp.sentry.io" },
  },
];

describe("McpClientManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListTools.mockResolvedValue({
      tools: [
        {
          name: "search_issues",
          description: "Search issues",
          inputSchema: { type: "object" },
        },
        {
          name: "get_event",
          description: "Get event details",
          inputSchema: { type: "object" },
        },
      ],
    });
  });

  it("should initialize and list tools with serverName", async () => {
    const manager = new McpClientManager(serverConfigs, mockLogger);
    await manager.initialize();

    const tools = await manager.listTools();
    expect(tools).toHaveLength(2);
    expect(tools[0]).toEqual({
      name: "search_issues",
      description: "Search issues",
      inputSchema: { type: "object" },
      serverName: "sentry",
    });
    expect(tools[1]).toEqual({
      name: "get_event",
      description: "Get event details",
      inputSchema: { type: "object" },
      serverName: "sentry",
    });
  });

  it("should call a tool and route to the correct server", async () => {
    const manager = new McpClientManager(serverConfigs, mockLogger);
    await manager.initialize();

    const result = await manager.callTool("search_issues", { query: "slow" });
    expect(mockCallTool).toHaveBeenCalledWith({
      name: "search_issues",
      arguments: { query: "slow" },
    });
    expect(result).toEqual({
      content: [{ type: "text", text: "result" }],
      isError: false,
    });
  });

  it("should throw MCP_TOOL_NOT_FOUND for unknown tool", async () => {
    const manager = new McpClientManager(serverConfigs, mockLogger);
    await manager.initialize();

    await expect(manager.callTool("nonexistent")).rejects.toThrow(ChatError);
    await expect(manager.callTool("nonexistent")).rejects.toMatchObject({
      code: "MCP_TOOL_NOT_FOUND",
    });
  });

  it("should close all connections", async () => {
    const manager = new McpClientManager(serverConfigs, mockLogger);
    await manager.initialize();

    await manager.close();
    expect(mockClientClose).toHaveBeenCalled();

    // After close, listTools should return empty
    const tools = await manager.listTools();
    expect(tools).toHaveLength(0);
  });

  it("should log warning for failed server connection and continue", async () => {
    mockConnect.mockRejectedValueOnce(new Error("connection refused"));

    const twoServers: McpServerConfig[] = [
      {
        name: "failing",
        transport: { type: "http", url: "https://fail.example.com" },
      },
      {
        name: "working",
        transport: { type: "http", url: "https://work.example.com" },
      },
    ];

    const manager = new McpClientManager(twoServers, mockLogger);
    await manager.initialize();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("failing"),
      expect.any(Object)
    );

    // The working server's tools should still be available
    const tools = await manager.listTools();
    expect(tools).toHaveLength(2);
  });

  it("should refresh tool lists", async () => {
    const manager = new McpClientManager(serverConfigs, mockLogger);
    await manager.initialize();

    // Update mock to return different tools
    mockListTools.mockResolvedValue({
      tools: [
        {
          name: "new_tool",
          description: "New tool",
          inputSchema: { type: "object" },
        },
      ],
    });

    await manager.refresh();
    const tools = await manager.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("new_tool");
  });

  it("should create SSE transport for sse type", async () => {
    const sseConfig: McpServerConfig[] = [
      {
        name: "sse-server",
        transport: { type: "sse", url: "https://sse.example.com" },
      },
    ];

    const manager = new McpClientManager(sseConfig, mockLogger);
    await manager.initialize();

    expect(MockSSETransport).toHaveBeenCalled();
    expect(MockHTTPTransport).not.toHaveBeenCalled();
  });

  it("should create HTTP transport for http type", async () => {
    const manager = new McpClientManager(serverConfigs, mockLogger);
    await manager.initialize();

    expect(MockHTTPTransport).toHaveBeenCalled();
  });

  it("should use cached client when callTool is called without headers", async () => {
    const manager = new McpClientManager(serverConfigs, mockLogger);
    await manager.initialize();

    await manager.callTool("search_issues", { query: "slow" });

    // Should use the client created during initialize, not create a new one
    // MockClient is called once during initialize
    expect(MockClient).toHaveBeenCalledTimes(1);
    expect(mockCallTool).toHaveBeenCalledWith({
      name: "search_issues",
      arguments: { query: "slow" },
    });
  });

  it("should create a temporary client with per-call headers", async () => {
    const manager = new McpClientManager(serverConfigs, mockLogger);
    await manager.initialize();

    // Reset mocks after initialize
    MockClient.mockClear();
    MockHTTPTransport.mockClear();
    mockConnect.mockClear();
    mockCallTool.mockClear();
    mockClientClose.mockClear();

    await manager.callTool(
      "search_issues",
      { query: "test" },
      {
        headers: { Authorization: "Bearer user-token-123" },
      }
    );

    // Should create a new transport with the override headers
    expect(MockHTTPTransport).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        requestInit: { headers: { Authorization: "Bearer user-token-123" } },
      })
    );

    // Should create a new client, connect, call, and close
    expect(MockClient).toHaveBeenCalledTimes(1);
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockCallTool).toHaveBeenCalledWith({
      name: "search_issues",
      arguments: { query: "test" },
    });
    expect(mockClientClose).toHaveBeenCalledTimes(1);
  });

  it("should close temporary client even if callTool throws", async () => {
    const manager = new McpClientManager(serverConfigs, mockLogger);
    await manager.initialize();

    mockClientClose.mockClear();
    mockCallTool.mockRejectedValueOnce(new Error("tool error"));

    await expect(
      manager.callTool(
        "search_issues",
        {},
        {
          headers: { Authorization: "Bearer fail-token" },
        }
      )
    ).rejects.toThrow("tool error");

    // Temporary client should still be closed
    expect(mockClientClose).toHaveBeenCalled();
  });

  it("should pass static headers to transport", async () => {
    const configWithHeaders: McpServerConfig[] = [
      {
        name: "auth-server",
        transport: {
          type: "http",
          url: "https://auth.example.com",
          headers: { Authorization: "Bearer token123" },
        },
      },
    ];

    const manager = new McpClientManager(configWithHeaders, mockLogger);
    await manager.initialize();

    expect(MockHTTPTransport).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        requestInit: { headers: { Authorization: "Bearer token123" } },
      })
    );
  });
});

describe("NoopMcpManager", () => {
  it("should return empty tools list", async () => {
    const manager = new NoopMcpManager();
    const tools = await manager.listTools();
    expect(tools).toEqual([]);
  });

  it("should throw on callTool", async () => {
    const manager = new NoopMcpManager();
    await expect(manager.callTool("anything")).rejects.toThrow(ChatError);
    await expect(manager.callTool("anything")).rejects.toMatchObject({
      code: "MCP_NOT_CONFIGURED",
    });
  });

  it("should not throw on refresh", async () => {
    const manager = new NoopMcpManager();
    await expect(manager.refresh()).resolves.toBeUndefined();
  });
});

describe("Chat MCP wiring", () => {
  let mockAdapter: Adapter;
  let mockState: StateAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter = createMockAdapter("slack");
    mockState = createMockState();
  });

  it("should expose mcp getter with NoopMcpManager when no servers configured", () => {
    const chat = new Chat({
      userName: "testbot",
      adapters: { slack: mockAdapter },
      state: mockState,
      logger: mockLogger,
    });

    expect(chat.mcp).toBeInstanceOf(NoopMcpManager);
  });

  it("should expose mcp getter with McpClientManager when servers configured", () => {
    const chat = new Chat({
      userName: "testbot",
      adapters: { slack: mockAdapter },
      state: mockState,
      logger: mockLogger,
      mcpServers: serverConfigs,
    });

    expect(chat.mcp).toBeInstanceOf(McpClientManager);
  });

  it("should initialize MCP on first webhook", async () => {
    const chat = new Chat({
      userName: "testbot",
      adapters: { slack: mockAdapter },
      state: mockState,
      logger: mockLogger,
      mcpServers: serverConfigs,
    });

    await chat.webhooks.slack(
      new Request("http://test.com", { method: "POST" })
    );

    // MCP client should have been created and connected
    expect(MockClient).toHaveBeenCalled();
    expect(mockConnect).toHaveBeenCalled();
  });

  it("should close MCP on shutdown", async () => {
    const chat = new Chat({
      userName: "testbot",
      adapters: { slack: mockAdapter },
      state: mockState,
      logger: mockLogger,
      mcpServers: serverConfigs,
    });

    // Initialize first
    await chat.webhooks.slack(
      new Request("http://test.com", { method: "POST" })
    );

    await chat.shutdown();
    expect(mockClientClose).toHaveBeenCalled();
  });
});
