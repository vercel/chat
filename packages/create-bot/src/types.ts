export interface EnvVar {
  description: string;
  name: string;
  required: boolean;
}

export interface PlatformAdapter {
  category: string;
  envVars: EnvVar[];
  factoryFn: string;
  name: string;
  package: string;
  serverExternalPackages: string[];
  typeName: string;
  value: string;
}

export interface StateAdapter {
  envVars: EnvVar[];
  factoryFn: string;
  hint: string;
  name: string;
  package: string;
  value: string;
}

export interface AdaptersConfig {
  platformAdapters: PlatformAdapter[];
  stateAdapters: StateAdapter[];
}

export type PackageManager = "npm" | "yarn" | "pnpm" | "bun";

export interface ProjectConfig {
  description: string;
  name: string;
  packageManager: PackageManager;
  platformAdapters: PlatformAdapter[];
  shouldInstall: boolean;
  stateAdapter: StateAdapter;
}
