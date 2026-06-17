import { getCliScaffoldSpec } from "../catalog/index.js";
import type { ProjectConfig } from "../types.js";

const quote = (value: string): string => JSON.stringify(value);

const uniqueSorted = (values: readonly string[]): string[] =>
  [...new Set(values)].sort();

const renderArray = (name: string, values: readonly string[]): string => {
  if (values.length === 0) {
    return "";
  }
  const items = values.map((value) => `    ${quote(value)},`).join("\n");
  return `  ${name}: [\n${items}\n  ],`;
};

/**
 * Generate `next.config.ts` for the scaffolded app.
 *
 * @param config - Resolved project configuration.
 * @returns TypeScript source for the Next.js config.
 */
export function generateNextConfig(config: ProjectConfig): string {
  const selectedAdapters = [...config.platformAdapters, config.stateAdapter];
  const transpilePackages = uniqueSorted([
    "chat",
    ...selectedAdapters
      .map((adapter) => adapter.packageName)
      .filter((packageName) => packageName.startsWith("@chat-adapter/")),
  ]);
  const serverExternalPackages = uniqueSorted(
    selectedAdapters.flatMap(
      (adapter) => getCliScaffoldSpec(adapter.slug).serverExternalPackages ?? []
    )
  );
  const configLines = [
    renderArray("transpilePackages", transpilePackages),
    renderArray("serverExternalPackages", serverExternalPackages),
  ].filter(Boolean);

  return `import type { NextConfig } from "next";\n\nconst nextConfig: NextConfig = {\n${configLines.join("\n")}\n};\n\nexport default nextConfig;\n`;
}
