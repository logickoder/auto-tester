"""Capture open PR revisions and review inputs without changing their code."""
import concurrent.futures
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "reviews" / "open-prs"
OUT.mkdir(exist_ok=True)

def run(*args, cwd=None):
    if args[0] == "git":
        args = ("git", "-c", f"safe.directory={(ROOT / 'zedu-fe').as_posix()}", *args[1:])
    p = subprocess.run(args, cwd=cwd, capture_output=True, text=True, encoding="utf-8")
    if p.returncode:
        raise RuntimeError(p.stderr)
    return p.stdout

def api(endpoint):
    return json.loads(run("gh", "api", endpoint))

prs = [json.loads(line) for line in run("gh", "api", "--paginate",
    "repos/zedu-hng/zedu-fe/pulls?state=open&per_page=100", "--jq", ".[] | @json").splitlines()]
(OUT / "index.json").write_text(json.dumps(prs, indent=2), encoding="utf-8")
run("git", "fetch", "origin", *[f"refs/pull/{p['number']}/head:refs/review/{p['number']}" for p in prs], cwd=ROOT / "zedu-fe")
run("git", "fetch", "origin", "dev", cwd=ROOT / "zedu-fe")

def collect(pr):
    n, sha = pr["number"], pr["head"]["sha"]
    dest = OUT / str(n)
    dest.mkdir(exist_ok=True)
    for name, endpoint in [
        ("metadata", f"pulls/{n}"),
        ("checks", f"commits/{sha}/check-runs?per_page=100"),
        ("status", f"commits/{sha}/status?per_page=100"),
        ("comments", f"issues/{n}/comments?per_page=100"),
    ]:
        (dest / f"{name}.json").write_text(json.dumps(api("repos/zedu-hng/zedu-fe/" + endpoint), indent=2), encoding="utf-8")
    files = [json.loads(line) for line in run("gh", "api", "--paginate",
        f"repos/zedu-hng/zedu-fe/pulls/{n}/files?per_page=100", "--jq", ".[] | @json").splitlines()]
    (dest / "files.json").write_text(json.dumps(files, indent=2), encoding="utf-8")
    diff = run("git", "diff", f"{pr['base']['sha']}...{sha}", cwd=ROOT / "zedu-fe")
    (dest / "changes.diff").write_text(diff, encoding="utf-8")
    return f"#{n}: {pr['title']} ({len(files)} files, +{sum(f['additions'] for f in files)}/-{sum(f['deletions'] for f in files)})"

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    for result in pool.map(collect, prs):
        print(result, flush=True)
