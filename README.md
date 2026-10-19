# Zedu Auto Tester

Pre-release automated tester for Zedu (HNG internship task, Team Yoda).
It runs automated browser checks against staging and shows one verdict:
**Ready**, **Ready with warnings**, **Not Ready** or **Running**.

This repo hosts all three pieces:

| Piece | Tech | Path |
| --- | --- | --- |
| Results API + data access | Python + FastAPI (Supabase behind it) | `app/` |
| Dashboard | Next.js (React) + Tailwind CSS + Supabase Auth (Google) | `frontend/` |
| Test runner | Playwright (TypeScript) in GitHub Actions | `e2e/`, `.github/workflows/smoke.yml` |

How the PRD maps to the code, file by file: [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md).

## Run locally

```bash
# API on :8000 — without SUPABASE_* env vars it runs an in-memory dev store
pip install -r requirements.txt
uvicorn app.main:app --reload

# Dashboard on :3000 — without .env.local it skips login (dev mode)
cd frontend
npm ci
npm run dev
```

Open http://localhost:3000. Full setup (Supabase project, Google sign-in, first run,
runner secrets, deploy) is in [docs/SETUP.md](docs/SETUP.md).

```bash
# Runner (Playwright) — run one test against staging from your machine
cd e2e
npm ci --ignore-scripts
npx playwright install chromium
export BASE_URL=https://staging.zedu.chat USER_A_EMAIL=... USER_A_PASSWORD=... USER_B_EMAIL=... USER_B_PASSWORD=...
npx playwright test --project=chromium -g "login shows the sidebar"
```

### API at a glance

- `POST /api/projects` — connect a project (or use **Connect project** on the dashboard);
  returns its API key **once**. Staging URL must be https and on the allow-list.
- `POST /api/runs` — the runner registers a run (`status: running`) or posts a finished
  one, with the `X-API-Key` header. `PATCH /api/runs/{id}` finishes a running run.
  The verdict is computed server-side (FR-17). Staging only.
- `GET /api/projects`, `GET /api/runs`, `GET /api/runs/{id}` — dashboard reads
  (Supabase Auth token required once configured); failures include screenshot URLs.
- `POST /api/runs/{id}/signoff` — Approve or Block (FR-26); approving a Not Ready run
  needs an override reason (FR-27).
- `POST /api/runs/{id}/rerun` — starts the smoke workflow again via GitHub (FR-14).
- `GET /api/tests` — manifest plus last result per test, for the Tests page (FR-22).

### Environment variables (API)

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` | Data, storage and login verification. Empty = in-memory dev mode. |
| `DASHBOARD_URL` | Public dashboard URL used in alert links. |
| `STAGING_ALLOWLIST` | Comma-separated hosts a project's staging URL may use. |
| `ALLOWED_EMAIL_DOMAINS`, `ALLOWED_EMAILS` | Who may log in. Set at least one in production. |
| `ALERT_WEBHOOK_URL`, `ALERT_ON_SUCCESS` | FR-24 failure alerts (Zedu channel / Slack-compatible webhook). |
| `GITHUB_TOKEN`, `RUNNER_REPO`, `RUNNER_REF`, `RUNNER_WORKFLOW_FILE` | FR-14 Re-run via `workflow_dispatch`. |

The runner workflow is `.github/workflows/smoke.yml`; `examples/` keeps a copy
meant for Zedu's own repos (FR-13, needs the leads' approval).

## Deploy (Coolify)

Dockerfile build pack, port 8000 — unchanged; add the `SUPABASE_*` env vars in
Coolify when the project exists. GitHub secrets: COOLIFY_WEBHOOK_URL (optional
COOLIFY_TOKEN); the Deploy (Coolify) workflow runs only after Malware Scan (CI
Gate) passes on main. The `frontend/` app deploys to Vercel (root directory
`frontend`).

## Live

API: https://tester.zedu.chat
