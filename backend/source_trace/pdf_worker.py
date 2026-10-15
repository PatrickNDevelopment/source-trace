"""Runs in a separate, isolated interpreter (``python -I``): extracts text from one PDF.

Usage: ``pdf_worker.py <path> <max_pages> <max_chars>``. Prints exactly one JSON object on stdout:
``{"ok": true, "pages": n, "text": "..."}`` or ``{"ok": false, "code": "..."}``. The parent enforces
the wall-clock limit and kills this process on expiry; nothing here executes document content
(pypdf does not run JavaScript or open embedded files).
"""

from __future__ import annotations

import json
import sys


def main(argv: list[str]) -> int:
    path, max_pages, max_chars = argv[1], int(argv[2]), int(argv[3])

    def done(obj: dict[str, object]) -> int:
        sys.stdout.write(json.dumps(obj, ensure_ascii=True))
        sys.stdout.flush()
        return 0

    try:
        from pypdf import PdfReader

        reader = PdfReader(path, strict=False)
        if reader.is_encrypted:
            return done({"ok": False, "code": "pdf_encrypted"})
        count = len(reader.pages)
        if count > max_pages:
            return done({"ok": False, "code": "pdf_too_many_pages", "pages": count})
        parts: list[str] = []
        total = 0
        for page in reader.pages:
            piece = page.extract_text() or ""
            total += len(piece)
            if total > max_chars:
                return done({"ok": False, "code": "pdf_text_too_long"})
            parts.append(piece)
        return done({"ok": True, "pages": count, "text": "\n\n".join(parts)})
    except Exception:
        return done({"ok": False, "code": "pdf_invalid"})


if __name__ == "__main__":
    sys.exit(main(sys.argv))
