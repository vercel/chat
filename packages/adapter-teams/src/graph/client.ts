import {
  readResponseBody,
  resolveTeamsAccessToken,
  TeamsApiError,
} from "../api/client";
import type { TeamsGraphOptions } from "./types";

const DEFAULT_GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const DEFAULT_GRAPH_URL = "https://graph.microsoft.com/v1.0/";
const LEADING_SLASH_PATTERN = /^\/+/;
const TRUSTED_GRAPH_HOSTS = new Set([
  "dod-graph.microsoft.us",
  "graph.microsoft.com",
  "graph.microsoft.de",
  "graph.microsoft.us",
  "microsoftgraph.chinacloudapi.cn",
]);

function getTrustedGraphUrl(pathOrUrl: string, graphUrl: string): URL {
  const url = pathOrUrl.startsWith("http")
    ? new URL(pathOrUrl)
    : new URL(pathOrUrl.replace(LEADING_SLASH_PATTERN, ""), graphUrl);

  if (
    url.protocol !== "https:" ||
    !TRUSTED_GRAPH_HOSTS.has(url.hostname.toLowerCase())
  ) {
    throw new TeamsApiError(
      "Refusing to send a Microsoft Graph token to an untrusted URL"
    );
  }

  return url;
}

export async function resolveGraphAccessToken(
  options: TeamsGraphOptions
): Promise<string> {
  return resolveTeamsAccessToken({
    ...options,
    scope: DEFAULT_GRAPH_SCOPE,
  });
}

export async function callTeamsGraphApi<T = unknown>(
  pathOrUrl: string,
  options: TeamsGraphOptions
): Promise<T> {
  const request = options.fetch ?? fetch;
  const url = getTrustedGraphUrl(
    pathOrUrl,
    options.graphUrl ?? DEFAULT_GRAPH_URL
  );
  const token = await resolveGraphAccessToken(options);

  const response = await request(url, {
    headers: {
      authorization: `Bearer ${token}`,
    },
    method: "GET",
  });
  const body = await readResponseBody(response);

  if (!response.ok) {
    throw new TeamsApiError("Microsoft Graph request failed", {
      body,
      status: response.status,
    });
  }

  return body as T;
}

export async function paginateTeamsGraph<T = unknown>(
  nextLink: string,
  options: TeamsGraphOptions
): Promise<T> {
  return callTeamsGraphApi<T>(nextLink, options);
}
