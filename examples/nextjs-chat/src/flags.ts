import { vercelAdapter } from "@flags-sdk/vercel";
import { flag } from "flags/next";

export const ngrokTunnelFlag = flag<boolean>({
  key: "use-ngrok-tunnel",
  description:
    "Flag that will redirect traffic to ngrok tunnel for demo purposes",
  defaultValue: false,
  options: [
    { label: "Off", value: false },
    { label: "On", value: true },
  ],
  adapter: vercelAdapter(),
});
