import type { AppOptions, IPlugin } from "@microsoft/teams.apps";
import type { TeamsAdapterConfig } from "./types";

/**
 * Convert TeamsAdapterConfig (public API) to the Teams SDK AppOptions.
 *
 * Historically, TeamsAdapterConfig was built with BotFramework, which is now deprecated.
 *
 */
export function toAppOptions(
  config: TeamsAdapterConfig
): Omit<AppOptions<IPlugin>, "httpServerAdapter"> {
  if (config.certificate) {
    throw new Error(
      "Certificate-based authentication is not yet supported by the Teams SDK adapter. " +
        "Use appPassword (client secret) or federated (workload identity) authentication instead."
    );
  }

  const clientId = config.appId ?? process.env.TEAMS_APP_ID;
  const clientSecret = config.federated
    ? undefined
    : (config.appPassword ?? process.env.TEAMS_APP_PASSWORD);

  // For SingleTenant, tenantId is required. For MultiTenant, omit it.
  const tenantId =
    config.appType === "MultiTenant"
      ? undefined
      : (config.appTenantId ?? process.env.TEAMS_APP_TENANT_ID);

  if (config.federated?.clientAudience) {
    config.logger?.warn(
      "federated.clientAudience is not supported by the Teams SDK and will be ignored."
    );
  }

  const managedIdentityClientId = config.federated?.clientId;

  return {
    ...(clientId ? { clientId } : {}),
    ...(clientSecret ? { clientSecret } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(managedIdentityClientId ? { managedIdentityClientId } : {}),
  };
}
