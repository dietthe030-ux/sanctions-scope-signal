import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assertFinalSuccess,
  bindProviderLifecycle,
  createPendingWriteStore,
  defaultSnapshotLabel,
  ensureWalletChain,
  executeGuardedWrite,
  extractCreatedCaseId,
  formatError,
  parseCase,
  registerWalletProvider,
  serializeWriteArgs,
  walletProviderAliases,
} from "./lib.js";

test("prefills an editable snapshot label from the browser-local date", () => {
  assert.equal(defaultSnapshotLabel(new Date(2026, 7, 13)), "Publication observed 2026-08-13");
});

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("reload stays disconnected until the provider selector is used", async () => {
  const source = await readFile(new URL("./app.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\beth_accounts\b|restoreWallet|walletMemory/i);
  assert.match(source, /elements\.connect\.addEventListener\("click"/);
  assert.match(source, /eth_requestAccounts/);
});

test("accepts named and numeric FINALIZED successful execution only", () => {
  assert.doesNotThrow(() => assertFinalSuccess({ statusName: "FINALIZED", txExecutionResultName: "FINISHED_WITH_RETURN" }));
  assert.doesNotThrow(() => assertFinalSuccess({ status: 7, txExecutionResult: 1 }));
  assert.doesNotThrow(() => assertFinalSuccess({ status_name: "FINALIZED", tx_execution_result: "1" }));
  assert.doesNotThrow(() => assertFinalSuccess({ status: 7, consensus_data: { leader_receipt: [{ error: null, result: "2" }] } }));
  assert.throws(() => assertFinalSuccess({ statusName: "ACCEPTED", txExecutionResultName: "FINISHED_WITH_RETURN" }), /FINALIZED/);
  assert.throws(() => assertFinalSuccess({ statusName: "FINALIZED", txExecutionResultName: "FINISHED_WITH_ERROR" }), /no state change/);
  assert.throws(() => assertFinalSuccess({ statusName: "ACCEPTED", status: 7, txExecutionResult: 1 }), /FINALIZED/);
  assert.throws(() => assertFinalSuccess({ status: 7 }), /no state change/);
  assert.throws(() => assertFinalSuccess({ status: 7, consensus_data: { leader_receipt: [{ error: "reverted", result: null }] } }), /no state change/);
  assert.throws(() => assertFinalSuccess({
    status: 7,
    txExecutionResult: 2,
    consensus_data: { leader_receipt: [{ error: null, result: "2" }] },
  }), /no state change/);
});

test("decodes a transaction-specific case id and never falls back to a count", () => {
  const receipt = { consensus_data: { leader_receipt: [{ error: null, result: "42" }] } };
  assert.equal(extractCreatedCaseId(receipt), 42n);
  assert.equal(extractCreatedCaseId({
    consensus_data: {
      leader_receipt: [{ result: { status: "return", payload: { raw: [2], readable: "43" } } }],
    },
  }), 43n);
  assert.throws(() => extractCreatedCaseId({
    consensus_data: {
      leader_receipt: [{ result: { status: "rollback", payload: { readable: "44" } } }],
    },
  }), /valid case ID/);
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
  assert.equal(formatError({ code: -32601, message: "Method not found" }), "Method not found");
});

test("deduplicates provider identities by normalized rdns or name", () => {
  assert.deepEqual(walletProviderAliases({ rdns: "IO.MetaMask", name: " MetaMask " }), ["io.metamask", "metamask"]);
  assert.deepEqual(walletProviderAliases({ name: "MetaMask" }), ["metamask"]);
  const providers = new Map();
  registerWalletProvider(providers, { rdns: "io.metamask", name: "MetaMask" }, { source: "eip6963" });
  registerWalletProvider(providers, { name: "MetaMask" }, { source: "legacy" });
  assert.equal(providers.size, 1);
  assert.equal([...providers.values()][0].provider.source, "eip6963");
});

test("switches the selected provider without invoking wallet_getSnaps", async () => {
  const calls = [];
  let currentChain = "0x1";
  const provider = {
    request: async ({ method, params }) => {
      calls.push([method, params]);
      if (method === "eth_chainId") return currentChain;
      if (method === "wallet_switchEthereumChain") currentChain = params[0].chainId;
      return null;
    },
  };
  await ensureWalletChain(provider, {
    id: 61999,
    name: "Genlayer Studio Network",
    rpcUrls: { default: { http: ["https://studio.genlayer.com/api"] } },
    nativeCurrency: { name: "GEN Token", symbol: "GEN", decimals: 18 },
    blockExplorers: {},
  });
  assert.deepEqual(calls.map(([method]) => method), ["eth_chainId", "wallet_switchEthereumChain", "eth_chainId"]);
});

test("adds Studionet only when the selected provider reports an unknown chain", async () => {
  const calls = [];
  let switchAttempts = 0;
  let currentChain = "0x1";
  const provider = {
    request: async ({ method, params }) => {
      calls.push([method, params]);
      if (method === "eth_chainId") return currentChain;
      if (method === "wallet_switchEthereumChain" && switchAttempts++ === 0) {
        throw Object.assign(new Error("Unknown chain"), { code: 4902 });
      }
      if (method === "wallet_switchEthereumChain") currentChain = params[0].chainId;
      return null;
    },
  };
  await ensureWalletChain(provider, {
    id: 61999,
    name: "Genlayer Studio Network",
    rpcUrls: { default: { http: ["https://studio.genlayer.com/api"] } },
    nativeCurrency: { name: "GEN Token", symbol: "GEN", decimals: 18 },
    blockExplorers: { default: { url: "https://explorer-studio.genlayer.com" } },
  });
  assert.deepEqual(calls.map(([method]) => method), [
    "eth_chainId",
    "wallet_switchEthereumChain",
    "wallet_addEthereumChain",
    "wallet_switchEthereumChain",
    "eth_chainId",
  ]);
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
