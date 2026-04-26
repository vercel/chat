/**
 * Shared test utilities for all adapter integration tests.
 */

/**
 * WaitUntil tracker for capturing and awaiting async operations
 */
export interface WaitUntilTracker {
  waitForAll: () => Promise<void>;
  waitUntil: (task: Promise<unknown>) => void;
}

export function createWaitUntilTracker(): WaitUntilTracker {
  const tasks: Promise<unknown>[] = [];
  return {
    waitUntil: (task: Promise<unknown>) => {
      tasks.push(task);
    },
    waitForAll: async () => {
      // drain in a loop: awaited tasks may register more via waitUntil mid-flight
      while (tasks.length > 0) {
        const pending = tasks.splice(0);
        await Promise.all(pending);
      }
    },
  };
}
