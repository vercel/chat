import { describe, expect, it, vi } from "vitest";
import { TokenBucket } from "./rate-limit";

describe("TokenBucket", () => {
  it("allows burst up to capacity then waits", async () => {
    vi.useFakeTimers();
    const bucket = new TokenBucket(2, 2);

    await bucket.acquire();
    await bucket.acquire();

    const third = bucket.acquire();
    let resolved = false;
    third.then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(600);
    await third;
    expect(resolved).toBe(true);

    vi.useRealTimers();
  });
});
