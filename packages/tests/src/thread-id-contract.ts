import { describe, expect, it } from "vitest";

/**
 * A decoded thread descriptor paired with the adapter that produced it. The
 * `encoded` field is optional: when present the contract also pins the exact
 * encoded string, otherwise it only asserts the decode(encode(x)) round-trip.
 */
export interface ThreadIdCase<TDecoded> {
  decoded: TDecoded;
  encoded?: string;
}

/**
 * Per-adapter hooks the {@link threadIdContract} runner needs.
 *
 * `encode`/`decode` should delegate to the adapter's `encodeThreadId` /
 * `decodeThreadId` (wrap in arrows so `this` binds correctly).
 */
export interface ThreadIdContractDescriptor<TDecoded> {
  /** Sample descriptors to round-trip. */
  cases: readonly ThreadIdCase<TDecoded>[];
  /** Decode a thread-id string back into a descriptor. */
  decode: (id: string) => TDecoded;
  /** Encode a decoded thread descriptor into a thread-id string. */
  encode: (decoded: TDecoded) => string;
  /**
   * Optional DM detection check: an `isDM` function plus a DM thread id
   * (expected `true`) and a non-DM thread id (expected `false`).
   */
  isDM?: {
    fn: (id: string) => boolean;
    dmThreadId: string;
    nonDmThreadId: string;
  };
  /** Label + expected thread-id prefix (the `{adapter}` in `{adapter}:...`). */
  name: string;
}

/**
 * Shared Vitest suite for an adapter's thread-id codec.
 *
 * Asserts every case round-trips (`decode(encode(x))` deep-equals `x`), encoded
 * ids carry the `{name}:` prefix, any pinned `encoded` strings match exactly,
 * and (optionally) `isDM` distinguishes DM from non-DM threads. Call it at the
 * top level of an adapter's test file.
 *
 * ```ts
 * threadIdContract({
 *   name: "github",
 *   encode: (d) => adapter.encodeThreadId(d),
 *   decode: (id) => adapter.decodeThreadId(id),
 *   cases: [{ decoded: { owner: "acme", repo: "app", prNumber: 1, type: "pr" } }],
 * });
 * ```
 */
export function threadIdContract<TDecoded>(
  descriptor: ThreadIdContractDescriptor<TDecoded>
): void {
  describe(`thread id contract (${descriptor.name})`, () => {
    it("prefixes encoded thread ids with the adapter name", () => {
      for (const testCase of descriptor.cases) {
        expect(
          descriptor.encode(testCase.decoded).startsWith(`${descriptor.name}:`)
        ).toBe(true);
      }
    });

    it("round-trips decode(encode(x))", () => {
      for (const testCase of descriptor.cases) {
        expect(descriptor.decode(descriptor.encode(testCase.decoded))).toEqual(
          testCase.decoded
        );
      }
    });

    it("matches pinned encoded strings", () => {
      for (const testCase of descriptor.cases) {
        if (testCase.encoded !== undefined) {
          expect(descriptor.encode(testCase.decoded)).toBe(testCase.encoded);
        }
      }
    });

    if (descriptor.isDM) {
      const { fn, dmThreadId, nonDmThreadId } = descriptor.isDM;
      it("distinguishes DM from non-DM threads", () => {
        expect(fn(dmThreadId)).toBe(true);
        expect(fn(nonDmThreadId)).toBe(false);
      });
    }
  });
}
