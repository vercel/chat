import {
  ConditionalCheckFailedException,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import type { Lock, Logger, StateAdapter } from "chat";
import { ConsoleLogger } from "chat";

const DEFAULT_TABLE_NAME = "chat-state";
const DEFAULT_KEY_PREFIX = "chat-sdk";

const SEQ_PAD_LENGTH = 16;
const BATCH_WRITE_LIMIT = 25;

export interface DynamoDBStateAdapterOptions {
  /** Custom DynamoDB endpoint (for DynamoDB Local development) */
  endpoint?: string;
  /** Key prefix for multi-tenancy (default: "chat-sdk") */
  keyPrefix?: string;
  /** Logger instance for error reporting */
  logger?: Logger;
  /** AWS region (default: from environment) */
  region?: string;
  /** DynamoDB table name (default: "chat-state") */
  tableName?: string;
}

export interface DynamoDBStateClientOptions {
  /** Existing DynamoDBDocument instance */
  client: DynamoDBDocument;
  /** Key prefix for multi-tenancy (default: "chat-sdk") */
  keyPrefix?: string;
  /** Logger instance for error reporting */
  logger?: Logger;
  /** DynamoDB table name (default: "chat-state") */
  tableName?: string;
}

export type CreateDynamoDBStateOptions =
  | (Partial<DynamoDBStateAdapterOptions> & { client?: never })
  | (Partial<Omit<DynamoDBStateClientOptions, "client">> & {
      client: DynamoDBDocument;
    });

export class DynamoDBStateAdapter implements StateAdapter {
  private readonly docClient: DynamoDBDocument;
  private readonly tableName: string;
  private readonly keyPrefix: string;
  private readonly logger: Logger;
  private readonly ownsClient: boolean;
  private connected = false;

  constructor(
    options: DynamoDBStateAdapterOptions | DynamoDBStateClientOptions
  ) {
    if ("client" in options && options.client) {
      this.docClient = options.client;
      this.ownsClient = false;
    } else {
      const opts = options as DynamoDBStateAdapterOptions;
      this.docClient = DynamoDBDocument.from(
        new DynamoDBClient({
          region: opts.region,
          endpoint: opts.endpoint,
        })
      );
      this.ownsClient = true;
    }

    this.tableName = options.tableName ?? DEFAULT_TABLE_NAME;
    this.keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;
    this.logger = options.logger ?? new ConsoleLogger("info").child("dynamodb");
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    if (this.ownsClient) {
      this.docClient.destroy();
    }

    this.connected = false;
  }

  async subscribe(threadId: string): Promise<void> {
    this.ensureConnected();

    await this.docClient.put({
      TableName: this.tableName,
      Item: {
        pk: this.subKey(threadId),
        sk: "_",
      },
    });
  }

  async unsubscribe(threadId: string): Promise<void> {
    this.ensureConnected();

    await this.docClient.delete({
      TableName: this.tableName,
      Key: { pk: this.subKey(threadId), sk: "_" },
    });
  }

  async isSubscribed(threadId: string): Promise<boolean> {
    this.ensureConnected();

    const result = await this.docClient.get({
      TableName: this.tableName,
      Key: { pk: this.subKey(threadId), sk: "_" },
      ProjectionExpression: "pk",
    });

    return result.Item !== undefined;
  }

  async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    this.ensureConnected();

    const token = generateToken();
    const now = Date.now();
    const expiresAtMs = now + ttlMs;

    try {
      await this.docClient.put({
        TableName: this.tableName,
        Item: {
          pk: this.lockKey(threadId),
          sk: "_",
          token,
          expiresAtMs,
          expiresAt: msToSeconds(expiresAtMs),
        },
        ConditionExpression: "attribute_not_exists(pk) OR expiresAtMs <= :now",
        ExpressionAttributeValues: { ":now": now },
      });

      return { threadId, token, expiresAt: expiresAtMs };
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        return null;
      }
      throw error;
    }
  }

  async releaseLock(lock: Lock): Promise<void> {
    this.ensureConnected();

    try {
      await this.docClient.delete({
        TableName: this.tableName,
        Key: { pk: this.lockKey(lock.threadId), sk: "_" },
        ConditionExpression: "#t = :token",
        ExpressionAttributeNames: { "#t": "token" },
        ExpressionAttributeValues: { ":token": lock.token },
      });
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        return;
      }
      throw error;
    }
  }

  async forceReleaseLock(threadId: string): Promise<void> {
    this.ensureConnected();

    await this.docClient.delete({
      TableName: this.tableName,
      Key: { pk: this.lockKey(threadId), sk: "_" },
    });
  }

  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    this.ensureConnected();

    const now = Date.now();
    const newExpiresAtMs = now + ttlMs;

    try {
      await this.docClient.update({
        TableName: this.tableName,
        Key: { pk: this.lockKey(lock.threadId), sk: "_" },
        UpdateExpression: "SET expiresAtMs = :newMs, expiresAt = :newSec",
        ConditionExpression: "#t = :token AND expiresAtMs > :now",
        ExpressionAttributeNames: { "#t": "token" },
        ExpressionAttributeValues: {
          ":token": lock.token,
          ":now": now,
          ":newMs": newExpiresAtMs,
          ":newSec": msToSeconds(newExpiresAtMs),
        },
      });

      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        return false;
      }
      throw error;
    }
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    this.ensureConnected();

    const result = await this.docClient.get({
      TableName: this.tableName,
      Key: { pk: this.cacheKey(key), sk: "_" },
    });

    if (!result.Item) {
      return null;
    }

    if (
      result.Item.expiresAtMs !== undefined &&
      (result.Item.expiresAtMs as number) <= Date.now()
    ) {
      return null;
    }

    return result.Item.value as T;
  }

  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.ensureConnected();

    const item: Record<string, unknown> = {
      pk: this.cacheKey(key),
      sk: "_",
      value,
    };

    if (ttlMs !== undefined) {
      const expiresAtMs = Date.now() + ttlMs;
      item.expiresAtMs = expiresAtMs;
      item.expiresAt = msToSeconds(expiresAtMs);
    }

    await this.docClient.put({ TableName: this.tableName, Item: item });
  }

  async setIfNotExists(
    key: string,
    value: unknown,
    ttlMs?: number
  ): Promise<boolean> {
    this.ensureConnected();

    const now = Date.now();
    const item: Record<string, unknown> = {
      pk: this.cacheKey(key),
      sk: "_",
      value,
    };

    if (ttlMs !== undefined) {
      const expiresAtMs = now + ttlMs;
      item.expiresAtMs = expiresAtMs;
      item.expiresAt = msToSeconds(expiresAtMs);
    }

    try {
      await this.docClient.put({
        TableName: this.tableName,
        Item: item,
        ConditionExpression: "attribute_not_exists(pk) OR expiresAtMs <= :now",
        ExpressionAttributeValues: { ":now": now },
      });
      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        return false;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    this.ensureConnected();

    await this.docClient.delete({
      TableName: this.tableName,
      Key: { pk: this.cacheKey(key), sk: "_" },
    });
  }

  async appendToList(
    key: string,
    value: unknown,
    options?: { maxLength?: number; ttlMs?: number }
  ): Promise<void> {
    this.ensureConnected();

    const counterResult = await this.docClient.update({
      TableName: this.tableName,
      Key: { pk: this.listCounterKey(key), sk: "_" },
      UpdateExpression: "ADD seq :one",
      ExpressionAttributeValues: { ":one": 1 },
      ReturnValues: "ALL_NEW",
    });

    const seq = counterResult.Attributes?.seq as number;
    const sk = String(seq).padStart(SEQ_PAD_LENGTH, "0");

    const item: Record<string, unknown> = {
      pk: this.listKey(key),
      sk,
      value,
    };

    if (options?.ttlMs !== undefined) {
      const expiresAtMs = Date.now() + options.ttlMs;
      item.expiresAtMs = expiresAtMs;
      item.expiresAt = msToSeconds(expiresAtMs);
    }

    await this.docClient.put({ TableName: this.tableName, Item: item });

    if (options?.maxLength) {
      await this.trimList(key, options.maxLength);
    }

    if (options?.ttlMs !== undefined) {
      await this.refreshListTtl(key, options.ttlMs);
    }
  }

  async getList<T = unknown>(key: string): Promise<T[]> {
    this.ensureConnected();

    const items = await this.queryAllListItems(key);
    const now = Date.now();

    const results: T[] = [];
    for (const item of items) {
      if (
        item.expiresAtMs !== undefined &&
        (item.expiresAtMs as number) <= now
      ) {
        continue;
      }

      results.push(item.value as T);
    }

    return results;
  }

  getClient(): DynamoDBDocument {
    return this.docClient;
  }

  private subKey(threadId: string): string {
    return `${this.keyPrefix}#sub#${threadId}`;
  }

  private lockKey(threadId: string): string {
    return `${this.keyPrefix}#lock#${threadId}`;
  }

  private cacheKey(key: string): string {
    return `${this.keyPrefix}#cache#${key}`;
  }

  private listKey(key: string): string {
    return `${this.keyPrefix}#list#${key}`;
  }

  private listCounterKey(key: string): string {
    return `${this.keyPrefix}#list-counter#${key}`;
  }

  private async queryAllListItems(
    key: string
  ): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const result = await this.docClient.query({
        TableName: this.tableName,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": this.listKey(key) },
        ScanIndexForward: true,
        ExclusiveStartKey: exclusiveStartKey,
      });

      if (result.Items) {
        items.push(...result.Items);
      }
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return items;
  }

  private async trimList(key: string, maxLength: number): Promise<void> {
    const allKeys: string[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const result = await this.docClient.query({
        TableName: this.tableName,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": this.listKey(key) },
        ProjectionExpression: "sk",
        ScanIndexForward: true,
        ExclusiveStartKey: exclusiveStartKey,
      });

      if (result.Items) {
        for (const item of result.Items) {
          allKeys.push(item.sk as string);
        }
      }
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    const overflow = allKeys.length - maxLength;
    if (overflow <= 0) {
      return;
    }

    const keysToDelete = allKeys.slice(0, overflow);
    const pk = this.listKey(key);

    for (let i = 0; i < keysToDelete.length; i += BATCH_WRITE_LIMIT) {
      const batch = keysToDelete.slice(i, i + BATCH_WRITE_LIMIT);

      const result = await this.docClient.batchWrite({
        RequestItems: {
          [this.tableName]: batch.map((sk) => ({
            DeleteRequest: { Key: { pk, sk } },
          })),
        },
      });

      const unprocessed = result.UnprocessedItems?.[this.tableName];
      if (unprocessed?.length) {
        this.logger.warn(
          `trimList: ${unprocessed.length} unprocessed deletes for list "${key}"`
        );
      }
    }
  }

  private async refreshListTtl(key: string, ttlMs: number): Promise<void> {
    const items = await this.queryAllListItems(key);
    const now = Date.now();
    const expiresAtMs = now + ttlMs;
    const expiresAt = msToSeconds(expiresAtMs);

    for (let i = 0; i < items.length; i += BATCH_WRITE_LIMIT) {
      const batch = items.slice(i, i + BATCH_WRITE_LIMIT);

      const result = await this.docClient.batchWrite({
        RequestItems: {
          [this.tableName]: batch.map((item) => ({
            PutRequest: {
              Item: { ...item, expiresAtMs, expiresAt },
            },
          })),
        },
      });

      const unprocessed = result.UnprocessedItems?.[this.tableName];
      if (unprocessed?.length) {
        this.logger.warn(
          `refreshListTtl: ${unprocessed.length} unprocessed writes for list "${key}"`
        );
      }
    }
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error(
        "DynamoDBStateAdapter is not connected. Call connect() first."
      );
    }
  }
}

function generateToken(): string {
  return `ddb_${crypto.randomUUID()}`;
}

function msToSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

export function createDynamoDBState(
  options: CreateDynamoDBStateOptions = {}
): DynamoDBStateAdapter {
  if ("client" in options && options.client) {
    return new DynamoDBStateAdapter({
      client: options.client,
      tableName: options.tableName,
      keyPrefix: options.keyPrefix,
      logger: options.logger,
    });
  }

  const opts = options as Partial<DynamoDBStateAdapterOptions>;
  return new DynamoDBStateAdapter({
    tableName: opts.tableName,
    keyPrefix: opts.keyPrefix,
    region: opts.region,
    endpoint: opts.endpoint,
    logger: opts.logger,
  });
}
