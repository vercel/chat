import { constants } from "node:fs";
import { access } from "node:fs/promises";

const DEVIN_LOCAL_PATH = "/opt/.devin";

const CURSOR = "cursor";
const CURSOR_CLI = "cursor-cli";
const CLAUDE = "claude";
const COWORK = "cowork";
const DEVIN = "devin";
const REPLIT = "replit";
const GEMINI = "gemini";
const CODEX = "codex";
const ANTIGRAVITY = "antigravity";
const AUGMENT_CLI = "augment-cli";
const OPENCODE = "opencode";
const GITHUB_COPILOT = "github-copilot";
const GITHUB_COPILOT_CLI = "github-copilot-cli";
const V0 = "v0";

/**
 * Agent names recognized by create-chat-sdk.
 */
export type KnownAgentNames =
  | typeof ANTIGRAVITY
  | typeof AUGMENT_CLI
  | typeof CLAUDE
  | typeof CODEX
  | typeof COWORK
  | typeof CURSOR
  | typeof CURSOR_CLI
  | typeof DEVIN
  | typeof GEMINI
  | typeof GITHUB_COPILOT
  | typeof GITHUB_COPILOT_CLI
  | typeof OPENCODE
  | typeof REPLIT
  | typeof V0;

/**
 * Details about the detected coding agent.
 */
export interface KnownAgentDetails {
  /**
   * Normalized coding agent name.
   */
  name: KnownAgentNames;
}

/**
 * Result of checking whether the CLI is running inside a coding agent.
 */
export type AgentResult =
  | {
      /**
       * Detected coding agent details.
       */
      agent: KnownAgentDetails;
      /**
       * Whether a coding agent was detected.
       */
      isAgent: true;
    }
  | {
      /**
       * No agent details are available when no coding agent is detected.
       */
      agent: undefined;
      /**
       * Whether a coding agent was detected.
       */
      isAgent: false;
    };

/**
 * Known coding agent names.
 */
export const KNOWN_AGENTS = {
  ANTIGRAVITY,
  AUGMENT_CLI,
  CLAUDE,
  CODEX,
  COWORK,
  CURSOR,
  CURSOR_CLI,
  DEVIN,
  GEMINI,
  GITHUB_COPILOT,
  GITHUB_COPILOT_CLI,
  OPENCODE,
  REPLIT,
  V0,
} as const;

interface AgentDetector {
  env: readonly string[];
  name: KnownAgentNames;
}

/**
 * Environment variable map used by agent detection.
 *
 * Tests pass explicit maps so detection stays deterministic and does not depend
 * on the process running the test suite.
 */
type AgentEnvironment = Record<string, string | undefined>;

/**
 * Filesystem sentinel checker used for agents that expose a local marker path.
 */
type PathExists = (path: string) => Promise<boolean>;

/**
 * Environment-only agent detectors checked after explicit `AI_AGENT` and
 * special-case detectors.
 *
 * Cursor CLI and Claude/Cowork have precedence-sensitive rules, so they are
 * handled directly in {@link determineAgent}. GitHub Copilot also normalizes
 * multiple signals to the single `github-copilot` agent name.
 */
const ENV_AGENT_DETECTORS = [
  { env: ["CURSOR_TRACE_ID"], name: CURSOR },
  { env: ["CURSOR_AGENT"], name: CURSOR_CLI },
  { env: ["GEMINI_CLI"], name: GEMINI },
  { env: ["CODEX_SANDBOX", "CODEX_CI", "CODEX_THREAD_ID"], name: CODEX },
  { env: ["ANTIGRAVITY_AGENT"], name: ANTIGRAVITY },
  { env: ["AUGMENT_AGENT"], name: AUGMENT_CLI },
  { env: ["OPENCODE_CLIENT"], name: OPENCODE },
  { env: ["REPL_ID"], name: REPLIT },
  {
    env: ["COPILOT_MODEL", "COPILOT_ALLOW_ALL", "COPILOT_GITHUB_TOKEN"],
    name: GITHUB_COPILOT,
  },
] as const satisfies readonly AgentDetector[];

const detected = (name: KnownAgentNames): AgentResult => ({
  agent: { name },
  isAgent: true,
});

const notDetected = (): AgentResult => ({
  agent: undefined,
  isAgent: false,
});

const hasAnyEnv = (
  env: AgentEnvironment,
  keys: readonly string[],
  expected?: string
): boolean =>
  keys.some((key) => {
    const value = env[key];
    return expected ? value === expected : Boolean(value);
  });

const normalizeExplicitAgent = (
  value: string | undefined
): KnownAgentNames | null => {
  const name = value?.trim();
  if (!name) {
    return null;
  }
  if (name === GITHUB_COPILOT || name === GITHUB_COPILOT_CLI) {
    return GITHUB_COPILOT;
  }
  return name as KnownAgentNames;
};

/**
 * Check whether a path exists.
 *
 * @param path - Absolute path to check.
 * @returns Whether the path exists.
 */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect whether create-chat-sdk is running inside a coding agent.
 *
 * Detection order is intentionally stable:
 *
 * 1. `AI_AGENT` explicit override.
 * 2. Cursor CLI and Claude/Cowork signals that need normalization.
 * 3. Known environment-variable detectors.
 * 4. Devin's local sentinel path.
 *
 * @param env - Environment variables to inspect.
 * @param exists - Filesystem path checker used for local agent sentinels.
 * @returns Agent detection result.
 */
export async function determineAgent(
  env: AgentEnvironment = process.env,
  exists: PathExists = pathExists
): Promise<AgentResult> {
  const explicitAgent = normalizeExplicitAgent(env.AI_AGENT);
  if (explicitAgent) {
    return detected(explicitAgent);
  }

  if (
    hasAnyEnv(env, ["CURSOR_EXTENSION_HOST_ROLE"], "agent-exec") ||
    hasAnyEnv(env, ["CURSOR_AGENT"])
  ) {
    return detected(CURSOR_CLI);
  }

  if (hasAnyEnv(env, ["CLAUDECODE", "CLAUDE_CODE"])) {
    return detected(env.CLAUDE_CODE_IS_COWORK ? COWORK : CLAUDE);
  }

  for (const detector of ENV_AGENT_DETECTORS) {
    if (hasAnyEnv(env, detector.env)) {
      return detected(detector.name);
    }
  }

  if (await exists(DEVIN_LOCAL_PATH)) {
    return detected(DEVIN);
  }

  return notDetected();
}
