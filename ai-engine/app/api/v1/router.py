"""CAD Copilot V2 - /api/v1 router."""
from __future__ import annotations

import asyncio
import json
import os
import re
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from app.models.schemas import GenerateResponse
from app.services.llm_codegen import LLMCodegenService

router = APIRouter(tags=["cad"])

_ALLOWED_MIME_PREFIXES = ("image/",)
_ALLOWED_MIME_EXACT   = {"application/pdf"}
_DEFAULT_MODEL = os.getenv("GENAI_MODEL", "gemini-3.1-flash-lite-preview")


def _extract_parameters(script: str) -> dict[str, Any]:
    """Pull the PARAMETERS_JSON block out of the generated script."""
    m = re.search(r"/\*\s*PARAMETERS_JSON\s*(\{.*?\})\s*\*/", script, re.S)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass
    return {}


def _resolve_mime(content_type: str, filename: str) -> str | None:
    """Return the canonical MIME type or None if unsupported."""
    ct = (content_type or "").lower().split(";")[0].strip()
    if ct in _ALLOWED_MIME_EXACT:
        return ct
    if any(ct.startswith(p) for p in _ALLOWED_MIME_PREFIXES):
        return ct
    # Fallback: infer from extension
    if filename.lower().endswith(".pdf"):
        return "application/pdf"
    return None


def _sanitize_script(script: str) -> str:
    """
    Server-side safety net applied to every generated script before it is
    returned to the frontend. Applies three targeted regex fixes:

    Guard 1 - $fn cap
        Any `$fn = N` where N > 32 is rewritten to `$fn = 32`.

    Guard 2 - $fn injection
        If the script has no `$fn` at all, prepend `$fn = 32;`.

    Guard 3 - eps injection
        If the script has `difference()` but no `eps` variable, inject
        `eps = 0.02;` before the first module or difference() block.

    Guard 4 - Library Strip
        Hallucinated `include <BOSL2/std.scad>` or similar are removed
        to ensure the script remains vanilla and portable.
    """
    if not script:
        return script

    # -- Guard 4: Strip BOSL2 includes -----------------------------------------
    script = re.sub(r'include\s*<BOSL2/.*?>;?', '', script, flags=re.I)

    # -- Guard 1: cap every $fn value that exceeds 32 --------------------------
    FN_CAP = 32

    def _cap_fn(match: re.Match) -> str:
        val = int(match.group(1))
        capped = min(val, FN_CAP)
        return match.group(0).replace(match.group(1), str(capped))

    script = re.sub(r'\$fn\s*=\s*(\d+)', _cap_fn, script)

    # -- Guard 2: inject $fn = 32 if entirely absent ---------------------------
    if "$fn" not in script:
        script = "$fn = 32;\n\n" + script

    # -- Guard 3: inject eps = 0.02 if difference() exists but eps is absent --
    has_difference = "difference()" in script
    has_eps        = re.search(r'\beps\s*=', script) is not None

    if has_difference and not has_eps:
        if "// PARAMETERS_START" in script:
            script = script.replace(
                "// PARAMETERS_START",
                "// PARAMETERS_START\neps = 0.02;  // CGAL crash prevention",
                1,
            )
        else:
            # Fallback: inject before the first module or difference() block
            script = re.sub(
                r'(\bmodule\b|\bdifference\(\))',
                r'eps = 0.02;  // CGAL crash prevention\n\n\1',
                script,
                count=1,
            )

    return script


@router.post("/generate", response_model=GenerateResponse)
async def generate(
    prompt: str = Form(...),
    model_name: str = Form(_DEFAULT_MODEL),
    image: UploadFile = File(None),
    base_code: str | None = Form(None),
    selection_context: str | None = Form(None),
) -> GenerateResponse:
    """
    Two-stage CAD generation pipeline:
      1. Audit blueprint image/PDF  →  structured feature-map JSON
      2. Synthesise/refine OpenSCAD script via BOSL2 codegen
    `image` is optional for text-only refinement sessions.
    """
    # ── Validate & read uploaded file ────────────────────────────────────────
    image_bytes: bytes | None = None
    mime_type: str | None = None

    if image and image.filename:
        mime_type = _resolve_mime(image.content_type or "", image.filename)
        if mime_type is None:
            raise HTTPException(
                status_code=400,
                detail={"error": {"message": "File must be an image (PNG/JPEG/WEBP) or PDF."}},
            )
        image_bytes = await image.read()

    # ── Initialise service ────────────────────────────────────────────────────
    try:
        svc = LLMCodegenService(model=model_name)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail={"error": {"message": str(exc)}})

    # ── Stage 1: Blueprint Audit (skip if no image) ──────────────────────────
    feature_map: dict[str, Any] = {}
    if image_bytes and mime_type:
        try:
            feature_map = await asyncio.to_thread(
                svc.audit_blueprint, image_bytes, mime_type
            )
        except Exception as exc:
            # Non-fatal: proceed with empty feature map
            print(f"[audit] failed — {exc}")

    # ── Stage 2: Script Generation / Refinement ───────────────────────────────
    try:
        script = await asyncio.to_thread(
            svc.generate_script,
            prompt=prompt,
            image_bytes=image_bytes,
            mime_type=mime_type,
            feature_map=feature_map,
            base_code=base_code,
            selection_context=selection_context,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": {"message": str(exc), "hint": "Check API key and quota."}},
        )

    # ── Server-side safety net ────────────────────────────────────────────────
    # Ensures eps=0.02 and $fn=32 are always present even if the AI omitted them.
    script = _sanitize_script(script)

    return GenerateResponse(
        openscad_script=script,
        parameters=_extract_parameters(script),
    )
