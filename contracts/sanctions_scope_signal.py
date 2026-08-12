# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
import hashlib
import json
import unicodedata


SOURCE_URLS = {
    "OFAC_SDN": "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV",
    "OFAC_NON_SDN": "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/CONSOLIDATED.CSV",
    "UN_CONSOLIDATED": "https://scsanctions.un.org/resources/xml/en/name/consolidated.xml",
}

OUTCOMES = (
    "CONFIRMED_IDENTIFIER_MATCH",
    "PROBABLE_ALIAS_MATCH",
    "NO_MATCH_IN_BOUND_SNAPSHOT",
    "AMBIGUOUS",
    "UNRESOLVED",
)


def _canonical(value: dict) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _normalize(value: str) -> str:
    folded = unicodedata.normalize("NFKD", value)
    return " ".join("".join(ch.lower() if ch.isalnum() else " " for ch in folded if not unicodedata.combining(ch)).split())


def _contains_term(normalized_document: str, term: str) -> bool:
    normalized_term = _normalize(term)
    if len(normalized_term) < 3:
        return False
    return f" {normalized_term} " in f" {normalized_document} "


def _evidence_windows(normalized_document: str, terms: list[str]) -> list[str]:
    windows = []
    padded = f" {normalized_document} "
    for term in terms:
        normalized_term = _normalize(term)
        if len(normalized_term) < 3:
            continue
        cursor = 0
        while len(windows) < 12:
            position = padded.find(f" {normalized_term} ", cursor)
            if position < 0:
                break
            start = max(0, position - 420)
            end = min(len(padded), position + len(normalized_term) + 420)
            windows.append(padded[start:end])
            cursor = position + len(normalized_term) + 1
        if len(windows) >= 12:
            break
    return windows


def _is_complete_snapshot(policy: str, body: str) -> bool:
    if policy != "UN_CONSOLIDATED":
        return False
    upper = body.upper().strip()
    return (
        len(body) > 500_000
        and "<CONSOLIDATED_LIST" in upper[:2_000]
        and upper.endswith("</CONSOLIDATED_LIST>")
        and "<INDIVIDUALS>" in upper
        and "<ENTITIES>" in upper
    )


def _valid_model_result(value: object) -> bool:
    if not isinstance(value, dict):
        return False
    return (
        value.get("outcome") in OUTCOMES
        and value.get("consequence") in ("HOLD", "ESCALATE", "UNRESOLVED")
        and isinstance(value.get("matched_record"), str)
        and isinstance(value.get("reason"), str)
        and len(value.get("reason", "")) <= 900
    )


