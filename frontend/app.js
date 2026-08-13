import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { ExecutionResult, TransactionStatus } from "genlayer-js/types";
import {
  assertFinalSuccess,
  bindProviderLifecycle,
  createPendingWriteStore,
  ensureWalletChain,
  executeGuardedWrite,
  extractCreatedCaseId,
  formatError,
  parseCase,
  registerWalletProvider,
  restoreWalletProvider,
  serializeWriteArgs,
  shortAddress,
  walletProviderAliases,
} from "./lib.js";

const config = window.__SSS_CONFIG__ || {};
const contractAddress = /^0x[0-9a-fA-F]{40}$/.test(config.contractAddress || "") ? config.contractAddress : "";
const readClient = createClient({ chain: studionet });

const state = {
  account: "",
  provider: null,
  writeClient: null,
  case: null,
  providers: new Map(),
  detachProvider: null,
};

const pendingStore = createPendingWriteStore(window.localStorage, `sss:pending:${contractAddress || "undeployed"}`);
const walletMemoryKey = `sss:wallet:${contractAddress || "undeployed"}`;
let walletRestoreInFlight = false;

const byId = (id) => document.getElementById(id);
const elements = {
  connect: byId("connect-wallet"),
  disconnect: byId("disconnect-wallet"),
  reconcile: byId("reconcile-write"),
  providerDialog: byId("provider-dialog"),
  providerList: byId("provider-list"),
  commandDialog: byId("command-dialog"),
  commandOpen: byId("open-command"),
  commandClose: byId("close-command"),
  caseSearch: byId("case-search"),
  loadCase: byId("load-case"),
  walletState: byId("wallet-state"),
  contractState: byId("contract-state"),
  notice: byId("global-notice"),
  createForm: byId("create-form"),
  caseView: byId("case-view"),
  aliasForm: byId("alias-form"),
  identifierForm: byId("identifier-form"),
  freezeForm: byId("freeze-form"),
  assess: byId("assess-case"),
  supersedeForm: byId("supersede-form"),
};

function notice(message, tone = "info") {
  elements.notice.hidden = !message;
  elements.notice.textContent = message;
  elements.notice.dataset.tone = tone;
}

function setButton(button, mode, label) {
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.dataset.state = mode || "idle";
  button.disabled = mode === "loading" || !contractAddress;
  button.textContent = label || button.dataset.label;
}

function requireWriteClient() {
  if (!contractAddress) throw new Error("The Studionet contract is not deployed yet.");
  if (!state.writeClient || !state.account) throw new Error("Connect a wallet provider before signing this write.");
  return state.writeClient;
}

async function readCase(caseId) {
  if (!contractAddress) throw new Error("The Studionet contract is not deployed yet.");
  const raw = await readClient.readContract({
    address: contractAddress,
    functionName: "get_case",
    args: [caseId],
  });
  return parseCase(raw);
}

async function finalizeWrite(functionName, args, button, readback) {
  const client = requireWriteClient();
  const account = state.account;
  const intent = { contractAddress, account, functionName, args: serializeWriteArgs(args) };
  const existing = pendingStore.load();
  setButton(button, "loading", existing ? "Reconciling pending…" : "Waiting for finality…");
  notice(existing ? "Reconciling the stored transaction before any retry." : "Write intent persisted. Waiting for a transaction hash and FINALIZED consensus.");
  try {
    const result = await executeGuardedWrite({
      store: pendingStore,
      intent,
      submit: () => client.writeContract({ address: contractAddress, functionName, args, value: 0n }),
      waitForReceipt: (hash) => readClient.waitForTransactionReceipt({
        hash,
        status: TransactionStatus.FINALIZED,
        interval: 4_000,
        retries: 240,
      }),
      validateReceipt: assertFinalSuccess,
      readback: (receipt, hash, pending) => readback(receipt, hash, { ...pending, account }),
      isDefiniteNoSubmission: (error) => error?.code === 4001,
    });
    setButton(button, "success", "Readback verified");
    elements.reconcile.hidden = true;
    notice("Finalized leader execution and authoritative readback verified.", "success");
    window.setTimeout(() => setButton(button, "idle"), 2_500);
    return result;
  } catch (error) {
    const pending = pendingStore.load();
    setButton(button, pending ? "pending" : "error", pending ? "Reconcile pending" : "Write not sent");
    elements.reconcile.hidden = !pending;
    notice(`${formatError(error)} ${pending ? "The persisted intent remains locked; reconcile it before retrying." : "No pending transaction was retained."}`, "error");
    throw error;
  }
}

