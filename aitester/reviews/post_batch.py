"""Publish the reviewed snapshot, checking revision and existing comments first."""
import json
import subprocess
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent
API = 'repos/zedu-hng/zedu-fe/'

def api(endpoint, *args):
    result = subprocess.run(['gh', 'api', API + endpoint, *args], capture_output=True, text=True, encoding='utf-8', check=True)
    return json.loads(result.stdout)

def location(number, filename, needle):
    data = subprocess.run(['git', '-c', 'safe.directory=D:/Code/zedutester/zedu-fe', '-C', str(ROOT.parent / 'zedu-fe'), 'show', f'refs/review/{number}:{filename}'], capture_output=True, text=True, encoding='utf-8', check=True).stdout
    line = next(i for i, value in enumerate(data.splitlines(), 1) if needle in value)
    sha = json.loads((ROOT / 'open-prs' / str(number) / 'metadata.json').read_text(encoding='utf-8'))['head']['sha']
    return f'[{Path(filename).name}:{line}](https://github.com/zedu-hng/zedu-fe/blob/{sha}/{quote(filename, safe="/")}#L{line})'

findings = {
    1244: '**[P2] Unread fallback never runs when all loaded messages are unread.** ' + location(1244, 'src/app/(client)/[org]/_components/ChannelMessage/index.tsx', 'const unreadIndex =') + ': with 50 loaded messages and 50 or more unread, `Math.min(count, messages.length)` returns 50, so `messages[50]` is undefined. The `if (firstUnread)` guard skips the oldest-message fallback entirely; no divider or jump is created. Select the oldest loaded message before that guard for `count >= messages.length`. Reproduced with the extracted effect for counts 50 and 51.',
    1241: '**[P2] Mobile redirect also runs on desktop when channels are already loaded.** ' + location(1241, 'src/app/(client)/[org]/page.tsx', 'if (!isLargeScreen && defaultChannel') + ': `windowWidth` starts at 0. On the first effect pass, `isLargeScreen` is therefore false even at desktop width; the earlier resize effect schedules a new render but does not change this closure. Navigating back to the workspace landing page with cached channels unexpectedly redirects to general. Wait until viewport width is measured, or check `matchMedia` inside the redirect effect. Confirmed with an isolated first-render effect reproduction.',
    1238: '**[P2] Calculator does not manage keyboard focus.** ' + location(1238, 'src/app/(homepage)/_components/pricing/SlackZeduCalculator.tsx', 'role="dialog"') + ': opening the portal leaves focus on the page behind it, and Tab can continue through background links while the modal covers them. `aria-modal` does not move or trap focus. Use the existing `~/components/ui/dialog` with a trigger, or add initial focus, focus containment and restoration on close.',
}
strengths = {
    1245: 'The meeting create/join handlers are preserved, and the replacement image is present.',
    1243: 'QR generation uses the same configured store URL as the download link and has a failure fallback; the menu uses the shared Button and handles Escape.',
    1242: 'The supplied phone-validation Node tests pass (2/2); unchanged legacy phone values do not block other profile edits.',
    1240: 'The mobile contents navigation cleans up listeners and handles section focus; the width changes stay within the affected pages.',
    1239: 'The download badges use a single anchor, and the Help Center link has a matching FAQ target.',
    1237: 'The auth controls reuse the shared Button, and phone validation rejects letters before normalization.',
    1233: 'Billing selection maps to distinct plan data; the Contact Sales changes preserve submission behavior.',
    1230: 'Favourite updates synchronize both channel collections and roll back on a failed save. The live backend endpoint was not exercised.',
    1228: 'Keyboard selection is bounded to the filtered list, and scrolling cancels its animation on cleanup.',
    1156: 'Attachment uploads are tracked by ID, failed uploads block sending, and removed files are excluded when requests finish.',
}

results = []
for number in [1245,1244,1243,1242,1241,1240,1239,1238,1237,1233,1230,1228,1156]:
    folder = ROOT / 'open-prs' / str(number)
    reviewed = json.loads((folder / 'metadata.json').read_text(encoding='utf-8'))
    current = api(f'pulls/{number}')
    sha = reviewed['head']['sha']
    if current['head']['sha'] != sha or current['state'] != 'open':
        print(f'#{number}: SKIPPED - revision/state changed', flush=True)
        continue
    comments = api(f'issues/{number}/comments?per_page=100')
    existing = [c for c in comments if 'ZeduTester review' in c.get('body','') and sha[:7] in c.get('body','')]
    if existing:
        print(f'#{number}: existing {existing[-1]["html_url"]}', flush=True)
        continue
    status = api(f'commits/{sha}/status?per_page=100')
    (folder / 'status-before-comment.json').write_text(json.dumps(status, indent=2), encoding='utf-8')
    failed = [s for s in status.get('statuses',[]) if s['state'] in ('failure','error','pending')]
    body = f'**ZeduTester review** - commit `{sha[:7]}`\n\n'
    if number in findings:
        body += findings[number]
    elif failed:
        body += 'No blocking code issue found in the changed files. ' + strengths[number]
    else:
        body += 'No blocking issues found; suitable to merge from this code review, subject to required checks. ' + strengths[number]
    if failed:
        body += '\n\n'
        for check in failed:
            label = check['context']
            if check.get('target_url'):
                label = f'[{label}]({check["target_url"]})'
            body += f'**CI: {label} is {check["state"]}.** {check.get("description", "")} '
    body += '\n\nScope: PR changes and relevant callers only. Browser/E2E tests were not run in this review.'
    (folder / 'zedutester-comment.md').write_text(body + '\n', encoding='utf-8')
    request = folder / 'comment-request.json'
    request.write_text(json.dumps({'body':body}, ensure_ascii=True), encoding='ascii')
    posted = api(f'issues/{number}/comments', '--method', 'POST', '--input', str(request))
    results.append({'number':number, 'sha':sha, 'url':posted['html_url'], 'id':posted['id']})
    (ROOT / 'posted-batch.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    print(f'#{number}: {posted["html_url"]}', flush=True)
