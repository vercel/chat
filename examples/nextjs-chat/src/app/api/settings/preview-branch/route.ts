import { createClient } from "redis";

const REDIS_URL = process.env.REDIS_URL || "";
const PREVIEW_BRANCH_KEY = "chat-sdk:cache:preview-branch-url";

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

export async function GET(): Promise<Response> {
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
  try {
    const body = await request.json();
    const { url } = body;

    const client = await getRedisClient();

    if (url) {
      // Validate URL
      try {
        new URL(url);
      } catch {
        return Response.json({ error: "Invalid URL" }, { status: 400 });
      }
      await client.set(PREVIEW_BRANCH_KEY, url);
    } else {
      // Clear the preview branch URL
      await client.del(PREVIEW_BRANCH_KEY);
    }

    return Response.json({ success: true, url: url || null });
  } catch (error) {
    console.error("[settings] Error setting preview branch URL:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
