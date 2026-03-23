import {
  ConditionalCheckFailedException,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import type { Lock, Logger, StateAdapter } from "chat";
import { ConsoleLogger } from "chat";

const DEFAULT_TABLE_NAME = "chat-state";
const DEFAULT_KEY_PREFIX = "chat-sdk";
const DEFAULT_PK_NAME = "pk";
const DEFAULT_SK_NAME = "sk";
const DEFAULT_TTL_NAME = "expiresAt";

const SEQ_PAD_LENGTH = 16;
const BATCH_WRITE_LIMIT = 25;

export interface DynamoDBStateSharedOptions {
  /** Key prefix for multi-tenancy (default: "chat-sdk") */
  keyPrefix?: string;
  /** Logger instance for error reporting */
  logger?: Logger;
  /** Partition key attribute name (default: "pk") */
  pkName?: string;
  /** Sort key attribute name (default: "sk") */
  skName?: string;
  /** DynamoDB table name (default: "chat-state") */
  tableName?: string;
  /** TTL attribute name (default: "expiresAt") */
  ttlName?: string;
}

export interface DynamoDBStateAdapterOptions
  extends DynamoDBStateSharedOptions {
  /** Custom DynamoDB endpoint (for DynamoDB Local development) */
  endpoint?: string;
  /** AWS region (default: from environment) */
  region?: string;
}

export interface DynamoDBStateClientOptions extends DynamoDBStateSharedOptions {
  /** Existing DynamoDBDocument instance */
  client: DynamoDBDocument;
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
  private readonly pkName: string;
  private readonly skName: string;
  private readonly ttlName: string;
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
    this.pkName = options.pkName ?? DEFAULT_PK_NAME;
    this.skName = options.skName ?? DEFAULT_SK_NAME;
    this.ttlName = options.ttlName ?? DEFAULT_TTL_NAME;
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
      Item: this.key(this.subKey(threadId), "_"),
    });
  }

  async unsubscribe(threadId: string): Promise<void> {
    this.ensureConnected();

    await this.docClient.delete({
      TableName: this.tableName,
      Key: this.key(this.subKey(threadId), "_"),
    });
  }

  async isSubscribed(threadId: string): Promise<boolean> {
    this.ensureConnected();

    const result = await this.docClient.get({
      TableName: this.tableName,
      Key: this.key(this.subKey(threadId), "_"),
      ProjectionExpression: "#pk",
      ExpressionAttributeNames: { "#pk": this.pkName },
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
          ...this.key(this.lockKey(threadId), "_"),
          token,
          expiresAtMs,
          [this.ttlName]: msToSeconds(expiresAtMs),
        },
        ConditionExpression: "attribute_not_exists(#pk) OR expiresAtMs <= :now",
        ExpressionAttributeNames: { "#pk": this.pkName },
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
        Key: this.key(this.lockKey(lock.threadId), "_"),
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
      Key: this.key(this.lockKey(threadId), "_"),
    });
  }

  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    this.ensureConnected();

    const now = Date.now();
    const newExpiresAtMs = now + ttlMs;

    try {
      await this.docClient.update({
        TableName: this.tableName,
        Key: this.key(this.lockKey(lock.threadId), "_"),
        UpdateExpression: "SET expiresAtMs = :newMs, #ttl = :newSec",
        ConditionExpression: "#t = :token AND expiresAtMs > :now",
        ExpressionAttributeNames: { "#t": "token", "#ttl": this.ttlName },
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
      Key: this.key(this.cacheKey(key), "_"),
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
      ...this.key(this.cacheKey(key), "_"),
      value,
    };

    if (ttlMs !== undefined) {
      const expiresAtMs = Date.now() + ttlMs;
      item.expiresAtMs = expiresAtMs;
      item[this.ttlName] = msToSeconds(expiresAtMs);
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
      ...this.key(this.cacheKey(key), "_"),
      value,
    };

    if (ttlMs !== undefined) {
      const expiresAtMs = now + ttlMs;
      item.expiresAtMs = expiresAtMs;
      item[this.ttlName] = msToSeconds(expiresAtMs);
    }

    try {
      await this.docClient.put({
        TableName: this.tableName,
        Item: item,
        ConditionExpression: "attribute_not_exists(#pk) OR expiresAtMs <= :now",
        ExpressionAttributeNames: { "#pk": this.pkName },
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
      Key: this.key(this.cacheKey(key), "_"),
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
      Key: this.key(this.listCounterKey(key), "_"),
      UpdateExpression: "ADD seq :one",
      ExpressionAttributeValues: { ":one": 1 },
      ReturnValues: "ALL_NEW",
    });

    const seq = counterResult.Attributes?.seq as number;
    const sk = String(seq).padStart(SEQ_PAD_LENGTH, "0");

    const item: Record<string, unknown> = {
      ...this.key(this.listKey(key), sk),
      value,
    };

    if (options?.ttlMs !== undefined) {
      const expiresAtMs = Date.now() + options.ttlMs;
      item.expiresAtMs = expiresAtMs;
      item[this.ttlName] = msToSeconds(expiresAtMs);
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
        KeyConditionExpression: "#pk = :pk",
        ExpressionAttributeNames: { "#pk": this.pkName },
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
        KeyConditionExpression: "#pk = :pk",
        ExpressionAttributeNames: { "#pk": this.pkName, "#sk": this.skName },
        ExpressionAttributeValues: { ":pk": this.listKey(key) },
        ProjectionExpression: "#sk",
        ScanIndexForward: true,
        ExclusiveStartKey: exclusiveStartKey,
      });

      if (result.Items) {
        for (const item of result.Items) {
          allKeys.push(item[this.skName] as string);
        }
      }
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    const overflow = allKeys.length - maxLength;
    if (overflow <= 0) {
      return;
    }

    const keysToDelete = allKeys.slice(0, overflow);
    const pkValue = this.listKey(key);

    for (let i = 0; i < keysToDelete.length; i += BATCH_WRITE_LIMIT) {
      const batch = keysToDelete.slice(i, i + BATCH_WRITE_LIMIT);

      const result = await this.docClient.batchWrite({
        RequestItems: {
          [this.tableName]: batch.map((sk) => ({
            DeleteRequest: { Key: this.key(pkValue, sk) },
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
    const ttlSeconds = msToSeconds(expiresAtMs);

    for (let i = 0; i < items.length; i += BATCH_WRITE_LIMIT) {
      const batch = items.slice(i, i + BATCH_WRITE_LIMIT);

      const result = await this.docClient.batchWrite({
        RequestItems: {
          [this.tableName]: batch.map((item) => ({
            PutRequest: {
              Item: { ...item, expiresAtMs, [this.ttlName]: ttlSeconds },
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

  private key(pk: string, sk: string): Record<string, string> {
    return { [this.pkName]: pk, [this.skName]: sk };
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
      pkName: options.pkName,
      skName: options.skName,
      ttlName: options.ttlName,
      logger: options.logger,
    });
  }

  const opts = options as Partial<DynamoDBStateAdapterOptions>;
  return new DynamoDBStateAdapter({
    tableName: opts.tableName,
    keyPrefix: opts.keyPrefix,
    pkName: opts.pkName,
    skName: opts.skName,
    ttlName: opts.ttlName,
    region: opts.region,
    endpoint: opts.endpoint,
    logger: opts.logger,
  });
}
