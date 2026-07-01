import type { Attachment } from "chat";

export function twimlResponse(): Response {
  return new Response("<Response></Response>", {
    headers: { "content-type": "application/xml" },
    status: 200,
  });
}

export function senderFields(sender: string): {
  from?: string;
  messagingServiceSid?: string;
} {
  return sender.startsWith("MG")
    ? { messagingServiceSid: sender }
    : { from: sender };
}

export function attachmentType(
  contentType: string | undefined
): Attachment["type"] {
  if (contentType?.startsWith("image/")) {
    return "image";
  }
  if (contentType?.startsWith("video/")) {
    return "video";
  }
  if (contentType?.startsWith("audio/")) {
    return "audio";
  }
  return "file";
}
