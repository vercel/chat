import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APPROVAL_PREFIX,
  ApprovalRegistry,
  type ApprovalResult,
  buildApprovalCard,
  buildExpiredCard,
  buildResolvedCard,
  consumePendingApproval,
  defaultApprovalCard,
  isApprovalActionId,
  parseApprovalAction,
  type StoredApproval,
  storePendingApproval,
} from "./approval";
import type { Author } from "./types";

// ── Helpers ─────────────────────────────────────────────────────────────────

const makeUser = (overrides?: Partial<Author>): Author => ({
  userId: "u1",
  userName: "alice",
  fullName: "Alice",
  isBot: false,
  isMe: false,
  ...overrides,
});

const makeResult = (
  id: string,
  approved: boolean,
  overrides?: Partial<ApprovalResult>
): ApprovalResult => ({
  id,
  approved,
  user: makeUser(),
  ...overrides,
});

const makeStoredApproval = (
  overrides?: Partial<StoredApproval>
): StoredApproval => ({
  id: "test-123",
  title: "Test",
  adapterName: "slack",
  createdAt: new Date().toISOString(),
  thread: {} as StoredApproval["thread"],
  updateCard: true,
  ...overrides,
});

// ============================================================================
// buildApprovalCard
// ============================================================================

describe("buildApprovalCard", () => {
  it("should build a card with approve and deny buttons", () => {
    const card = buildApprovalCard({
      id: "test-123",
      title: "Test Approval",
    });

    expect(card.type).toBe("card");
    expect(card.title).toBe("Test Approval");

    const actions = card.children.find((c) => c.type === "actions");
    expect(actions).toBeDefined();
    if (actions?.type === "actions") {
      expect(actions.children).toHaveLength(2);
      const [approve, deny] = actions.children;
      expect(approve).toMatchObject({
        type: "button",
        id: `${APPROVAL_PREFIX}:test-123:approve`,
        label: "Approve",
        style: "primary",
      });
      expect(deny).toMatchObject({
        type: "button",
        id: `${APPROVAL_PREFIX}:test-123:deny`,
        label: "Deny",
        style: "danger",
      });
    }
  });

  it("should include description text", () => {
    const card = buildApprovalCard({
      id: "test",
      title: "Test",
      description: "Please review this action.",
    });

    const textChild = card.children.find(
      (c) => c.type === "text" && c.content === "Please review this action."
    );
    expect(textChild).toBeDefined();
  });

  it("should include fields", () => {
    const card = buildApprovalCard({
      id: "test",
      title: "Test",
      fields: { Amount: "$500", To: "acct_123" },
    });

    const fieldsChild = card.children.find((c) => c.type === "fields");
    expect(fieldsChild).toBeDefined();
    if (fieldsChild?.type === "fields") {
      expect(fieldsChild.children).toHaveLength(2);
      expect(fieldsChild.children[0]).toMatchObject({
        type: "field",
        label: "Amount",
        value: "$500",
      });
      expect(fieldsChild.children[1]).toMatchObject({
        type: "field",
        label: "To",
        value: "acct_123",
      });
    }
  });

  it("should support custom button labels", () => {
    const card = buildApprovalCard({
      id: "test",
      title: "Test",
      approveLabel: "Yes, Delete",
      denyLabel: "Cancel",
    });

    const actions = card.children.find((c) => c.type === "actions");
    if (actions?.type === "actions") {
      expect(actions.children[0]).toMatchObject({ label: "Yes, Delete" });
      expect(actions.children[1]).toMatchObject({ label: "Cancel" });
    }
  });

  it("should include custom children before the buttons", () => {
    const card = buildApprovalCard({
      id: "test",
      title: "Test",
      children: [{ type: "text", content: "Custom content" }],
    });

    const customText = card.children.find(
      (c) => c.type === "text" && c.content === "Custom content"
    );
    expect(customText).toBeDefined();
    if (!customText) {
      throw new Error("expected customText");
    }

    // Custom content should come before divider+actions
    const customIdx = card.children.indexOf(customText);
    const dividerIdx = card.children.findIndex((c) => c.type === "divider");
    expect(customIdx).toBeLessThan(dividerIdx);
  });

  it("should build a minimal card with only title and no optional fields", () => {
    const card = buildApprovalCard({ id: "minimal", title: "Minimal" });

    // Should only have divider + actions (no description, no fields, no children)
    expect(card.children).toHaveLength(2);
    expect(card.children[0].type).toBe("divider");
    expect(card.children[1].type).toBe("actions");
  });

  it("should skip fields when the fields object is empty", () => {
    const card = buildApprovalCard({
      id: "empty-fields",
      title: "Test",
      fields: {},
    });

    const fieldsChild = card.children.find((c) => c.type === "fields");
    expect(fieldsChild).toBeUndefined();
  });

  it("should include description, fields, and children in the correct order", () => {
    const card = buildApprovalCard({
      id: "ordering",
      title: "Ordering Test",
      description: "Desc",
      fields: { Key: "Val" },
      children: [{ type: "text", content: "Extra" }],
    });

    const types = card.children.map((c) => c.type);
    // description (text), fields, custom child (text), divider, actions
    expect(types).toEqual(["text", "fields", "text", "divider", "actions"]);
  });

  it("should handle multiple custom children", () => {
    const card = buildApprovalCard({
      id: "multi",
      title: "Multi",
      children: [
        { type: "text", content: "First" },
        { type: "text", content: "Second" },
        { type: "text", content: "Third" },
      ],
    });

    const textChildren = card.children.filter(
      (c) =>
        c.type === "text" && ["First", "Second", "Third"].includes(c.content)
    );
    expect(textChildren).toHaveLength(3);
  });
});

