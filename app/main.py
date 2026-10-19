import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse

from .config import get_settings
from .routers import results

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("autotester")

app = FastAPI(title="Auto Tester API")


@app.exception_handler(Exception)
async def unhandled_error(request: Request, exc: Exception) -> JSONResponse:
    """Always answer JSON with a 'detail' so the dashboard can show what went wrong
    (FastAPI's default is a plain-text 'Internal Server Error')."""
    logger.exception("unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": f"{type(exc).__name__}: {exc}"[:500]})

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type", "X-API-Key"],
)

app.include_router(results.router)

PAGE = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Auto Tester</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; background: #0b0d12; color: #e8eaf0; }
    main { max-width: 720px; margin: 0 auto; padding: 96px 24px; }
    p { color: #a0a6b5; line-height: 1.6; }
  </style>
</head>
<body>
  <main>
    <h1>Auto Tester</h1>
    <p>Automated testing platform. The testing team will build this out.</p>
  </main>
</body>
</html>"""


@app.get("/", response_class=HTMLResponse)
def index():
    return PAGE


@app.get("/health")
def health():
    return {"status": "ok"}
