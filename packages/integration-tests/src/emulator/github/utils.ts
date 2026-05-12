/**
 * Test utilities for spinning up an in-process GitHub emulator
 * (`@emulators/github`) and bridging its outbound webhook deliveries back into
 * the SDK.
 *
 * The GitHub adapter exposes an `apiUrl` config that re-points the underlying
 * Octokit at any GitHub-compatible host. This helper boots the emulator with
 * a known user / repo / issue / PR / review-comment seed, wraps it in an HTTP
 * server, and returns the URL plus direct handles to the store and webhook
 * dispatcher so tests can read state and register subscribers without going
 * through HTTP.
 *
 * Unlike the Slack emulator, the GitHub emulator's `WebhookDispatcher` already
 * signs deliveries with `X-Hub-Signature-256: sha256=<hex>` whenever a
 * subscription has a `secret`. That's exactly what the GitHub adapter
 * verifies, so for inbound `event_callback` flows we only need a thin HTTP
 * forwarder that copies the dispatcher's headers (`x-github-event`,
 * `x-github-delivery`, `x-hub-signature-256`) onto a Web `Request` and hands
 * it to `chat.webhooks.github(...)`. No re-signing.
 */

import { createServer as createNodeServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Store, TokenMap, WebhookDispatcher } from "@emulators/core";
import { createServer as createCoreServer } from "@emulators/core";
import {
  type GitHubStore,
  getGitHubStore,
  githubPlugin,
  seedFromConfig,
} from "@emulators/github";
import { serve } from "@hono/node-server";
import type { Logger } from "chat";

/**
 * No-op logger shared by the GitHub emulator test suites. Hoisted out of each
 * test file to keep `silentLogger` referentially unique (so adapter and Chat
 * receive the exact same instance) and to avoid duplicating the same
 * boilerplate in every spec.
 */
export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};

const DEFAULT_OWNER = "bot-user";
const DEFAULT_REPO_NAME = "test-repo";
const DEFAULT_BOT_LOGIN = "bot-user";
const DEFAULT_HUMAN_LOGIN = "human-user";
const DEFAULT_BOT_TOKEN = "ghp_bot_test_token";
const DEFAULT_HUMAN_TOKEN = "ghp_human_test_token";
const DEFAULT_WEBHOOK_SECRET = "test-webhook-secret";

const FULL_GITHUB_SCOPES = [
  "repo",
  "read:user",
  "user:email",
  "admin:org",
  "admin:repo_hook",
];

const HEX_CHARS = "0123456789abcdef";

function generateSha(): string {
  let s = "";
  for (let i = 0; i < 40; i++) {
    s += HEX_CHARS[Math.floor(Math.random() * HEX_CHARS.length)];
  }
  return s;
}

interface GitHubEmulatorSeed {
  bot: { login: string; token: string };
  human: { login: string; token: string };
  owner: string;
  repoName: string;
  webhookSecret: string;
}

const DEFAULT_SEED: GitHubEmulatorSeed = {
  bot: { login: DEFAULT_BOT_LOGIN, token: DEFAULT_BOT_TOKEN },
  human: { login: DEFAULT_HUMAN_LOGIN, token: DEFAULT_HUMAN_TOKEN },
  owner: DEFAULT_OWNER,
  repoName: DEFAULT_REPO_NAME,
  webhookSecret: DEFAULT_WEBHOOK_SECRET,
};

export interface GitHubEmulatorHandle {
  /** GitHub API base URL to pass to `createGitHubAdapter({ apiUrl })`. */
  apiUrl: string;
  baseUrl: string;
  botLogin: string;
  botToken: string;
  /** Numeric ID of the seeded bot user. Stable across `reset()`. */
  botUserId: number;
  /** Shut down the underlying HTTP server. */
  close: () => Promise<void>;
  ghStore: GitHubStore;
  humanLogin: string;
  humanUserId: number;
  humanUserToken: string;
  /** Pre-seeded issue number (`#1`). */
  issueNumber: number;
  owner: string;
  /** Pre-seeded PR number (`#2`). */
  prNumber: number;
  repo: string;
  /** Reset the emulator state and re-seed. */
  reset: () => void;
  /** Pre-seeded review comment id (the parent of any reply-thread tests). */
  reviewCommentId: number;
  store: Store;
  tokenMap: TokenMap;
  webhookSecret: string;
  webhooks: WebhookDispatcher;
}

/**
 * Boot an in-process GitHub emulator on an ephemeral 127.0.0.1 port.
 */
