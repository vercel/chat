/**
 * Shared fixtures for Slack adapter tests.
 */

import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";

/**
 * Builds a minimal IncomingMessage for stubbing an AttachmentTransport.
 * Pass a never-ending Readable as `body` to model a stalled download.
 */
export function incomingMessage(
  body: Buffer | Readable = Buffer.from("file"),
  {
    headers = {},
    statusCode = 200,
    statusMessage = "OK",
  }: {
    headers?: IncomingMessage["headers"];
    statusCode?: number;
    statusMessage?: string;
  } = {}
): IncomingMessage {
  const stream = Buffer.isBuffer(body) ? Readable.from([body]) : body;
  return Object.assign(stream, {
    headers,
    statusCode,
    statusMessage,
  }) as IncomingMessage;
}

/** A message event carrying one private Slack file. */
export const fileMessageEvent = {
  type: "message",
  user: "U123",
  channel: "C123",
  text: "file",
  ts: "1.1",
  files: [
    {
      id: "F123",
      name: "file.pdf",
      mimetype: "application/pdf",
      url_private: "https://files.slack.com/file.pdf",
    },
  ],
};
