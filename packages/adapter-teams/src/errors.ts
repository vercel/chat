import {
  AdapterRateLimitError,
  AuthenticationError,
  NetworkError,
  PermissionError,
} from "@chat-adapter/shared";

export function handleTeamsError(error: unknown, operation: string): never {
  if (error && typeof error === "object") {
    const err = error as Record<string, unknown>;

    // Check for TeamsSDK HttpError shape: innerHttpError.statusCode
    const innerError = err.innerHttpError as
      | Record<string, unknown>
      | undefined;
    const statusCode =
      (innerError?.statusCode as number) ||
      (err.statusCode as number) ||
      (err.status as number) ||
      (err.code as number);

    if (statusCode === 401) {
      throw new AuthenticationError(
        "teams",
        `Authentication failed for ${operation}: ${err.message || "unauthorized"}`
      );
    }

    if (
      statusCode === 403 ||
      (err.message &&
        typeof err.message === "string" &&
        err.message.toLowerCase().includes("permission"))
    ) {
      throw new PermissionError("teams", operation);
    }

    if (statusCode === 404) {
      throw new NetworkError(
        "teams",
        `Resource not found during ${operation}: conversation or message may no longer exist`,
        error instanceof Error ? error : undefined
      );
    }

    if (statusCode === 429) {
      const retryAfter =
        typeof err.retryAfter === "number" ? err.retryAfter : undefined;
      throw new AdapterRateLimitError("teams", retryAfter);
    }

    if (err.message && typeof err.message === "string") {
      throw new NetworkError(
        "teams",
        `Teams API error during ${operation}: ${err.message}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  throw new NetworkError(
    "teams",
    `Teams API error during ${operation}: ${String(error)}`,
    error instanceof Error ? error : undefined
  );
}
