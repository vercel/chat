import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import type { Lock, Logger } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDynamoDBState, DynamoDBStateAdapter } from "./index";

function createMockDocClient(): DynamoDBDocument {
  return {
    put: vi.fn().mockResolvedValue({}),
    get: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    query: vi.fn().mockResolvedValue({ Items: [] }),
    batchWrite: vi.fn().mockResolvedValue({}),
    destroy: vi.fn(),
  } as unknown as DynamoDBDocument;
}

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Logger;
}

describe("DynamoDBStateAdapter", () => {
  it("should export createDynamoDBState function", () => {
    expect(typeof createDynamoDBState).toBe("function");
  });

  it("should export DynamoDBStateAdapter class", () => {
    expect(typeof DynamoDBStateAdapter).toBe("function");
  });

  describe("createDynamoDBState", () => {
    it("should create an adapter with default options", () => {
      const adapter = createDynamoDBState({ client: createMockDocClient() });
      expect(adapter).toBeInstanceOf(DynamoDBStateAdapter);
    });

    it("should create an adapter with custom options", () => {
      const adapter = createDynamoDBState({
        client: createMockDocClient(),
        tableName: "custom-table",
        keyPrefix: "custom-prefix",
      });
      expect(adapter).toBeInstanceOf(DynamoDBStateAdapter);
    });

    it("should create an adapter without a client", () => {
      const adapter = createDynamoDBState({ region: "us-east-1" });
      expect(adapter).toBeInstanceOf(DynamoDBStateAdapter);
    });
  });

  describe("ensureConnected", () => {
    it("should throw when calling subscribe before connect", async () => {
      const adapter = new DynamoDBStateAdapter({
        client: createMockDocClient(),
      });
      await expect(adapter.subscribe("thread1")).rejects.toThrow(
        "not connected"
      );
    });

    it("should throw when calling acquireLock before connect", async () => {
      const adapter = new DynamoDBStateAdapter({
        client: createMockDocClient(),
      });
      await expect(adapter.acquireLock("thread1", 5000)).rejects.toThrow(
        "not connected"
      );
    });

    it("should throw when calling get before connect", async () => {
      const adapter = new DynamoDBStateAdapter({
        client: createMockDocClient(),
      });
      await expect(adapter.get("key")).rejects.toThrow("not connected");
    });

    it("should throw when calling set before connect", async () => {
      const adapter = new DynamoDBStateAdapter({
        client: createMockDocClient(),
      });
      await expect(adapter.set("key", "value")).rejects.toThrow(
        "not connected"
      );
    });

    it("should throw when calling delete before connect", async () => {
      const adapter = new DynamoDBStateAdapter({
        client: createMockDocClient(),
      });
      await expect(adapter.delete("key")).rejects.toThrow("not connected");
    });
  });

  describe("with mock client", () => {
    let adapter: DynamoDBStateAdapter;
    let client: DynamoDBDocument;
    let logger: Logger;

    beforeEach(async () => {
      client = createMockDocClient();
      logger = createMockLogger();
      adapter = new DynamoDBStateAdapter({ client, logger });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    describe("connect / disconnect", () => {
      it("should be idempotent on connect", async () => {
        await adapter.connect();
        await adapter.connect();
      });

      it("should be idempotent on disconnect", async () => {
        await adapter.disconnect();
        await adapter.disconnect();
      });
    });

    describe("subscriptions", () => {
      it("should subscribe by calling put", async () => {
        await adapter.subscribe("slack:C123:1234.5678");

        expect(client.put).toHaveBeenCalledWith(
          expect.objectContaining({
            Item: { pk: "chat-sdk#sub#slack:C123:1234.5678", sk: "_" },
          })
        );
      });

      it("should unsubscribe by calling delete", async () => {
        await adapter.unsubscribe("slack:C123:1234.5678");

        expect(client.delete).toHaveBeenCalledWith(
          expect.objectContaining({
            Key: { pk: "chat-sdk#sub#slack:C123:1234.5678", sk: "_" },
          })
        );
      });

      it("should return true when subscribed", async () => {
        vi.mocked(client.get).mockResolvedValue({
          Item: { pk: "chat-sdk#sub#thread1", sk: "_" },
          $metadata: {},
        });

        const result = await adapter.isSubscribed("thread1");
        expect(result).toBe(true);
      });

      it("should return false when not subscribed", async () => {
        vi.mocked(client.get).mockResolvedValue({ $metadata: {} });

        const result = await adapter.isSubscribed("thread1");
        expect(result).toBe(false);
      });
    });

    describe("locking", () => {
      it("should acquire a lock successfully", async () => {
        const lock = await adapter.acquireLock("thread1", 5000);
        expect(lock).not.toBeNull();
        expect(lock?.threadId).toBe("thread1");
        expect(lock?.token?.startsWith("ddb_")).toBe(true);
        expect(lock?.expiresAt).toBeGreaterThan(Date.now());
      });

      it("should return null when lock is already held", async () => {
        vi.mocked(client.put).mockRejectedValue(
          new ConditionalCheckFailedException({
            message: "Condition not met",
            $metadata: {},
          })
        );

        const lock = await adapter.acquireLock("thread1", 5000);
        expect(lock).toBeNull();
      });

      it("should release a lock with token check", async () => {
        const lock: Lock = {
          threadId: "thread1",
          token: "ddb_test-token",
          expiresAt: Date.now() + 5000,
        };
        await adapter.releaseLock(lock);

        expect(client.delete).toHaveBeenCalledWith(
          expect.objectContaining({
            ConditionExpression: "#t = :token",
            ExpressionAttributeValues: { ":token": "ddb_test-token" },
          })
        );
      });

      it("should no-op when releasing with wrong token", async () => {
        vi.mocked(client.delete).mockRejectedValue(
          new ConditionalCheckFailedException({
            message: "Condition not met",
            $metadata: {},
          })
        );

        const lock: Lock = {
          threadId: "thread1",
          token: "wrong-token",
          expiresAt: Date.now() + 5000,
        };
        await adapter.releaseLock(lock);
      });

      it("should force-release a lock without token check", async () => {
        await adapter.forceReleaseLock("thread1");

        expect(client.delete).toHaveBeenCalledWith(
          expect.not.objectContaining({
            ConditionExpression: expect.anything(),
          })
        );
      });

      it("should return true when lock is extended", async () => {
        const lock: Lock = {
          threadId: "thread1",
          token: "ddb_test-token",
          expiresAt: Date.now() + 5000,
        };
        const result = await adapter.extendLock(lock, 5000);
        expect(result).toBe(true);
      });

      it("should return false when lock extension fails", async () => {
        vi.mocked(client.update).mockRejectedValue(
          new ConditionalCheckFailedException({
            message: "Condition not met",
            $metadata: {},
          })
        );

        const lock: Lock = {
          threadId: "thread1",
          token: "ddb_test-token",
          expiresAt: Date.now() + 5000,
        };
        const result = await adapter.extendLock(lock, 5000);
        expect(result).toBe(false);
      });
    });

    describe("cache", () => {
      it("should return value on cache hit", async () => {
        vi.mocked(client.get).mockResolvedValue({
          Item: { pk: "x", sk: "_", value: { foo: "bar" } },
          $metadata: {},
        });

        const result = await adapter.get("key");
        expect(result).toEqual({ foo: "bar" });
      });

      it("should return raw value for non-object types", async () => {
        vi.mocked(client.get).mockResolvedValue({
          Item: { pk: "x", sk: "_", value: "plain-string" },
          $metadata: {},
        });

        const result = await adapter.get("key");
        expect(result).toBe("plain-string");
      });

      it("should return null on cache miss", async () => {
        vi.mocked(client.get).mockResolvedValue({ $metadata: {} });

        const result = await adapter.get("key");
        expect(result).toBeNull();
      });

      it("should return null for expired items", async () => {
        vi.mocked(client.get).mockResolvedValue({
          Item: {
            pk: "x",
            sk: "_",
            value: { foo: "bar" },
            expiresAtMs: Date.now() - 1000,
          },
          $metadata: {},
        });

        const result = await adapter.get("key");
        expect(result).toBeNull();
      });

      it("should set a value with correct key format", async () => {
        await adapter.set("my-key", { foo: "bar" });

        expect(client.put).toHaveBeenCalledWith(
          expect.objectContaining({
            Item: expect.objectContaining({
              pk: "chat-sdk#cache#my-key",
              value: { foo: "bar" },
            }),
          })
        );
      });

      it("should set a value with TTL", async () => {
        await adapter.set("key", "value", 5000);

        expect(client.put).toHaveBeenCalledWith(
          expect.objectContaining({
            Item: expect.objectContaining({
              expiresAtMs: expect.any(Number),
              expiresAt: expect.any(Number),
            }),
          })
        );
      });

      it("should return true when setIfNotExists succeeds", async () => {
        const result = await adapter.setIfNotExists("key", "value");
        expect(result).toBe(true);
      });

      it("should return false when setIfNotExists finds existing key", async () => {
        vi.mocked(client.put).mockRejectedValue(
          new ConditionalCheckFailedException({
            message: "Condition not met",
            $metadata: {},
          })
        );

        const result = await adapter.setIfNotExists("key", "value");
        expect(result).toBe(false);
      });

      it("should support setIfNotExists with TTL", async () => {
        const result = await adapter.setIfNotExists("key", "value", 5000);
        expect(result).toBe(true);
      });

      it("should delete a value without throwing", async () => {
        await adapter.delete("key");
        expect(client.delete).toHaveBeenCalled();
      });
    });

    describe("appendToList / getList", () => {
      it("should increment counter and write list entry", async () => {
        vi.mocked(client.update).mockResolvedValue({
          Attributes: { seq: 1 },
          $metadata: {},
        });

        await adapter.appendToList("mylist", { foo: "bar" });

        expect(client.update).toHaveBeenCalledWith(
          expect.objectContaining({
            Key: expect.objectContaining({
              pk: "chat-sdk#list-counter#mylist",
            }),
            UpdateExpression: "ADD seq :one",
          })
        );

        expect(client.put).toHaveBeenCalledWith(
          expect.objectContaining({
            Item: expect.objectContaining({
              pk: "chat-sdk#list#mylist",
              sk: "0000000000000001",
              value: { foo: "bar" },
            }),
          })
        );
      });

      it("should trim overflow when maxLength is specified", async () => {
        vi.mocked(client.update).mockResolvedValue({
          Attributes: { seq: 4 },
          $metadata: {},
        });
        vi.mocked(client.query).mockResolvedValue({
          Items: [
            { sk: "0000000000000001" },
            { sk: "0000000000000002" },
            { sk: "0000000000000003" },
            { sk: "0000000000000004" },
          ],
          $metadata: {},
        });

        await adapter.appendToList("mylist", { id: 4 }, { maxLength: 2 });

        expect(client.batchWrite).toHaveBeenCalledWith(
          expect.objectContaining({
            RequestItems: {
              "chat-state": expect.arrayContaining([
                {
                  DeleteRequest: {
                    Key: { pk: "chat-sdk#list#mylist", sk: "0000000000000001" },
                  },
                },
                {
                  DeleteRequest: {
                    Key: { pk: "chat-sdk#list#mylist", sk: "0000000000000002" },
                  },
                },
              ]),
            },
          })
        );
      });

      it("should set TTL on list entries when ttlMs is provided", async () => {
        vi.mocked(client.update).mockResolvedValue({
          Attributes: { seq: 1 },
          $metadata: {},
        });

        await adapter.appendToList("mylist", { id: 1 }, { ttlMs: 60000 });

        expect(client.put).toHaveBeenCalledWith(
          expect.objectContaining({
            Item: expect.objectContaining({
              expiresAtMs: expect.any(Number),
              expiresAt: expect.any(Number),
            }),
          })
        );
      });

      it("should return list items from getList in order", async () => {
        vi.mocked(client.query).mockResolvedValue({
          Items: [
            { sk: "0000000000000001", value: { id: 1 } },
            { sk: "0000000000000002", value: { id: 2 } },
          ],
          $metadata: {},
        });

        const result = await adapter.getList("mylist");
        expect(result).toEqual([{ id: 1 }, { id: 2 }]);
      });

      it("should filter expired items in getList", async () => {
        vi.mocked(client.query).mockResolvedValue({
          Items: [
            {
              sk: "0000000000000001",
              value: { id: 1 },
              expiresAtMs: Date.now() - 1000,
            },
            { sk: "0000000000000002", value: { id: 2 } },
          ],
          $metadata: {},
        });

        const result = await adapter.getList("mylist");
        expect(result).toEqual([{ id: 2 }]);
      });

      it("should return empty array when no items exist", async () => {
        vi.mocked(client.query).mockResolvedValue({ Items: [], $metadata: {} });

        const result = await adapter.getList("mylist");
        expect(result).toEqual([]);
      });

      it("should handle paginated query results in getList", async () => {
        vi.mocked(client.query)
          .mockResolvedValueOnce({
            Items: [{ sk: "0000000000000001", value: { id: 1 } }],
            LastEvaluatedKey: { pk: "x", sk: "0000000000000001" },
            $metadata: {},
          })
          .mockResolvedValueOnce({
            Items: [{ sk: "0000000000000002", value: { id: 2 } }],
            $metadata: {},
          });

        const result = await adapter.getList("mylist");
        expect(result).toEqual([{ id: 1 }, { id: 2 }]);
      });
    });

    describe("disconnect", () => {
      it("should call destroy on owned client", async () => {
        const ownedAdapter = createDynamoDBState({
          region: "us-east-1",
          logger,
        });
        await ownedAdapter.connect();
        const ownedClient = ownedAdapter.getClient();
        vi.spyOn(ownedClient, "destroy").mockImplementation(() => {});
        await ownedAdapter.disconnect();
        expect(ownedClient.destroy).toHaveBeenCalled();
      });

      it("should not call destroy on externally provided client", async () => {
        await adapter.disconnect();
        expect(client.destroy).not.toHaveBeenCalled();
      });
    });

    describe("trimList logging", () => {
      it("should log a warning when batchWrite has unprocessed items", async () => {
        vi.mocked(client.update).mockResolvedValue({
          Attributes: { seq: 4 },
          $metadata: {},
        });
        vi.mocked(client.query).mockResolvedValue({
          Items: [
            { sk: "0000000000000001" },
            { sk: "0000000000000002" },
            { sk: "0000000000000003" },
            { sk: "0000000000000004" },
          ],
          $metadata: {},
        });
        vi.mocked(client.batchWrite).mockResolvedValue({
          UnprocessedItems: {
            "chat-state": [
              {
                DeleteRequest: {
                  Key: {
                    pk: "chat-sdk#list#mylist",
                    sk: "0000000000000001",
                  },
                },
              },
            ],
          },
          $metadata: {},
        });

        await adapter.appendToList("mylist", { id: 4 }, { maxLength: 2 });

        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining("unprocessed deletes")
        );
      });
    });

    describe("appendToList TTL refresh", () => {
      it("should refresh TTL on all existing list items via batchWrite", async () => {
        vi.mocked(client.update).mockResolvedValue({
          Attributes: { seq: 2 },
          $metadata: {},
        });
        vi.mocked(client.query).mockResolvedValue({
          Items: [
            { sk: "0000000000000001", value: { id: 1 } },
            { sk: "0000000000000002", value: { id: 2 } },
          ],
          $metadata: {},
        });

        await adapter.appendToList("mylist", { id: 2 }, { ttlMs: 60000 });

        expect(client.batchWrite).toHaveBeenCalledWith(
          expect.objectContaining({
            RequestItems: {
              "chat-state": expect.arrayContaining([
                {
                  PutRequest: {
                    Item: expect.objectContaining({
                      sk: "0000000000000001",
                      value: { id: 1 },
                      expiresAtMs: expect.any(Number),
                      expiresAt: expect.any(Number),
                    }),
                  },
                },
                {
                  PutRequest: {
                    Item: expect.objectContaining({
                      sk: "0000000000000002",
                      value: { id: 2 },
                      expiresAtMs: expect.any(Number),
                      expiresAt: expect.any(Number),
                    }),
                  },
                },
              ]),
            },
          })
        );
      });

      it("should not refresh TTL when ttlMs is not provided", async () => {
        vi.mocked(client.update).mockResolvedValue({
          Attributes: { seq: 1 },
          $metadata: {},
        });

        await adapter.appendToList("mylist", { id: 1 });

        // Only the counter update, no batchWrite for TTL refresh
        expect(client.update).toHaveBeenCalledTimes(1);
        expect(client.batchWrite).not.toHaveBeenCalled();
      });
    });

    describe("getClient", () => {
      it("should return the underlying DynamoDB Document client", () => {
        expect(adapter.getClient()).toBe(client);
      });
    });
  });

  describe("custom attribute names", () => {
    let adapter: DynamoDBStateAdapter;
    let client: DynamoDBDocument;

    beforeEach(async () => {
      client = createMockDocClient();
      adapter = new DynamoDBStateAdapter({
        client,
        pkName: "PK",
        skName: "SK",
        ttlName: "ttl",
        logger: createMockLogger(),
      });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    it("should use custom pk and sk names in subscribe", async () => {
      await adapter.subscribe("thread1");

      expect(client.put).toHaveBeenCalledWith(
        expect.objectContaining({
          Item: { PK: "chat-sdk#sub#thread1", SK: "_" },
        })
      );
    });

    it("should use custom pk and sk names in key lookups", async () => {
      vi.mocked(client.get).mockResolvedValue({
        Item: { PK: "chat-sdk#sub#thread1", SK: "_" },
        $metadata: {},
      });

      const result = await adapter.isSubscribed("thread1");
      expect(result).toBe(true);
      expect(client.get).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: { PK: "chat-sdk#sub#thread1", SK: "_" },
          ProjectionExpression: "PK",
        })
      );
    });

    it("should use custom ttl name in acquireLock", async () => {
      const lock = await adapter.acquireLock("thread1", 5000);
      expect(lock).not.toBeNull();

      expect(client.put).toHaveBeenCalledWith(
        expect.objectContaining({
          Item: expect.objectContaining({
            PK: expect.any(String),
            SK: "_",
            ttl: expect.any(Number),
          }),
        })
      );
    });

    it("should use custom ttl name in cache set", async () => {
      await adapter.set("key", "value", 5000);

      expect(client.put).toHaveBeenCalledWith(
        expect.objectContaining({
          Item: expect.objectContaining({
            PK: "chat-sdk#cache#key",
            SK: "_",
            ttl: expect.any(Number),
          }),
        })
      );
    });

    it("should use custom sk name in trimList", async () => {
      vi.mocked(client.update).mockResolvedValue({
        Attributes: { seq: 3 },
        $metadata: {},
      });
      vi.mocked(client.query).mockResolvedValue({
        Items: [
          { SK: "0000000000000001" },
          { SK: "0000000000000002" },
          { SK: "0000000000000003" },
        ],
        $metadata: {},
      });

      await adapter.appendToList("mylist", { id: 3 }, { maxLength: 1 });

      expect(client.batchWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          RequestItems: {
            "chat-state": expect.arrayContaining([
              {
                DeleteRequest: {
                  Key: { PK: "chat-sdk#list#mylist", SK: "0000000000000001" },
                },
              },
              {
                DeleteRequest: {
                  Key: { PK: "chat-sdk#list#mylist", SK: "0000000000000002" },
                },
              },
            ]),
          },
        })
      );
    });

    it("should return list items with custom key names in getList", async () => {
      vi.mocked(client.query).mockResolvedValue({
        Items: [
          {
            PK: "chat-sdk#list#mylist",
            SK: "0000000000000001",
            value: { id: 1 },
          },
          {
            PK: "chat-sdk#list#mylist",
            SK: "0000000000000002",
            value: { id: 2 },
          },
        ],
        $metadata: {},
      });

      const result = await adapter.getList("mylist");
      expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it("should use custom ttl name in refreshListTtl", async () => {
      vi.mocked(client.update).mockResolvedValue({
        Attributes: { seq: 1 },
        $metadata: {},
      });
      vi.mocked(client.query).mockResolvedValue({
        Items: [
          {
            PK: "chat-sdk#list#mylist",
            SK: "0000000000000001",
            value: { id: 1 },
          },
        ],
        $metadata: {},
      });

      await adapter.appendToList("mylist", { id: 1 }, { ttlMs: 60000 });

      expect(client.batchWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          RequestItems: {
            "chat-state": expect.arrayContaining([
              {
                PutRequest: {
                  Item: expect.objectContaining({
                    ttl: expect.any(Number),
                    expiresAtMs: expect.any(Number),
                  }),
                },
              },
            ]),
          },
        })
      );
    });
  });
});
