import type { Logger } from "./log.ts";
import type { BillingStore, LicenceRecord } from "./store.ts";

/**
 * Durable `BillingStore` on one DynamoDB table, selected with
 * `SUITE_BILLING_STORE=dynamodb` and off by default.
 *
 * One table, one string partition key `pk`, two prefixes:
 *
 *   event#<stripe event id>    a claim; the item existing means "already processed"
 *   customer#<stripe customer> a `LicenceRecord`, unchanged in shape beside `pk`
 *
 * Correctness comes from conditional writes, not from reading first: a read
 * followed by a write is two round trips with a window between them, and two
 * identical Stripe deliveries can land in different Lambda containers.
 *
 * The AWS SDK is imported by name only when the adapter is selected, so a
 * deployment that keeps the in-memory store never loads it. The interfaces
 * below are structural rather than imported types for the same reason: the
 * packages are optional and a build without them still typechecks.
 */

export const DYNAMODB_CLIENT_MODULE = "@aws-sdk/client-dynamodb";
export const DYNAMODB_DOCUMENT_MODULE = "@aws-sdk/lib-dynamodb";

/**
 * Stripe retries for up to three days; thirty days leaves room for a replay by
 * hand without keeping the table growing forever. TTL is eventual, so the
 * conditional put — not the deletion — is what makes a claim idempotent.
 */
export const DEFAULT_EVENT_TTL_SECONDS = 30 * 24 * 60 * 60;

export type DynamoItem = Record<string, unknown>;

export function eventKey(eventId: string): string {
  return `event#${eventId}`;
}

export function customerKey(customerId: string): string {
  return `customer#${customerId}`;
}

/** The one error the store treats as an expected outcome rather than a failure. */
export function isConditionalCheckFailed(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "ConditionalCheckFailedException"
  );
}

export interface DynamoDocumentClient {
  send(command: unknown): Promise<unknown>;
}

/** The pieces of the two SDK modules this adapter uses. */
export interface DynamoDbSdk {
  DynamoDBClient: new (config: { region?: string }) => unknown;
  DynamoDBDocumentClient: {
    from(client: unknown, config?: DynamoItem): DynamoDocumentClient;
  };
  PutCommand: new (input: DynamoItem) => unknown;
  GetCommand: new (input: DynamoItem) => unknown;
  DeleteCommand: new (input: DynamoItem) => unknown;
}

/**
 * Commands are built by the transport so the store can be tested without the
 * SDK, and so a fake can assert on the exact input DynamoDB would receive.
 */
export interface DynamoTransport {
  put(input: DynamoItem): unknown;
  get(input: DynamoItem): unknown;
  remove(input: DynamoItem): unknown;
  send(command: unknown): Promise<unknown>;
}

export function dynamoTransport(sdk: DynamoDbSdk, client: DynamoDocumentClient): DynamoTransport {
  return {
    put: (input) => new sdk.PutCommand(input),
    get: (input) => new sdk.GetCommand(input),
    remove: (input) => new sdk.DeleteCommand(input),
    send: (command) => client.send(command),
  };
}

export interface DynamoDbStoreOptions {
  table: string;
  transport: DynamoTransport;
  now?: () => number;
  eventTtlSeconds?: number;
}

