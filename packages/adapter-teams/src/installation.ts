import type { InstallationAction } from "chat";

// The Teams SDK types only `add` and `remove`; Microsoft also documents the
// upgrade variants, so validate the wire value instead of trusting the union.
const INSTALLATION_ACTIONS: readonly InstallationAction[] = [
  "add",
  "add-upgrade",
  "remove",
  "remove-upgrade",
];

export function parseInstallationAction(
  value: unknown
): InstallationAction | undefined {
  return INSTALLATION_ACTIONS.find((action) => action === value);
}

export function isInstallAction(
  action: InstallationAction
): action is "add" | "add-upgrade" {
  return action === "add" || action === "add-upgrade";
}
