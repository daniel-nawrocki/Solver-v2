from __future__ import annotations

import math
import pathlib
import textwrap


ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / "HOW_TO_USE.md"
OUTPUT = ROOT / "Daniel Fire - How to Use.pdf"

PAGE_WIDTH = 612
PAGE_HEIGHT = 792
LEFT_MARGIN = 54
RIGHT_MARGIN = 54
TOP_MARGIN = 54
BOTTOM_MARGIN = 54
BODY_FONT_SIZE = 11
BODY_LEADING = 15


def escape_pdf_text(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def wrap_text(text: str, width: int) -> list[str]:
    return textwrap.wrap(
        text,
        width=width,
        break_long_words=False,
        break_on_hyphens=False,
        replace_whitespace=False,
    ) or [""]


def markdown_to_blocks(markdown_text: str) -> list[dict[str, object]]:
    blocks: list[dict[str, object]] = []
    paragraph_lines: list[str] = []

    def flush_paragraph() -> None:
        nonlocal paragraph_lines
        if not paragraph_lines:
            return
        blocks.append({"type": "paragraph", "text": " ".join(line.strip() for line in paragraph_lines).strip()})
        paragraph_lines = []

    for raw_line in markdown_text.splitlines():
        line = raw_line.rstrip()
        stripped = line.strip()
        if not stripped:
            flush_paragraph()
            continue
        if stripped.startswith("# "):
            flush_paragraph()
            blocks.append({"type": "h1", "text": stripped[2:].strip()})
            continue
        if stripped.startswith("## "):
            flush_paragraph()
            blocks.append({"type": "h2", "text": stripped[3:].strip()})
            continue
        if stripped.startswith("### "):
            flush_paragraph()
            blocks.append({"type": "h3", "text": stripped[4:].strip()})
            continue
        if stripped.startswith("- "):
            flush_paragraph()
            blocks.append({"type": "bullet", "text": stripped[2:].strip()})
            continue
        if stripped[:2].isdigit() and stripped[1:3] == ". ":
            flush_paragraph()
            blocks.append({"type": "numbered", "text": stripped})
            continue
        if len(stripped) >= 3 and stripped[0].isdigit() and stripped[1] == "." and stripped[2] == " ":
            flush_paragraph()
            blocks.append({"type": "numbered", "text": stripped})
            continue
        paragraph_lines.append(stripped)

    flush_paragraph()
    return blocks


def build_layout(blocks: list[dict[str, object]]) -> list[list[dict[str, object]]]:
    usable_height = PAGE_HEIGHT - TOP_MARGIN - BOTTOM_MARGIN
    pages: list[list[dict[str, object]]] = [[]]
    current_height = 0

    def ensure_space(height_needed: int) -> None:
        nonlocal current_height
        if current_height + height_needed <= usable_height:
            return
        pages.append([])
        current_height = 0

    for block in blocks:
        block_type = str(block["type"])
        text = str(block["text"])
        if block_type == "h1":
            height = 30
            ensure_space(height)
            pages[-1].append({"type": "h1", "text": text})
            current_height += height
        elif block_type == "h2":
            height = 24
            ensure_space(height)
            pages[-1].append({"type": "h2", "text": text})
            current_height += height
        elif block_type == "h3":
            height = 20
            ensure_space(height)
            pages[-1].append({"type": "h3", "text": text})
            current_height += height
        else:
            prefix = ""
            indent = 0
            width = 86
            if block_type == "bullet":
                prefix = u"\u2022 "
                indent = 14
                width = 82
            elif block_type == "numbered":
                parts = text.split(" ", 1)
                prefix = f"{parts[0]} "
                text = parts[1] if len(parts) > 1 else ""
                indent = 18
                width = 80
            lines = wrap_text(text, width)
            height = len(lines) * BODY_LEADING + 7
            ensure_space(height)
            pages[-1].append(
                {
                    "type": block_type,
                    "lines": lines,
                    "prefix": prefix,
                    "indent": indent,
                }
            )
            current_height += height

    return pages


def page_stream(page_blocks: list[dict[str, object]], page_number: int, total_pages: int) -> bytes:
    y = PAGE_HEIGHT - TOP_MARGIN
    lines: list[str] = ["BT"]

    for block in page_blocks:
        block_type = str(block["type"])
        if block_type == "h1":
            y -= 6
            lines.append(f"/F2 22 Tf 1 0 0 1 {LEFT_MARGIN} {y} Tm ({escape_pdf_text(str(block['text']))}) Tj")
            y -= 24
            continue
        if block_type == "h2":
            y -= 4
            lines.append(f"/F2 15 Tf 1 0 0 1 {LEFT_MARGIN} {y} Tm ({escape_pdf_text(str(block['text']))}) Tj")
            y -= 20
            continue
        if block_type == "h3":
            y -= 2
            lines.append(f"/F2 12 Tf 1 0 0 1 {LEFT_MARGIN} {y} Tm ({escape_pdf_text(str(block['text']))}) Tj")
            y -= 18
            continue

        block_lines = list(block["lines"])
        prefix = str(block["prefix"])
        indent = int(block["indent"])
        for index, text in enumerate(block_lines):
            rendered = text
            x = LEFT_MARGIN + indent
            if index == 0 and prefix:
                rendered = prefix + rendered
                x = LEFT_MARGIN
            lines.append(f"/F1 {BODY_FONT_SIZE} Tf 1 0 0 1 {x} {y} Tm ({escape_pdf_text(rendered)}) Tj")
            y -= BODY_LEADING
        y -= 7

    footer = f"Page {page_number} of {total_pages}"
    lines.append(f"/F1 9 Tf 1 0 0 1 {PAGE_WIDTH - RIGHT_MARGIN - 70} {BOTTOM_MARGIN - 12} Tm ({escape_pdf_text(footer)}) Tj")
    lines.append("ET")
    return "\n".join(lines).encode("latin-1", "replace")


def build_pdf(pages: list[list[dict[str, object]]]) -> bytes:
    objects: list[bytes] = []

    def add_object(payload: bytes) -> int:
        objects.append(payload)
        return len(objects)

    font_helvetica = add_object(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    font_bold = add_object(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")

    page_object_ids: list[int] = []
    content_object_ids: list[int] = []

    pages_placeholder_index = len(objects)
    objects.append(b"")
    pages_id = pages_placeholder_index + 1

    for index, page_blocks in enumerate(pages, start=1):
        content = page_stream(page_blocks, index, len(pages))
        content_id = add_object(b"<< /Length " + str(len(content)).encode("ascii") + b" >>\nstream\n" + content + b"\nendstream")
        content_object_ids.append(content_id)
        page_payload = (
            f"<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 {PAGE_WIDTH} {PAGE_HEIGHT}] "
            f"/Resources << /Font << /F1 {font_helvetica} 0 R /F2 {font_bold} 0 R >> >> "
            f"/Contents {content_id} 0 R >>"
        ).encode("ascii")
        page_object_ids.append(add_object(page_payload))

    kids = " ".join(f"{page_id} 0 R" for page_id in page_object_ids)
    objects[pages_placeholder_index] = f"<< /Type /Pages /Count {len(page_object_ids)} /Kids [{kids}] >>".encode("ascii")
    catalog_id = add_object(f"<< /Type /Catalog /Pages {pages_id} 0 R >>".encode("ascii"))

    pdf = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for object_id, payload in enumerate(objects, start=1):
        offsets.append(len(pdf))
        pdf.extend(f"{object_id} 0 obj\n".encode("ascii"))
        pdf.extend(payload)
        pdf.extend(b"\nendobj\n")

    xref_offset = len(pdf)
    pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    pdf.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    pdf.extend(
        (
            f"trailer\n<< /Size {len(objects) + 1} /Root {catalog_id} 0 R >>\n"
            f"startxref\n{xref_offset}\n%%EOF\n"
        ).encode("ascii")
    )
    return bytes(pdf)


def main() -> None:
    markdown_text = SOURCE.read_text(encoding="utf-8")
    blocks = markdown_to_blocks(markdown_text)
    pages = build_layout(blocks)
    pdf_bytes = build_pdf(pages)
    OUTPUT.write_bytes(pdf_bytes)
    print(f"Wrote {OUTPUT}")
    print(f"Pages: {len(pages)}")


if __name__ == "__main__":
    main()
