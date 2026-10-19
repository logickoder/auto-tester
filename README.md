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

# Unit tests (standard library only, no extra install)
python -m unittest

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
export STAGING_BASIC_USER=... STAGING_BASIC_PASSWORD=...   # staging's browser password popup
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

**Today (single container):** the root `Dockerfile` builds the dashboard and the
API into one image on port 8000. The dashboard is public and forwards `/api/*`,
`/docs` and `/health` to FastAPI inside the container, so tester.zedu.chat serves
both with no Coolify or DNS changes.

**Target:** two Coolify apps from this repo, the API (port 8000, on
api.tester.zedu.chat) and the dashboard (`frontend/Dockerfile`, base directory
`frontend`, port 3000, on tester.zedu.chat). Add the
`SUPABASE_*` env vars before a public deploy. GitHub secrets: COOLIFY_WEBHOOK_URL
(API), COOLIFY_FRONTEND_WEBHOOK_URL (dashboard, optional), optional COOLIFY_TOKEN.
The Deploy (Coolify) workflow runs only after Malware Scan (CI Gate) passes on
main. Details: [docs/SETUP.md §6](docs/SETUP.md#6-deploy-coolify-two-apps-from-this-repo).

## Live

- Dashboard: https://tester.zedu.chat
- API: https://tester.zedu.chat/api/… (docs at https://tester.zedu.chat/docs)

After the move to two apps, the API gets its own host: https://api.tester.zedu.chat.
