import { getProviderData } from "@flags-sdk/vercel";
import { createFlagsDiscoveryEndpoint } from "flags/next";
import { ngrokTunnelFlag } from "../../../../flags";

export const GET = createFlagsDiscoveryEndpoint(async () => {
  return await getProviderData({ ngrokTunnelFlag });
});
