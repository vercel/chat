import {
  type GoogleChatApiOptions,
  resolveGoogleChatAccessToken,
} from "./client";

const TRAILING_SLASH_PATTERN = /\/$/;

export async function downloadGoogleChatMedia(
  resourceName: string,
  options: GoogleChatApiOptions
): Promise<ArrayBuffer> {
  const fetchImpl = options.fetch ?? fetch;
  const accessToken = await resolveGoogleChatAccessToken(options);
  const apiUrl = options.apiUrl ?? "https://chat.googleapis.com/v1";
  const url = `${apiUrl.replace(TRAILING_SLASH_PATTERN, "")}/media/${encodeGoogleChatResourceName(resourceName)}?alt=media`;
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(
      `Google Chat media download failed: ${response.status} ${response.statusText}`
    );
  }

  return response.arrayBuffer();
}

function encodeGoogleChatResourceName(resourceName: string): string {
  return resourceName.split("/").map(encodeURIComponent).join("/");
}
