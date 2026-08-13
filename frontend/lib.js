export const FINAL_STATUS = "FINALIZED";
export const SUCCESS_RESULT = "FINISHED_WITH_RETURN";

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

export async function restoreWalletProvider(providers, remembered, chain) {
  if (!remembered || !Array.isArray(remembered.aliases)) return null;
  const match = [...providers.values()].find((entry) => remembered.aliases.some((alias) => entry.aliases.includes(alias)));
  if (!match) return null;
  const accounts = await match.provider.request({ method: "eth_accounts" });
  if (!Array.isArray(accounts) || !accounts[0]) return null;
  const chainId = String(await match.provider.request({ method: "eth_chainId" })).toLowerCase();
  if (chainId !== `0x${chain.id.toString(16)}`) return null;
  return { ...match, account: accounts[0] };
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
  const status = receipt?.statusName ?? receipt?.status;
  const execution = receipt?.txExecutionResultName;
  if (status !== FINAL_STATUS) {
    throw new Error(`Transaction stopped at ${String(status || "UNKNOWN")}; FINALIZED is required.`);
  }
  if (execution !== SUCCESS_RESULT) {
    throw new Error(`Leader execution is ${String(execution || "UNKNOWN")}; no state change is trusted.`);
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
    for (const key of ["result", "return", "returnValue", "value", "calldata"]) {
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