export async function createGitHubEmulator(): Promise<GitHubEmulatorHandle> {
  const seed = DEFAULT_SEED;

  const { app, store, webhooks, tokenMap } = createCoreServer(githubPlugin, {
    port: 0,
    tokens: buildTokenSeedEntries(seed),
  });

  // Translate Octokit's `pulls.createReplyForReviewComment` shortcut endpoint
  // (POST /repos/:owner/:repo/pulls/:pull_number/comments/:comment_id/replies)
  // into the underlying review-comment POST that the emulator implements
  // (`/repos/:owner/:repo/pulls/:pull_number/comments` with `in_reply_to_id`).
  // This is a documented GitHub API shortcut; the emulator currently ships
  // the canonical form only.
  const httpServer = await listen(rewriteReplyShortcut(app.fetch));
  const port = (httpServer.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const apiUrl = baseUrl;

  const ids = applySeed(store, seed, baseUrl);

  return {
    apiUrl,
    baseUrl,
    botLogin: seed.bot.login,
    botUserId: ids.botUserId,
    botToken: seed.bot.token,
    humanLogin: seed.human.login,
    humanUserId: ids.humanUserId,
    humanUserToken: seed.human.token,
    owner: seed.owner,
    repo: seed.repoName,
    issueNumber: ids.issueNumber,
    prNumber: ids.prNumber,
    reviewCommentId: ids.reviewCommentId,
    webhookSecret: seed.webhookSecret,
    store,
    ghStore: getGitHubStore(store),
    webhooks,
    tokenMap,
    reset: () => {
      store.reset();
      webhooks.clear();
      applyTokenSeed(tokenMap, seed);
      const next = applySeed(store, seed, baseUrl);
      // Mutate handle ids so tests written against initial values still find
      // the seeded data after reset (the ids are deterministic because we
      // always seed in the same order against a freshly cleared store).
      ids.botUserId = next.botUserId;
      ids.humanUserId = next.humanUserId;
      ids.issueNumber = next.issueNumber;
      ids.prNumber = next.prNumber;
      ids.reviewCommentId = next.reviewCommentId;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function listen(fetch: (req: Request) => Response | Promise<Response>) {
  return new Promise<Server>((resolve) => {
    const server = serve({ fetch, port: 0, hostname: "127.0.0.1" }, () => {
      resolve(server as unknown as Server);
    }) as unknown as Server;
  });
}

const REPLY_SHORTCUT_PATTERN =
  /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/comments\/(\d+)\/replies$/;

function rewriteReplyShortcut(
  fetch: (req: Request) => Response | Promise<Response>
): (req: Request) => Promise<Response> {
  return async (req) => {
    const url = new URL(req.url);
    const match = url.pathname.match(REPLY_SHORTCUT_PATTERN);
    if (req.method !== "POST" || !match) {
      return fetch(req);
    }
    const [, owner, repoName, pullNumber, commentId] = match;
    const original = await req
      .clone()
      .json()
      .catch(() => ({}) as Record<string, unknown>);
    const rewrittenBody = JSON.stringify({
      ...(original ?? {}),
      in_reply_to_id: Number(commentId),
    });
    const rewrittenUrl = new URL(req.url);
    rewrittenUrl.pathname = `/repos/${owner}/${repoName}/pulls/${pullNumber}/comments`;
    const rewritten = new Request(rewrittenUrl, {
      method: "POST",
      headers: req.headers,
      body: rewrittenBody,
    });
    return fetch(rewritten);
  };
}

interface SeededTokenEntry {
  id: number;
  login: string;
  scopes: string[];
}

/**
 * Single source of truth for the token map seed. Both the initial
 * `createCoreServer({ tokens })` call and `reset()` (via `applyTokenSeed`)
 * use this so the scopes granted to each token never drift between fresh
 * boots and post-reset state.
 */
function buildTokenSeedEntries(
  seed: GitHubEmulatorSeed
): Record<string, SeededTokenEntry> {
  return {
    [seed.bot.token]: {
      id: 1,
      login: seed.bot.login,
      scopes: [...FULL_GITHUB_SCOPES],
    },
    [seed.human.token]: {
      id: 2,
      login: seed.human.login,
      scopes: [...FULL_GITHUB_SCOPES],
    },
  };
}

function applyTokenSeed(tokenMap: TokenMap, seed: GitHubEmulatorSeed) {
  tokenMap.clear();
  for (const [token, entry] of Object.entries(buildTokenSeedEntries(seed))) {
    tokenMap.set(token, entry);
  }
}

function applySeed(
  store: Store,
  seed: GitHubEmulatorSeed,
  baseUrl: string
): {
  botUserId: number;
  humanUserId: number;
  issueNumber: number;
  prNumber: number;
  reviewCommentId: number;
} {
  // Use the plugin's built-in seeder for users and the repo (it sets up the
  // initial commit + default branch when `auto_init: true`, which makes PR
  // creation work correctly).
  seedFromConfig(store, baseUrl, {
    users: [
      { login: seed.bot.login, name: "Bot User", email: "bot@localhost" },
      { login: seed.human.login, name: "Human User", email: "human@localhost" },
    ],
    repos: [
      {
        owner: seed.owner,
        name: seed.repoName,
        description: "Repo for emulator integration tests",
        auto_init: true,
      },
    ],
  });

  const gh = getGitHubStore(store);
  const botUser = gh.users.findOneBy("login", seed.bot.login);
  const humanUser = gh.users.findOneBy("login", seed.human.login);
  const repo = gh.repos.findOneBy(
    "full_name",
    `${seed.owner}/${seed.repoName}`
  );
  if (!(botUser && humanUser && repo)) {
    throw new Error("github emulator seed: missing user or repo");
  }

  // Insert a plain issue (#1).
  const issueRow = gh.issues.insert({
    node_id: "",
    number: 1,
    repo_id: repo.id,
    title: "Test issue",
    body: "Body of the seeded issue",
    state: "open",
    state_reason: null,
    locked: false,
    active_lock_reason: null,
    user_id: humanUser.id,
    assignee_ids: [],
    label_ids: [],
    milestone_id: null,
    comments: 0,
    closed_at: null,
    closed_by_id: null,
    is_pull_request: false,
  });

  // Insert a PR (#2) — both an issue row and a pullRequests row, matching
  // what the API path does. The PR shares its number with the issue row.
  const headSha = generateSha();
  const baseSha = generateSha();
  gh.issues.insert({
    node_id: "",
    number: 2,
    repo_id: repo.id,
    title: "Test PR",
    body: "Body of the seeded PR",
    state: "open",
    state_reason: null,
    locked: false,
    active_lock_reason: null,
    user_id: humanUser.id,
    assignee_ids: [],
    label_ids: [],
    milestone_id: null,
    comments: 0,
    closed_at: null,
    closed_by_id: null,
    is_pull_request: true,
  });
  gh.pullRequests.insert({
    node_id: "",
    number: 2,
    repo_id: repo.id,
    title: "Test PR",
    body: "Body of the seeded PR",
    state: "open",
    locked: false,
    user_id: humanUser.id,
    assignee_ids: [],
    label_ids: [],
    milestone_id: null,
    head_ref: "feature/test",
    head_sha: headSha,
    head_repo_id: repo.id,
    base_ref: "main",
    base_sha: baseSha,
    base_repo_id: repo.id,
    merged: false,
    merged_at: null,
    merged_by_id: null,
    merge_commit_sha: null,
    mergeable: true,
    mergeable_state: "clean",
    comments: 0,
    review_comments: 0,
    commits: 1,
    additions: 0,
    deletions: 0,
    changed_files: 0,
    draft: false,
    requested_reviewer_ids: [],
    requested_team_ids: [],
    closed_at: null,
    auto_merge: null,
  });

  // Insert a starter review comment so review-thread reply tests have a
  // parent comment to reference via `pulls.createReplyForReviewComment`.
  const reviewCommentRow = gh.comments.insert({
    node_id: "",
    repo_id: repo.id,
    issue_number: null,
    pull_number: 2,
    commit_sha: headSha,
    body: "Original review comment",
    user_id: humanUser.id,
    in_reply_to_id: null,
    path: "src/index.ts",
    position: 1,
    line: 1,
    side: "RIGHT",
    subject_type: "line",
    comment_type: "review",
    review_id: null,
  });

  return {
    botUserId: botUser.id,
    humanUserId: humanUser.id,
    issueNumber: issueRow.number,
    prNumber: 2,
    reviewCommentId: reviewCommentRow.id,
  };
}

/**
 * Inbound webhook bridge: the dispatcher already signs deliveries with
 * `X-Hub-Signature-256` (matching the GitHub adapter's verifier exactly),
 * so this forwarder is a near-passthrough — it just buffers the body,
 * copies the dispatcher's GitHub-style headers onto a Web `Request`, and
 * hands it to the `onWebhook` callback. No re-signing required.
 */
export interface GitHubWebhookForwarder {
  close: () => Promise<void>;
  /** Subscription id returned by `webhooks.register`. */
  subscriptionId: number;
  url: string;
}

export interface GitHubForwarderOptions {
  onWebhook: (request: Request) => Promise<Response> | Response;
  /** Owner to scope subscriptions on (typically `emulator.owner`). */
  owner: string;
  /** Repo to scope subscriptions on (typically `emulator.repo`). */
  repo: string;
  webhookSecret: string;
  webhooks: WebhookDispatcher;
}

const FORWARDED_HEADER_PREFIXES = ["x-github-", "x-hub-signature"];
const FORWARDED_HEADERS = ["content-type"];

export async function startGitHubWebhookForwarder(
  options: GitHubForwarderOptions
): Promise<GitHubWebhookForwarder> {
  const { onWebhook, owner, repo, webhooks, webhookSecret } = options;

  const httpServer = createNodeServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      chunks.push(chunk as Buffer);
    });
    req.on("end", async () => {
      try {
        const rawBody = Buffer.concat(chunks).toString("utf8");
        const headers = new Headers();
        for (const [name, value] of Object.entries(req.headers)) {
          if (typeof value !== "string") {
            continue;
          }
          const lower = name.toLowerCase();
          const matchesPrefix = FORWARDED_HEADER_PREFIXES.some((p) =>
            lower.startsWith(p)
          );
          if (matchesPrefix || FORWARDED_HEADERS.includes(lower)) {
            headers.set(lower, value);
          }
        }
        const request = new Request("https://example.invalid/webhook/github", {
          method: "POST",
          headers,
          body: rawBody,
        });
        const response = await onWebhook(request);
        res.statusCode = response.status;
        const text = await response.text();
        res.end(text);
      } catch (err) {
        res.statusCode = 500;
        res.end(err instanceof Error ? err.message : "forwarder error");
      }
    });
    req.on("error", () => {
      res.statusCode = 400;
      res.end();
    });
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => resolve());
  });

  const port = (httpServer.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}/`;

  const subscription = webhooks.register({
    url,
    events: ["*"],
    active: true,
    owner,
    repo,
    secret: webhookSecret,
  });

  return {
    url,
    subscriptionId: subscription.id,
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

/**
 * Convenience: post an issue comment via the emulator using the human user's
 * token. Triggers an `issue_comment` webhook dispatch.
 */
export async function postIssueCommentAsHuman(
  emulator: GitHubEmulatorHandle,
  options: { body: string; issueNumber?: number }
): Promise<{ id: number; body: string }> {
  const issueNumber = options.issueNumber ?? emulator.prNumber;
  const response = await fetch(
    `${emulator.apiUrl}/repos/${emulator.owner}/${emulator.repo}/issues/${issueNumber}/comments`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${emulator.humanUserToken}`,
        "content-type": "application/json",
        accept: "application/vnd.github+json",
      },
      body: JSON.stringify({ body: options.body }),
    }
  );
  if (!response.ok) {
    throw new Error(
      `emulator POST /issues/${issueNumber}/comments failed: ${response.status} ${await response.text()}`
    );
  }
  const json = (await response.json()) as { id: number; body: string };
  return json;
}

