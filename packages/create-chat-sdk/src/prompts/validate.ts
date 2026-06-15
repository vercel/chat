import type { PackageManager } from "../types.js";

// The project name doubles as the output directory name, so scoped names like
// "@acme/my-bot" are rejected to avoid creating a nested "@acme/my-bot" path.
const PACKAGE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

const PACKAGE_MANAGERS = new Set(["npm", "yarn", "pnpm", "bun"]);

/**
 * Validate a project name as an npm package name.
 *
 * @param value - Candidate project name.
 * @returns Validation message when invalid, otherwise `undefined`.
 */
export function validatePackageName(
  value: string | undefined
): string | undefined {
  const name = value?.trim() ?? "";
  if (!name) {
    return "Project name is required";
  }
  if (
    name.startsWith(".") ||
    name.startsWith("_") ||
    name.includes("..") ||
    !PACKAGE_NAME_PATTERN.test(name)
  ) {
    return "Use a valid npm package name (unscoped), like my-bot";
  }
}

/**
 * Check whether a string is a supported package manager.
 *
 * @param value - Candidate package manager.
 * @returns Whether the value is supported.
 */
export const isPackageManager = (value: string): value is PackageManager =>
  PACKAGE_MANAGERS.has(value);

/**
 * Detect the current package manager from npm's user-agent environment value.
 *
 * @param userAgent - Value of `npm_config_user_agent`.
 * @returns Detected package manager, defaulting to npm.
 */
export function detectPackageManager(userAgent = ""): PackageManager {
  if (userAgent.startsWith("pnpm")) {
    return "pnpm";
  }
  if (userAgent.startsWith("yarn")) {
    return "yarn";
  }
  if (userAgent.startsWith("bun")) {
    return "bun";
  }
  return "npm";
}
