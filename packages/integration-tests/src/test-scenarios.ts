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
      await Promise.all(tasks);
      tasks.length = 0;
    },
  };
}
