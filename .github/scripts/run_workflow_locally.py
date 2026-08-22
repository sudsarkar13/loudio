#!/usr/bin/env python3
"""Run a workflow job's shell steps locally. See run-workflow-locally.sh."""

import os
import re
import subprocess
import sys

import yaml

# Steps we deliberately do not execute, with the reason shown in the report.
SKIP_PATTERNS = [
    (r"apt-get\s+(install|update)", "system package install"),
    (r"yarn\s+install", "dependency install (already installed locally)"),
    (r"yarn\s+tauri\s+build", "native build (run separately; takes minutes)"),
    (r"corepack", "runner toolchain setup"),
]

EXPR = re.compile(r"\$\{\{\s*([^}]+?)\s*\}\}")


def substitute(text, variables):
    """Resolve ${{ … }} expressions from the supplied variable map."""

    def repl(match):
        key = match.group(1).strip()
        if key in variables:
            return variables[key]
        # `a || b` — take the first side that has a value.
        if "||" in key:
            for part in (p.strip().strip("'\"") for p in key.split("||")):
                if part in variables:
                    return variables[part]
                if part and not re.match(r"^[\w.\-]+$", part):
                    return part
        return ""

    return EXPR.sub(repl, text)


def main():
    workflow, job_name = sys.argv[1], sys.argv[2]
    variables = dict(pair.split("=", 1) for pair in sys.argv[3:])

    with open(workflow) as fh:
        wf = yaml.safe_load(fh)

    job = wf["jobs"][job_name]
    print(f"### {workflow} :: {job_name}   (runs-on: {job.get('runs-on')})\n")

    ran = skipped = failed = 0
    for step in job["steps"]:
        name = step.get("name", step.get("uses", "<unnamed>"))

        if "run" not in step:
            print(f"  ~ SKIP  {name}\n          uses: {step.get('uses')}")
            skipped += 1
            continue

        script = substitute(step["run"], variables)

        reason = next(
            (why for pat, why in SKIP_PATTERNS if re.search(pat, script)), None
        )
        if reason:
            print(f"  ~ SKIP  {name}\n          ({reason})")
            skipped += 1
            continue

        env = os.environ.copy()
        for key, value in (step.get("env") or {}).items():
            env[key] = substitute(str(value), variables)
        # Actions exposes step outputs through this file.
        env.setdefault("GITHUB_OUTPUT", "/dev/null")

        proc = subprocess.run(
            ["bash", "-e", "-c", script],
            env=env,
            capture_output=True,
            text=True,
        )
        out = (proc.stdout + proc.stderr).rstrip()
        if proc.returncode == 0:
            print(f"  ✓ RUN   {name}")
            ran += 1
        else:
            print(f"  ✗ FAIL  {name}  (exit {proc.returncode})")
            failed += 1
        for line in out.splitlines():
            print(f"          {line}")

    print(f"\n### {ran} ran, {skipped} skipped, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
