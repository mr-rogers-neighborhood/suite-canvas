import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  customerKey,
  DYNAMODB_CLIENT_MODULE,
  DYNAMODB_DOCUMENT_MODULE,
  type DynamoDbSdk,
  type DynamoItem,
  type DynamoTransport,
  dynamoDbStore,
  dynamoDbStoreFromEnvironment,
  eventKey,
} from "./store-dynamodb.ts";
import { CUSTOMER_EMAIL, CUSTOMER_ID, NOW, PRICE_SOLO } from "./testing.ts";

/**
 * These tests never touch AWS. The fake below implements exactly the three
 * conditional expressions the store writes, so a condition that regressed
 * would fail here rather than in a deployed table.
 */

const EVENT_CONDITION = "attribute_not_exists(pk)";
const CUSTOMER_CONDITION = "attribute_not_exists(updatedAt) OR updatedAt <= :updatedAt";

type Operation = "put" | "get" | "delete";

interface FakeTable {
  items: Map<string, DynamoItem>;
  /** Every put input, so a test can read the condition that was sent. */
  puts: DynamoItem[];
}

function conditionalFailure(): Error {
  return Object.assign(new Error("The conditional request failed"), {
    name: "ConditionalCheckFailedException",
  });
}

function execute(state: FakeTable, operation: Operation, input: DynamoItem): unknown {
  switch (operation) {
    case "put": {
      const item = input.Item as DynamoItem;
      const pk = item.pk as string;
      const stored = state.items.get(pk);
      const condition = input.ConditionExpression;

      if (condition === EVENT_CONDITION && stored !== undefined) throw conditionalFailure();
      if (condition === CUSTOMER_CONDITION) {
        const incoming = (input.ExpressionAttributeValues as Record<string, number>)[":updatedAt"];
        const current = stored?.updatedAt;
        const allowed =
          current === undefined || (typeof current === "number" && current <= (incoming as number));
        if (!allowed) throw conditionalFailure();
      }

      state.puts.push(input);
      state.items.set(pk, structuredClone(item));
      return {};
    }
    case "get": {
      const stored = state.items.get((input.Key as DynamoItem).pk as string);
      return stored === undefined ? {} : { Item: structuredClone(stored) };
    }
    case "delete": {
      state.items.delete((input.Key as DynamoItem).pk as string);
      return {};
    }
    default: {
      throw new Error(`unexpected operation ${operation as string}`);
    }
  }
}

function tableState(): FakeTable {
  return { items: new Map(), puts: [] };
}

function fakeTransport(state: FakeTable): DynamoTransport {
  return {
    put: (input) => ({ operation: "put" as Operation, input }),
    get: (input) => ({ operation: "get" as Operation, input }),
    remove: (input) => ({ operation: "delete" as Operation, input }),
    async send(command) {
      const { operation, input } = command as { operation: Operation; input: DynamoItem };
      assert.equal(input.TableName, "suite-billing");
      return execute(state, operation, input);
    },
  };
}

function store(state: FakeTable = tableState()) {
  return {
    state,
    store: dynamoDbStore({
      table: "suite-billing",
      transport: fakeTransport(state),
      now: () => NOW,
    }),
  };
}

