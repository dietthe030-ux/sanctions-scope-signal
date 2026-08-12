import json

import pytest


CONTRACT = "contracts/sanctions_scope_signal.py"


def read_case(contract, case_id):
    return json.loads(contract.get_case(case_id))


def make_case(contract, name="Northwind Export Cooperative", policy="OFAC_SDN"):
    return contract.create_case(name, policy)


def test_create_edit_freeze_lifecycle(direct_deploy):
    contract = direct_deploy(CONTRACT)
    case_id = make_case(contract)
    contract.add_alias(case_id, "Northwind Exports")
    contract.add_identifier(case_id, "REG-884201")
    contract.freeze_case(case_id, "OFAC current publication")

    case = read_case(contract, case_id)
    assert case["stage"] == "FROZEN"
    assert case["aliases"] == ["Northwind Exports"]
    assert case["identifiers"] == ["REG-884201"]
    assert contract.get_case_count() == 1


def test_duplicate_terms_and_post_freeze_edits_revert(direct_vm, direct_deploy):
    contract = direct_deploy(CONTRACT)
    case_id = make_case(contract)
    contract.add_alias(case_id, "Northwind Exports")
    with direct_vm.expect_revert("Alias already exists"):
        contract.add_alias(case_id, " northwind  exports ")
    contract.freeze_case(case_id, "Publication A")
    with direct_vm.expect_revert("DRAFT"):
        contract.add_identifier(case_id, "REG-42")


def test_only_owner_can_mutate(direct_vm, direct_deploy, direct_bob):
    contract = direct_deploy(CONTRACT)
    case_id = make_case(contract)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Only the case owner"):
        contract.add_alias(case_id, "Foreign Alias")


def test_ofac_absence_is_unresolved_not_clearance(direct_vm, direct_deploy):
    direct_vm.strict_mocks = True
    direct_vm.mock_web(
        r"PublicationPreview/exports/SDN\.CSV",
        {"status": 200, "body": "unrelated,organization,record\n" * 40},
    )
    contract = direct_deploy(CONTRACT)
    case_id = make_case(contract)
    contract.freeze_case(case_id, "OFAC synthetic absence fixture")
    contract.assess_case(case_id)

    case = read_case(contract, case_id)
    assert case["stage"] == "UNRESOLVED"
    assert case["outcome"] == "UNRESOLVED"
    assert case["consequence"] == "UNRESOLVED"


def test_identifier_match_can_hold_only_with_linked_record(direct_vm, direct_deploy):
    direct_vm.strict_mocks = True
    direct_vm.mock_web(
        r"PublicationPreview/exports/SDN\.CSV",
        {
            "status": 200,
            "body": "9911,Northwind Export Cooperative,Entity,REG-884201,SDN\n" + "context,record\n" * 8,
        },
    )
    direct_vm.mock_llm(
        r"organization-only sanctions screening signal",
        {
            "outcome": "CONFIRMED_IDENTIFIER_MATCH",
            "consequence": "HOLD",
            "matched_record": "9911 — Northwind Export Cooperative",
            "reason": "The identifier and organization name occur in the same entity record.",
        },
    )
    contract = direct_deploy(CONTRACT)
    case_id = make_case(contract)
    contract.add_identifier(case_id, "REG-884201")
    contract.freeze_case(case_id, "OFAC identifier fixture")
    contract.assess_case(case_id)

    case = read_case(contract, case_id)
    assert case["stage"] == "SIGNALLED"
    assert case["outcome"] == "CONFIRMED_IDENTIFIER_MATCH"
    assert case["consequence"] == "HOLD"