/**
 * Convenience: post a review comment as the human user. The comment is
 * attached to the seeded PR (`emulator.prNumber`) and replies to the seeded
 * review comment by default, mirroring how a review-thread reply event would
 * arrive in production.
 */
export async function postReviewCommentReplyAsHuman(
  emulator: GitHubEmulatorHandle,
  options: { body: string; inReplyToId?: number }
): Promise<{ id: number; body: string; in_reply_to_id: number | null }> {
  const inReplyToId = options.inReplyToId ?? emulator.reviewCommentId;
  const response = await fetch(
    `${emulator.apiUrl}/repos/${emulator.owner}/${emulator.repo}/pulls/${emulator.prNumber}/comments`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${emulator.humanUserToken}`,
        "content-type": "application/json",
        accept: "application/vnd.github+json",
      },
      body: JSON.stringify({ body: options.body, in_reply_to_id: inReplyToId }),
    }
  );
  if (!response.ok) {
    throw new Error(
      `emulator POST /pulls/${emulator.prNumber}/comments failed: ${response.status} ${await response.text()}`
    );
  }
  const json = (await response.json()) as {
    id: number;
    body: string;
    in_reply_to_id: number | null;
  };
  return json;
}

/**
 * Wait until at least one webhook delivery has been recorded that matches
 * the predicate, with a small polling loop to absorb async dispatch timing.
 */
export async function waitForGitHubDelivery(
  emulator: GitHubEmulatorHandle,
  predicate: (
    delivery: ReturnType<WebhookDispatcher["getDeliveries"]>[number]
  ) => boolean,
  options: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 2000;
  const intervalMs = options.intervalMs ?? 25;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const deliveries = emulator.webhooks.getDeliveries();
    if (deliveries.some(predicate)) {
      return;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `waitForGitHubDelivery: predicate never matched (${emulator.webhooks
      .getDeliveries()
      .map((d) => d.event)
      .join(", ")})`
  );
}
