import { convert } from "html-to-text";
import { createMimeMessage } from "mimetext";
import PostalMime, { type Address, type Email } from "postal-mime";
import { z } from "zod";
import { GmailContentError } from "./http";
import {
  address,
  continuation as continuationSchema,
  type GmailAddress,
  type GmailContinuation,
  type GmailMessage,
  mailbox as mailboxSchema,
  message as messageSchema,
} from "./schema";

export { GmailContentError } from "./http";
export type { GmailAddress, GmailContinuation } from "./schema";

export interface GmailAttachment {
  data: Uint8Array;
  filename: string;
  mimeType: string;
}

export interface GmailEmail {
  attachments: GmailAttachment[];
  email: Email;
  message: GmailMessage;
  text: string;
}

export interface GmailOutgoing {
  attachments?: GmailAttachment[];
  cc?: GmailAddress[];
  continuation?: GmailContinuation;
  html?: string;
  subject?: string;
  text: string;
  to?: GmailAddress[];
}

const controls = /[\r\n\0]/;
const referencesPattern = /<[^<>\s]+>/g;
const header = z
  .string()
  .max(998)
  .refine((value) => !controls.test(value));
const messageId = z
  .string()
  .regex(/^<[^<>\s]+>$/)
  .max(998);

export async function parseGmailMessage(
  input: GmailMessage
): Promise<GmailEmail> {
  const message = messageSchema.parse(input);
  const bytes = Buffer.from(message.raw, "base64url");
  if (bytes.byteLength > 25 * 1024 * 1024) {
    throw new GmailContentError("size");
  }
  const email = await PostalMime.parse(bytes, {
    attachmentEncoding: "arraybuffer",
    forceRfc822Attachments: true,
    maxNestingDepth: 30,
    maxHeadersSize: 65_536,
  }).catch(() => {
    throw new GmailContentError("format");
  });
  return {
    message,
    email,
    text: email.text ?? convert(email.html ?? "", { wordwrap: false }),
    attachments: email.attachments.map((attachment) => ({
      filename: attachment.filename ?? "attachment",
      mimeType: attachment.mimeType,
      data:
        typeof attachment.content === "string"
          ? Buffer.from(
              attachment.content,
              attachment.encoding === "base64" ? "base64" : "utf8"
            )
          : new Uint8Array(attachment.content),
    })),
  };
}

function addresses(values: Address[]): GmailAddress[] {
  return values
    .flatMap((value) => value.group ?? [value])
    .map((value) => address.parse(value));
}

export function extractGmailContinuation(
  input: GmailEmail,
  mailbox: string,
  options: { replyAll?: boolean } = {}
): GmailContinuation {
  const email = input.email;
  const sender = email.from ? [email.from] : [];
  const recipients = addresses(email.replyTo?.length ? email.replyTo : sender);
  const account = mailboxSchema.parse(mailbox);
  const seen = new Set<string>();
  const unique = (values: GmailAddress[]) =>
    values.filter((value) => {
      const position = value.address.lastIndexOf("@");
      const key =
        value.address.slice(0, position) +
        value.address.slice(position).toLowerCase();
      if (value.address.toLowerCase() === account || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  const to = options.replyAll
    ? unique([...recipients, ...addresses(email.to ?? [])])
    : recipients;
  const cc = options.replyAll ? unique(addresses(email.cc ?? [])) : undefined;
  const inReplyTo = messageId.parse(email.messageId);
  const references = (email.references?.match(referencesPattern) ?? []).slice(
    -99
  );
  if (!references.includes(inReplyTo)) {
    references.push(inReplyTo);
  }
  return continuationSchema.parse({
    mailbox,
    threadId: input.message.threadId,
    messageId: input.message.id,
    subject: email.subject ?? "",
    inReplyTo,
    references,
    to,
    ...(cc?.length ? { cc } : {}),
  });
}

export function composeGmailMessage(
  input: GmailOutgoing & { from: string }
): string {
  const continuation = input.continuation
    ? continuationSchema.parse(input.continuation)
    : undefined;
  const recipients = z
    .array(address)
    .min(1)
    .max(100)
    .parse(input.to ?? continuation?.to);
  const subject = header.parse(continuation?.subject ?? input.subject ?? "");
  const message = createMimeMessage();
  message.setSender(mailboxSchema.parse(input.from));
  const cc = z
    .array(address)
    .max(100)
    .parse(input.cc ?? continuation?.cc ?? []);
  for (const [type, values] of [
    ["To", recipients],
    ["Cc", cc],
  ] as const) {
    if (values.length) {
      message.setRecipients(
        values.map((value) => ({
          addr: value.address,
          name: value.name === undefined ? undefined : header.parse(value.name),
        })),
        { type }
      );
    }
  }
  message.setSubject(subject);
  if (continuation) {
    message.setHeader("In-Reply-To", continuation.inReplyTo);
    message.setHeader("References", continuation.references.join(" "));
  }
  message.addMessage({
    contentType: "text/plain",
    data: Buffer.from(input.text).toString("base64"),
    encoding: "base64",
  });
  if (input.html !== undefined) {
    message.addMessage({
      contentType: "text/html",
      data: Buffer.from(input.html).toString("base64"),
      encoding: "base64",
    });
  }
  for (const attachment of input.attachments ?? []) {
    message.addAttachment({
      filename: header.parse(attachment.filename),
      contentType: header.parse(attachment.mimeType),
      data: Buffer.from(attachment.data).toString("base64"),
      encoding: "base64",
    });
  }
  const raw = Buffer.from(message.asRaw());
  if (raw.byteLength > 25 * 1024 * 1024) {
    throw new Error("Gmail message exceeds the 25 MB sending limit");
  }
  return raw.toString("base64url");
}
