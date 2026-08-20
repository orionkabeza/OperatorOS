"""Unit tests for scripts/check_no_float_money.py's detection logic,
run against synthetic in-memory source (never against real files) so
this stays a permanent, safe part of the suite.

A full end-to-end proof that the gate actually fails the build on a real
violation and passes clean otherwise was run manually and is recorded in
docs/DECISIONS.md (a deliberately-broken file was added under
apps/api/src, the script was run and shown to exit 1 with the exact
violations, the file was deleted, and the script was shown to exit 0
again) -- that demonstration is not kept as a permanent test file because
leaving deliberately-broken source around, even temporarily-imported, is
worse than a documented one-time proof plus this always-on logic test.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

SCRIPT_PATH = Path(__file__).resolve().parents[3] / "scripts" / "check_no_float_money.py"


def _load_checker():
    spec = importlib.util.spec_from_file_location("check_no_float_money", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["check_no_float_money"] = module
    spec.loader.exec_module(module)
    return module


checker = _load_checker()


def test_float_annotated_money_variable_is_flagged() -> None:
    violations = checker.check_source("unit_price: float = 10.5\n")
    assert len(violations) >= 1
    assert any("unit_price" in msg for _, msg in violations)


def test_float_literal_assigned_to_money_name_is_flagged() -> None:
    violations = checker.check_source("expense_amount = 4999.99\n")
    assert any("expense_amount" in msg for _, msg in violations)


def test_float_parameter_with_money_name_is_flagged() -> None:
    source = "def take_payment(amount_minor: float) -> None:\n    pass\n"
    violations = checker.check_source(source)
    assert any("amount_minor" in msg for _, msg in violations)


def test_float_function_return_looking_like_money_accessor_is_flagged() -> None:
    source = "def get_total_price() -> float:\n    return 10.0\n"
    violations = checker.check_source(source)
    assert any("get_total_price" in msg for _, msg in violations)


def test_int_typed_money_is_clean() -> None:
    source = "amount_minor: int = 125000\ndef take_payment(amount_minor: int) -> int:\n    return amount_minor\n"
    assert checker.check_source(source) == []


def test_float_on_a_non_money_name_is_clean() -> None:
    source = "elapsed_seconds: float = 3.5\n"
    assert checker.check_source(source) == []


def test_ignore_marker_suppresses_a_flagged_line() -> None:
    source = "conversion_rate_cost: float = 1.5  # money-lint: ignore\n"
    assert checker.check_source(source) == []


def test_no_violations_means_check_file_returns_empty(tmp_path) -> None:
    clean_file = tmp_path / "clean.py"
    clean_file.write_text("amount_minor: int = 100\n", encoding="utf-8")
    assert checker.check_file(clean_file) == []


def test_a_violation_means_check_file_returns_nonempty(tmp_path) -> None:
    bad_file = tmp_path / "bad.py"
    bad_file.write_text("total_price: float = 5.0\n", encoding="utf-8")
    assert checker.check_file(bad_file) != []