class SanctionsScopeSignal(gl.Contract):
    cases: TreeMap[u256, str]
    next_case_id: u256

    def __init__(self):
        self.next_case_id = 1
        # VERIFY-AT-STUDIO: confirm the deployment sender is the retained Studio account.
        root = gl.storage.Root.get()
        root.upgraders.get().append(gl.message.sender_address)

    def _load(self, case_id: u256) -> dict:
        raw = self.cases.get(case_id, "")
        if not raw:
            raise gl.vm.UserError("Case does not exist")
        return json.loads(raw)

    def _save(self, case_id: u256, case: dict) -> None:
        self.cases[case_id] = _canonical(case)

    def _require_owner(self, case: dict) -> None:
        if case["owner"] != gl.message.sender_address.as_hex:
            raise gl.vm.UserError("Only the case owner can perform this action")

    @gl.public.write
    def create_case(self, legal_name: str, source_policy: str) -> u256:
        normalized_name = _normalize(legal_name)
        if len(normalized_name) < 3 or len(legal_name) > 180:
            raise gl.vm.UserError("Legal name must contain 3 to 180 characters")
        if source_policy not in SOURCE_URLS:
            raise gl.vm.UserError("Unsupported source policy")

        case_id = self.next_case_id
        self.next_case_id += 1
        self._save(
            case_id,
            {
                "case_id": case_id,
                "owner": gl.message.sender_address.as_hex,
                "legal_name": legal_name.strip(),
                "aliases": [],
                "identifiers": [],
                "source_policy": source_policy,
                "source_url": SOURCE_URLS[source_policy],
                "snapshot_label": "",
                "stage": "DRAFT",
                "outcome": "",
                "consequence": "",
                "source_digest": "",
                "matched_record": "",
                "reason": "",
                "superseded_by": 0,
            },
        )
        return case_id

    @gl.public.write
    def add_alias(self, case_id: u256, alias: str) -> None:
        case = self._load(case_id)
        self._require_owner(case)
        if case["stage"] != "DRAFT":
            raise gl.vm.UserError("Aliases can only be added while the case is DRAFT")
        normalized_alias = _normalize(alias)
        if len(normalized_alias) < 3 or len(alias) > 180:
            raise gl.vm.UserError("Alias must contain 3 to 180 characters")
        if normalized_alias in [_normalize(item) for item in case["aliases"]]:
            raise gl.vm.UserError("Alias already exists")
        if len(case["aliases"]) >= 12:
            raise gl.vm.UserError("A case can contain at most 12 aliases")
        case["aliases"].append(alias.strip())
        self._save(case_id, case)

    @gl.public.write
    def add_identifier(self, case_id: u256, identifier: str) -> None:
        case = self._load(case_id)
        self._require_owner(case)
        if case["stage"] != "DRAFT":
            raise gl.vm.UserError("Identifiers can only be added while the case is DRAFT")
        normalized_identifier = _normalize(identifier)
        if len(normalized_identifier) < 4 or len(identifier) > 120:
            raise gl.vm.UserError("Identifier must contain 4 to 120 characters")
        if normalized_identifier in [_normalize(item) for item in case["identifiers"]]:
            raise gl.vm.UserError("Identifier already exists")
        if len(case["identifiers"]) >= 12:
            raise gl.vm.UserError("A case can contain at most 12 identifiers")
        case["identifiers"].append(identifier.strip())
        self._save(case_id, case)

    @gl.public.write
    def freeze_case(self, case_id: u256, snapshot_label: str) -> None:
        case = self._load(case_id)
        self._require_owner(case)
        if case["stage"] != "DRAFT":
            raise gl.vm.UserError("Only a DRAFT case can be frozen")
        if len(snapshot_label.strip()) < 3 or len(snapshot_label) > 120:
            raise gl.vm.UserError("Snapshot label must contain 3 to 120 characters")
        case["snapshot_label"] = snapshot_label.strip()
        case["stage"] = "FROZEN"
        self._save(case_id, case)

    @gl.public.write
    def assess_case(self, case_id: u256) -> None:
        case = self._load(case_id)
        self._require_owner(case)
        if case["stage"] != "FROZEN":
            raise gl.vm.UserError("Only a FROZEN case can be assessed")

        legal_name = case["legal_name"]
        aliases = list(case["aliases"])
        identifiers = list(case["identifiers"])
        policy = case["source_policy"]
        source_url = case["source_url"]
        snapshot_label = case["snapshot_label"]

        def evaluate_source() -> str:
            try:
                response = gl.nondet.web.get(source_url)
                status_code = response.status_code
                body_bytes = response.body
                body = body_bytes.decode("utf-8", errors="replace")
            except Exception:
                return _canonical({
                    "outcome": "UNRESOLVED",
                    "consequence": "UNRESOLVED",
                    "source_digest": "",
                    "matched_record": "",
                    "reason": "The official source could not be fetched or decoded.",
                })

            digest = hashlib.sha256(body_bytes).hexdigest()
            if status_code != 200 or len(body) < 100:
                return _canonical({
                    "outcome": "UNRESOLVED",
                    "consequence": "UNRESOLVED",
                    "source_digest": digest,
                    "matched_record": "",
                    "reason": "The official source response was unavailable or too short.",
                })

            normalized_document = _normalize(body)
            identifier_hits = [item for item in identifiers if _contains_term(normalized_document, item)]
            name_terms = [legal_name] + aliases
            name_hits = [item for item in name_terms if _contains_term(normalized_document, item)]

            if not identifier_hits and not name_hits:
                if _is_complete_snapshot(policy, body):
                    return _canonical({
                        "outcome": "NO_MATCH_IN_BOUND_SNAPSHOT",
                        "consequence": "NO_SIGNAL",
                        "source_digest": digest,
                        "matched_record": "",
                        "reason": "No supplied name, alias, or identifier occurs in the complete bound UN XML snapshot.",
                    })
                return _canonical({
                    "outcome": "UNRESOLVED",
                    "consequence": "UNRESOLVED",
                    "source_digest": digest,
                    "matched_record": "",
                    "reason": "No term was found, but exhaustive snapshot coverage could not be proven.",
                })

            terms = identifier_hits + name_hits
            windows = _evidence_windows(normalized_document, terms)
            prompt = f"""
You are classifying an organization-only sanctions screening signal from official-source evidence windows.
This is not legal advice and not KYC/AML clearance.

Bound source policy: {policy}
Bound snapshot label: {snapshot_label}
Organization legal name: {legal_name}
Aliases: {aliases}
Identifiers: {identifiers}
Identifiers found literally: {identifier_hits}
Names or aliases found literally: {name_hits}
Normalized evidence windows: {windows}

Rules:
1. CONFIRMED_IDENTIFIER_MATCH only when a supplied identifier is visibly linked to the same listed organization record. Consequence HOLD.
2. PROBABLE_ALIAS_MATCH only when a supplied name or alias is visibly linked to an organization record but no supplied strong identifier confirms identity. Consequence ESCALATE.
3. AMBIGUOUS when occurrences belong to a person, vessel, aircraft, another organization, conflicting records, or insufficient context. Consequence ESCALATE.
4. UNRESOLVED when the evidence windows cannot support one of the above. Consequence UNRESOLVED.
5. Never output NO_MATCH_IN_BOUND_SNAPSHOT here because at least one literal occurrence exists.

Return one JSON object with exactly these keys:
outcome: one of CONFIRMED_IDENTIFIER_MATCH, PROBABLE_ALIAS_MATCH, AMBIGUOUS, UNRESOLVED
consequence: HOLD, ESCALATE, or UNRESOLVED according to the rules
matched_record: a compact source-grounded record label, at most 240 characters
reason: a source-grounded explanation, at most 900 characters
"""
            try:
                model_result = gl.nondet.exec_prompt(prompt, response_format="json")
            except Exception:
                model_result = {}

            if not _valid_model_result(model_result):
                return _canonical({
                    "outcome": "UNRESOLVED",
                    "consequence": "UNRESOLVED",
                    "source_digest": digest,
                    "matched_record": "",
                    "reason": "The model response was missing or malformed.",
                })

            allowed = {
                "CONFIRMED_IDENTIFIER_MATCH": "HOLD",
                "PROBABLE_ALIAS_MATCH": "ESCALATE",
                "AMBIGUOUS": "ESCALATE",
                "UNRESOLVED": "UNRESOLVED",
            }
            outcome = model_result["outcome"]
            if model_result["consequence"] != allowed[outcome]:
                outcome = "UNRESOLVED"
            if outcome == "CONFIRMED_IDENTIFIER_MATCH" and not identifier_hits:
                outcome = "UNRESOLVED"
            if outcome == "PROBABLE_ALIAS_MATCH" and not name_hits:
                outcome = "UNRESOLVED"

            consequence = allowed[outcome]
            return _canonical({
                "outcome": outcome,
                "consequence": consequence,
                "source_digest": digest,
                "matched_record": model_result["matched_record"][:240] if outcome != "UNRESOLVED" else "",
                "reason": model_result["reason"][:900] if outcome != "UNRESOLVED" else "The model decision failed deterministic policy checks.",
            })

        def validate_source(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            try:
                leader = json.loads(leader_result.calldata)
                validator = json.loads(evaluate_source())
            except Exception:
                return False
            material_fields = ("outcome", "consequence", "source_digest")
            return all(leader.get(field) == validator.get(field) for field in material_fields)

        agreed = json.loads(gl.vm.run_nondet_unsafe(evaluate_source, validate_source))
        case["outcome"] = agreed["outcome"]
        case["consequence"] = agreed["consequence"]
        case["source_digest"] = agreed["source_digest"]
        case["matched_record"] = agreed["matched_record"]
        case["reason"] = agreed["reason"]
        case["stage"] = "UNRESOLVED" if agreed["outcome"] == "UNRESOLVED" else "SIGNALLED"
        self._save(case_id, case)

    @gl.public.write
    def supersede_case(self, case_id: u256, replacement_case_id: u256) -> None:
        case = self._load(case_id)
        self._require_owner(case)
        if case["stage"] not in ("SIGNALLED", "UNRESOLVED"):
            raise gl.vm.UserError("Only an assessed case can be superseded")
        replacement = self._load(replacement_case_id)
        self._require_owner(replacement)
        if replacement_case_id == case_id:
            raise gl.vm.UserError("A case cannot supersede itself")
        case["stage"] = "SUPERSEDED"
        case["superseded_by"] = replacement_case_id
        self._save(case_id, case)

    @gl.public.view
    def get_case(self, case_id: u256) -> str:
        return _canonical(self._load(case_id))

    @gl.public.view
    def get_case_count(self) -> u256:
        return self.next_case_id - 1

    @gl.public.view
    def get_source_url(self, source_policy: str) -> str:
        if source_policy not in SOURCE_URLS:
            raise gl.vm.UserError("Unsupported source policy")
        return SOURCE_URLS[source_policy]

    @gl.public.view
    def get_upgraders(self) -> list[str]:
        # VERIFY-AT-STUDIO: read back this list and match it to deployment provenance.
        root = gl.storage.Root.get()
        return [address.as_hex for address in root.upgraders.get()]

    @gl.public.write
    def upgrade(self, new_code: bytes) -> None:
        # VERIFY-AT-STUDIO: rehearse on a separate deployment before release acceptance.
        root = gl.storage.Root.get()
        code = root.code.get()
        code.truncate()
        code.extend(new_code)
