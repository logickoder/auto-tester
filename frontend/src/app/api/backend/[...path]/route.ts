// Proxy for the FastAPI backend: /api/backend/* -> FASTAPI_BASE_URL/api/*.
// Keeps the backend URL server-side and avoids CORS in the browser.
const FASTAPI_BASE_URL = process.env.FASTAPI_BASE_URL ?? "http://localhost:8000";

async function proxy(request: Request, params: Promise<{ path: string[] }>) {
  const { path } = await params;
  const { search } = new URL(request.url);
  const target = `${FASTAPI_BASE_URL}/api/${path.join("/")}${search}`;

  const headers = new Headers();
  // Forward only what the API needs; never forward cookies.
  for (const name of ["authorization", "x-api-key", "content-type"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  try {
    const res = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.text(),
    });
    // arrayBuffer, not text: dev-mode screenshots (PNG) come through here too.
    const body = await res.arrayBuffer();
    const out = new Headers({ "content-type": res.headers.get("content-type") ?? "application/json" });
    const cache = res.headers.get("cache-control");
    if (cache) out.set("cache-control", cache);
    return new Response(body, { status: res.status, headers: out });
  } catch {
    return Response.json(
      { detail: "Backend is unreachable. Is uvicorn running on port 8000?" },
      { status: 502 }
    );
  }
}

export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(request, ctx.params);
}

export async function POST(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(request, ctx.params);
}

export async function PATCH(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(request, ctx.params);
}
