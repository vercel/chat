import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    // Allow ngrok tunnels for testing Slack webhooks locally
    allowedHosts: [
      ".ngrok-free.app",
      ".ngrok-free.dev",
      ".ngrok.app",
      ".ngrok.dev",
    ],
  },
  // The React plugin must come after tanstackStart()
  plugins: [tailwindcss(), tanstackStart(), nitro(), viteReact()],
});
