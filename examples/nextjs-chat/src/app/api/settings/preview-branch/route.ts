import { createClient } from "redis";
import { authorizePreviewBranchRequest } from "@/lib/authorization";
import {
  PREVIEW_BRANCH_KEY,
  parseAllowedPreviewBranchUrl,
} from "@/lib/preview-branch";

const REDIS_URL = process.env.REDIS_URL || "";

// Redis client singleton
let redisClient: ReturnType<typeof createClient> | null = null;
let redisConnectPromise: Promise<void> | null = null;

async function getRedisClient() {
  if (!REDIS_URL) {
    throw new Error("REDIS_URL is not configured");
  }

  if (!redisClient) {
    redisClient = createClient({ url: REDIS_URL });
    redisClient.on("error", (err) => {
      console.error("[settings] Redis client error:", err);
    });
  }

  if (!redisClient.isOpen) {
    if (!redisConnectPromise) {
      redisConnectPromise = redisClient.connect().then(() => {});
    }
    await redisConnectPromise;
  }

  return redisClient;
}

export async function GET(request: Request): Promise<Response> {
  const unauthorized = authorizePreviewBranchRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const client = await getRedisClient();
    const value = await client.get(PREVIEW_BRANCH_KEY);

    return Response.json({ url: value || null });
  } catch (error) {
    console.error("[settings] Error getting preview branch URL:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  const unauthorized = authorizePreviewBranchRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const body: unknown = await request.json();
    if (!(body && typeof body === "object" && "url" in body)) {
      return Response.json({ error: "Missing URL" }, { status: 400 });
    }
    const { url } = body as { url: unknown };

    const client = await getRedisClient();

    if (typeof url === "string" && url.length > 0) {
      const allowedUrl = parseAllowedPreviewBranchUrl(url);
      if (!allowedUrl) {
        return Response.json(
          {
            error:
              "URL must be an HTTPS Vercel deployment or a configured allowed host",
          },
          { status: 400 }
        );
      }
      await client.set(PREVIEW_BRANCH_KEY, allowedUrl.origin);
      return Response.json({ success: true, url: allowedUrl.origin });
    }
    if (url === null || url === "") {
      // Clear the preview branch URL
      await client.del(PREVIEW_BRANCH_KEY);
      return Response.json({ success: true, url: null });
    }

    return Response.json(
      { error: "URL must be a string or null" },
      {
        status: 400,
      }
    );
  } catch (error) {
    console.error("[settings] Error setting preview branch URL:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
