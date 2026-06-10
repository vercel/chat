import type { ProjectConfig } from "../types.js";

/**
 * Determine whether the selected adapters need the Web adapter chat route.
 *
 * @param config - Resolved project configuration.
 * @returns Whether `/api/chat` should be generated.
 */
export const needsWebRoute = (config: ProjectConfig): boolean =>
  config.platformAdapters.some((adapter) => adapter.slug === "web");

/**
 * Generate `src/app/api/chat/route.ts` for the Web adapter.
 *
 * @returns Route handler source.
 */
export const generateWebRoute = (): string =>
  `import { bot } from "@/lib/bot";\n\nexport const POST = (request: Request) => bot.webhooks.web(request);\n`;

/**
 * Generate the auth helper used by the Web adapter starter.
 *
 * @returns Auth helper source.
 */
export const generateAuthStub = (): string =>
  `export interface WebUser {\n  id: string;\n}\n\nexport async function getUser(_request: Request): Promise<WebUser | null> {\n  // TODO: Replace this with your app's authentication.\n  return { id: "local-user" };\n}\n`;
