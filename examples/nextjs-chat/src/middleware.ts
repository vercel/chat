import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createClient } from "redis";

export const runtime = "nodejs";

// Redis URL from environment
const REDIS_URL = process.env.REDIS_URL || "";

// Key for storing the preview branch URL
const PREVIEW_BRANCH_KEY = "chat-sdk:cache:preview-branch-url";

// Redis client singleton
let redisClient: ReturnType<typeof createClient> | null = null;
let redisConnectPromise: Promise<void> | null = null;

async function getRedisClient() {
  if (!REDIS_URL) {
    return null;
  }

  if (!redisClient) {
    redisClient = createClient({ url: REDIS_URL });
    redisClient.on("error", (err) => {
      console.error("[middleware] Redis client error:", err);
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

/**
 * Fetch the preview branch URL from Redis.
 */
async function getPreviewBranchUrl(): Promise<string | null> {
  try {
    const client = await getRedisClient();
    if (!client) {
      return null;
    }

    const value = await client.get(PREVIEW_BRANCH_KEY);
    return value || null;
  } catch (error) {
    console.error("[middleware] Error fetching preview branch URL:", error);
    return null;
  }
}

export async function middleware(request: NextRequest) {
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.next();
  }

  if (process.env.VERCEL_ENV !== "production") {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  // Check if we have a preview branch configured
  const previewBranchUrl = await getPreviewBranchUrl();

  if (!previewBranchUrl) {
    // No preview branch configured, continue normally
    return NextResponse.next();
  }

  // Rewrite the request to the preview branch URL
  const targetUrl = new URL(
    pathname + request.nextUrl.search,
    previewBranchUrl
  );

  console.warn(`[middleware] Proxying ${pathname} to ${targetUrl.hostname}`);

  // Proxy the request to the preview branch
  return NextResponse.rewrite(targetUrl);
}

export const config = {
  matcher: [
    // Match webhook API routes
    "/api/webhooks/:path*",
  ],
};
