export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: false },
  typescript: { strict: true },
  css: ["~/assets/css/main.css"],
  routeRules: {
    "/chat": { ssr: false },
    "/api/**": { cors: true },
  },
  vite: {
    server: {
      allowedHosts: [
        ".ngrok-free.app",
        ".ngrok-free.dev",
        ".ngrok.app",
        ".ngrok.dev",
      ],
    },
  },
  build: {
    transpile: [
      "chat",
      "@chat-adapter/slack",
      "@chat-adapter/web",
      "@chat-adapter/state-memory",
      "@chat-adapter/state-redis",
    ],
  },
  nitro: {
    esbuild: {
      options: {
        jsx: "automatic",
        jsxImportSource: "chat",
      },
    },
    typescript: {
      tsConfig: {
        compilerOptions: {
          jsx: "react-jsx",
          jsxImportSource: "chat",
        },
      },
    },
    hooks: {
      "types:extend"(types) {
        const compilerOptions = types.tsConfig?.compilerOptions;
        if (compilerOptions) {
          compilerOptions.jsxFactory = undefined;
          compilerOptions.jsxFragmentFactory = undefined;
        }
      },
    },
  },
});
