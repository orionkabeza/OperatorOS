#!/usr/bin/env python3
"""CI gate: fail the build if a float is used for money anywhere in
apps/api (spec E.5 / engineering brief non-negotiable). Money is BIGINT
minor units (`operatoros_api.money.Minor`), never a float -- not as a
type annotation, not as a literal.

This is an AST heuristic, not a type-system guarantee, and that's
deliberate: mypy alone doesn't stop `amount = 10.5` from flowing into a
dynamically-typed request body field, and Pydantic v2's default (lax)
float->int coercion for whole numbers means a schema-level check isn't
sufficient by itself either (see money.py's docstring). This scans every
.py file under apps/api for two shapes of the mistake:

  1. A variable / function parameter / return type annotated `float`
     whose name looks money-shaped (amount, price, cost, balance, ...).
  2. A float literal assigned to a money-shaped name (annotated or not).

"Money-shaped" is a deliberately generous name list. A rare genuine false
positive (a non-money `float` that happens to match, e.g. a duration
named `total_seconds`) is silenced with a trailing `# money-lint: ignore`
comment on that line -- the heuristic itself is not narrowed for one-off
exceptions, so it stays effective against the mistake it exists to catch.

Usage: `python scripts/check_no_float_money.py` (exit 0 = clean, exit 1 =
violations found, printed to stderr). Wired into `make lint` and CI.
"""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

MONEY_NAME_RE = re.compile(
    r"(amount|price|cost|balance|total|subtotal|discount|tax|fee|wage|salary|"
    r"refund|payment|expense|revenue|margin|wholesale|commission|deposit|"
    r"minor|payout|debt|credit_limit|change_due|cash)",
    re.IGNORECASE,
)
IGNORE_MARKER = "money-lint: ignore"
SKIP_PARTS = {".venv", "__pycache__", ".git"}


def _is_money_name(name: str) -> bool:
    return bool(MONEY_NAME_RE.search(name))


def _is_float_annotation(node: ast.expr | None) -> bool:
    return isinstance(node, ast.Name) and node.id == "float"


def check_source(source: str, filename: str = "<string>") -> list[tuple[int, str]]:
    try:
        tree = ast.parse(source, filename=filename)
    except SyntaxError:
        return []
    lines = source.splitlines()
    violations: list[tuple[int, str]] = []

    def flagged(lineno: int) -> bool:
        line = lines[lineno - 1] if 0 < lineno <= len(lines) else ""
        return IGNORE_MARKER in line

    for node in ast.walk(tree):
        if isinstance(node, ast.AnnAssign):
            target = node.target
            name = target.id if isinstance(target, ast.Name) else getattr(target, "attr", None)
            if (
                name
                and _is_money_name(name)
                and _is_float_annotation(node.annotation)
                and not flagged(node.lineno)
            ):
                violations.append((node.lineno, f"'{name}' is annotated float but looks like money"))

        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
            all_args = [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]
            if node.args.vararg:
                all_args.append(node.args.vararg)
            if node.args.kwarg:
                all_args.append(node.args.kwarg)
            for arg in all_args:
                if _is_money_name(arg.arg) and _is_float_annotation(arg.annotation) and not flagged(arg.lineno):
                    violations.append(
                        (arg.lineno, f"parameter '{arg.arg}' is annotated float but looks like money")
                    )
            if (
                node.returns is not None
                and _is_money_name(node.name)
                and _is_float_annotation(node.returns)
                and not flagged(node.lineno)
            ):
                violations.append(
                    (node.lineno, f"function '{node.name}' returns float but looks like a money accessor")
                )

        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant) and isinstance(
            node.value.value, float
        ):
            for target in node.targets:
                name = target.id if isinstance(target, ast.Name) else getattr(target, "attr", None)
                if name and _is_money_name(name) and not flagged(node.lineno):
                    violations.append(
                        (node.lineno, f"'{name}' is assigned a float literal ({node.value.value!r})")
                    )

    return violations


def check_file(path: Path) -> list[tuple[int, str]]:
    return check_source(path.read_text(encoding="utf-8"), filename=str(path))


def main() -> int:
    root = Path(__file__).resolve().parents[1] / "apps" / "api"
    all_violations: list[tuple[Path, int, str]] = []
    for path in sorted(root.rglob("*.py")):
        rel = path.relative_to(root)
        if any(part in SKIP_PARTS for part in rel.parts):
            continue
        for lineno, message in check_file(path):
            all_violations.append((rel, lineno, message))

    if all_violations:
        print("no-float-money gate FAILED:", file=sys.stderr)
        for rel, lineno, message in all_violations:
            print(f"  {rel}:{lineno}: {message}", file=sys.stderr)
        print(
            f"\n{len(all_violations)} violation(s). Money must be an int of minor units "
            "(operatoros_api.money.Minor), never a float. If this is a genuine false "
            "positive, add `# money-lint: ignore` to the line.",
            file=sys.stderr,
        )
        return 1

    print("no-float-money gate: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
