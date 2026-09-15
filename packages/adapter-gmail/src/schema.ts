import { z } from "zod";

const controls = /[\r\n\0]/;

export const identifier = z
  .string()
  .regex(/^[a-zA-Z0-9_-]+$/)
  .max(256);
export const historyId = z.string().regex(/^\d+$/).max(64);
export const mailbox = z
  .email()
  .max(320)
  .transform((value) => value.toLowerCase());
export const reference = z.object({ id: identifier, threadId: identifier });
export const metadata = reference.extend({
  labelIds: z.array(identifier).default([]),
});
export const prepared = z.object({
  raw: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+={0,2}$/)
    .max(34_952_536),
  threadId: identifier.optional(),
});
export const message = metadata.extend({
  historyId: historyId.optional(),
  internalDate: z.string().regex(/^\d+$/),
  raw: z.string().regex(/^[a-zA-Z0-9_-]*={0,2}$/),
  snippet: z.string().optional(),
});
const changed = reference.extend({ labelIds: z.array(identifier).optional() });
const membership = z.object({
  message: changed,
  labelIds: z.array(identifier),
});
export const historyType = z.enum([
  "messageAdded",
  "messageDeleted",
  "labelAdded",
  "labelRemoved",
]);
export const history = z.object({
  history: z
    .array(
      z.object({
        id: historyId,
        messages: z.array(changed).default([]),
        messagesAdded: z.array(z.object({ message: changed })).default([]),
        messagesDeleted: z.array(z.object({ message: changed })).default([]),
        labelsAdded: z.array(membership).default([]),
        labelsRemoved: z.array(membership).default([]),
      })
    )
    .default([]),
  historyId,
  nextPageToken: z.string().optional(),
});
export const listing = z.object({
  messages: z.array(reference).default([]),
  nextPageToken: z.string().optional(),
  resultSizeEstimate: z.number().int().nonnegative().optional(),
});
export const thread = z.object({
  id: identifier,
  messages: z.array(reference).default([]),
});
export const watch = z.object({
  historyId,
  expiration: z.string().regex(/^\d+$/),
});
export const profile = z.object({ emailAddress: mailbox, historyId });
const label = z.object({
  id: identifier,
  name: z.string(),
  type: z.enum(["system", "user"]),
  messageListVisibility: z.enum(["show", "hide"]).optional(),
  labelListVisibility: z
    .enum(["labelShow", "labelShowIfUnread", "labelHide"])
    .optional(),
});
export const labels = z.object({ labels: z.array(label).default([]) });
export const draft = z.object({ id: identifier, message: reference });
export const address = z.object({
  address: z.email().max(320),
  name: z.string().optional(),
});
export const continuation = z.object({
  mailbox,
  threadId: identifier,
  messageId: identifier,
  subject: z
    .string()
    .max(998)
    .refine((value) => !controls.test(value)),
  inReplyTo: z
    .string()
    .regex(/^<[^<>\s]+>$/)
    .max(998),
  references: z
    .array(
      z
        .string()
        .regex(/^<[^<>\s]+>$/)
        .max(998)
    )
    .max(100),
  to: z.array(address).min(1).max(100),
  cc: z.array(address).max(100).optional(),
});

export type GmailMessage = z.infer<typeof message>;
export type GmailMetadata = z.infer<typeof metadata>;
export type GmailPreparedMessage = z.infer<typeof prepared>;
export type GmailHistory = z.infer<typeof history>;
export type GmailHistoryType = z.infer<typeof historyType>;
export type GmailListing = z.infer<typeof listing>;
export type GmailThread = z.infer<typeof thread>;
export type GmailWatch = z.infer<typeof watch>;
export type GmailProfile = z.infer<typeof profile>;
export type GmailLabel = z.infer<typeof label>;
export type GmailLabels = z.infer<typeof labels>;
export type GmailReference = z.infer<typeof reference>;
export type GmailDraft = z.infer<typeof draft>;
export type GmailContinuation = z.infer<typeof continuation>;
export type GmailAddress = z.infer<typeof address>;
