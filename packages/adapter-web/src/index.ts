// biome-ignore lint/style/noExportedImports: Konsistent requires importing the Adapter type from "chat" in this entry point. Re-exporting from "chat" doesn't satisfy the rule, so we import + re-export here.
import type { Adapter } from "chat";
import { WebAdapter } from "./adapter";
import type { WebAdapterConfig } from "./types";

export { WebAdapter, type WebThreadIdData } from "./adapter";
export { WebFormatConverter } from "./format-converter";
export type {
  WebAdapterConfig,
  WebAdapterOptions,
  WebUser,
} from "./types";
export type { Adapter };

export function createWebAdapter(opts: WebAdapterConfig): WebAdapter {
  return new WebAdapter(opts);
}
