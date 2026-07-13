import type { H3Event } from "h3";

export function toChatRequest(event: H3Event): Request {
  const request = (event as { req?: unknown }).req;
  if (request instanceof Request) {
    return request;
  }

  throw new Error("Unable to convert H3Event to a Fetch Request");
}
