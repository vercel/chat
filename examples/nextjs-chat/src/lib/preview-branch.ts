export const PREVIEW_BRANCH_KEY = "chat-sdk:cache:preview-branch-url";

function configuredAllowedHosts(): Set<string> {
  return new Set(
    (process.env.PREVIEW_BRANCH_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function parseAllowedPreviewBranchUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  ) {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  const allowedHosts = configuredAllowedHosts();
  const hostnameAllowed =
    allowedHosts.size > 0
      ? allowedHosts.has(hostname)
      : hostname.endsWith(".vercel.app");

  return hostnameAllowed ? url : null;
}