// ============================================================================
// buildResolvedCard
// ============================================================================

describe("buildResolvedCard", () => {
  const user = makeUser({ userName: "sarah", fullName: "Sarah Connor" });

  it("should build an approved card", () => {
    const card = buildResolvedCard("Transfer Money", true, user);
    expect(card.title).toBe("✅ Approved — Transfer Money");
    const textChild = card.children.find((c) => c.type === "text");
    expect(textChild).toBeDefined();
    if (textChild?.type === "text") {
      expect(textChild.content).toContain("sarah");
    }
  });

  it("should build a denied card", () => {
    const card = buildResolvedCard("Transfer Money", false, user);
    expect(card.title).toBe("❌ Denied — Transfer Money");
  });

  it("should include fields if provided", () => {
    const card = buildResolvedCard("Test", true, user, {
      Amount: "$500",
    });
    const fieldsChild = card.children.find((c) => c.type === "fields");
    expect(fieldsChild).toBeDefined();
  });

  it("should fall back to fullName when userName is missing", () => {
    const noUserName = makeUser({
      userName: undefined,
      fullName: "John Doe",
    });
    const card = buildResolvedCard("Test", true, noUserName);
    const textChild = card.children.find((c) => c.type === "text");
    if (textChild?.type === "text") {
      expect(textChild.content).toContain("John Doe");
    }
  });

  it("should fall back to 'a user' when both names are missing", () => {
    const anonymous = makeUser({
      userName: undefined,
      fullName: undefined,
    });
    const card = buildResolvedCard("Test", true, anonymous);
    const textChild = card.children.find((c) => c.type === "text");
    if (textChild?.type === "text") {
      expect(textChild.content).toContain("a user");
    }
  });

  it("should not include fields section when fields object is empty", () => {
    const card = buildResolvedCard("Test", true, user, {});
    const fieldsChild = card.children.find((c) => c.type === "fields");
    expect(fieldsChild).toBeUndefined();
  });

  it("should not include fields section when fields is undefined", () => {
    const card = buildResolvedCard("Test", false, user, undefined);
    expect(card.children).toHaveLength(1); // only the status text
  });
});

// ============================================================================
// buildExpiredCard
// ============================================================================

describe("buildExpiredCard", () => {
  it("should build an expired card", () => {
    const card = buildExpiredCard("Transfer Money");
    expect(card.title).toBe("⏰ Expired — Transfer Money");
    expect(card.children).toHaveLength(1);
  });

  it("should contain an expiry message in the card body", () => {
    const card = buildExpiredCard("Something");
    const textChild = card.children[0];
    if (textChild.type === "text") {
      expect(textChild.content).toContain("expired");
    }
  });
});

// ============================================================================
// parseApprovalAction
// ============================================================================

