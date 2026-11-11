/**
 * Shared test utilities for all adapter integration tests.
 */

/**
 * WaitUntil tracker for capturing and awaiting async operations
 */
export interface WaitUntilTracker {
  /** Total number of tasks registered through `waitUntil`, including drained ones. */
  taskCount: () => number;
  waitForAll: () => Promise<void>;
  waitUntil: (task: Promise<unknown>) => void;
}

export function createWaitUntilTracker(): WaitUntilTracker {
  const tasks: Promise<unknown>[] = [];
  let registered = 0;
  return {
    taskCount: () => registered,
    waitUntil: (task: Promise<unknown>) => {
      registered++;
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
