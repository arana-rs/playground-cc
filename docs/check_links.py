#!/usr/bin/env python3
"""Check the spec (docs/spec.md and docs/spec/*.md): links and error codes.

Usage: python3 docs/check_links.py   (from any directory)

- Links: every relative link points to an existing file and heading anchor.
- Error codes: every code written in the spec (`area.reason`, optionally with
  its status, as in `409 album.name_taken`) is listed in docs/spec/errors.md
  with the same status, and every code listed there is used somewhere else.
  Skipped while docs/spec/errors.md does not exist.

Exits 1 and lists each problem when any is found.
"""

import re
import sys
from pathlib import Path

DOCS = Path(__file__).resolve().parent
ERRORS = DOCS / "spec" / "errors.md"
LINK = re.compile(r"\]\(([^)\s]+)\)")
HEADING = re.compile(r"^#+\s+(.*)$", re.M)
CATALOG_ROW = re.compile(r"^\| `([a-z]+\.[a-z_]+)` \| (\d{3}) \|", re.M)
CODE = re.compile(r"`(?:(\d{3}) )?([a-z]+)\.([a-z_]+)`")
TEMPLATE = re.compile(r"`(?:\d{3} )?<area>\.([a-z_]+)`")
# Backticked `area.reason` tokens that are not error codes (event names, file names).
NOT_CODES: set[str] = set()


def slug(heading: str) -> str:
    """GitHub-style anchor: lower-case, punctuation dropped, spaces to hyphens."""
    text = re.sub(r"[^\w\- ]", "", heading.strip().lower())
    return text.replace(" ", "-")


def check_links(files: list[Path]) -> list[str]:
    anchors = {f.resolve(): {slug(h) for h in HEADING.findall(f.read_text())} for f in files}
    broken = []
    for f in files:
        for target in LINK.findall(f.read_text()):
            if target.startswith(("http://", "https://", "mailto:")):
                continue
            path, _, anchor = target.partition("#")
            dest = (f.parent / path).resolve() if path else f.resolve()
            if dest not in anchors:
                if not dest.exists():
                    broken.append(f"missing file: {f.relative_to(DOCS)} -> {target}")
                continue
            if anchor and anchor not in anchors[dest]:
                broken.append(f"missing anchor: {f.relative_to(DOCS)} -> {target}")
    return broken


def check_codes(files: list[Path]) -> list[str]:
    if not ERRORS.exists():
        return []
    catalog = dict(CATALOG_ROW.findall(ERRORS.read_text()))
    areas = {code.split(".")[0] for code in catalog}
    problems, used, templates = [], set(), set()
    for f in files:
        if f.resolve() == ERRORS.resolve():
            continue
        text = f.read_text()
        templates.update(TEMPLATE.findall(text))
        for status, area, reason in CODE.findall(text):
            code = f"{area}.{reason}"
            if area not in areas or code in NOT_CODES:
                continue
            used.add(code)
            name = f.relative_to(DOCS)
            if code not in catalog:
                problems.append(f"unknown error code: {name} -> {code}")
            elif status and status != catalog[code]:
                problems.append(f"status mismatch: {name} -> {status} {code} (errors.md: {catalog[code]})")
    for code in catalog:
        if code not in used and code.split(".")[1] not in templates:
            problems.append(f"unused error code: errors.md -> {code}")
    return problems


def main() -> int:
    files = [DOCS / "spec.md", *sorted((DOCS / "spec").glob("*.md"))]
    broken = check_links(files)
    codes = check_codes(files)
    for line in broken + codes:
        print(line)
    print(f"{len(broken)} broken link(s)")
    print(f"{len(codes)} error code problem(s)")
    return 1 if broken or codes else 0


if __name__ == "__main__":
    sys.exit(main())