describe("parseApprovalAction", () => {
  it("should parse an approve action", () => {
    const result = parseApprovalAction("__approval:txn_123:approve");
    expect(result).toEqual({ id: "txn_123", approved: true });
  });

  it("should parse a deny action", () => {
    const result = parseApprovalAction("__approval:txn_123:deny");
    expect(result).toEqual({ id: "txn_123", approved: false });
  });

  it("should return null for non-approval actions", () => {
    expect(parseApprovalAction("hello")).toBeNull();
    expect(parseApprovalAction("approve")).toBeNull();
    expect(parseApprovalAction("__approval")).toBeNull();
    expect(parseApprovalAction("__approval:id")).toBeNull();
    expect(parseApprovalAction("__approval:id:unknown")).toBeNull();
  });

  it("should return null for empty string", () => {
    expect(parseApprovalAction("")).toBeNull();
  });

  it("should handle IDs containing colons", () => {
    const result = parseApprovalAction("__approval:a:b:approve");
    expect(result).toEqual({ id: "a:b", approved: true });
  });

  it("should handle IDs with multiple colons", () => {
    const result = parseApprovalAction("__approval:tool:call:abc_123:deny");
    expect(result).toEqual({ id: "tool:call:abc_123", approved: false });
  });

  it("should handle an ID that is only a colon", () => {
    const result = parseApprovalAction("__approval:::approve");
    expect(result).toEqual({ id: ":", approved: true });
  });

  it("should return null for prefix-only with trailing colon", () => {
    expect(parseApprovalAction("__approval:")).toBeNull();
  });

  it("should handle IDs with special characters (no colons)", () => {
    const result = parseApprovalAction("__approval:id-with_chars.123:approve");
    expect(result).toEqual({ id: "id-with_chars.123", approved: true });
  });
});

// ============================================================================
// isApprovalActionId
// ============================================================================

describe("isApprovalActionId", () => {
  it("should return true for approval actions", () => {
    expect(isApprovalActionId("__approval:id:approve")).toBe(true);
    expect(isApprovalActionId("__approval:id:deny")).toBe(true);
    expect(isApprovalActionId("__approval:anything")).toBe(true);
  });

  it("should return false for non-approval actions", () => {
    expect(isApprovalActionId("hello")).toBe(false);
    expect(isApprovalActionId("approve")).toBe(false);
    expect(isApprovalActionId("")).toBe(false);
  });

  it("should return false for similar-looking prefixes", () => {
    expect(isApprovalActionId("__approvalx:id:approve")).toBe(false);
    expect(isApprovalActionId("__APPROVAL:id:approve")).toBe(false);
    expect(isApprovalActionId("_approval:id:approve")).toBe(false);
  });

  it("should return true for prefix with only a colon (no ID)", () => {
    // Starts with `__approval:` — isApprovalActionId only checks prefix
    expect(isApprovalActionId("__approval:")).toBe(true);
  });
});

// ============================================================================
// State Persistence Helpers
// ============================================================================

describe("storePendingApproval / consumePendingApproval", () => {
  const mockStateAdapter = {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should store an approval in the state adapter", async () => {
    const approval = makeStoredApproval();

    await storePendingApproval(mockStateAdapter as any, approval, 60000);

    expect(mockStateAdapter.set).toHaveBeenCalledWith(
      "pending-approval:test-123",
      approval,
      60000
    );
  });

  it("should consume and delete an approval", async () => {
    const stored = makeStoredApproval();
    mockStateAdapter.get.mockResolvedValue(stored);

    const result = await consumePendingApproval(
      mockStateAdapter as any,
      "test-123"
    );

    expect(result).toBe(stored);
    expect(mockStateAdapter.get).toHaveBeenCalledWith(
      "pending-approval:test-123"
    );
    expect(mockStateAdapter.delete).toHaveBeenCalledWith(
      "pending-approval:test-123"
    );
  });

  it("should return null for missing approval", async () => {
    mockStateAdapter.get.mockResolvedValue(null);

    const result = await consumePendingApproval(
      mockStateAdapter as any,
      "missing"
    );

    expect(result).toBeNull();
    expect(mockStateAdapter.delete).not.toHaveBeenCalled();
  });

  it("should use the default TTL when none is provided", async () => {
    const approval = makeStoredApproval();

    await storePendingApproval(mockStateAdapter as any, approval);

    // Default is 24 hours
    expect(mockStateAdapter.set).toHaveBeenCalledWith(
      "pending-approval:test-123",
      approval,
      86_400_000
    );
  });

  it("should preserve metadata in stored approval", async () => {
    const approval = makeStoredApproval({
      metadata: { toolName: "transfer", args: { amount: 500 } },
    });
    mockStateAdapter.get.mockResolvedValue(approval);

    const result = await consumePendingApproval(
      mockStateAdapter as any,
      "test-123"
    );

    expect(result?.metadata).toEqual({
      toolName: "transfer",
      args: { amount: 500 },
    });
  });

  it("should use the correct key prefix for different IDs", async () => {
    const approval1 = makeStoredApproval({ id: "abc" });
    const approval2 = makeStoredApproval({ id: "xyz" });

    await storePendingApproval(mockStateAdapter as any, approval1, 1000);
    await storePendingApproval(mockStateAdapter as any, approval2, 1000);

    expect(mockStateAdapter.set).toHaveBeenCalledWith(
      "pending-approval:abc",
      expect.anything(),
      1000
    );
    expect(mockStateAdapter.set).toHaveBeenCalledWith(
      "pending-approval:xyz",
      expect.anything(),
      1000
    );
  });
});

