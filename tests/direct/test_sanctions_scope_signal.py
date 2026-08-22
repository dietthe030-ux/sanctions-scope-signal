import hashlib
import json

import pytest


CONTRACT = "contracts/sanctions_scope_signal.py"


def read_case(contract, case_id):
    return json.loads(contract.get_case(case_id))


def make_case(contract, name="Northwind Export Cooperative", policy="OFAC_SDN"):
    return contract.create_case(name, policy)


def test_create_edit_freeze_lifecycle(direct_vm, direct_deploy):
    body = "unrelated,organization,record\n" * 40
    direct_vm.mock_web(
        r"PublicationPreview/exports/SDN\.CSV",
        {"status": 200, "body": body},
    )
    contract = direct_deploy(CONTRACT)
    case_id = make_case(contract)
    contract.add_alias(case_id, "Northwind Exports")
    contract.add_identifier(case_id, "REG-884201")
    contract.freeze_case(case_id)

    case = read_case(contract, case_id)
    assert case["stage"] == "FROZEN"
    assert case["frozen_source_digest"] == hashlib.sha256(body.encode("utf-8")).hexdigest()
    assert len(case["frozen_source_digest"]) == 64
    assert case["aliases"] == ["Northwind Exports"]
    assert case["identifiers"] == ["REG-884201"]
    assert contract.get_case_count() == 1


def test_freeze_captures_and_persists_official_digest(direct_vm, direct_deploy):
    body = "official,treasury,sdn,data,row\n" * 20
    expected_digest = hashlib.sha256(body.encode("utf-8")).hexdigest()
    direct_vm.mock_web(
        r"PublicationPreview/exports/SDN\.CSV",
        {"status": 200, "body": body},
    )
    contract = direct_deploy(CONTRACT)
    case_id = make_case(contract)
    contract.freeze_case(case_id)

    case = read_case(contract, case_id)
    assert case["stage"] == "FROZEN"
    assert case["frozen_source_digest"] == expected_digest


def test_freeze_fails_closed_when_source_unavailable(direct_vm, direct_deploy):
    direct_vm.mock_web(
        r"PublicationPreview/exports/SDN\.CSV",
        {"status": 503, "body": "Service Unavailable"},
    )
    contract = direct_deploy(CONTRACT)
    case_id = make_case(contract)
    with direct_vm.expect_revert("Official source is unavailable or invalid"):
        contract.freeze_case(case_id)

    case = read_case(contract, case_id)
    assert case["stage"] == "DRAFT"
    assert case["frozen_source_digest"] == ""


def test_freeze_fails_closed_when_source_non_200(direct_vm, direct_deploy):
    direct_vm.mock_web(
        r"PublicationPreview/exports/SDN\.CSV",
        {"status": 404, "body": "Resource Not Found on Official Service\n" * 10},
    )
    contract = direct_deploy(CONTRACT)
    case_id = make_case(contract)
    with direct_vm.expect_revert("Official source is unavailable or invalid"):
        contract.freeze_case(case_id)

    case = read_case(contract, case_id)
    assert case["stage"] == "DRAFT"
    assert case["frozen_source_digest"] == ""


def test_freeze_fails_closed_when_source_too_short_or_undecodable(direct_vm, direct_deploy):
    direct_vm.mock_web(
        r"PublicationPreview/exports/SDN\.CSV",
        {"status": 200, "body": "too short"},
    )
    contract = direct_deploy(CONTRACT)
    case_id = make_case(contract)
    with direct_vm.expect_revert("Official source is unavailable or invalid"):
        contract.freeze_case(case_id)

    case = read_case(contract, case_id)
    assert case["stage"] == "DRAFT"
    assert case["frozen_source_digest"] == ""


