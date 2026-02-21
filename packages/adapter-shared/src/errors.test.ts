/**
 * Tests for standardized error types.
 */
import { describe, expect, it } from "vitest";
import {
  AdapterError,
  AdapterRateLimitError,
  AuthenticationError,
  NetworkError,
  PermissionError,
  ResourceNotFoundError,
  ValidationError,
} from "./errors";

describe("AdapterError", () => {
  it("creates error with message, adapter, and code", () => {
    const error = new AdapterError("Something failed", "slack", "CUSTOM_CODE");
    expect(error.message).toBe("Something failed");
    expect(error.adapter).toBe("slack");
    expect(error.code).toBe("CUSTOM_CODE");
    expect(error.name).toBe("AdapterError");
  });

  it("is an instance of Error", () => {
    const error = new AdapterError("test", "slack");
    expect(error).toBeInstanceOf(Error);
  });

  it("works without code", () => {
    const error = new AdapterError("test", "teams");
    expect(error.code).toBeUndefined();
  });
});

describe("AdapterRateLimitError", () => {
  it("creates error with retry after", () => {
    const error = new AdapterRateLimitError("slack", 30);
    expect(error.message).toBe("Rate limited by slack, retry after 30s");
    expect(error.adapter).toBe("slack");
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.retryAfter).toBe(30);
    expect(error.name).toBe("AdapterRateLimitError");
  });

  it("creates error without retry after", () => {
    const error = new AdapterRateLimitError("teams");
    expect(error.message).toBe("Rate limited by teams");
    expect(error.retryAfter).toBeUndefined();
  });

  it("is an instance of AdapterError", () => {
    const error = new AdapterRateLimitError("slack");
    expect(error).toBeInstanceOf(AdapterError);
  });
});

describe("AuthenticationError", () => {
  it("creates error with custom message", () => {
    const error = new AuthenticationError("slack", "Token expired");
    expect(error.message).toBe("Token expired");
    expect(error.adapter).toBe("slack");
    expect(error.code).toBe("AUTH_FAILED");
    expect(error.name).toBe("AuthenticationError");
  });

  it("creates error with default message", () => {
    const error = new AuthenticationError("teams");
    expect(error.message).toBe("Authentication failed for teams");
  });

  it("is an instance of AdapterError", () => {
    const error = new AuthenticationError("slack");
    expect(error).toBeInstanceOf(AdapterError);
  });
});

describe("ResourceNotFoundError", () => {
  it("creates error with resource type and id", () => {
    const error = new ResourceNotFoundError("slack", "channel", "C123456");
    expect(error.message).toBe("channel 'C123456' not found in slack");
    expect(error.adapter).toBe("slack");
    expect(error.code).toBe("NOT_FOUND");
    expect(error.resourceType).toBe("channel");
    expect(error.resourceId).toBe("C123456");
    expect(error.name).toBe("ResourceNotFoundError");
  });

  it("creates error without resource id", () => {
    const error = new ResourceNotFoundError("teams", "user");
    expect(error.message).toBe("user not found in teams");
    expect(error.resourceId).toBeUndefined();
  });

  it("is an instance of AdapterError", () => {
    const error = new ResourceNotFoundError("slack", "thread");
    expect(error).toBeInstanceOf(AdapterError);
  });
});

describe("PermissionError", () => {
  it("creates error with action and scope", () => {
    const error = new PermissionError("slack", "send messages", "chat:write");
    expect(error.message).toBe(
      "Permission denied: cannot send messages in slack (requires: chat:write)"
    );
    expect(error.adapter).toBe("slack");
    expect(error.code).toBe("PERMISSION_DENIED");
    expect(error.action).toBe("send messages");
    expect(error.requiredScope).toBe("chat:write");
    expect(error.name).toBe("PermissionError");
  });

  it("creates error without scope", () => {
    const error = new PermissionError("teams", "delete messages");
    expect(error.message).toBe(
      "Permission denied: cannot delete messages in teams"
    );
    expect(error.requiredScope).toBeUndefined();
  });

  it("is an instance of AdapterError", () => {
    const error = new PermissionError("gchat", "test");
    expect(error).toBeInstanceOf(AdapterError);
  });
});

describe("ValidationError", () => {
  it("creates error with message", () => {
    const error = new ValidationError(
      "slack",
      "Message text exceeds 40000 characters"
    );
    expect(error.message).toBe("Message text exceeds 40000 characters");
    expect(error.adapter).toBe("slack");
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.name).toBe("ValidationError");
  });

  it("is an instance of AdapterError", () => {
    const error = new ValidationError("teams", "Invalid");
    expect(error).toBeInstanceOf(AdapterError);
  });
});

describe("NetworkError", () => {
  it("creates error with custom message", () => {
    const error = new NetworkError("slack", "Connection timeout after 30s");
    expect(error.message).toBe("Connection timeout after 30s");
    expect(error.adapter).toBe("slack");
    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.name).toBe("NetworkError");
  });

  it("creates error with default message", () => {
    const error = new NetworkError("gchat");
    expect(error.message).toBe("Network error communicating with gchat");
  });

  it("can wrap original error", () => {
    const original = new Error("ECONNREFUSED");
    const error = new NetworkError("teams", "Connection refused", original);
    expect(error.originalError).toBe(original);
  });

  it("is an instance of AdapterError", () => {
    const error = new NetworkError("slack");
    expect(error).toBeInstanceOf(AdapterError);
  });
});

describe("Error hierarchy", () => {
  it("all errors extend AdapterError", () => {
    const errors = [
      new AdapterRateLimitError("slack"),
      new AuthenticationError("slack"),
      new ResourceNotFoundError("slack", "test"),
      new PermissionError("slack", "test"),
      new ValidationError("slack", "test"),
      new NetworkError("slack"),
    ];

    for (const error of errors) {
      expect(error).toBeInstanceOf(AdapterError);
      expect(error).toBeInstanceOf(Error);
    }
  });

  it("can be caught by adapter name", () => {
    const slackErrors: AdapterError[] = [];

    try {
      throw new AdapterRateLimitError("slack", 30);
    } catch (e) {
      if (e instanceof AdapterError && e.adapter === "slack") {
        slackErrors.push(e);
      }
    }

    expect(slackErrors).toHaveLength(1);
    expect(slackErrors[0].adapter).toBe("slack");
  });

  it("can be caught by error code", () => {
    const rateLimitErrors: AdapterError[] = [];

    const errors: AdapterError[] = [
      new AdapterRateLimitError("slack"),
      new AuthenticationError("teams"),
      new AdapterRateLimitError("gchat"),
    ];

    for (const error of errors) {
      if (error.code === "RATE_LIMITED") {
        rateLimitErrors.push(error);
      }
    }

    expect(rateLimitErrors).toHaveLength(2);
  });
});
