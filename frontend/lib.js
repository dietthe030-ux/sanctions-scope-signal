export const FINAL_STATUS = "FINALIZED";
export const SUCCESS_RESULT = "FINISHED_WITH_RETURN";
const FINAL_STATUS_CODE = 7;
const SUCCESS_RESULT_CODE = 1;

function normalizeExecution(value) {
  const text = String(value).trim().toUpperCase();
  return text === SUCCESS_RESULT || text === "SUCCESS" || text.endsWith(".SUCCESS") || Number(value) === SUCCESS_RESULT_CODE
    ? SUCCESS_RESULT
    : text;
}

export function formatBoundDigestLabel(digest) {
  if (!digest || typeof digest !== "string") return "";
  const trimmed = digest.trim();
  if (!trimmed) return "";
  const short = trimmed.length > 16 ? `${trimmed.slice(0, 16)}…` : trimmed;
  return `Official publication bound · SHA-256 ${short}`;
}

export function defaultSnapshotLabel(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `Publication observed ${year}-${month}-${day}`;
}

export function formatError(error) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && typeof error.message === "string") return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error, (_, value) => typeof value === "bigint" ? value.toString() : value);
  } catch {
    return "The operation failed without a readable error.";
  }
}

export function walletProviderAliases(info = {}) {
  const aliases = [info.rdns, info.name]
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.trim().toLowerCase());
  return [...new Set(aliases)];
}

export function registerWalletProvider(providers, info, provider) {
  const normalizedInfo = info || { name: "Injected wallet" };
  const aliases = walletProviderAliases(normalizedInfo);
  for (const [key, existing] of providers) {
    if (existing.provider === provider || aliases.some((alias) => existing.aliases.includes(alias))) {
      if (!existing.info?.rdns && normalizedInfo.rdns) providers.set(key, { info: normalizedInfo, provider, aliases });
      return;
    }
  }
  const key = aliases[0] || normalizedInfo.uuid || `provider-${providers.size + 1}`;
  providers.set(key, { info: normalizedInfo, provider, aliases });
}

function providerErrorCode(error) {
  return Number(error?.code ?? error?.data?.originalError?.code);
}

export async function ensureWalletChain(provider, chain) {
  const chainId = `0x${chain.id.toString(16)}`;
  const verify = async () => {
    const actual = String(await provider.request({ method: "eth_chainId" })).toLowerCase();
    if (actual !== chainId) throw new Error(`Wallet remained on chain ${actual}; Studionet ${chainId} is required.`);
  };
  const current = await provider.request({ method: "eth_chainId" });
  if (String(current).toLowerCase() === chainId) return;

  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
    await verify();
    return;
  } catch (error) {
    const message = String(error?.message || "");
    const missingChain = providerErrorCode(error) === 4902 || /unknown|unrecognized|not added/i.test(message);
    if (!missingChain) throw error;
  }

  await provider.request({
    method: "wallet_addEthereumChain",
    params: [{
      chainId,
      chainName: chain.name,
      rpcUrls: chain.rpcUrls.default.http,
      nativeCurrency: chain.nativeCurrency,
      blockExplorerUrls: Object.values(chain.blockExplorers || {}).map(({ url }) => url).filter(Boolean),
    }],
  });
  await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  await verify();
}

export function assertFinalSuccess(receipt) {
  const statuses = [receipt?.statusName, receipt?.status_name, receipt?.status]
    .filter((value) => value !== undefined && value !== null)
    .map((value) => value === FINAL_STATUS || Number(value) === FINAL_STATUS_CODE ? FINAL_STATUS : String(value));
  const executions = [
    receipt?.txExecutionResultName,
    receipt?.tx_execution_result_name,
    receipt?.txExecutionResult,
    receipt?.tx_execution_result,
  ]
    .filter((value) => value !== undefined && value !== null)
    .map(normalizeExecution);
  if (!statuses.length || statuses.some((status) => status !== FINAL_STATUS)) {
    throw new Error(`Transaction stopped at ${statuses.join("/") || "UNKNOWN"}; FINALIZED is required.`);
  }
  const leaderReceipts = receipt?.consensus_data?.leader_receipt;
  const leaderExecutions = Array.isArray(leaderReceipts)
    ? leaderReceipts
      .filter((leader) => leader?.mode === "leader" || leader?.mode == null)
      .map((leader) => leader?.execution_result)
      .filter((value) => value !== undefined && value !== null)
      .map(normalizeExecution)
    : [];
  const explicitSuccessfulLeader = leaderExecutions.length > 0
    && leaderExecutions.every((execution) => execution === SUCCESS_RESULT);
  const successfulLeader = Array.isArray(leaderReceipts) && leaderReceipts.length > 0 && leaderReceipts.every((leader) => (
    leader && typeof leader === "object"
    && leader.error == null
    && leader.result && typeof leader.result === "object"
    && leader.result.status === "return"
    && Object.hasOwn(leader.result, "payload")
  ));
  const conflictingLeader = Array.isArray(leaderReceipts) && leaderReceipts.some((leader) => (
    leader?.error != null
    || (leader?.result && typeof leader.result === "object" && leader.result.status !== "return")
  ));
  const failedLeaderExecution = leaderExecutions.some((execution) => execution !== SUCCESS_RESULT);
  if (executions.length) {
    if (executions.every((execution) => execution === SUCCESS_RESULT)) return receipt;
    throw new Error(`Leader execution is ${executions.join("/")}; no state change is trusted.`);
  }
  if (explicitSuccessfulLeader) return receipt;
  if (conflictingLeader || failedLeaderExecution || executions.some((execution) => execution !== SUCCESS_RESULT) || (!successfulLeader && !explicitSuccessfulLeader)) {
    throw new Error(`Leader execution is ${executions.join("/") || leaderExecutions.join("/") || "UNKNOWN"}; no state change is trusted.`);
  }
  return receipt;
}

