#!/usr/bin/env python3
"""List open PRs and optionally download a PR diff and its full codebase."""

import argparse
import json
import subprocess
import sys
from pathlib import Path


def run(command: list[str], cwd: Path | None = None) -> str:
    result = subprocess.run(
        command, cwd=cwd, capture_output=True, text=True, encoding="utf-8"
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or f"Command failed: {command[0]}")
    return result.stdout


def retrieve_pr(repo: str, number: int, checkout: Path, output: Path) -> None:
    endpoint = f"repos/{repo}/pulls/{number}"
    metadata = json.loads(run(["gh", "api", endpoint]))
    diff = run(["gh", "api", endpoint, "-H", "Accept: application/vnd.github.diff"])
    files = [json.loads(line) for line in run([
        "gh", "api", f"{endpoint}/files", "--paginate", "--jq", ".[] | @json"
    ]).splitlines() if line.strip()]
    output.mkdir(parents=True, exist_ok=True)
    (output / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    (output / "files.json").write_text(json.dumps(files, indent=2), encoding="utf-8")
    (output / "changes.diff").write_text(diff, encoding="utf-8")

    # Use a fresh directory to avoid overwriting any existing checkout or local work.
    if checkout.exists():
        raise RuntimeError(f"Checkout already exists: {checkout}. Choose a new --checkout-dir.")
    checkout.parent.mkdir(parents=True, exist_ok=True)
    print(f"Cloning full repository into {checkout} ...", flush=True)
    run(["git", "clone", "--no-checkout", metadata["base"]["repo"]["clone_url"], str(checkout)])
    run(["git", "fetch", "origin", f"refs/pull/{number}/head"], cwd=checkout)
    # Pin to the reviewed revision, even if the PR advances during the download.
    revision = metadata["head"]["sha"]
    run(["git", "checkout", "--detach", revision], cwd=checkout)
    print(f"PR #{number}: {metadata['title']}\nRevision: {revision}")
    print(f"Codebase: {checkout}\nReview data: {output}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default="zedu-hng/zedu-fe", help="OWNER/REPO")
    parser.add_argument("--pr", type=int, help="Also retrieve this PR and check out its full codebase")
    parser.add_argument("--checkout-dir", type=Path, default=Path("zedu-fe"))
    parser.add_argument("--output-dir", type=Path, help="PR metadata and diff destination")
    args = parser.parse_args()

    command = [
        "gh", "api", "--method", "GET", f"repos/{args.repo}/pulls",
        "-f", "state=open", "-f", "per_page=100", "--paginate",
        "--jq", ".[] | {number, title, author: .user.login, url: .html_url} | @json",
    ]
    try:
        stdout = run(command)
    except (FileNotFoundError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        return 1

    prs = [json.loads(line) for line in stdout.splitlines() if line.strip()]
    print(f"{len(prs)} open pull request(s) in {args.repo}")
    for pr in prs:
        print(f"#{pr['number']}  {pr['title']}  (@{pr['author']})")
        print(f"  {pr['url']}")
    if args.pr is not None:
        output = args.output_dir or Path("reviews") / f"pr-{args.pr}"
        try:
            retrieve_pr(args.repo, args.pr, args.checkout_dir.resolve(), output.resolve())
        except (OSError, RuntimeError) as error:
            print(str(error), file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
