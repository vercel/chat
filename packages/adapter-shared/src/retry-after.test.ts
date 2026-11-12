import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRetryAfter } from "./retry-after";

const HTTP_DATE = "Wed, 21 Oct 2015 07:28:00 GMT";
const HTTP_DATE_MS = Date.UTC(2015, 9, 21, 7, 28, 0);

describe("parseRetryAfter", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it.each([
    [null, undefined],
    ["", undefined],
    ["0", undefined],
    ["-5", undefined],
    ["soon", undefined],
    ["30abc", undefined],
    ["1.5", undefined],
    ["30", 30],
  ])("parses %j as %j", (value, expected) => {
    expect(parseRetryAfter(value)).toBe(expected);
  });

  it("returns undefined for an integer too large to represent", () => {
    expect(parseRetryAfter("9".repeat(400))).toBeUndefined();
  });

  it("rounds a future HTTP date up to whole seconds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(HTTP_DATE_MS - 29_400);
    expect(parseRetryAfter(HTTP_DATE)).toBe(30);
  });

  it.each([
    ["IMF-fixdate", "Wed, 21 Oct 2015 07:28:00 GMT", HTTP_DATE_MS],
    ["RFC 850", "Wednesday, 21-Oct-15 07:28:00 GMT", HTTP_DATE_MS],
    ["asctime", "Wed Oct 21 07:28:00 2015", HTTP_DATE_MS],
    [
      "asctime with a padded day",
      "Thu Oct  1 07:28:00 2015",
      Date.UTC(2015, 9, 1, 7, 28, 0),
    ],
  ])("reads the %s form as GMT", (_label, value, dateMs) => {
    // A zone other than UTC, where reading the date as local time is wrong.
    vi.stubEnv("TZ", "Asia/Tokyo");
    expect(new Date(HTTP_DATE_MS).getTimezoneOffset()).toBe(-540);
    vi.useFakeTimers();
    vi.setSystemTime(dateMs - 3_600_000);
    expect(parseRetryAfter(value)).toBe(3600);
  });

  it.each([
    "max-age=3600",
    "soon 2099",
    "Jan 1 2099",
    "01 Jan 2099 00:00:00 GMT",
    "x Fri, 01 Jan 2099 00:00:00 GMT",
    "Fri, 01 Jan 2099 00:00:00 GMT x",
    "Fri, 01 Jan 2099 00:00:00 GMT+0100",
    "Fri, 01 Jan 2099 00:00:00 +0100",
  ])("returns undefined for %j, which is not an HTTP date", (value) => {
    expect(parseRetryAfter(value)).toBeUndefined();
  });

  it("returns undefined for an HTTP date in the past", () => {
    vi.useFakeTimers();
    vi.setSystemTime(HTTP_DATE_MS + 5000);
    expect(parseRetryAfter(HTTP_DATE)).toBeUndefined();
  });

  it("returns undefined for an HTTP date equal to the current time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(HTTP_DATE_MS);
    expect(parseRetryAfter(HTTP_DATE)).toBeUndefined();
  });

  it("returns undefined for a date that cannot be parsed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(HTTP_DATE_MS);
    expect(parseRetryAfter("Wed, 41 Oct 2015 07:28:00 GMT")).toBeUndefined();
  });

  // V8 parses bare numbers such as "-5" and "1.5" as dates around 2000, which
  // the real clock hides because those dates are in the past.
  it.each(["-5", "1.5"])("does not read %j as a date", (value) => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(1990, 0, 1));
    expect(parseRetryAfter(value)).toBeUndefined();
  });
});