async function verifyPendingReadback(receipt, _hash, pending) {
  const args = pending.args.map((value) => value?.bigint ? BigInt(value.bigint) : value);
  if (pending.functionName === "create_case") {
    const caseId = extractCreatedCaseId(receipt);
    const record = await readCase(caseId);
    if (record.owner.toLowerCase() !== pending.account.toLowerCase() || record.legal_name !== args[0] || record.source_policy !== args[1]) {
      throw new Error("Authoritative creation readback does not match the persisted intent.");
    }
    renderCase(record);
    return record;
  }
  const record = await readCase(BigInt(args[0]));
  const verified = {
    add_alias: () => record.aliases.includes(args[1]),
    add_identifier: () => record.identifiers.includes(args[1]),
    freeze_case: () => record.stage === "FROZEN" && record.snapshot_label === args[1],
    assess_case: () => ["SIGNALLED", "UNRESOLVED"].includes(record.stage),
    supersede_case: () => record.stage === "SUPERSEDED" && BigInt(record.superseded_by) === BigInt(args[1]),
  }[pending.functionName];
  if (!verified || !verified()) throw new Error("Authoritative state does not match the persisted write intent.");
  renderCase(record);
  return record;
}

async function reconcilePendingWrite() {
  const pending = pendingStore.load();
  if (!pending) {
    elements.reconcile.hidden = true;
    return;
  }
  if (!state.account || pending.account.toLowerCase() !== state.account.toLowerCase()) {
    elements.reconcile.hidden = false;
    throw new Error(`Reconnect ${shortAddress(pending.account)} to reconcile its pending write.`);
  }
  setButton(elements.reconcile, "loading", "Reconciling…");
  try {
    await executeGuardedWrite({
      store: pendingStore,
      intent: pending,
      submit: () => { throw new Error("A persisted write must never be resubmitted."); },
      waitForReceipt: (hash) => readClient.waitForTransactionReceipt({ hash, status: TransactionStatus.FINALIZED, interval: 4_000, retries: 240 }),
      validateReceipt: assertFinalSuccess,
      readback: verifyPendingReadback,
    });
    elements.reconcile.hidden = true;
    setButton(elements.reconcile, "success", "Reconciled");
    notice("Stored transaction finalized successfully and its contract state was verified.", "success");
  } catch (error) {
    setButton(elements.reconcile, "pending", "Reconcile pending write");
    notice(formatError(error), "error");
    throw error;
  }
}

function renderTerms(list, values) {
  list.replaceChildren(...values.map((value) => {
    const item = document.createElement("li");
    item.textContent = value;
    return item;
  }));
}

