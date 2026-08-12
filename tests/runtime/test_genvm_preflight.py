import json
import os
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "contracts" / "sanctions_scope_signal.py"
GENVMROOT = Path(r"E:\Genlayer-Tools\GenVM\genvmroot-v0.3.0-rc7")


def run_linter(command):
    env = os.environ.copy()
    env["GENVMROOT"] = str(GENVMROOT)
    result = subprocess.run(
        ["genvm-lint", command, str(CONTRACT), "--json"],
        cwd=ROOT,
        env=env,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return json.loads(result.stdout)


def test_official_sdk_semantic_validation_passes():
    result = run_linter("check")
    assert result["ok"] is True
    assert result["lint"] == {"ok": True, "passed": 3}
    assert result["validate"]["contract"] == "SanctionsScopeSignal"
    assert result["validate"]["methods"] == 11


def test_official_schema_exposes_expected_runtime_surface():
    methods = run_linter("schema")["schema"]["methods"]
    assert methods["create_case"]["ret"] == "int"
    assert methods["get_case"]["readonly"] is True
    assert methods["get_upgraders"]["ret"] == [{"$rep": "string"}]
    assert methods["upgrade"]["params"] == [["new_code", "bytes"]]