def test_duplicate_terms_and_post_freeze_edits_revert(direct_vm, direct_deploy):
    direct_vm.mock_web(
        r"PublicationPreview/exports/SDN\.CSV",
        {"status": 200, "body": "unrelated,organization,record\n" * 40},
    )
    contract = direct_deploy(CONTRACT)
    case_id = make_case(contract)
    contract.add_alias(case_id, "Northwind Exports")
    with direct_vm.expect_revert("Alias already exists"):
        contract.add_alias(case_id, " northwind  exports ")
    contract.freeze_case(case_id)
    with direct_vm.expect_revert("DRAFT"):
        contract.add_identifier(case_id, "REG-42")


def test_only_owner_can_mutate(direct_vm, direct_deploy, direct_bob):
    direct_vm.mock_web(
        r"PublicationPreview/exports/SDN\.CSV",
        {"status": 200, "body": "unrelated,organization,record\n" * 40},
    )
    contract = direct_deploy(CONTRACT)
    case_id = make_case(contract)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Only the case owner"):
        contract.add_alias(case_id, "Foreign Alias")
    with direct_vm.expect_revert("Only the case owner"):
        contract.freeze_case(case_id)


def test_ofac_absence_is_unresolved_not_clearance(direct_vm, direct_deploy):
    direct_vm.strict_mocks = True
    body = "unrelated,organization,record\n" * 40
    direct_vm.mock_web(
        r"PublicationPreview/exports/SDN\.CSV",
        {"status": 200, "body": body},
    )
    contract = direct_deploy(CONTRACT)
    case_id = make_case(contract)
    contract.freeze_case(case_id)
    contract.assess_case(case_id)

    case = read_case(contract, case_id)
    assert case["stage"] == "UNRESOLVED"
    assert case["outcome"] == "UNRESOLVED"
    assert case["consequence"] == "UNRESOLVED"
    assert case["source_digest"] == case["frozen_source_digest"]
    assert case["match_narrative"] == "No term was found, but exhaustive snapshot coverage could not be proven."


def test_assessment_accepts_matching_digest_and_persists_narrative(direct_vm, direct_deploy):
    direct_vm.strict_mocks = True
    body = "9911,Northwind Export Cooperative,Entity,REG-884201,SDN\n" + "context,record\n" * 8
    direct_vm.mock_web(
        r"PublicationPreview/exports/SDN\.CSV",
        {"status": 200, "body": body},
    )
    direct_vm.mock_llm(
        r"organization-only sanctions screening signal",
        {
            "outcome": "CONFIRMED_IDENTIFIER_MATCH",
            "consequence": "HOLD",
            "matched_record": "9911 — Northwind Export Cooperative",
            "match_narrative": "The identifier and organization name occur in the same entity record.",
        },
    )
    contract = direct_deploy(CONTRACT)
    case_id = make_case(contract)
    contract.add_identifier(case_id, "REG-884201")
    contract.freeze_case(case_id)
    contract.assess_case(case_id)

    case = read_case(contract, case_id)
    assert case["stage"] == "SIGNALLED"
    assert case["outcome"] == "CONFIRMED_IDENTIFIER_MATCH"
    assert case["consequence"] == "HOLD"
    assert case["matched_record"] == "9911 — Northwind Export Cooperative"
    assert case["match_narrative"] == "The identifier and organization name occur in the same entity record."
    assert case["source_digest"] == case["frozen_source_digest"]


