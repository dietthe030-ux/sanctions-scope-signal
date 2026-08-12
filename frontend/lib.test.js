import test from "node:test";
import assert from "node:assert/strict";
import {
  assertFinalSuccess,
  bindProviderLifecycle,
  createPendingWriteStore,
  executeGuardedWrite,
  extractCreatedCaseId,
  formatError,
  parseCase,
  serializeWriteArgs,
} from "./lib.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("accepts only FINALIZED successful execution", () => {
  assert.doesNotThrow(() => assertFinalSuccess({ statusName: "FINALIZED", txExecutionResultName: "FINISHED_WITH_RETURN" }));
  assert.throws(() => assertFinalSuccess({ statusName: "ACCEPTED", txExecutionResultName: "FINISHED_WITH_RETURN" }), /FINALIZED/);
  assert.throws(() => assertFinalSuccess({ statusName: "FINALIZED", txExecutionResultName: "FINISHED_WITH_ERROR" }), /no state change/);
});

test("decodes a transaction-specific case id and never falls back to a count", () => {
  const receipt = { consensus_data: { leader_receipt: [{ error: null, result: "42" }] } };
  assert.equal(extractCreatedCaseId(receipt), 42n);
  assert.throws(() => extractCreatedCaseId({ caseCount: 99 }), /leader return/);
});

test("rejects malformed contract readback", () => {
  assert.throws(() => parseCase("{}"), /schema/);
  assert.equal(parseCase(JSON.stringify({
    case_id: 1,
    owner: "0x1",
    legal_name: "Northwind",
    aliases: [],
    identifiers: [],
    source_policy: "OFAC_SDN",
    source_url: "https://example.invalid",
    stage: "DRAFT",
  })).case_id, 1);
});

test("error formatting is bigint-safe", () => {
  assert.match(formatError({ amount: 2n ** 60n }), /1152921504606846976/);
});

test("persists intent and hash across timeout, then reconciles without replay", async () => {
  const store = createPendingWriteStore(memoryStorage(), "pending");
  const intent = { contractAddress: "0xabc", account: "0xowner", functionName: "create_case", args: serializeWriteArgs(["Northwind", 7n]) };
  let submissions = 0;
  await assert.rejects(() => executeGuardedWrite({
    store,
    intent,
    submit: async () => { submissions += 1; return "0xhash"; },
    waitForReceipt: async () => { throw new Error("timeout"); },
    validateReceipt: assertFinalSuccess,
    readback: async () => {},
  }), /timeout/);
  assert.equal(store.load().hash, "0xhash");

  let readbacks = 0;
  await executeGuardedWrite({
    store,
    intent,
    submit: async () => { submissions += 1; throw new Error("must not replay"); },
    waitForReceipt: async (hash) => ({ hash, statusName: "FINALIZED", txExecutionResultName: "FINISHED_WITH_RETURN" }),
    validateReceipt: assertFinalSuccess,
    readback: async () => { readbacks += 1; },
  });
  assert.equal(submissions, 1);
  assert.equal(readbacks, 1);
  assert.equal(store.load(), null);
});

test("keeps failed-final and delayed-readback writes locked", async () => {
  for (const failure of ["receipt", "readback"]) {
    const store = createPendingWriteStore(memoryStorage(), failure);
    const intent = { contractAddress: "0xabc", account: "0xowner", functionName: "freeze_case", args: serializeWriteArgs([1n, "Snapshot"]) };
    await assert.rejects(() => executeGuardedWrite({
      store,
      intent,
      submit: async () => "0xhash",
      waitForReceipt: async () => failure === "receipt"
        ? { statusName: "FINALIZED", txExecutionResultName: "FINISHED_WITH_ERROR" }
        : { statusName: "FINALIZED", txExecutionResultName: "FINISHED_WITH_RETURN" },
      validateReceipt: assertFinalSuccess,
      readback: async () => { throw new Error("readback unavailable"); },
    }));
    assert.equal(store.load().hash, "0xhash");
  }
});

test("blocks a different write while one intent is pending", async () => {
  const store = createPendingWriteStore(memoryStorage(), "pending");
  store.begin({ contractAddress: "0xabc", account: "0xowner", functionName: "create_case", args: ["A"] });
  await assert.rejects(() => executeGuardedWrite({
    store,
    intent: { contractAddress: "0xabc", account: "0xowner", functionName: "create_case", args: ["B"] },
    submit: async () => "0xnever",
    waitForReceipt: async () => ({}),
    validateReceipt: () => {},
    readback: async () => {},
  }), /before any different write/);
});

test("clears only a definite wallet rejection before transaction submission", async () => {
  const store = createPendingWriteStore(memoryStorage(), "pending");
  const rejection = Object.assign(new Error("user rejected"), { code: 4001 });
  await assert.rejects(() => executeGuardedWrite({
    store,
    intent: { contractAddress: "0xabc", account: "0xowner", functionName: "create_case", args: ["A"] },
    submit: async () => { throw rejection; },
    waitForReceipt: async () => ({}),
    validateReceipt: () => {},
    readback: async () => {},
    isDefiniteNoSubmission: (error) => error?.code === 4001,
  }), /user rejected/);
  assert.equal(store.load(), null);
});

test("invalidates stale clients for account, chain, and disconnect lifecycle events", () => {
  const handlers = new Map();
  const removed = [];
  const provider = {
    on: (event, handler) => handlers.set(event, handler),
    removeListener: (event, handler) => removed.push([event, handler]),
  };
  const invalidations = [];
  const detach = bindProviderLifecycle(provider, (reason) => invalidations.push(reason));
  handlers.get("accountsChanged")(["0xnew"]);
  handlers.get("chainChanged")("0xf22f");
  handlers.get("disconnect")();
  assert.deepEqual(invalidations, ["accountsChanged", "chainChanged", "disconnect"]);
  detach();
  assert.equal(removed.length, 3);
});
