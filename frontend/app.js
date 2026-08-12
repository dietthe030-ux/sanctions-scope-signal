import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { ExecutionResult, TransactionStatus } from "genlayer-js/types";
import { assertFinalSuccess, extractCreatedCaseId, formatError, parseCase, shortAddress } from "./lib.js";

const config = window.__SSS_CONFIG__ || {};
const contractAddress = /^0x[0-9a-fA-F]{40}$/.test(config.contractAddress || "") ? config.contractAddress : "";
const readClient = createClient({ chain: studionet });

const state = {
  account: "",
  provider: null,
  writeClient: null,
  case: null,
  providers: new Map(),
};

const byId = (id) => document.getElementById(id);
const elements = {
  connect: byId("connect-wallet"),
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
  setButton(button, "loading", "Waiting for finality…");
  notice("Write submitted. Waiting for FINALIZED consensus and successful leader execution.");
  try {
    const hash = await client.writeContract({
      address: contractAddress,
      functionName,
      args,
      value: 0n,
    });
    const receipt = await readClient.waitForTransactionReceipt({
      hash,
      status: TransactionStatus.FINALIZED,
      interval: 4_000,
      retries: 240,
    });
    assertFinalSuccess(receipt);
    const result = await readback(receipt, hash);
    setButton(button, "success", "Readback verified");
    notice(`Finalized and verified. Transaction ${String(hash).slice(0, 12)}…`, "success");
    window.setTimeout(() => setButton(button, "idle"), 2_500);
    return result;
  } catch (error) {
    setButton(button, "error", "Write not trusted");
    notice(`${formatError(error)} Reconcile the transaction before retrying.`, "error");
    window.setTimeout(() => setButton(button, "idle"), 3_500);
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
  const key = info?.uuid || info?.rdns || info?.name || `provider-${state.providers.size + 1}`;
  if (!state.providers.has(key)) state.providers.set(key, { info: info || { name: "Injected wallet" }, provider });
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

async function connectProvider(provider, info) {
  notice(`Requesting access from ${info?.name || "the selected wallet"}…`);
  try {
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    if (!Array.isArray(accounts) || !accounts[0]) throw new Error("The selected wallet returned no account.");
    const account = accounts[0];
    const client = createClient({ chain: studionet, account, provider });
    await client.connect("studionet");
    state.provider = provider;
    state.account = account;
    state.writeClient = client;
    elements.connect.textContent = shortAddress(account);
    elements.walletState.textContent = `Connected ${shortAddress(account)} through ${info?.name || "selected provider"}.`;
    elements.providerDialog.close();
    notice("Wallet connected to Studionet. No write has been sent.", "success");
    provider.on?.("accountsChanged", (next) => {
      if (!next?.[0]) window.location.reload();
      state.account = next[0];
      elements.connect.textContent = shortAddress(next[0]);
      elements.walletState.textContent = `Connected ${shortAddress(next[0])}. Reload before a write if the account changed mid-case.`;
    });
  } catch (error) {
    notice(`${formatError(error)} Choose a provider again or approve the Studionet switch.`, "error");
  }
}

elements.connect.addEventListener("click", () => {
  renderProviderList();
  elements.providerDialog.showModal();
  elements.providerList.querySelector("button")?.focus();
});

window.addEventListener("eip6963:announceProvider", (event) => registerProvider(event.detail.info, event.detail.provider));

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
    await finalizeWrite("create_case", [legalName, policy], button, async (receipt) => {
      const caseId = extractCreatedCaseId(receipt);
      const record = await readCase(caseId);
      if (record.owner.toLowerCase() !== state.account.toLowerCase() || record.legal_name !== legalName || record.source_policy !== policy) {
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
