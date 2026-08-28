import {
  type AttachmentTransport,
  downloadAttachment,
  NetworkError,
} from "@chat-adapter/shared";

const HOSTS = ["fbsbx.com", "fbcdn.net"] as const;

export async function download(
  url: string,
  transport?: AttachmentTransport
): Promise<Buffer> {
  try {
    return await downloadAttachment(url, {
      adapter: "messenger",
      hosts: HOSTS,
      transport,
    });
  } catch (error) {
    if (error instanceof NetworkError) {
      throw error;
    }
    throw new NetworkError(
      "messenger",
      "Failed to download Messenger attachment",
      error instanceof Error ? error : undefined
    );
  }
}
