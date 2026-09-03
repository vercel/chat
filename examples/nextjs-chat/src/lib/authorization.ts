import { timingSafeEqual } from "node:crypto";

export function authorizePreviewBranchRequest(
  request: Request
): Response | null {
  const secret = process.env.PREVIEW_BRANCH_SECRET;
  if (!secret) {
    return Response.json(
      { error: "PREVIEW_BRANCH_SECRET is not configured" },
      { status: 503 }
    );
  }

  const authorization = request.headers.get("authorization");
  const provided = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  const expectedBytes = Buffer.from(secret);
  const providedBytes = Buffer.from(provided);
  if (
    expectedBytes.length !== providedBytes.length ||
    !timingSafeEqual(expectedBytes, providedBytes)
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
