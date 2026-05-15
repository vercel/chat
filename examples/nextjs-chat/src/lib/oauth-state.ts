import { randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * OAuth `state` (CSRF) helpers for install/callback routes.
 *
 * Generate a fresh, opaque, single-use state value before redirecting to the
 * provider, persist it in an HttpOnly cookie scoped to the callback path, and
 * validate it on the way back. This binds the user who started the flow to
 * the user who completes it, defeating the classic OAuth login-CSRF where
 * an attacker tricks a victim into completing the attacker's flow (or vice
 * versa) and the wrong tokens get associated with the wrong account.
 *
 * Cookie: HttpOnly + Secure (in production) + SameSite=Lax + scoped to the
 * callback path so the browser sends it nowhere else. The cookie is consumed
 * (deleted) on first read so a stolen state can't be replayed.
 */

const STATE_BYTE_LENGTH = 32;
const STATE_TTL_SECONDS = 10 * 60;

/** Generate an opaque state value, store it in a scoped cookie, and return it. */
export async function issueOAuthState(options: {
  cookieName: string;
  callbackPath: string;
}): Promise<string> {
  const value = randomBytes(STATE_BYTE_LENGTH).toString("base64url");
  const store = await cookies();
  store.set(options.cookieName, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: options.callbackPath,
    maxAge: STATE_TTL_SECONDS,
  });
  return value;
}

/**
 * Read and consume the state cookie, then constant-time-compare it to the
 * `state` query parameter on the incoming request. Returns true only if both
 * are present and match.
 */
export async function consumeAndVerifyOAuthState(options: {
  request: Request;
  cookieName: string;
  callbackPath: string;
}): Promise<boolean> {
  const url = new URL(options.request.url);
  const queryState = url.searchParams.get("state");
  const store = await cookies();
  const cookieState = store.get(options.cookieName)?.value;
  // Always clear, even on failure — the value is single-use.
  store.delete({ name: options.cookieName, path: options.callbackPath });
  if (!(queryState && cookieState)) {
    return false;
  }
  const a = Buffer.from(queryState);
  const b = Buffer.from(cookieState);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