function renderCase(caseRecord) {
  state.case = caseRecord;
  elements.caseView.hidden = false;
  elements.createForm.hidden = true;
  byId("case-number").textContent = `CASE ${caseRecord.case_id}`;
  byId("case-name").textContent = caseRecord.legal_name;
  byId("case-stage").textContent = caseRecord.stage;
  byId("case-source").textContent = caseRecord.source_policy.replaceAll("_", " ");
  byId("case-source").href = caseRecord.source_url;
  renderTerms(byId("alias-list"), caseRecord.aliases);
  renderTerms(byId("identifier-list"), caseRecord.identifiers);

  const assessed = ["SIGNALLED", "UNRESOLVED", "SUPERSEDED"].includes(caseRecord.stage);
  byId("case-result").hidden = !assessed;
  if (assessed) {
    byId("case-outcome").textContent = caseRecord.outcome || "—";
    byId("case-consequence").textContent = caseRecord.consequence || "—";
    byId("case-reason").textContent = caseRecord.reason || "No reasoning was stored.";
    byId("case-digest").textContent = caseRecord.source_digest ? `SHA-256 ${caseRecord.source_digest}` : "No source digest available";
  }

  byId("draft-actions").hidden = caseRecord.stage !== "DRAFT";
  byId("assessment-action").hidden = caseRecord.stage !== "FROZEN";
  elements.supersedeForm.hidden = !["SIGNALLED", "UNRESOLVED"].includes(caseRecord.stage);
  elements.caseView.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

async function loadAndRender(caseId) {
  notice("Reading accepted contract state…");
  try {
    const record = await readCase(BigInt(caseId));
    renderCase(record);
    notice("Accepted case state loaded.", "success");
    return record;
  } catch (error) {
    notice(`${formatError(error)} Check the case ID and contract deployment.`, "error");
    throw error;
  }
}

function registerProvider(info, provider) {
  registerWalletProvider(state.providers, info, provider);
}

function discoverProviders() {
  state.providers.clear();
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  const injected = window.ethereum;
  if (Array.isArray(injected?.providers)) {
    injected.providers.forEach((provider, index) => registerProvider({ name: provider.isMetaMask ? "MetaMask" : `Injected wallet ${index + 1}` }, provider));
  } else if (injected?.request) {
    registerProvider({ name: injected.isMetaMask ? "MetaMask" : "Injected wallet" }, injected);
  }
}

function renderProviderList() {
  discoverProviders();
  elements.providerList.replaceChildren();
  if (!state.providers.size) {
    const empty = document.createElement("p");
    empty.className = "provider-empty";
    empty.textContent = "No supported EIP-1193 provider was announced. Install or enable a compatible wallet, then reopen this selector.";
    elements.providerList.append(empty);
    return;
  }
  for (const { info, provider } of state.providers.values()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button--quiet provider-button";
    button.textContent = info.name || info.rdns || "Wallet provider";
    button.addEventListener("click", () => connectProvider(provider, info));
    elements.providerList.append(button);
  }
}

function detachProviderHandlers() {
  state.detachProvider?.();
  state.detachProvider = null;
}

function invalidateWallet(message) {
  detachProviderHandlers();
  state.provider = null;
  state.account = "";
  state.writeClient = null;
  window.localStorage.removeItem(walletMemoryKey);
  elements.connect.textContent = "Connect wallet";
  elements.disconnect.hidden = true;
  elements.walletState.textContent = message || "Wallet disconnected locally.";
}

function activateWallet(provider, info, account, restored = false) {
  detachProviderHandlers();
  state.provider = provider;
  state.account = account;
  state.writeClient = createClient({ chain: studionet, account, provider });
  elements.connect.textContent = "Switch wallet";
  elements.disconnect.hidden = false;
  elements.walletState.textContent = `Connected ${shortAddress(account)} through ${info?.name || "selected provider"}.`;
  window.localStorage.setItem(walletMemoryKey, JSON.stringify({
    version: 1,
    aliases: walletProviderAliases(info),
    name: info?.name || "selected provider",
  }));
  state.detachProvider = bindProviderLifecycle(provider, (reason) => invalidateWallet({
    accountsChanged: "Wallet account changed. Reconnect through the provider selector before any write.",
    chainChanged: "Wallet network changed. Reconnect and confirm Studionet before any write.",
    disconnect: "Wallet provider disconnected. Reconnect before any write.",
  }[reason]));
  notice(restored ? "Authorized wallet session restored on Studionet. No write has been sent." : "Wallet connected to Studionet. No write has been sent.", "success");
}

async function tryRestoreRememberedWallet() {
  if (walletRestoreInFlight || state.account) return;
  let remembered;
  try {
    remembered = JSON.parse(window.localStorage.getItem(walletMemoryKey) || "null");
  } catch {
    window.localStorage.removeItem(walletMemoryKey);
    return;
  }
  if (remembered?.version !== 1) return;
  walletRestoreInFlight = true;
  try {
    const restored = await restoreWalletProvider(state.providers, remembered, studionet);
    if (!restored) return;
    activateWallet(restored.provider, restored.info, restored.account, true);
  } catch {
    window.localStorage.removeItem(walletMemoryKey);
  } finally {
    walletRestoreInFlight = false;
  }
  try {
    if (state.account && pendingStore.load()) await reconcilePendingWrite();
  } catch (error) {
    notice(formatError(error), "error");
  }
}

async function connectProvider(provider, info) {
  notice(`Requesting access from ${info?.name || "the selected wallet"}…`);
  try {
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    if (!Array.isArray(accounts) || !accounts[0]) throw new Error("The selected wallet returned no account.");
    const account = accounts[0];
    await ensureWalletChain(provider, studionet);
    activateWallet(provider, info, account);
    elements.providerDialog.close();
    if (pendingStore.load()) await reconcilePendingWrite();
  } catch (error) {
    notice(`${formatError(error)} Choose a provider again or approve the Studionet switch.`, "error");
  }
}

elements.connect.addEventListener("click", () => {
  renderProviderList();
  elements.providerDialog.showModal();
  elements.providerList.querySelector("button")?.focus();
});

window.addEventListener("eip6963:announceProvider", (event) => {
  registerProvider(event.detail.info, event.detail.provider);
  window.setTimeout(() => void tryRestoreRememberedWallet(), 0);
});
elements.disconnect.addEventListener("click", () => {
  invalidateWallet("Wallet disconnected locally. Any persisted transaction remains available for later reconciliation.");
  notice("Local wallet session cleared. No provider account was selected automatically.", "success");
});
elements.reconcile.addEventListener("click", () => reconcilePendingWrite().catch(() => {}));

elements.commandOpen.addEventListener("click", () => {
  elements.commandDialog.showModal();
  elements.caseSearch.focus();
});
elements.commandClose.addEventListener("click", () => elements.commandDialog.close());
document.addEventListener("keydown", (event) => {
  const target = event.target;
  const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (!elements.commandDialog.open) elements.commandDialog.showModal();
    elements.caseSearch.focus();
  } else if (event.key === "/" && !typing && !elements.commandDialog.open) {
    event.preventDefault();
    elements.commandDialog.showModal();
    elements.caseSearch.focus();
  }
});

