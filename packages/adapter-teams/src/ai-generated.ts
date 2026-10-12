import type { AdapterPostableMessage } from "chat";

/**
 * Adds Teams' "AI generated" label to an outbound activity when the message
 * opts in with `aiGenerated: true`. Plain strings and bare card elements
 * can't carry the flag, so they're never labeled.
 */
export function applyAiGeneratedLabel(
  activity: { addAiGenerated(): unknown },
  message: AdapterPostableMessage
): void {
  if (
    typeof message === "object" &&
    (message as { aiGenerated?: unknown }).aiGenerated === true
  ) {
    activity.addAiGenerated();
  }
}
