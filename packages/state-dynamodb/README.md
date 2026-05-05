# @chat-adapter/state-dynamodb

[![npm version](https://img.shields.io/npm/v/@chat-adapter/state-dynamodb)](https://www.npmjs.com/package/@chat-adapter/state-dynamodb)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/state-dynamodb)](https://www.npmjs.com/package/@chat-adapter/state-dynamodb)

Production DynamoDB state adapter for [Chat SDK](https://chat-sdk.dev) built with [AWS SDK](https://www.npmjs.com/package/@aws-sdk/client-dynamodb). Use this for a simple AWS deployment.

## Installation

```bash
pnpm add @chat-adapter/state-dynamodb
```

## Usage

`createDynamoDbState({tableName: 'DYNAMO_DB_TABLE_NAME'})` the only required option is the table name:

```typescript
import { Chat } from "chat";
import { createDynamoDbState } from "@chat-adapter/state-dynamodb";

const bot = new Chat({
  userName: "mybot",
  adapters: { /* ... */ },
  state: createDynamoDbState({tableName: 'DYNAMO_DB_TABLE_NAME'}),
});
```

## To provide AWS configuration parameters provide the DynamoDB client:

```typescript
const client = new DynamoDBClient({
  region: "us-east-1",
});
const state = createDynamoDbState({
  client: client
});
```

## Configuration

| Option | Required | Description |
|--------|----------|-------------|
| `tableName` | Yes | DynamoDB Tabla Name |
| `partitionKeyName` | No | The partition key for the table (default: `PK`) |
| `sortKeyName` | No | The sort key for the table (default: `SK`) |
| `ttlAttributeName` | No | The [ttl attribute name](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html)  (default: `ttl_seconds`) |
| `keyPrefix` | No | Prefix for all partition keys (default: `chat-sdk`) |
| `credentials` | No | AwsCredentialIdentity or AwsCredentialIdentityProvider. If not provided will use default credentials. |
| `region` | No | AWS region if not provided will use . |
| `logger` | No | Logger instance (defaults to `ConsoleLogger("info").child("dynamodb")`) |


## Data model

The adapter expects a DynamoDB table to have been created, an CloudFormation example is below

```yaml
ChatStateTable:
  Type: AWS::DynamoDB::Table
  DeletionPolicy: Retain
  UpdateReplacePolicy: Retain
  Properties:
    AttributeDefinitions:
      - AttributeName: PK
        AttributeType: S
      - AttributeName: SK
        AttributeType: S
    KeySchema:
      - AttributeName: PK
        KeyType: HASH
      - AttributeName: SK
        KeyType: RANGE
    TimeToLiveSpecification:
        AttributeName: ttl_seconds
        Enabled: true
    BillingMode: PAY_PER_REQUEST
```

All PK values are prefixed by `key_prefix`.

## Features

| Feature | Supported |
|---------|-----------|
| Persistence | Yes |
| Multi-instance | Yes |
| Subscriptions | Yes |
| Distributed locking | Yes |
| Key-value caching | Yes (with TTL) |
| Automatic table creation | No |
| Key prefix namespacing | Yes |


## Expired row cleanup

Expired rows will be cleaned up using the built in DynamoDB [TTL Attribute](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html).  Make sure that TTL attribute is set enabled.  The Cloudformation snippet above includes this setting.

## License

MIT