// ============================================================================
// ApprovalRegistry
// ============================================================================

describe("ApprovalRegistry", () => {
  let registry: ApprovalRegistry;

  beforeEach(() => {
    registry = new ApprovalRegistry();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should register and resolve an approval", async () => {
    const promise = registry.register("test-1", 60000);
    const result = makeResult("test-1", true);

    const resolved = registry.resolve("test-1", result);
    expect(resolved).toBe(true);

    const value = await promise;
    expect(value).toEqual(result);
  });

  it("should return false when resolving a non-existent approval", () => {
    const result = registry.resolve(
      "non-existent",
      makeResult("non-existent", true)
    );
    expect(result).toBe(false);
  });

  it("should time out pending approvals", async () => {
    const promise = registry.register("test-timeout", 5000);

    vi.advanceTimersByTime(5001);

    await expect(promise).rejects.toThrow(
      'Approval request "test-timeout" timed out'
    );
    expect(registry.has("test-timeout")).toBe(false);
  });

  it("should track pending approvals with has()", () => {
    registry.register("test-has", 60000);
    expect(registry.has("test-has")).toBe(true);
    expect(registry.has("non-existent")).toBe(false);
  });

  it("should remove pending approvals", () => {
    registry.register("test-remove", 60000);
    expect(registry.has("test-remove")).toBe(true);

    registry.remove("test-remove");
    expect(registry.has("test-remove")).toBe(false);
  });

  it("should replace existing entry for same ID", async () => {
    registry.register("dup", 60000);
    const promise2 = registry.register("dup", 60000);

    const result = makeResult("dup", true);
    registry.resolve("dup", result);
    const value = await promise2;
    expect(value.approved).toBe(true);
  });

  it("should clear timeout on resolve", () => {
    registry.register("test-clear", 60000);

    registry.resolve("test-clear", makeResult("test-clear", false));

    // Advancing time should not cause issues
    vi.advanceTimersByTime(120000);
    expect(registry.has("test-clear")).toBe(false);
  });

  it("should resolve with denied result", async () => {
    const promise = registry.register("deny-test", 60000);
    const result = makeResult("deny-test", false);

    registry.resolve("deny-test", result);

    const value = await promise;
    expect(value.approved).toBe(false);
  });

  it("should include metadata in resolved result", async () => {
    const promise = registry.register("meta-test", 60000);
    const result = makeResult("meta-test", true, {
      metadata: { toolName: "send", args: {} },
    });

    registry.resolve("meta-test", result);

    const value = await promise;
    expect(value.metadata).toEqual({ toolName: "send", args: {} });
  });

  it("should include reason in resolved result", async () => {
    const promise = registry.register("reason-test", 60000);
    const result = makeResult("reason-test", false, {
      reason: "Too risky",
    });

    registry.resolve("reason-test", result);

    const value = await promise;
    expect(value.reason).toBe("Too risky");
  });

  it("should not time out when ttlMs is 0", async () => {
    const promise = registry.register("no-timeout", 0);

    // Advance a lot of time
    vi.advanceTimersByTime(999_999);

    // Should still be pending
    expect(registry.has("no-timeout")).toBe(true);

    // Can still resolve
    registry.resolve("no-timeout", makeResult("no-timeout", true));
    const value = await promise;
    expect(value.approved).toBe(true);
  });

  it("should handle removing a non-existent entry gracefully", () => {
    // Should not throw
    expect(() => registry.remove("does-not-exist")).not.toThrow();
  });

  it("should manage multiple independent approvals concurrently", async () => {
    const p1 = registry.register("a", 60000);
    const p2 = registry.register("b", 60000);
    const p3 = registry.register("c", 60000);

    expect(registry.has("a")).toBe(true);
    expect(registry.has("b")).toBe(true);
    expect(registry.has("c")).toBe(true);

    registry.resolve("b", makeResult("b", false));
    registry.resolve("a", makeResult("a", true));
    registry.resolve("c", makeResult("c", true));

    const [v1, v2, v3] = await Promise.all([p1, p2, p3]);
    expect(v1.approved).toBe(true);
    expect(v2.approved).toBe(false);
    expect(v3.approved).toBe(true);
  });

  it("should not resolve after timeout has fired", async () => {
    const promise = registry.register("late", 1000);

    vi.advanceTimersByTime(1001);

    // Promise rejected
    await expect(promise).rejects.toThrow("timed out");

    // Attempting to resolve returns false (entry already cleaned up)
    const resolved = registry.resolve("late", makeResult("late", true));
    expect(resolved).toBe(false);
  });

  it("should clear timeout on remove", () => {
    registry.register("remove-timer", 5000);
    registry.remove("remove-timer");

    // Advancing past original timeout should not cause unhandled rejection
    vi.advanceTimersByTime(10000);
    expect(registry.has("remove-timer")).toBe(false);
  });

  it("should remove entry that has no timer (ttlMs=0)", () => {
    registry.register("no-timer", 0);
    expect(registry.has("no-timer")).toBe(true);

    registry.remove("no-timer");
    expect(registry.has("no-timer")).toBe(false);
  });
});