def test_assessment_returns_unresolved_after_source_bytes_change(direct_vm, direct_deploy):
    body_v1 = "9911,Northwind Export Cooperative,Entity,REG-884201,SDN\n" + "context,record\n" * 8
    direct_vm.mock_web(
        r"PublicationPreview/exports/SDN\.CSV",
        {"status": 200, "body": body_v1},
    )
    contract = direct_deploy(CONTRACT)
    case_id = make_case(contract)
    contract.add_identifier(case_id, "REG-884201")
    contract.freeze_case(case_id)
    frozen_digest = read_case(contract, case_id)["frozen_source_digest"]

    # Official publication changed on remote server after freeze
    body_v2 = "9911,Northwind Export Cooperative,Entity,REG-884201,SDN\n" + "context,record,UPDATED\n" * 8
    direct_vm.clear_mocks()
    direct_vm.mock_web(
        r"PublicationPreview/exports/SDN\.CSV",
        {"status": 200, "body": body_v2},
    )
    direct_vm.mock_llm(
        r"organization-only sanctions screening signal",
        {
            "outcome": "CONFIRMED_IDENTIFIER_MATCH",
            "consequence": "HOLD",
            "matched_record": "9911 — Northwind Export Cooperative",
            "match_narrative": "Should not be accepted on changed source",
        },
    )
    contract.assess_case(case_id)

    case = read_case(contract, case_id)
    assert case["stage"] == "UNRESOLVED"
    assert case["outcome"] == "UNRESOLVED"
    assert case["consequence"] == "UNRESOLVED"
    assert case["source_digest"] != frozen_digest
    assert "does not match the frozen publication digest" in case["match_narrative"]
    assert case["matched_record"] == ""


def test_changed_source_cannot_produce_no_signal_hold_or_escalate(direct_vm, direct_deploy):
    html_v1 = (
        "<h1>United Nations Security Council Consolidated List</h1>"
        "<h2>Composition of the List</h2><b>A. </b><b>Individuals</b><b>B. </b><b>Entities and other groups</b>"
        + ("<article>Unrelated Entity record</article>" * 15_000)
    )
    direct_vm.mock_web(
        r"scsanctions\.un\.org/consolidated",
        {"status": 200, "body": html_v1},
    )
    contract = direct_deploy(CONTRACT)
    case_id = make_case(contract, policy="UN_CONSOLIDATED")
    contract.freeze_case(case_id)

    # The official UN HTML publication changed after freeze.
    html_v2 = (
        "<h1>United Nations Security Council Consolidated List</h1>"
        "<h2>Composition of the List</h2><b>A. </b><b>Individuals</b><b>B. </b><b>Entities and other groups</b>"
        + ("<article>Different Entity Modified record</article>" * 15_000)
    )
    direct_vm.clear_mocks()
    direct_vm.mock_web(
        r"scsanctions\.un\.org/consolidated",
        {"status": 200, "body": html_v2},
    )
    contract.assess_case(case_id)

    case = read_case(contract, case_id)
    assert case["outcome"] == "UNRESOLVED"
    assert case["consequence"] == "UNRESOLVED"
    assert case["outcome"] != "NO_MATCH_IN_BOUND_SNAPSHOT"
    assert case["consequence"] != "NO_SIGNAL"
    assert case["consequence"] != "HOLD"
    assert case["consequence"] != "ESCALATE"


def test_identifier_match_can_hold_only_with_linked_record(direct_vm, direct_deploy):
    direct_vm.strict_mocks = True
    body = "9911,Northwind Export Cooperative,Entity,REG-884201,SDN\n" + "context,record\n" * 8
    direct_vm.mock_web(
        r"PublicationPreview/exports/SDN\.CSV",
        {"status": 200, "body": body},
    )
    direct_vm.mock_llm(
        r"organization-only sanctions screening signal",
        {
            "outcome": "CONFIRMED_IDENTIFIER_MATCH",
            "consequence": "HOLD",
            "matched_record": "9911 — Northwind Export Cooperative",
            "match_narrative": "The identifier and organization name occur in the same entity record.",
        },
    )
    contract = direct_deploy(CONTRACT)
    case_id = make_case(contract)
    contract.add_identifier(case_id, "REG-884201")
    contract.freeze_case(case_id)
    contract.assess_case(case_id)

    case = read_case(contract, case_id)
    assert case["stage"] == "SIGNALLED"
    assert case["outcome"] == "CONFIRMED_IDENTIFIER_MATCH"
    assert case["consequence"] == "HOLD"
    assert case["match_narrative"] == "The identifier and organization name occur in the same entity record."


