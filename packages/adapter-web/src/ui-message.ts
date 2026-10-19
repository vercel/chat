import type { UIMessage } from "ai";
import type { WebDataParts } from "./types";

/**
 * A `UIMessage` typed with the data parts the Web adapter streams. Exported
 * from the framework entries only, so the server entry stays free of `ai`.
 */
export type WebUIMessage = UIMessage<unknown, WebDataParts>;
