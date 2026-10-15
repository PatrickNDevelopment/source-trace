"""Bounded, isolated PDF text extraction (spec 03 section 3).

The PDF is untrusted. It is checked for a header, size-capped, written to a private temporary
directory and parsed by ``pdf_worker.py`` in a separate ``python -I`` process that is killed after
``pdf_timeout_s``. The result is normalized with the shared text rules.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from .config import Settings
from .engine.locator import content_hash
from .engine.text import MAX_SOURCE_CODEPOINTS, is_blank, normalize_text
from .errors import AppError

WORKER = Path(__file__).resolve().with_name("pdf_worker.py")

_STATUS = {
    "pdf_invalid": (422, "The file is not a readable PDF."),
    "pdf_encrypted": (422, "The PDF is encrypted; SourceTrace does not open encrypted PDFs."),
    "pdf_too_many_pages": (422, "The PDF has more pages than this backend allows."),
    "pdf_text_too_long": (422, "The extracted text is longer than 500,000 characters."),
    "pdf_no_text": (
        422,
        "The PDF has no extractable text (scanned images are not supported; there is no OCR).",
    ),
}


def extract_text(data: bytes, settings: Settings) -> dict[str, Any]:
    if len(data) > settings.pdf_max_bytes:
        raise AppError(
            413,
            "payload_too_large",
            f"The PDF is larger than {settings.pdf_max_bytes} bytes.",
        )
    if b"%PDF-" not in data[:1024]:
        raise AppError(422, "pdf_invalid", _STATUS["pdf_invalid"][1])
    with tempfile.TemporaryDirectory(prefix="source-trace-pdf-") as tmp:
        target = Path(tmp) / "input.pdf"
        target.write_bytes(data)
        try:
            proc = subprocess.run(
                [
                    sys.executable,
                    "-I",
                    str(WORKER),
                    str(target),
                    str(settings.pdf_max_pages),
                    str(MAX_SOURCE_CODEPOINTS),
                ],
                capture_output=True,
                timeout=settings.pdf_timeout_s,
                cwd=tmp,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise AppError(
                504,
                "pdf_timeout",
                f"Reading the PDF took longer than {settings.pdf_timeout_s:g} s and was stopped.",
            ) from exc
    try:
        result = json.loads(proc.stdout.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise AppError(422, "pdf_invalid", _STATUS["pdf_invalid"][1]) from exc
    if not isinstance(result, dict) or result.get("ok") is not True:
        code = result.get("code") if isinstance(result, dict) else None
        code = code if isinstance(code, str) and code in _STATUS else "pdf_invalid"
        status, message = _STATUS[code]
        pages = result.get("pages") if isinstance(result, dict) else None
        details = {"pages": pages} if isinstance(pages, int) else None
        raise AppError(status, code, message, details=details)
    raw = str(result.get("text", ""))
    # Control characters and unpaired surrogates cannot be stored in a source (spec 01).
    cleaned = "".join("�" if (ch == "\x00" or 0xD800 <= ord(ch) <= 0xDFFF) else ch for ch in raw)
    text = normalize_text(cleaned)
    if is_blank(text):
        raise AppError(422, "pdf_no_text", _STATUS["pdf_no_text"][1])
    if len(text) > MAX_SOURCE_CODEPOINTS:
        raise AppError(422, "pdf_text_too_long", _STATUS["pdf_text_too_long"][1])
    return {
        "text": text,
        "pages": int(result.get("pages", 0)),
        "characters": len(text),
        "contentHash": content_hash(text),
    }