// ============================================================================
// defaultApprovalCard
// ============================================================================

describe("defaultApprovalCard", () => {
  it("should build card options from a tool call", () => {
    const result = defaultApprovalCard({
      toolName: "transferMoney",
      toolCallId: "tc_123",
      input: { amount: 500, to: "acct_456" },
    });

    expect(result.title).toBe("🔒 transferMoney");
    expect(result.fields).toEqual({
      amount: "500",
      to: "acct_456",
    });
  });

  it("should handle null and undefined values", () => {
    const result = defaultApprovalCard({
      toolName: "test",
      toolCallId: "tc_1",
      input: { a: null, b: undefined },
    });

    expect(result.fields).toEqual({ a: "—", b: "—" });
  });

  it("should stringify nested objects", () => {
    const result = defaultApprovalCard({
      toolName: "test",
      toolCallId: "tc_1",
      input: { config: { nested: true } },
    });

    expect(result.fields?.config).toBe('{"nested":true}');
  });

  it("should handle empty input", () => {
    const result = defaultApprovalCard({
      toolName: "noop",
      toolCallId: "tc_1",
      input: {},
    });

    expect(result.title).toBe("🔒 noop");
    expect(result.fields).toEqual({});
  });

  it("should stringify arrays in input", () => {
    const result = defaultApprovalCard({
      toolName: "test",
      toolCallId: "tc_1",
      input: { items: [1, 2, 3] },
    });

    expect(result.fields?.items).toBe("[1,2,3]");
  });

  it("should convert boolean values to strings", () => {
    const result = defaultApprovalCard({
      toolName: "test",
      toolCallId: "tc_1",
      input: { dryRun: true, force: false },
    });

    expect(result.fields).toEqual({ dryRun: "true", force: "false" });
  });

  it("should convert numeric values to strings", () => {
    const result = defaultApprovalCard({
      toolName: "test",
      toolCallId: "tc_1",
      input: { count: 0, amount: 99.99, negative: -5 },
    });

    expect(result.fields).toEqual({
      count: "0",
      amount: "99.99",
      negative: "-5",
    });
  });
});