function record(overrides: Partial<{ updatedAt: number; expiresAt: number }> = {}) {
  return {
    customerId: CUSTOMER_ID,
    email: CUSTOMER_EMAIL,
    tier: "solo",
    priceId: PRICE_SOLO,
    licence: "payload.signature",
    licenceId: "lic-1",
    issuedAt: NOW,
    expiresAt: NOW + 86_400_000,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("dynamoDbStore", () => {
  it("claims an event id once, with a conditional put on the key", async () => {
    const { state, store: billing } = store();
    assert.equal(await billing.claimEvent("evt_1"), true);
    assert.equal(await billing.claimEvent("evt_1"), false);
    assert.equal(await billing.claimEvent("evt_2"), true);

    assert.equal(state.puts.length, 2, "the duplicate is rejected by DynamoDB, not written");
    assert.equal(state.puts[0]?.ConditionExpression, EVENT_CONDITION);
    assert.ok(state.items.has(eventKey("evt_1")));
    assert.equal(state.items.get(eventKey("evt_1"))?.ttl, Math.floor(NOW / 1000) + 30 * 86_400);
  });

  it("lets a released claim be taken again, so a retry is processed", async () => {
    const { state, store: billing } = store();
    await billing.claimEvent("evt_1");
    await billing.releaseEvent("evt_1");
    assert.equal(state.items.has(eventKey("evt_1")), false, "release deletes the claim");
    assert.equal(await billing.claimEvent("evt_1"), true);
  });

  it("round-trips a licence record by customer, without the table key", async () => {
    const { state, store: billing } = store();
    assert.equal(await billing.getCustomer(CUSTOMER_ID), null);

    const stored = record();
    await billing.putCustomer(stored);

    assert.deepEqual(await billing.getCustomer(CUSTOMER_ID), stored);
    assert.deepEqual(state.items.get(customerKey(CUSTOMER_ID)), {
      pk: customerKey(CUSTOMER_ID),
      ...stored,
    });
  });

  it("refuses an older record so a slow retry cannot roll a customer back", async () => {
    const { store: billing } = store();
    const newer = record({ updatedAt: NOW + 60_000, expiresAt: NOW + 120_000 });
    await billing.putCustomer(newer);

    await assert.rejects(billing.putCustomer(record()), /already holds a newer record/);
    assert.deepEqual(await billing.getCustomer(CUSTOMER_ID), newer);
  });

  it("accepts an equal updatedAt, so replaying the same record is harmless", async () => {
    const { state, store: billing } = store();
    await billing.putCustomer(record());
    await billing.putCustomer(record());
    assert.equal(state.puts.length, 2);
    assert.equal(state.puts[1]?.ConditionExpression, CUSTOMER_CONDITION);
    assert.deepEqual(state.puts[1]?.ExpressionAttributeValues, { ":updatedAt": NOW });
  });

  it("propagates failures that are not conditional-check failures", async () => {
    const outage = dynamoDbStore({
      table: "suite-billing",
      transport: {
        put: () => ({}),
        get: () => ({}),
        remove: () => ({}),
        async send() {
          throw new Error("ProvisionedThroughputExceededException");
        },
      },
    });
    await assert.rejects(outage.claimEvent("evt_1"), /ThroughputExceeded/);
    await assert.rejects(outage.putCustomer(record()), /ThroughputExceeded/);
  });
});

class FakeDynamoDBClient {
  readonly config: { region?: string };
  constructor(config: { region?: string }) {
    this.config = config;
  }
}

class FakeCommand {
  readonly input: DynamoItem;
  readonly operation: Operation;
  constructor(operation: Operation, input: DynamoItem) {
    this.operation = operation;
    this.input = input;
  }
}

describe("dynamoDbStoreFromEnvironment", () => {
  it("loads both SDK modules by name and wires the commands to a document client", async () => {
    const state = tableState();
    const loaded: string[] = [];
    const lines: string[] = [];
    let base: unknown = null;

    const sdkModules: Record<string, unknown> = {
      [DYNAMODB_CLIENT_MODULE]: { DynamoDBClient: FakeDynamoDBClient },
      [DYNAMODB_DOCUMENT_MODULE]: {
        DynamoDBDocumentClient: {
          from(client: unknown) {
            base = client;
            return {
              async send(command: unknown) {
                const { operation, input } = command as FakeCommand;
                return execute(state, operation, input);
              },
            };
          },
        },
        PutCommand: class extends FakeCommand {
          constructor(input: DynamoItem) {
            super("put", input);
          }
        },
        GetCommand: class extends FakeCommand {
          constructor(input: DynamoItem) {
            super("get", input);
          }
        },
        DeleteCommand: class extends FakeCommand {
          constructor(input: DynamoItem) {
            super("delete", input);
          }
        },
      },
    };
    const sdk = {
      ...(sdkModules[DYNAMODB_CLIENT_MODULE] as object),
      ...(sdkModules[DYNAMODB_DOCUMENT_MODULE] as object),
    } as unknown as DynamoDbSdk;
    assert.equal(typeof sdk.DynamoDBDocumentClient.from, "function");

    const billing = await dynamoDbStoreFromEnvironment({
      table: " suite-billing ",
      region: "eu-west-1",
      now: () => NOW,
      loadSdk: async (moduleName) => {
        loaded.push(moduleName);
        return sdkModules[moduleName];
      },
      log: (level, message, fields) => {
        lines.push(JSON.stringify({ level, message, ...fields }));
      },
    });

    assert.deepEqual(loaded, [DYNAMODB_CLIENT_MODULE, DYNAMODB_DOCUMENT_MODULE]);
    assert.deepEqual((base as FakeDynamoDBClient).config, { region: "eu-west-1" });

    assert.equal(await billing.claimEvent("evt_1"), true);
    assert.equal(await billing.claimEvent("evt_1"), false);
    await billing.putCustomer(record());
    assert.deepEqual(await billing.getCustomer(CUSTOMER_ID), record());
    await billing.releaseEvent("evt_1");
    assert.equal(state.items.has(eventKey("evt_1")), false);

    assert.match(lines[0] ?? "", /"table":"suite-billing"/);
  });

  it("names the missing table instead of falling back to memory", async () => {
    await assert.rejects(dynamoDbStoreFromEnvironment({ table: undefined }), /SUITE_BILLING_TABLE/);
    await assert.rejects(dynamoDbStoreFromEnvironment({ table: "  " }), /SUITE_BILLING_TABLE/);
  });

  it("names the package to install when the SDK is absent", async () => {
    await assert.rejects(
      dynamoDbStoreFromEnvironment({
        table: "suite-billing",
        loadSdk: async (moduleName) => {
          throw new Error(`Cannot find module '${moduleName}'`);
        },
      }),
      (error: Error) => error.message.includes(DYNAMODB_CLIENT_MODULE),
    );
  });
});
