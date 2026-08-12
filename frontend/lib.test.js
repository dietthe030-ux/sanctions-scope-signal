import test from "node:test";
import assert from "node:assert/strict";
import { assertFinalSuccess, extractCreatedCaseId, formatError, parseCase } from "./lib.js";

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
