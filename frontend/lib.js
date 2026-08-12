export const FINAL_STATUS = "FINALIZED";
export const SUCCESS_RESULT = "FINISHED_WITH_RETURN";

export function formatError(error) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error, (_, value) => typeof value === "bigint" ? value.toString() : value);
  } catch {
    return "The operation failed without a readable error.";
  }
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