def test_alias_only_match_cannot_hold(direct_vm, direct_deploy):
    direct_vm.strict_mocks = True
    direct_vm.mock_web(
        r"PublicationPreview/exports/SDN\.CSV",
        {"status": 200, "body": "9912,Northwind Exports,Entity,SDN\n" + "context,record\n" * 8},
    )
    direct_vm.mock_llm(
        r"organization-only sanctions screening signal",
        {
            "outcome": "PROBABLE_ALIAS_MATCH",
            "consequence": "ESCALATE",
            "matched_record": "9912 — Northwind Exports",
            "reason": "The alias occurs in an organization record without a supplied strong identifier.",
        },
    )
    contract = direct_deploy(CONTRACT)
    case_id = make_case(contract)
    contract.add_alias(case_id, "Northwind Exports")
    contract.freeze_case(case_id, "OFAC alias fixture")
    contract.assess_case(case_id)

    case = read_case(contract, case_id)
    assert case["outcome"] == "PROBABLE_ALIAS_MATCH"
    assert case["consequence"] == "ESCALATE"


def test_name_and_identifier_in_different_ofac_records_cannot_hold(direct_vm, direct_deploy):
    direct_vm.mock_web(
        r"PublicationPreview/exports/SDN\.CSV",
        {
            "status": 200,
            "body": (
                "9911,Northwind Export Cooperative,Entity,OTHER-IDENTIFIER,SDN\n"
                "9912,Different Maritime Group,Entity,REG-884201,SDN\n"
                + "context,record\n" * 8
            ),
        },
    )
    direct_vm.mock_llm(
        r"organization-only sanctions screening signal",
        {
            "outcome": "CONFIRMED_IDENTIFIER_MATCH",
            "consequence": "HOLD",
            "matched_record": "Incorrect merged record",
            "reason": "The model incorrectly linked adjacent rows.",
        },
    )
    contract = direct_deploy(CONTRACT)
    case_id = make_case(contract)
    contract.add_identifier(case_id, "REG-884201")
    contract.freeze_case(case_id, "OFAC cross-record fixture")
    contract.assess_case(case_id)

    case = read_case(contract, case_id)
    assert case["outcome"] == "UNRESOLVED"
    assert case["consequence"] == "UNRESOLVED"


def test_malformed_model_response_fails_closed(direct_vm, direct_deploy):
    direct_vm.strict_mocks = True
    direct_vm.mock_web(
        r"PublicationPreview/exports/SDN\.CSV",
        {"status": 200, "body": "9912,Northwind Export Cooperative,Entity,SDN\n"},
    )
    direct_vm.mock_llm(r"organization-only sanctions screening signal", {"outcome": "HOLD"})
    contract = direct_deploy(CONTRACT)
    case_id = make_case(contract)
    contract.freeze_case(case_id, "Malformed model fixture")
    contract.assess_case(case_id)

    case = read_case(contract, case_id)
    assert case["outcome"] == "UNRESOLVED"
    assert case["consequence"] == "UNRESOLVED"


def test_complete_un_snapshot_can_produce_bounded_no_signal(direct_vm, direct_deploy):
    complete_xml = (
        "<CONSOLIDATED_LIST><INDIVIDUALS></INDIVIDUALS><ENTITIES>"
        + ("<ENTITY><FIRST_NAME>Unrelated Entity</FIRST_NAME></ENTITY>" * 9_000)
        + "</ENTITIES></CONSOLIDATED_LIST>"
    )
    direct_vm.mock_web(
        r"resources/xml/en/name/consolidated\.xml",
        {"status": 200, "body": complete_xml},
    )
    contract = direct_deploy(CONTRACT)
    case_id = make_case(contract, policy="UN_CONSOLIDATED")
    contract.freeze_case(case_id, "Complete UN XML fixture")
    contract.assess_case(case_id)

    case = read_case(contract, case_id)
    assert case["stage"] == "SIGNALLED"
    assert case["outcome"] == "NO_MATCH_IN_BOUND_SNAPSHOT"
    assert case["consequence"] == "NO_SIGNAL"