def test_alias_only_match_cannot_hold(direct_vm, direct_deploy):
    direct_vm.strict_mocks = True
    body = "9912,Northwind Exports,Entity,SDN\n" + "context,record\n" * 8
    direct_vm.mock_web(
        r"PublicationPreview/exports/SDN\.CSV",
        {"status": 200, "body": body},
    )
    direct_vm.mock_llm(
        r"organization-only sanctions screening signal",
        {
            "outcome": "PROBABLE_ALIAS_MATCH",
            "consequence": "ESCALATE",
            "matched_record": "9912 — Northwind Exports",
            "match_narrative": "The alias occurs in an organization record without a supplied strong identifier.",
        },
    )
    contract = direct_deploy(CONTRACT)
    case_id = make_case(contract)
    contract.add_alias(case_id, "Northwind Exports")
    contract.freeze_case(case_id)
    contract.assess_case(case_id)

    case = read_case(contract, case_id)
    assert case["outcome"] == "PROBABLE_ALIAS_MATCH"
    assert case["consequence"] == "ESCALATE"
    assert case["match_narrative"] == "The alias occurs in an organization record without a supplied strong identifier."


def test_name_and_identifier_in_different_ofac_records_cannot_hold(direct_vm, direct_deploy):
    body = (
        "9911,Northwind Export Cooperative,Entity,OTHER-IDENTIFIER,SDN\n"
        "9912,Different Maritime Group,Entity,REG-884201,SDN\n"
        + "context,record\n" * 8
    )
    direct_vm.mock_web(
        r"PublicationPreview/exports/SDN\.CSV",
        {"status": 200, "body": body},
    )
    direct_vm.mock_llm(
        r"organization-only sanctions screening signal",
        {
            "outcome": "CONFIRMED_IDENTIFIER_MATCH",
            "consequence": "HOLD",
            "matched_record": "Incorrect merged record",
            "match_narrative": "The model incorrectly linked adjacent rows.",
        },
    )
    contract = direct_deploy(CONTRACT)
    case_id = make_case(contract)
    contract.add_identifier(case_id, "REG-884201")
    contract.freeze_case(case_id)
    contract.assess_case(case_id)

    case = read_case(contract, case_id)
    assert case["outcome"] == "UNRESOLVED"
    assert case["consequence"] == "UNRESOLVED"


def test_malformed_model_response_fails_closed(direct_vm, direct_deploy):
    direct_vm.strict_mocks = True
    body = "9912,Northwind Export Cooperative,Entity,SDN\n" * 5
    direct_vm.mock_web(
        r"PublicationPreview/exports/SDN\.CSV",
        {"status": 200, "body": body},
    )
    direct_vm.mock_llm(r"organization-only sanctions screening signal", {"outcome": "HOLD"})
    contract = direct_deploy(CONTRACT)
    case_id = make_case(contract)
    contract.freeze_case(case_id)
    contract.assess_case(case_id)

    case = read_case(contract, case_id)
    assert case["outcome"] == "UNRESOLVED"
    assert case["consequence"] == "UNRESOLVED"
    assert case["match_narrative"] == "The model response was missing or malformed."


def test_complete_un_snapshot_can_produce_bounded_no_signal(direct_vm, direct_deploy):
    complete_html = (
        "<h1>United Nations Security Council Consolidated List</h1>"
        "<h2>Composition of the List</h2><b>A. </b><b>Individuals</b><b>B. </b><b>Entities and other groups</b>"
        + ("<article>Unrelated Entity record</article>" * 15_000)
    )
    direct_vm.mock_web(
        r"scsanctions\.un\.org/consolidated",
        {"status": 200, "body": complete_html},
    )
    contract = direct_deploy(CONTRACT)
    case_id = make_case(contract, policy="UN_CONSOLIDATED")
    contract.freeze_case(case_id)
    contract.assess_case(case_id)

    case = read_case(contract, case_id)
    assert case["stage"] == "SIGNALLED"
    assert case["outcome"] == "NO_MATCH_IN_BOUND_SNAPSHOT"
    assert case["consequence"] == "NO_SIGNAL"
    assert case["match_narrative"] == "No supplied name, alias, or identifier occurs in the complete bound UN HTML publication."