function positiveInteger(value) {
  if (typeof value === "bigint" && value > 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return BigInt(value);
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/^"|"$/g, "");
    if (/^[1-9]\d*$/.test(trimmed)) return BigInt(trimmed);
    try {
      return positiveInteger(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }
  if (value && typeof value === "object") {
    if (Object.hasOwn(value, "status") && value.status !== "return") return null;
    for (const key of ["result", "return", "returnValue", "value", "calldata", "payload", "readable"]) {
      const candidate = positiveInteger(value[key]);
      if (candidate) return candidate;
    }
  }
  return null;
}

export function extractCreatedCaseId(receipt) {
  const leaders = receipt?.consensus_data?.leader_receipt;
  if (!Array.isArray(leaders)) {
    throw new Error("The finalized receipt does not contain a leader return; the write must be reconciled manually.");
  }
  for (const leader of leaders) {
    if (leader?.error) continue;
    const candidate = positiveInteger(leader?.result);
    if (candidate) return candidate;
  }
  throw new Error("The successful write returned no valid case ID; the global case count will not be used as a guess.");
}

export function uniqueCreatedCaseId(records, intent, minimumId = 1n) {
  const matches = records.filter((record) => (
    BigInt(record.case_id) >= BigInt(minimumId)
    && String(record.owner).toLowerCase() === String(intent.account).toLowerCase()
    && record.legal_name === intent.legalName
    && record.source_policy === intent.sourcePolicy
  ));
  if (matches.length !== 1) {
    throw new Error(`Creation readback matched ${matches.length} cases; transaction identity remains ambiguous.`);
  }
  return BigInt(matches[0].case_id);
}

export function parseCase(raw) {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  const required = ["case_id", "owner", "legal_name", "source_policy", "source_url", "stage"];
  if (!value || typeof value !== "object" || required.some((key) => !(key in value))) {
    throw new Error("Contract readback did not match the case schema.");
  }
  if (!Array.isArray(value.aliases) || !Array.isArray(value.identifiers)) {
    throw new Error("Contract readback contains malformed evidence terms.");
  }
  return value;
}

export function shortAddress(address) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Not connected";
}

function encodeArg(value) {
  if (typeof value === "bigint") return { bigint: value.toString() };
  if (Array.isArray(value)) return value.map(encodeArg);
  return value;
}

export function serializeWriteArgs(args) {
  return args.map(encodeArg);
}

function intentFingerprint(intent) {
  return JSON.stringify({
    contractAddress: String(intent.contractAddress || "").toLowerCase(),
    account: String(intent.account || "").toLowerCase(),
    functionName: intent.functionName,
    args: intent.args,
  });
}

export function createPendingWriteStore(storage, key) {
  const load = () => {
    const raw = storage.getItem(key);
    if (!raw) return null;
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error("Pending write state is malformed. Do not retry until it is reconciled manually.");
    }
    if (value?.version !== 1 || !value.functionName || !Array.isArray(value.args)) {
      throw new Error("Pending write state is incomplete. Do not retry until it is reconciled manually.");
    }
    return value;
  };
  const save = (value) => storage.setItem(key, JSON.stringify(value));
  return {
    load,
    begin(intent) {
      if (load()) throw new Error("Another write is already pending reconciliation.");
      const pending = { version: 1, ...intent, hash: "", createdAt: new Date().toISOString() };
      save(pending);
      return pending;
    },
    setHash(hash) {
      const pending = load();
      if (!pending) throw new Error("Pending intent disappeared before its transaction hash was saved.");
      pending.hash = String(hash);
      save(pending);
      return pending;
    },
    clear() {
      storage.removeItem(key);
    },
  };
}

export async function executeGuardedWrite({
  store,
  intent,
  submit,
  waitForReceipt,
  validateReceipt,
  readback,
  isDefiniteNoSubmission = () => false,
}) {
  let pending = store.load();
  if (pending && intentFingerprint(pending) !== intentFingerprint(intent)) {
    throw new Error(`A pending ${pending.functionName} write must be reconciled before any different write.`);
  }
  if (!pending) {
    pending = store.begin(intent);
    try {
      const hash = await submit();
      pending = store.setHash(hash);
    } catch (error) {
      if (isDefiniteNoSubmission(error)) store.clear();
      throw error;
    }
  }
  if (!pending.hash) {
    throw new Error("A pending intent has no transaction hash. No retry will be sent automatically.");
  }
  const receipt = await waitForReceipt(pending.hash);
  validateReceipt(receipt);
  const result = await readback(receipt, pending.hash, pending);
  store.clear();
  return result;
}

export function bindProviderLifecycle(provider, invalidate) {
  const handlers = {
    accountsChanged: () => invalidate("accountsChanged"),
    chainChanged: () => invalidate("chainChanged"),
    disconnect: () => invalidate("disconnect"),
  };
  for (const [event, handler] of Object.entries(handlers)) provider.on?.(event, handler);
  return () => {
    for (const [event, handler] of Object.entries(handlers)) provider.removeListener?.(event, handler);
  };
}
