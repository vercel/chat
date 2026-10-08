import type { AdapterFeatures } from "./features";

/**
 * Whether an adapter connects to a messaging platform or stores Chat SDK
 * state.
 */
export type AdapterType = "platform" | "state";

/**
 * Who maintains an adapter.
 *
 * - `official`: maintained in the Chat SDK repository.
 * - `vendor-official`: maintained by the platform vendor.
 * - `community`: maintained by a third party and listed on chat-sdk.dev.
 */
export type AdapterGroup = "official" | "vendor-official" | "community";

/**
 * A single environment variable referenced by an adapter.
 */
export interface EnvVar {
  /**
   * Alternative variable names accepted for the same value.
   */
  aliases?: readonly string[];
  /**
   * Short description of what the value configures.
   */
  description: string;
  /**
   * Canonical environment variable name.
   */
  key: string;
  /**
   * Whether the value is a credential, token, secret, or password that should
   * be masked in logs and user interfaces.
   */
  secret: boolean;
}

/**
 * One self-contained way to satisfy an adapter's credential requirements.
 *
 * Use {@link AdapterEnvSpec.credentialModes} when an adapter supports multiple
 * mutually exclusive authentication paths.
 */
export interface EnvGroup {
  /**
   * Human-readable name for this credential mode.
   */
  label: string;
  /**
   * Variables that together satisfy this mode.
   */
  vars: readonly EnvVar[];
}

/**
 * Environment variables and constructor-only configuration for an adapter.
 */
export interface AdapterEnvSpec {
  /**
   * Constructor options that have no environment-variable equivalent.
   */
  config?: readonly string[];
  /**
   * Mutually exclusive credential modes. A caller usually satisfies exactly
   * one group.
   */
  credentialModes?: readonly EnvGroup[];
  /**
   * Additional caveats that do not fit the structured fields.
   */
  notes?: string;
  /**
   * Optional environment variables that tune behavior but are safe to omit.
   */
  optional?: readonly EnvVar[];
  /**
   * Variables needed regardless of credential mode.
   */
  required?: readonly EnvVar[];
}

/**
 * Listing metadata shared by every adapter in the catalog.
 */
export interface AdapterListing {
  /**
   * Maintainer for vendor-official and community adapters.
   */
  author?: string;
  /**
   * Whether the adapter is in beta.
   */
  beta?: boolean;
  /**
   * One-line summary of what the adapter connects to.
   */
  description: string;
  /**
   * Capability support. Omitted keys mean `"no"`.
   */
  features: AdapterFeatures;
  /**
   * Who maintains the adapter.
   */
  group: AdapterGroup;
  /**
   * Logo identifier used by chat-sdk.dev.
   */
  icon?: string;
  /**
   * Display name.
   */
  name: string;
  /**
   * npm package that provides the adapter implementation.
   */
  packageName: string;
  /**
   * GitHub URL of the adapter's README.
   */
  readme: string;
  /**
   * Stable catalog slug.
   */
  slug: string;
  /**
   * Whether the adapter connects to a messaging platform or stores Chat SDK
   * state.
   */
  type: AdapterType;
}

/**
 * An official or vendor-official adapter, with the metadata setup tools need
 * to install and configure it.
 */
export interface CatalogAdapter extends AdapterListing {
  /**
   * Environment variables and constructor-only configuration.
   */
  env: AdapterEnvSpec;
  /**
   * Named factory export from {@link AdapterListing.packageName}.
   */
  factoryExport: string;
  group: "official" | "vendor-official";
  /**
   * Module specifier the factory is imported from, when the adapter ships on
   * a subpath of {@link AdapterListing.packageName}. The package to install is
   * still `packageName`. Defaults to `packageName` when omitted.
   */
  importPath?: string;
  /**
   * Runtime packages the adapter expects the consuming app to provide or
   * install alongside it.
   */
  peerDeps: readonly string[];
}

/**
 * A community adapter listed on chat-sdk.dev. Community entries carry listing
 * metadata only.
 */
export interface CommunityAdapter extends AdapterListing {
  author: string;
  group: "community";
}

/**
 * Any adapter in the catalog.
 */
export type CatalogEntry = CatalogAdapter | CommunityAdapter;
