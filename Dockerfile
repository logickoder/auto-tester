# tester.zedu.chat, single-container mode: the Next.js dashboard is public on
# $PORT (8000) and forwards /api/*, /docs and /health to FastAPI on 127.0.0.1:8001.
# Once the dashboard has its own Coolify app (frontend/Dockerfile, docs/SETUP.md §6),
# this image can go back to the API alone.

# --- dashboard build ---------------------------------------------------------
FROM node:22-slim AS dashboard
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY frontend/package.json frontend/package-lock.json ./
# Supply-chain rule: committed lockfile, no install scripts (PRD §5).
RUN npm ci --ignore-scripts
COPY frontend/ ./
# NEXT_PUBLIC_* are baked into the browser bundle; empty Supabase = dev mode (no login).
ARG NEXT_PUBLIC_SUPABASE_URL=
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=
ARG NEXT_PUBLIC_AUTOTESTER_API_URL=https://tester.zedu.chat
ENV AUTOTESTER_API_PASSTHROUGH=1 FASTAPI_BASE_URL=http://127.0.0.1:8001
RUN npm run build

FROM node:22-slim AS node

# --- runtime: Python API + Node dashboard ----------------------------------------
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
# The node binary links against libstdc++.
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /code
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
COPY --from=dashboard /app/.next/standalone /dashboard
COPY --from=dashboard /app/.next/static /dashboard/.next/static
COPY --from=dashboard /app/public /dashboard/public
ENV NODE_ENV=production HOSTNAME=0.0.0.0 FASTAPI_BASE_URL=http://127.0.0.1:8001
EXPOSE 8000
CMD ["bash", "/code/docker-start.sh"]