def test_validator_rederives_and_rejects_material_disagreement(direct_vm, direct_deploy):
    direct_vm.mock_web(
        r"PublicationPreview/exports/SDN\.CSV",
        {"status": 200, "body": "9911,Northwind Export Cooperative,Entity,REG-884201,SDN\n" + "context,record\n" * 8},
    )
    direct_vm.mock_llm(
        r"organization-only sanctions screening signal",
        {
            "outcome": "CONFIRMED_IDENTIFIER_MATCH",
            "consequence": "HOLD",
            "matched_record": "9911 — Northwind Export Cooperative",
            "reason": "Identifier and name are linked.",
        },
    )
    contract = direct_deploy(CONTRACT)
    case_id = make_case(contract)
    contract.add_identifier(case_id, "REG-884201")
    contract.freeze_case(case_id, "Consensus disagreement fixture")
    contract.assess_case(case_id)

    direct_vm.clear_mocks()
    direct_vm.mock_web(
        r"PublicationPreview/exports/SDN\.CSV",
        {"status": 200, "body": "9911,Northwind Export Cooperative,Entity,REG-884201,SDN\n" + "context,record\n" * 8},
    )
    direct_vm.mock_llm(
        r"organization-only sanctions screening signal",
        {
            "outcome": "AMBIGUOUS",
            "consequence": "ESCALATE",
            "matched_record": "Conflicting record",
            "reason": "The validator found insufficient linkage.",
        },
    )
    assert direct_vm.run_validator() is False


def test_supersede_links_exact_replacement(direct_vm, direct_deploy):
    direct_vm.mock_web(
        r"PublicationPreview/exports/SDN\.CSV",
        {"status": 503, "body": "temporarily unavailable"},
    )
    contract = direct_deploy(CONTRACT)
    first = make_case(contract)
    contract.freeze_case(first, "Snapshot one")
    contract.assess_case(first)

    second = make_case(contract)
    contract.freeze_case(second, "Snapshot two")
    contract.assess_case(second)
    contract.supersede_case(first, second)
    updated = read_case(contract, first)
    assert updated["stage"] == "SUPERSEDED"
    assert updated["superseded_by"] == second


def test_supersede_rejects_unassessed_older_and_already_superseded_replacements(direct_vm, direct_deploy):
    direct_vm.mock_web(
        r"PublicationPreview/exports/SDN\.CSV",
        {"status": 503, "body": "temporarily unavailable"},
    )
    contract = direct_deploy(CONTRACT)
    older = make_case(contract, name="Older Organization")
    contract.freeze_case(older, "Older snapshot")
    contract.assess_case(older)
    current = make_case(contract, name="Current Organization")
    contract.freeze_case(current, "Current snapshot")
    contract.assess_case(current)
    draft = make_case(contract, name="Draft Organization")

    with direct_vm.expect_revert("newer case"):
        contract.supersede_case(current, older)
    with direct_vm.expect_revert("assessed and current"):
        contract.supersede_case(older, draft)

    replacement = make_case(contract, name="Replacement Organization")
    contract.freeze_case(replacement, "Replacement snapshot")
    contract.assess_case(replacement)
    newest = make_case(contract, name="Newest Organization")
    contract.freeze_case(newest, "Newest snapshot")
    contract.assess_case(newest)
    contract.supersede_case(replacement, newest)
    with direct_vm.expect_revert("newer case"):
        contract.supersede_case(current, older)
    with direct_vm.expect_revert("assessed and current"):
        contract.supersede_case(current, replacement)


def test_supersede_rejects_self_and_cross_owner(direct_vm, direct_deploy, direct_bob):
    direct_vm.mock_web(
        r"PublicationPreview/exports/SDN\.CSV",
        {"status": 503, "body": "temporarily unavailable"},
    )
    contract = direct_deploy(CONTRACT)
    owner = direct_vm.sender
    first = make_case(contract)
    contract.freeze_case(first, "First snapshot")
    contract.assess_case(first)
    with direct_vm.expect_revert("itself"):
        contract.supersede_case(first, first)

    direct_vm.sender = direct_bob
    other = make_case(contract, name="Other Owner Organization")
    contract.freeze_case(other, "Other snapshot")
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
