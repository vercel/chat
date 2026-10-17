import { vi } from "vitest";

/** A contract case collected by {@link collectContractTests}, keyed by name. */
export type CollectedTests = Map<string, () => Promise<unknown>>;

/**
 * Load a contract module with Vitest's `describe` and `it` swapped for
 * collectors, call `register` with it, and return the cases the contract
 * registered so a test can run each one itself.
 *
 * Running a contract the normal way only proves it passes for a compliant
 * adapter. Collecting its cases also lets a test assert that a specific case
 * fails for an adapter that breaks the behavior that case guards.
 */
export async function collectContractTests<TModule>(
  load: () => Promise<TModule>,
  register: (module: TModule) => void
): Promise<CollectedTests> {
  const tests: CollectedTests = new Map();
  vi.resetModules();
  vi.doMock("vitest", async (importOriginal) => ({
    ...(await importOriginal<typeof import("vitest")>()),
    describe: (_name: string, body: () => void) => body(),
    it: (name: string, body: () => unknown) => {
      tests.set(name, async () => await body());
    },
  }));
  try {
    register(await load());
  } finally {
    vi.doUnmock("vitest");
  }
  return tests;
}

/** Look up a collected case by name, failing loudly if it was not registered. */
export function getCase(
  tests: CollectedTests,
  name: string
): () => Promise<unknown> {
  const run = tests.get(name);
  if (!run) {
    throw new Error(
      `contract case "${name}" not registered; got: ${[...tests.keys()].join(", ")}`
    );
  }
  return run;
}
