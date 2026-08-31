import { createHmac } from "node:crypto";

const CRC_TOKEN_PATTERN = /^[A-Za-z0-9+/=_-]{16,128}$/;
const SIGNATURE_PREFIX = "sha256=";

export function createCrcChallengeResponse(
  request: Request,
  consumerSecret?: string
): Response {
  if (!consumerSecret) {
    return new Response("Consumer secret is not configured", { status: 500 });
  }

  const crcToken = new URL(request.url).searchParams.get("crc_token");
  if (!(crcToken && CRC_TOKEN_PATTERN.test(crcToken))) {
    return new Response("Invalid crc_token", { status: 400 });
  }

  const hash = createHmac("sha256", consumerSecret)
    .update(crcToken, "utf8")
    .digest("base64");

  return Response.json({ response_token: `${SIGNATURE_PREFIX}${hash}` });
}
