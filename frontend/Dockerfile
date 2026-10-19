# Dashboard (Next.js) image for Coolify: base directory `frontend`, port 3000.
FROM node:22-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
# Supply-chain rule: committed lockfile, no install scripts (PRD §5).
RUN npm ci --ignore-scripts
COPY . .
# NEXT_PUBLIC_* values are baked into the browser bundle at build time, so
# Coolify must pass them as build variables, not only runtime ones.
ARG NEXT_PUBLIC_SUPABASE_URL=
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=
ARG NEXT_PUBLIC_AUTOTESTER_API_URL=
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
# FASTAPI_BASE_URL (runtime) tells the /api/backend proxy where the API lives.
CMD ["node", "server.js"]
