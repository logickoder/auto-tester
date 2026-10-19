# Zedu Auto Tester — Setup Guide

Auto Tester runs automated browser checks against Zedu staging and shows one
verdict: **Ready**, **Ready with warnings**, **Not Ready** or **Running**.

| Piece | Tech | Where it runs |
| --- | --- | --- |
| Dashboard | Next.js + React + Tailwind | Vercel (or `npm run dev` locally) |
| Results API | FastAPI | Coolify (this repo's Dockerfile) |
| Data, login, screenshots | Supabase | supabase.com free tier |
| Test runner | Playwright in GitHub Actions | pushes results to the API |

Both apps live in this repo: `app/` (FastAPI) and `frontend/` (Next.js).

## 1. Run locally (no Supabase needed yet)

Without Supabase credentials the backend uses an in-memory store and the
frontend skips login — handy while building.

```bash
# backend (port 8000)
pip install -r requirements.txt
uvicorn app.main:app --reload

# frontend (port 3000) — separate terminal
cd frontend
npm ci
npm run dev
```

Open http://localhost:3000. To see data, post a demo run (see step 4).

## 2. Create the Supabase project

1. https://supabase.com → New project (free tier; note the project **pauses
   after inactivity** — wake it before the demo).
2. **SQL Editor** → paste the contents of `supabase/migrations/0001_init.sql` → Run,
   then `supabase/migrations/0002_signoffs_owner.sql` → Run.
3. **Project Settings → API** → copy:
   - Project URL → `SUPABASE_URL` (backend) and `NEXT_PUBLIC_SUPABASE_URL` (frontend)
   - `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (backend only, never in the frontend)
   - Auth JWT secret → `SUPABASE_JWT_SECRET` (backend only, optional but faster)

## 3. Enable Google sign-in

1. **Google Cloud Console** → https://console.cloud.google.com/apis/credentials →
   Create credentials → **OAuth client ID** → Web application.
2. Authorized redirect URI:
   `https://<PROJECT-REF>.supabase.co/auth/v1/callback`
3. In Supabase **Authentication → Providers → Google**: enable, paste the client
   ID and secret, Save.
4. In Supabase **Authentication → URL Configuration**: set Site URL to your
   dashboard URL (e.g. `http://localhost:3000` in dev) and add it to Redirect
   URLs so `/auth/callback` is allowed.
5. Copy `.env.example` → `.env` (backend) and `frontend/.env.example` →
   `frontend/.env.local`, fill in the values, restart both apps.

## 4. Create a project and send your first run

The easy way: sign in to the dashboard, click **Connect project**, fill in the
form and copy the API key it shows (once). The curl way:

```bash
# 1. Create a project (needs a dashboard login token when Supabase is on)
curl -s -X POST http://localhost:8000/api/projects \
  -H 'Content-Type: application/json' \
  -d '{"name":"Zedu Web","repo_url":"https://github.com/zedu-yodaa/zedu","branch":"main","staging_url":"https://staging.zedu.chat"}'
# Response includes "api_key" — shown ONCE. Store it as a GitHub secret AUTOTESTER_API_KEY.

# 2. Post a run (this is what GitHub Actions does; see examples/auto-tester-workflow.yml)
curl -s -X POST http://localhost:8000/api/runs \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: <the api_key from step 1>' \
  -d '{
    "branch": "main", "commit": "abc1234", "commit_message": "demo run",
    "trigger": "manual", "environment": "staging", "status": "completed",
    "started_at": "2026-10-16T10:00:00Z", "finished_at": "2026-10-16T10:04:30Z",
    "tests": [
      {"name":"login shows the sidebar","feature":"auth","priority":"P0","status":"passed","duration_ms":2100},
      {"name":"message reaches a second user","feature":"messaging","priority":"P0","status":"failed",
       "duration_ms":4300,"error":"Timeout waiting for .message-list to contain \"hello\""}
    ]
  }'
```

The dashboard now shows the run with a **Not Ready** verdict (a P0 test failed)
and the failing test with its error. Add `"screenshot_base64"` to a test to see
the screenshot viewer too.

## 5. Set up the runner (GitHub Actions)

The Playwright suite lives in `e2e/` and runs from `.github/workflows/smoke.yml`
on manual dispatch, nightly, and on push/PR touching `e2e/`.