elements.loadCase.addEventListener("click", async () => {
  if (!elements.caseSearch.reportValidity()) return;
  try {
    await loadAndRender(elements.caseSearch.value);
    elements.commandDialog.close();
  } catch {}
});

elements.createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = byId("create-case");
  const legalName = byId("legal-name").value.trim();
  const policy = byId("source-policy").value;
  try {
    await finalizeWrite("create_case", [legalName, policy], button, async (receipt, _hash, intent) => {
      const caseId = extractCreatedCaseId(receipt);
      const record = await readCase(caseId);
      if (record.owner.toLowerCase() !== intent.account.toLowerCase() || record.legal_name !== legalName || record.source_policy !== policy) {
        throw new Error("Authoritative readback does not match the signed creation intent.");
      }
      renderCase(record);
      return record;
    });
  } catch {}
});

elements.aliasForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = byId("alias-input");
  const button = elements.aliasForm.querySelector("button");
  const value = input.value.trim();
  if (!value) return input.focus();
  try {
    await finalizeWrite("add_alias", [BigInt(state.case.case_id), value], button, async () => {
      const record = await readCase(BigInt(state.case.case_id));
      if (!record.aliases.some((alias) => alias === value)) throw new Error("Alias was not present in authoritative readback.");
      input.value = "";
      renderCase(record);
    });
  } catch {}
});

elements.identifierForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = byId("identifier-input");
  const button = elements.identifierForm.querySelector("button");
  const value = input.value.trim();
  if (!value) return input.focus();
  try {
    await finalizeWrite("add_identifier", [BigInt(state.case.case_id), value], button, async () => {
      const record = await readCase(BigInt(state.case.case_id));
      if (!record.identifiers.some((identifier) => identifier === value)) throw new Error("Identifier was not present in authoritative readback.");
      input.value = "";
      renderCase(record);
    });
  } catch {}
});

elements.freezeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = elements.freezeForm.querySelector("button");
  const label = byId("snapshot-label").value.trim();
  try {
    await finalizeWrite("freeze_case", [BigInt(state.case.case_id), label], button, async () => {
      const record = await readCase(BigInt(state.case.case_id));
      if (record.stage !== "FROZEN" || record.snapshot_label !== label) throw new Error("Frozen boundary was not confirmed by readback.");
      renderCase(record);
    });
  } catch {}
});

elements.assess.addEventListener("click", async () => {
  try {
    await finalizeWrite("assess_case", [BigInt(state.case.case_id)], elements.assess, async () => {
      const record = await readCase(BigInt(state.case.case_id));
      if (!["SIGNALLED", "UNRESOLVED"].includes(record.stage)) throw new Error("Assessment terminal state was not confirmed by readback.");
      renderCase(record);
    });
  } catch {}
});

elements.supersedeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = elements.supersedeForm.querySelector("button");
  const replacement = BigInt(byId("replacement-id").value);
  try {
    await finalizeWrite("supersede_case", [BigInt(state.case.case_id), replacement], button, async () => {
      const record = await readCase(BigInt(state.case.case_id));
      if (record.stage !== "SUPERSEDED" || BigInt(record.superseded_by) !== replacement) throw new Error("Replacement linkage was not confirmed by readback.");
      renderCase(record);
    });
  } catch {}
});

if (contractAddress) {
  elements.contractState.textContent = `Contract ${shortAddress(contractAddress)} · Studionet.`;
  try {
    const pending = pendingStore.load();
    elements.reconcile.hidden = !pending;
    if (pending) notice(`A persisted ${pending.functionName} transaction must be reconciled before any new write.`, "info");
  } catch (error) {
    elements.reconcile.hidden = false;
    notice(formatError(error), "error");
  }
  discoverProviders();
  void tryRestoreRememberedWallet();
} else {
  document.querySelectorAll("button[type='submit'], #assess-case, #load-case").forEach((button) => {
    if (button.id !== "load-case") button.disabled = true;
  });
  elements.contractState.textContent = "Contract address pending PRE_DEPLOY. Writes remain disabled.";
  notice("Local build is ready for PRE_DEPLOY review; no contract address is configured yet.");
}

if (ExecutionResult.FINISHED_WITH_RETURN !== "FINISHED_WITH_RETURN") {
  notice("The installed SDK exposes an unexpected execution enum; writes are disabled.", "error");
  document.querySelectorAll("button[type='submit'], #assess-case").forEach((button) => button.disabled = true);
}
