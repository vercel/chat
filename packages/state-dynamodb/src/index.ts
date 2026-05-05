import {
  ConditionalCheckFailedException,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

import type { Lock, Logger, QueueEntry, StateAdapter } from "chat";
import { ConsoleLogger } from "chat";

export interface DynamoDBStateAdapterOptions {
  client?: DynamoDBClient;
  keyPrefix?: string;
  logger?: Logger;
  partitionKeyName?: string;
  sortKeyName?: string;
  tableName: string;
  ttlAttributeName?: string;
}

type KeyType = "sub" | "lock" | "cache" | "queue" | "list";

/**
 * DynamoDB state adapter for production use.
 *
 * Provides persistent subscriptions and distributed locking
 * across multiple server instances.
 */
export class DynamoDBStateAdapter implements StateAdapter {
  private readonly client: DynamoDBClient;
  private readonly docClient: DynamoDBDocumentClient;
  private readonly logger: Logger;
  private readonly tableName: string;
  private readonly partitionKeyName: string;
  private readonly sortKeyName: string;
  private readonly keyPrefix: string;
  private readonly ttlAttributeName: string;
  private connected = false;
  private connectPromise: Promise<void> | null = null;

  constructor(options: DynamoDBStateAdapterOptions) {
    this.client = options.client || new DynamoDBClient();
    this.docClient = DynamoDBDocumentClient.from(this.client);
    this.logger = options.logger ?? new ConsoleLogger("info").child("dynamodb");
    this.tableName = options.tableName;
    this.keyPrefix = options.keyPrefix || "chat-sdk";
    this.partitionKeyName = options.partitionKeyName || "PK";
    this.sortKeyName = options.sortKeyName || "SK";
    this.ttlAttributeName = options.ttlAttributeName || "ttl_seconds";
  }

  private key(type: KeyType, id: string): { [key: string]: string } {
    return {
      [this.partitionKeyName]: `${this.keyPrefix}-${type}`,
      [this.sortKeyName]: id,
    };
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    if (!this.connectPromise) {
      this.connectPromise = Promise.resolve().then(() => {
        this.connected = true;
      });
    }

    await this.connectPromise;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.connectPromise = null;
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error(
        "DynamoDBStateAdapter is not connected. Call connect() first."
      );
    }
  }

  async subscribe(threadId: string): Promise<void> {
    this.ensureConnected();
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          ...this.key("sub", threadId),
          subscribed: true,
        },
      })
    );
  }

  async unsubscribe(threadId: string): Promise<void> {
    this.ensureConnected();
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          ...this.key("sub", threadId),
          subscribed: false,
        },
      })
    );
  }

  async isSubscribed(threadId: string): Promise<boolean> {
    this.ensureConnected();
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: this.key("sub", threadId),
      })
    );
    if (result.Item) {
      return result.Item.subscribed === true;
    }
    return false;
  }

  async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    this.ensureConnected();
    const now = Date.now();
    const expiresAt = now + ttlMs;
    const lockToken = generateToken();

    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            ...this.key("lock", threadId),
            lockToken,
            expiresAt,
            //used by dynamodb to clear this
            [this.ttlAttributeName]: Math.ceil(expiresAt / 1000),
          },
          // Acquire if missing OR previous lock is expired.
          ConditionExpression:
            "attribute_not_exists(#partitionKey) or expiresAt < :now",
          ExpressionAttributeValues: {
            ":now": now,
          },
          ExpressionAttributeNames: {
            "#partitionKey": this.partitionKeyName,
          },
        })
      );

      return {
        expiresAt,
        threadId,
        token: lockToken,
      };
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        return null;
      }
      throw err;
    }
  }

  async forceReleaseLock(threadId: string): Promise<void> {
    this.ensureConnected();

    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: this.key("lock", threadId),
      })
    );
  }

  async releaseLock(lock: Lock): Promise<void> {
    this.ensureConnected();
    try {
      await this.docClient.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: this.key("lock", lock.threadId),
          ConditionExpression: "lockToken = :lockToken",
          ExpressionAttributeValues: {
            ":lockToken": lock.token,
          },
        })
      );
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        return;
      }
      throw err;
    }
  }

  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    this.ensureConnected();
    const now = Date.now();
    const expiresAt = now + ttlMs;

    try {
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: this.key("lock", lock.threadId),
          UpdateExpression:
            "SET #expiresAt = :expiresAt, #ttlSeconds = :ttlSeconds",
          ConditionExpression: "#lockToken = :lockToken AND #expiresAt >= :now",
          ExpressionAttributeValues: {
            ":lockToken": lock.token,
            ":expiresAt": expiresAt,
            ":ttlSeconds": Math.ceil(expiresAt / 1000),
            ":now": now,
          },
          ExpressionAttributeNames: {
            "#lockToken": "lockToken",
            "#expiresAt": "expiresAt",
            "#ttlSeconds": this.ttlAttributeName,
          },
        })
      );

      return true;
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        return false;
      }
      throw err;
    }
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    return await this._get("cache", key);
  }

  private async _get<T = unknown>(
    keyType: KeyType,
    key: string
  ): Promise<T | null> {
    this.ensureConnected();
    const value = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: this.key(keyType, key),
      })
    );

    if (!value.Item) {
      return null;
    }

    if (value.Item.expiresAt && value.Item.expiresAt < Date.now()) {
      return null;
    }
    return value.Item.data as T;
  }

  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    await this._set("cache", key, value, ttlMs);
  }

  private async _set<T = unknown>(
    keyType: KeyType,
    key: string,
    value: T,
    ttlMs?: number
  ): Promise<void> {
    this.ensureConnected();
    const expiresAt = ttlMs ? Date.now() + ttlMs : undefined;
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          ...this.key(keyType, key),
          data: value,
          ...(expiresAt
            ? {
                expiresAt,
                //used by dynamodb to clear this
                [this.ttlAttributeName]: Math.ceil(expiresAt / 1000),
              }
            : {}),
        },
      })
    );
  }

  async setIfNotExists(
    key: string,
    value: unknown,
    ttlMs?: number
  ): Promise<boolean> {
    this.ensureConnected();
    const now = Date.now();
    const expiresAt = ttlMs ? now + ttlMs : undefined;

    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            ...this.key("cache", key),
            data: value,
            ...(expiresAt
              ? {
                  expiresAt,
                  [this.ttlAttributeName]: Math.ceil(expiresAt / 1000),
                }
              : {}),
          },
          ConditionExpression:
            "attribute_not_exists(#partitionKey) or expiresAt < :now",
          ExpressionAttributeValues: {
            ":now": now,
          },
          ExpressionAttributeNames: {
            "#partitionKey": this.partitionKeyName,
          },
        })
      );
      return true;
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        return false;
      }
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    this.ensureConnected();

    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: this.key("cache", key),
      })
    );
  }

  async appendToList(
    key: string,
    value: unknown,
    options?: { maxLength?: number; ttlMs?: number }
  ): Promise<void> {
    let list = await this.getList(key);
    list.push(value);

    if (options?.maxLength && list.length > options?.maxLength) {
      list = list.slice(list.length - options.maxLength);
    }
    await this._set("list", key, list, options?.ttlMs);
  }

  async getList<T = unknown>(key: string): Promise<T[]> {
    return (await this._get<T[]>("list", key)) || [];
  }

  async enqueue(
    threadId: string,
    entry: QueueEntry,
    maxSize: number
  ): Promise<number> {
    const queue = (await this._get<QueueEntry[]>("queue", threadId)) || [];
    queue.push(entry);

    if (maxSize && queue.length > maxSize) {
      queue.splice(0, queue.length - maxSize);
    }
    await this._set("queue", threadId, queue);
    return queue.length;
  }

  async dequeue(threadId: string): Promise<QueueEntry | null> {
    const queue = (await this._get<QueueEntry[]>("queue", threadId)) || [];
    if (!queue || queue.length === 0) {
      return null;
    }
    const entry = queue.shift();

    if (queue.length === 0) {
      await this.docClient.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: this.key("queue", threadId),
        })
      );
    } else {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            ...this.key("queue", threadId),
            data: queue,
          },
        })
      );
    }
    return entry === undefined ? null : entry;
  }

  async queueDepth(threadId: string): Promise<number> {
    const queue = (await this._get<QueueEntry[]>("queue", threadId)) || [];
    return queue?.length ?? 0;
  }

  async _clearDb() {
    const keyTypes: KeyType[] = ["sub", "lock", "cache", "queue", "list"];
    for (const key of keyTypes) {
      const queryResult = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: "#partitionKey = :pk", // Change 'PK' to your actual Partition Key name
          ExpressionAttributeValues: { ":pk": `${this.keyPrefix}${key}` },
          ExpressionAttributeNames: {
            "#partitionKey": this.partitionKeyName,
            "#sortKey": this.sortKeyName,
          },
          ProjectionExpression: "#partitionKey, #sortKey", // Retrieve only necessary keys
        })
      );

      const items = queryResult.Items || [];

      for (let i = 0; i < items.length; i += 25) {
        const batch = items.slice(i, i + 25);

        const deleteRequests = batch.map((item) => ({
          DeleteRequest: {
            Key: item,
          },
        }));

        await this.docClient.send(
          new BatchWriteCommand({
            RequestItems: {
              [this.tableName]: deleteRequests,
            },
          })
        );
      }
    }
  }
}

function generateToken(): string {
  return `dynamo_${crypto.randomUUID()}`;
}

export function createDynamoDbState(
  options: DynamoDBStateAdapterOptions
): DynamoDBStateAdapter {
  return new DynamoDBStateAdapter(options);
}