1. Repo → **Settings → Environments → New environment** named `staging`.
2. Add these to that environment:

   | Kind | Name | Value |
   | --- | --- | --- |
   | Variable | `AUTOTESTER_API_URL` | `https://tester.zedu.chat` (`https://api.tester.zedu.chat` after the split in §6) |
   | Variable | `AUTOTESTER_STAGING_URL` | `https://staging.zedu.chat` |
   | Variable | `AUTOTESTER_STAGING_API_HEALTH_URL` | staging API health URL (optional) |
   | Variable | `AUTOTESTER_USER_A_NAME`, `AUTOTESTER_USER_B_NAME` | display names of the two test accounts |
   | Secret | `AUTOTESTER_API_KEY` | the project key from step 4 |
   | Secret | `AUTOTESTER_USER_A_EMAIL`, `AUTOTESTER_USER_A_PASSWORD` | test account A (staging only, never a real user) |
   | Secret | `AUTOTESTER_USER_B_EMAIL`, `AUTOTESTER_USER_B_PASSWORD` | test account B |
   | Secret | `AUTOTESTER_STAGING_BASIC_USER`, `AUTOTESTER_STAGING_BASIC_PASSWORD` | the browser password popup in front of staging (HTTP basic auth; ask the leads) |

   Only the runner repo needs this environment. In any other repo (the upstream
   `zeduchat/auto-tester`, forks) the smoke run skips with a warning when it is
   missing. If the runner moves, set the repo variable `AUTOTESTER_RUNNER_REPO`
   (default `zedu-yodaa/auto-tester`).

3. Confirm the Zedu selectors in `e2e/pages/zedu.ts` (lines marked `TODO`) with
   `npx playwright codegen https://staging.zedu.chat`, run one spec locally, then push.
4. **Actions → Auto Tester smoke run → Run workflow**. The dashboard shows the run as
   *Running* within seconds and a verdict when the job finishes.
5. For the **Re-run** button, create a fine-grained GitHub token with *Actions: read and
   write* on this repo and set `GITHUB_TOKEN` and `RUNNER_REPO=zedu-yodaa/auto-tester` on the API.
6. For alerts, set `ALERT_WEBHOOK_URL` on the API to the Zedu channel's incoming webhook
   (ask the leads which channel) and `DASHBOARD_URL` to the dashboard's public URL.

## 6. Deploy (Coolify, two apps from this repo)

Both apps deploy from `main` of `zeduchat/auto-tester`. Vercel and Render are not used.

**Interim, until someone with Coolify and DNS access does the steps below:** the
root `Dockerfile` runs both in one container on tester.zedu.chat. Next.js is public
on port 8000 and forwards `/api/*`, `/docs`, `/health` and `/openapi.json` to FastAPI
on `127.0.0.1:8001` (`docker-start.sh`, `AUTOTESTER_API_PASSTHROUGH` in
`frontend/next.config.ts`). The runner keeps `AUTOTESTER_API_URL=https://tester.zedu.chat`.
Once the two apps below exist, change the API app's build back to the API alone.

| App | Domain | Base directory | Build | Port |
| --- | --- | --- | --- | --- |
| API (FastAPI) | `api.tester.zedu.chat` | `/` | `Dockerfile` | 8000 |
| Dashboard (Next.js) | `tester.zedu.chat` | `/frontend` | `frontend/Dockerfile` | 3000 |

- **API**: set the `SUPABASE_*` env vars, plus `DASHBOARD_URL=https://tester.zedu.chat`,
  `STAGING_ALLOWLIST`, `ALLOWED_EMAILS` or `ALLOWED_EMAIL_DOMAINS` and, when ready,
  `ALERT_WEBHOOK_URL`, `GITHUB_TOKEN`, `RUNNER_REPO`. Without `SUPABASE_*` the API runs
  in dev mode **with no login**, so never leave a public deploy that way.
- **Dashboard**: Dockerfile build pack, base directory `/frontend`. Mark these as
  **build variables** (they are baked into the browser bundle):
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `NEXT_PUBLIC_AUTOTESTER_API_URL=https://api.tester.zedu.chat`. Runtime variable:
  `FASTAPI_BASE_URL=https://api.tester.zedu.chat`.
- **Moving the domains**: give the API app `api.tester.zedu.chat` first (DNS record
  plus the Coolify domain), then give `tester.zedu.chat` to the dashboard app. Then
  update `AUTOTESTER_API_URL` in the runner's `staging` environment and, in Supabase
  **Authentication → URL Configuration**, set the Site URL to `https://tester.zedu.chat`.
- **Auto-deploy**: the `Deploy (Coolify)` workflow calls `COOLIFY_WEBHOOK_URL` (API)
  and, if set, `COOLIFY_FRONTEND_WEBHOOK_URL` (dashboard), with optional `COOLIFY_TOKEN`,
  after the malware scan passes on `main`.

## Security rules (from the PRD — do not skip)

- Only **staging** URLs are accepted by the API; test accounts only.
- The project API key is stored hashed; the raw key is shown once.
- Screenshots live in a **private** bucket; the dashboard receives short-lived
  signed URLs after login.
- `npm ci --ignore-scripts` in CI; no new dependencies without tech-lead approval.
