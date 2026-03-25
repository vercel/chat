export const Logo = () => (
  <svg fill="none" height={24} viewBox="0 0 69 22" xmlns="http://www.w3.org/2000/svg">
    <path d="m12.204 12.788c-.522 2.682-2.376 4.5-5.4 4.5-3.744 0-6.012-2.916-6.012-6.66 0-3.762 2.268-6.696 6.012-6.696 2.862 0 4.734 1.71 5.328 4.266l-2.358.126c-.36-1.44-1.386-2.394-2.988-2.394-2.538 0-3.654 2.106-3.654 4.698 0 2.574 1.134 4.662 3.654 4.662 1.674 0 2.718-1.08 3.042-2.628zm1.5259-8.568h2.232v4.5c.558-1.044 1.62-1.476 2.772-1.476 2.106 0 3.204 1.566 3.204 3.618v6.138h-2.232v-5.364c0-1.602-.432-2.484-1.674-2.484-1.296 0-2.07.882-2.07 2.484v5.364h-2.232zm9.8386 6.138c.378-1.962 1.908-3.114 4.212-3.114 2.736 0 4.176 1.422 4.176 4.086v3.33c0 .54.216.684.594.684h.36v1.656l-.558.018c-.774 0-2.214-.018-2.358-1.476-.45.936-1.512 1.674-3.15 1.674-1.908 0-3.438-1.026-3.438-2.718 0-1.872 1.386-2.466 3.618-2.898l2.682-.54c-.018-1.458-.63-2.16-1.926-2.16-1.026 0-1.692.54-1.926 1.584zm2.142 4.068c0 .666.558 1.188 1.71 1.188 1.332 0 2.322-.954 2.322-2.898v-.09l-1.836.324c-1.242.234-2.196.36-2.196 1.476zm8.7959-9.126h2.232v2.16h2.52v1.746h-2.52v4.896c0 .756.36 1.134 1.08 1.134h1.44v1.764h-1.782c-1.944 0-2.97-.99-2.97-2.898v-4.896h-1.494v-1.746h1.494z" fill="currentColor" />
    <rect height="12.1517" rx="6.07585" stroke="currentColor" strokeWidth="1.28793" width="24.7957" x="42.644" y="4.92414" />
    <path d="m47.5852 12.141c.1469.7733.6754 1.2725 1.576 1.2725.6851 0 1.1452-.2741 1.1354-.7928 0-.5384-.4601-.832-1.5759-1.1159-1.4585-.3426-2.4275-.9495-2.4275-2.07511 0-1.25289 1.0376-2.03595 2.5841-2.03595 1.5563 0 2.6037.94946 2.7603 2.33939l-1.4193.06852c-.0979-.74391-.6069-1.20396-1.3704-1.20396-.6558 0-1.1256.3328-1.106.85158.0195.62643.7634.82223 1.5073.99843 1.5074.3426 2.5058 1.0082 2.5058 2.1142 0 1.3214-1.1746 2.0556-2.6428 2.0556-1.6738 0-2.8484-.9299-2.956-2.3982zm6.9703-4.59065c2.2415 0 3.4944 1.2529 3.4944 3.48465 0 2.2219-1.2235 3.465-3.4356 3.465h-2.4275v-6.94965zm-.9396 5.73595h.9396c1.3802 0 2.0458-.7342 2.0458-2.2513 0-1.53679-.6656-2.27091-2.0458-2.27091h-.9396zm4.7681-5.73595h1.429v3.06375l2.5744-3.06375h1.6052l-2.5645 3.06375 2.7309 3.8859h-1.5661l-2.0555-2.9267-.7244.8516v2.0751h-1.429z" fill="currentColor" />
  </svg>
);

export const github = {
  owner: "vercel",
  repo: "chat",
};

export const nav = [
  {
    label: "Docs",
    href: "/docs",
  },
  {
    label: "Adapters",
    href: "/adapters",
  },
  {
    label: "Guides",
    href: "/docs/guides/slack-nextjs",
  },
  {
    label: "API",
    href: "/docs/api",
  },
  {
    label: "Source",
    href: `https://github.com/${github.owner}/${github.repo}/`,
  },
];

export const suggestions = [
  "What platforms does Chat SDK support?",
  "How do I set up a Slack bot with Next.js?",
  "How do I send cards and interactive messages?",
  "How do I stream AI responses in real-time?",
];

export const title = "Chat SDK Documentation";

export const prompt =
  "You are a helpful assistant specializing in answering questions about Chat SDK, a unified SDK for building chat bots across Slack, Microsoft Teams, Google Chat, Discord, and more.";

export const translations = {
  en: {
    displayName: "English",
  },
};

export const basePath: string | undefined = undefined;

/**
 * Unique identifier for this site, used in markdown request tracking analytics.
 * Each site using geistdocs should set this to a unique value (e.g. "ai-sdk-docs", "next-docs").
 */
export const siteId: string | undefined = 'chat-sdk';
