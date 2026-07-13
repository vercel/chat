import type { AdapterSlug, CatalogAdapter } from "chat/adapters";

/**
 * Package managers supported by generated install commands.
 */
export type PackageManager = "npm" | "yarn" | "pnpm" | "bun";

/**
 * Fully resolved adapter selection for a scaffolded project.
 */
export interface AdapterSelection {
  /**
   * Platform adapters to register in `new Chat({ adapters })`.
   */
  platformAdapters: readonly CatalogAdapter[];
  /**
   * State adapter to register in `new Chat({ state })`.
   */
  stateAdapter: CatalogAdapter;
}

/**
 * Configuration needed to create a project on disk.
 */
export interface ProjectConfig extends AdapterSelection {
  /**
   * Optional package description.
   */
  description: string;
  /**
   * Project package name and output directory name.
   */
  name: string;
  /**
   * Package manager used in generated instructions and dependency install.
   */
  packageManager: PackageManager;
  /**
   * Whether a git repository should be initialized after files are written.
   */
  shouldInitializeGit: boolean;
  /**
   * Whether dependencies should be installed after files are written.
   */
  shouldInstall: boolean;
  /**
   * Authenticate Connect-capable adapters (Slack, GitHub, Linear) with Vercel
   * Connect instead of native provider secrets. Defaults to `false`.
   */
  useConnect?: boolean;
}

/**
 * Options that control filesystem scaffolding behavior.
 */
export interface ScaffoldOptions {
  /**
   * Allow generated files to overwrite files in a non-empty target directory.
   */
  force: boolean;
  /**
   * Suppress non-essential CLI output.
   */
  quiet: boolean;
  /**
   * Accept default answers for non-filesystem prompts.
   */
  yes: boolean;
}

/**
 * Known adapter slug with its catalog entry.
 */
export interface CatalogSelectionItem {
  /**
   * Catalog entry for the slug.
   */
  adapter: CatalogAdapter;
  /**
   * Adapter slug.
   */
  slug: AdapterSlug;
}
