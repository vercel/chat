const DELAY_SECONDS_PATTERN = /^\d+$/;
// The three HTTP-date forms: IMF-fixdate and RFC 850 end in "GMT", asctime
// ends in the year and names no zone. Anything else stays away from
// Date.parse, which reads values such as "-5" and "1.5" as dates.
const HTTP_DATE_PATTERN =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,? .*\d{2}:\d{2}:\d{2} (?:GMT|\d{4})$/;
const GMT_SUFFIX = " GMT";

/**
 * Parse a `Retry-After` header, given either as a delay in seconds or as an
 * HTTP date.
 *
 * @returns The positive number of seconds to wait (a date is measured from
 * now and rounded up), or `undefined` when the header is missing, is not a
 * positive integer, or is a date that cannot be parsed or is not in the
 * future.
 */
export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  if (DELAY_SECONDS_PATTERN.test(value)) {
    const seconds = Number.parseInt(value, 10);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
  }
  if (!HTTP_DATE_PATTERN.test(value)) {
    return undefined;
  }
  // An asctime date is in GMT. Without a zone, Date.parse reads it as local time.
  const date = value.endsWith(GMT_SUFFIX) ? value : `${value}${GMT_SUFFIX}`;
  const seconds = Math.ceil((Date.parse(date) - Date.now()) / 1000);
  return seconds > 0 ? seconds : undefined;
}