def test_validator_rederives_and_rejects_material_disagreement(direct_vm, direct_deploy):
    body = "9911,Northwind Export Cooperative,Entity,REG-884201,SDN\n" + "context,record\n" * 8
    direct_vm.mock_web(
        r"PublicationPreview/exports/SDN\.CSV",
        {"status": 200, "body": body},
    )
    direct_vm.mock_llm(
        r"organization-only sanctions screening signal",
        {
            "outcome": "CONFIRMED_IDENTIFIER_MATCH",
            "consequence": "HOLD",
            "matched_record": "9911 — Northwind Export Cooperative",
            "match_narrative": "Identifier and name are linked.",
        },
    )
    contract = direct_deploy(CONTRACT)
    case_id = make_case(contract)
    contract.add_identifier(case_id, "REG-884201")
    contract.freeze_case(case_id)
    contract.assess_case(case_id)

    direct_vm.clear_mocks()
    direct_vm.mock_web(
        r"PublicationPreview/exports/SDN\.CSV",
        {"status": 200, "body": body},
    )
    direct_vm.mock_llm(
        r"organization-only sanctions screening signal",
        {
            "outcome": "AMBIGUOUS",
            "consequence": "ESCALATE",
            "matched_record": "Conflicting record",
            "match_narrative": "The validator found insufficient linkage.",
        },
    )
    assert direct_vm.run_validator() is False


def test_validator_rejects_matched_record_disagreement(direct_vm, direct_deploy):
    body = "9911,Northwind Export Cooperative,Entity,REG-884201,SDN\n" + "context,record\n" * 8
    direct_vm.mock_web(
        r"PublicationPreview/exports/SDN\.CSV",
        {"status": 200, "body": body},
    )
    direct_vm.mock_llm(
        r"organization-only sanctions screening signal",
        {
            "outcome": "CONFIRMED_IDENTIFIER_MATCH",
            "consequence": "HOLD",
            "matched_record": "9911 — Record A",
            "match_narrative": "Identical narrative text.",
        },
    )
    contract = direct_deploy(CONTRACT)
    case_id = make_case(contract)
    contract.add_identifier(case_id, "REG-884201")
    contract.freeze_case(case_id)
    contract.assess_case(case_id)

    direct_vm.clear_mocks()
    direct_vm.mock_web(
        r"PublicationPreview/exports/SDN\.CSV",
        {"status": 200, "body": body},
    )
    direct_vm.mock_llm(
        r"organization-only sanctions screening signal",
        {
            "outcome": "CONFIRMED_IDENTIFIER_MATCH",
            "consequence": "HOLD",
            "matched_record": "9911 — Record B",
            "match_narrative": "Identical narrative text.",
        },
    )
    assert direct_vm.run_validator() is False


def test_validator_rejects_match_narrative_disagreement(direct_vm, direct_deploy):
    body = "9911,Northwind Export Cooperative,Entity,REG-884201,SDN\n" + "context,record\n" * 8
    direct_vm.mock_web(
        r"PublicationPreview/exports/SDN\.CSV",
        {"status": 200, "body": body},
    )
    direct_vm.mock_llm(
        r"organization-only sanctions screening signal",
        {
            "outcome": "CONFIRMED_IDENTIFIER_MATCH",
            "consequence": "HOLD",
            "matched_record": "9911 — Northwind Export Cooperative",
            "match_narrative": "Leader explanation text.",
        },
    )
    contract = direct_deploy(CONTRACT)
    case_id = make_case(contract)
    contract.add_identifier(case_id, "REG-884201")
    contract.freeze_case(case_id)
    contract.assess_case(case_id)

    direct_vm.clear_mocks()
    direct_vm.mock_web(
        r"PublicationPreview/exports/SDN\.CSV",
        {"status": 200, "body": body},
    )
    direct_vm.mock_llm(
        r"organization-only sanctions screening signal",
        {
            "outcome": "CONFIRMED_IDENTIFIER_MATCH",
            "consequence": "HOLD",
            "matched_record": "9911 — Northwind Export Cooperative",
            "match_narrative": "Different validator explanation text.",
        },
    )
    assert direct_vm.run_validator() is False


