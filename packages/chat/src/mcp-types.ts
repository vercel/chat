/**
 * Types for MCP (Model Context Protocol) client support.
 */

/**
 * Headers for MCP server authentication.
 * Can be a static record or an async function for token rotation.
 */
export type McpHeaders =
  | Record<string, string>
  | (() => Record<string, string>)
  | (() => Promise<Record<string, string>>);

/**
 * Transport configuration for an MCP server.
 * Supports SSE and Streamable HTTP transports only (no stdio).
 */
export interface McpTransportConfig {
  headers?: McpHeaders;
  type: "sse" | "http";
  url: string;
}

/**
 * Configuration for a single MCP server.
 */
export interface McpServerConfig {
  name: string;
  transport: McpTransportConfig;
}

/**
 * A tool exposed by an MCP server.
 */
export interface McpTool {
  description?: string;
  inputSchema: Record<string, unknown>;
  name: string;
  serverName: string;
}

/**
 * A content block returned by an MCP tool call.
 */
export type McpContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | {
      type: "resource";
      resource: { uri: string; mimeType?: string; text?: string };
    };

/**
 * Result of calling an MCP tool.
 */
export interface McpToolResult {
  content: McpContentBlock[];
  isError?: boolean;
}

/**
 * Manager interface for interacting with MCP servers.
 */
export interface McpManager {
  /** Call a tool by name with optional arguments. */
  callTool(
    name: string,
    args?: Record<string, unknown>
  ): Promise<McpToolResult>;
  /** List all tools available across connected MCP servers. */
  listTools(): Promise<McpTool[]>;

  /** Re-fetch tool lists from all connected servers. */
  refresh(): Promise<void>;
}
