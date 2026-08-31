import {
  type AttachmentTransport,
  downloadAttachment,
  NetworkError,
} from "@chat-adapter/shared";

const INSTAGRAM_CDN_HOSTS = [
  "cdninstagram.com",
  "fbcdn.net",
  "fbsbx.com",
] as const;

export async function downloadInstagramAttachment(
  url: string,
  transport?: AttachmentTransport
): Promise<Buffer> {
  try {
    return await downloadAttachment(url, {
      adapter: "instagram",
      hosts: INSTAGRAM_CDN_HOSTS,
      transport,
    });
  } catch (error) {
    if (error instanceof NetworkError) {
      throw error;
    }
    throw new NetworkError(
      "instagram",
      "Failed to download Instagram attachment",
      error instanceof Error ? error : undefined
    );
  }
}