def test_supersede_links_exact_replacement(direct_vm, direct_deploy):
    body = "unrelated,record\n" * 20
    direct_vm.mock_web(
        r"PublicationPreview/exports/SDN\.CSV",
        {"status": 200, "body": body},
    )
    contract = direct_deploy(CONTRACT)
    first = make_case(contract)
    contract.freeze_case(first)
    contract.assess_case(first)

    second = make_case(contract)
    contract.freeze_case(second)
    contract.assess_case(second)
    contract.supersede_case(first, second)
    updated = read_case(contract, first)
    assert updated["stage"] == "SUPERSEDED"
    assert updated["superseded_by"] == second


def test_supersede_rejects_unassessed_older_and_already_superseded_replacements(direct_vm, direct_deploy):
    body = "unrelated,record\n" * 20
    direct_vm.mock_web(
        r"PublicationPreview/exports/SDN\.CSV",
        {"status": 200, "body": body},
    )
    contract = direct_deploy(CONTRACT)
    older = make_case(contract, name="Older Organization")
    contract.freeze_case(older)
    contract.assess_case(older)
    current = make_case(contract, name="Current Organization")
    contract.freeze_case(current)
    contract.assess_case(current)
    draft = make_case(contract, name="Draft Organization")

    with direct_vm.expect_revert("newer case"):
        contract.supersede_case(current, older)
    with direct_vm.expect_revert("assessed and current"):
        contract.supersede_case(older, draft)

    replacement = make_case(contract, name="Replacement Organization")
    contract.freeze_case(replacement)
    contract.assess_case(replacement)
    newest = make_case(contract, name="Newest Organization")
    contract.freeze_case(newest)
    contract.assess_case(newest)
    contract.supersede_case(replacement, newest)
    with direct_vm.expect_revert("newer case"):
        contract.supersede_case(current, older)
    with direct_vm.expect_revert("assessed and current"):
        contract.supersede_case(current, replacement)


def test_supersede_rejects_self_and_cross_owner(direct_vm, direct_deploy, direct_bob):
    body = "unrelated,record\n" * 20
    direct_vm.mock_web(
        r"PublicationPreview/exports/SDN\.CSV",
        {"status": 200, "body": body},
    )
    contract = direct_deploy(CONTRACT)
    owner = direct_vm.sender
    first = make_case(contract)
    contract.freeze_case(first)
    contract.assess_case(first)
    with direct_vm.expect_revert("itself"):
        contract.supersede_case(first, first)

    direct_vm.sender = direct_bob
    other = make_case(contract, name="Other Owner Organization")
    contract.freeze_case(other)
    contract.assess_case(other)
    direct_vm.sender = owner
    with direct_vm.expect_revert("Only the case owner"):
        contract.supersede_case(first, other)


@pytest.mark.parametrize("policy", ["OFAC_SDN", "OFAC_NON_SDN", "UN_CONSOLIDATED"])
def test_supported_source_policies_are_locked(direct_deploy, policy):
    contract = direct_deploy(CONTRACT)
    case_id = make_case(contract, policy=policy)
    case = read_case(contract, case_id)
    assert case["source_policy"] == policy
    assert case["source_url"] == contract.get_source_url(policy)


def test_deployer_is_registered_and_authorized_upgrade_replaces_code(direct_deploy):
    contract = direct_deploy(CONTRACT)
    assert contract.get_upgraders() == ["0x00000000000000000000000000000000000000a1"]
    contract.upgrade(b"v2-compatible-code")
    assert contract._test_root.code.value == b"v2-compatible-code"


def test_unauthorized_upgrade_is_rejected(direct_vm, direct_deploy, direct_bob):
    contract = direct_deploy(CONTRACT)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("unauthorized upgrader"):
        contract.upgrade(b"hostile-code")
    assert contract._test_root.code.value == b"v1"
