const origins = new Set([
  "https://files.slack.com",
  "https://files.slack-gov.com",
  "https://slack-files.com",
  "https://slack-files-gov.com",
  "https://slack.com",
  "https://slack-gov.com",
]);

export function isSlackAuthUrl(url: string, apiUrl?: string): boolean {
  try {
    const origin = new URL(url).origin;
    return (
      origins.has(origin) ||
      (apiUrl !== undefined && origin === new URL(apiUrl).origin)
    );
  } catch {
    return false;
  }
}
