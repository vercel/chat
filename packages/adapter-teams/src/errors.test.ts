import {
  AdapterRateLimitError,
  AuthenticationError,
  NetworkError,
  PermissionError,
} from "@chat-adapter/shared";
import { describe, expect, it } from "vitest";
import { handleTeamsError } from "./errors";

describe("handleTeamsError", () => {
  it("should throw AuthenticationError for 401 status", () => {
    expect(() =>
      handleTeamsError(
        { statusCode: 401, message: "Unauthorized" },
        "postMessage"
      )
    ).toThrow(AuthenticationError);
  });

  it("should throw PermissionError for 403 status", () => {
    expect(() =>
      handleTeamsError({ statusCode: 403, message: "Forbidden" }, "postMessage")
    ).toThrow(PermissionError);
  });

  it("should throw NetworkError for 404 status", () => {
    expect(() =>
      handleTeamsError({ statusCode: 404, message: "Not found" }, "editMessage")
    ).toThrow(NetworkError);
  });

  it("should throw AdapterRateLimitError for 429 status", () => {
    expect(() =>
      handleTeamsError({ statusCode: 429, retryAfter: 30 }, "postMessage")
    ).toThrow(AdapterRateLimitError);
  });

  it("should handle TeamsSDK HttpError with innerHttpError", () => {
    expect(() =>
      handleTeamsError(
        { innerHttpError: { statusCode: 401 }, message: "Auth failed" },
        "postMessage"
      )
    ).toThrow(AuthenticationError);
  });

  it("should throw AdapterRateLimitError with retryAfter for 429", () => {
    try {
      handleTeamsError({ statusCode: 429, retryAfter: 60 }, "postMessage");
    } catch (error) {
      expect(error).toBeInstanceOf(AdapterRateLimitError);
      expect((error as AdapterRateLimitError).retryAfter).toBe(60);
    }
  });

  it("should throw PermissionError for messages containing 'permission'", () => {
    expect(() =>
      handleTeamsError(
        { message: "Insufficient Permission to complete the operation" },
        "deleteMessage"
      )
    ).toThrow(PermissionError);
  });

  it("should throw NetworkError for generic errors with message", () => {
    expect(() =>
      handleTeamsError({ message: "Connection reset" }, "startTyping")
    ).toThrow(NetworkError);
  });

  it("should throw NetworkError for unknown error types", () => {
    expect(() => handleTeamsError("some string error", "postMessage")).toThrow(
      NetworkError
    );
  });

  it("should throw NetworkError for null/undefined errors", () => {
    expect(() => handleTeamsError(null, "postMessage")).toThrow(NetworkError);
  });

  it("should use status field if statusCode not present", () => {
    expect(() =>
      handleTeamsError({ status: 401, message: "Unauthorized" }, "postMessage")
    ).toThrow(AuthenticationError);
  });

  it("should use code field if statusCode and status not present", () => {
    expect(() => handleTeamsError({ code: 429 }, "postMessage")).toThrow(
      AdapterRateLimitError
    );
  });
});