export function dynamoDbStore(options: DynamoDbStoreOptions): BillingStore {
  const { table, transport } = options;
  const now = options.now ?? (() => Date.now());
  const ttlSeconds = options.eventTtlSeconds ?? DEFAULT_EVENT_TTL_SECONDS;

  return {
    async claimEvent(eventId) {
      const claimedAt = now();
      try {
        await transport.send(
          transport.put({
            TableName: table,
            Item: {
              pk: eventKey(eventId),
              claimedAt,
              ttl: Math.floor(claimedAt / 1000) + ttlSeconds,
            },
            ConditionExpression: "attribute_not_exists(pk)",
          }),
        );
        return true;
      } catch (error) {
        if (isConditionalCheckFailed(error)) return false;
        throw error;
      }
    },

    async releaseEvent(eventId) {
      await transport.send(transport.remove({ TableName: table, Key: { pk: eventKey(eventId) } }));
    },

    async getCustomer(customerId) {
      const result = (await transport.send(
        transport.get({ TableName: table, Key: { pk: customerKey(customerId) } }),
      )) as { Item?: DynamoItem } | undefined;
      if (result?.Item === undefined) return null;
      // `pk` is the table's key, not part of the record; the shape inside is
      // exactly what `LicenceRecord` declares.
      const record = { ...result.Item };
      delete record.pk;
      return record as unknown as LicenceRecord;
    },

    async putCustomer(record) {
      try {
        await transport.send(
          transport.put({
            TableName: table,
            Item: { pk: customerKey(record.customerId), ...record },
            // A delivery that was retried slowly must not roll a customer back
            // to an older expiry. Equal timestamps still win, so a replay of the
            // same record is harmless.
            ConditionExpression: "attribute_not_exists(updatedAt) OR updatedAt <= :updatedAt",
            ExpressionAttributeValues: { ":updatedAt": record.updatedAt },
          }),
        );
      } catch (error) {
        if (isConditionalCheckFailed(error)) {
          throw new Error(
            `customer ${record.customerId} already holds a newer record than updatedAt ${record.updatedAt}`,
            { cause: error },
          );
        }
        throw error;
      }
    },
  };
}

async function loadModule(
  load: (moduleName: string) => Promise<unknown>,
  moduleName: string,
): Promise<DynamoItem> {
  try {
    return (await load(moduleName)) as DynamoItem;
  } catch (error) {
    throw new Error(
      `${moduleName} is not installed; run "pnpm --filter @suite/billing add ${moduleName}" in services/billing (the repository install stays AWS-free)`,
      { cause: error },
    );
  }
}

export interface DynamoDbEnvironmentOptions {
  /** `SUITE_BILLING_TABLE`; required whenever the adapter is selected. */
  table: string | undefined;
  /** Defaults to the Lambda's region, which the SDK reads from the environment. */
  region?: string | undefined;
  now?: () => number;
  eventTtlSeconds?: number;
  log?: Logger;
  /** Injection point for tests; the real path imports the SDK packages by name. */
  loadSdk?: (moduleName: string) => Promise<unknown>;
}

/**
 * The deployable form: dynamic import, a document client, and the same store.
 * A missing table is an error rather than a silent fall back to memory — a
 * Lambda that quietly forgot its claims would mint two licences for one event.
 */
export async function dynamoDbStoreFromEnvironment(
  options: DynamoDbEnvironmentOptions,
): Promise<BillingStore> {
  const table = options.table?.trim();
  if (table === undefined || table.length === 0) {
    throw new Error("SUITE_BILLING_TABLE is not set; SUITE_BILLING_STORE=dynamodb needs a table");
  }

  const load = options.loadSdk ?? ((moduleName: string) => import(moduleName));
  const clientSdk = await loadModule(load, DYNAMODB_CLIENT_MODULE);
  const documentSdk = await loadModule(load, DYNAMODB_DOCUMENT_MODULE);
  const sdk = { ...clientSdk, ...documentSdk } as unknown as DynamoDbSdk;

  if (
    typeof sdk.DynamoDBClient !== "function" ||
    typeof sdk.DynamoDBDocumentClient?.from !== "function" ||
    typeof sdk.PutCommand !== "function" ||
    typeof sdk.GetCommand !== "function" ||
    typeof sdk.DeleteCommand !== "function"
  ) {
    throw new Error(
      `${DYNAMODB_CLIENT_MODULE} and ${DYNAMODB_DOCUMENT_MODULE} do not export the DynamoDB client and command constructors`,
    );
  }

  const base = new sdk.DynamoDBClient(options.region ? { region: options.region } : {});
  const client = sdk.DynamoDBDocumentClient.from(base, {
    marshallOptions: { removeUndefinedValues: true },
  });

  options.log?.("info", "billing store selected", { backend: "dynamodb", table });

  return dynamoDbStore({
    table,
    transport: dynamoTransport(sdk, client),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.eventTtlSeconds === undefined ? {} : { eventTtlSeconds: options.eventTtlSeconds }),
  });
}
