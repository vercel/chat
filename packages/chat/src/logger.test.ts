import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConsoleLogger } from "./logger";

describe("ConsoleLogger", () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("default level (info)", () => {
    it("should not log debug messages", () => {
      const logger = new ConsoleLogger();
      logger.debug("hidden");
      expect(debugSpy).not.toHaveBeenCalled();
    });

    it("should log info messages", () => {
      const logger = new ConsoleLogger();
      logger.info("visible");
      expect(infoSpy).toHaveBeenCalledWith("[chat-sdk] visible");
    });

    it("should log warn messages", () => {
      const logger = new ConsoleLogger();
      logger.warn("warning");
      expect(warnSpy).toHaveBeenCalledWith("[chat-sdk] warning");
    });

    it("should log error messages", () => {
      const logger = new ConsoleLogger();
      logger.error("failure");
      expect(errorSpy).toHaveBeenCalledWith("[chat-sdk] failure");
    });
  });

  describe("debug level", () => {
    it("should log all levels including debug", () => {
      const logger = new ConsoleLogger("debug");
      logger.debug("dbg");
      logger.info("inf");
      logger.warn("wrn");
      logger.error("err");
      expect(debugSpy).toHaveBeenCalled();
      expect(infoSpy).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe("warn level", () => {
    it("should only log warn and error", () => {
      const logger = new ConsoleLogger("warn");
      logger.debug("hidden");
      logger.info("hidden");
      logger.warn("visible");
      logger.error("visible");
      expect(debugSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe("error level", () => {
    it("should only log errors", () => {
      const logger = new ConsoleLogger("error");
      logger.debug("hidden");
      logger.info("hidden");
      logger.warn("hidden");
      logger.error("visible");
      expect(debugSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe("silent level", () => {
    it("should not log anything", () => {
      const logger = new ConsoleLogger("silent");
      logger.debug("hidden");
      logger.info("hidden");
      logger.warn("hidden");
      logger.error("hidden");
      expect(debugSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe("prefix formatting", () => {
    it("should use default prefix", () => {
      const logger = new ConsoleLogger("info");
      logger.info("test");
      expect(infoSpy).toHaveBeenCalledWith("[chat-sdk] test");
    });

    it("should use custom prefix", () => {
      const logger = new ConsoleLogger("info", "my-app");
      logger.info("test");
      expect(infoSpy).toHaveBeenCalledWith("[my-app] test");
    });
  });

  describe("extra args passthrough", () => {
    it("should forward extra arguments", () => {
      const logger = new ConsoleLogger("debug");
      const extra = { key: "value" };
      logger.debug("msg", extra, 42);
      expect(debugSpy).toHaveBeenCalledWith("[chat-sdk] msg", extra, 42);
    });
  });

  describe("child logger", () => {
    it("should create child with combined prefix", () => {
      const logger = new ConsoleLogger("info", "parent");
      const child = logger.child("child");
      child.info("test");
      expect(infoSpy).toHaveBeenCalledWith("[parent:child] test");
    });

    it("should inherit log level", () => {
      const logger = new ConsoleLogger("warn", "parent");
      const child = logger.child("child");
      child.info("hidden");
      child.warn("visible");
      expect(infoSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith("[parent:child] visible");
    });
  });
});
