from __future__ import annotations

import pathlib
import textwrap


ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / "HOW_TO_USE.md"
OUTPUT = ROOT / "Daniel Fire - How to Use.pdf"

PAGE_WIDTH = 612
PAGE_HEIGHT = 792
LEFT_MARGIN = 52
RIGHT_MARGIN = 52
TOP_MARGIN = 52
BOTTOM_MARGIN = 48
BODY_FONT_SIZE = 10.5
BODY_LEADING = 15

BLUE = (0.09, 0.28, 0.54)
BLUE_SOFT = (0.91, 0.95, 0.99)
BLUE_LIGHT = (0.96, 0.98, 1.0)
TEXT = (0.19, 0.27, 0.4)
MUTED = (0.4, 0.48, 0.6)
WHITE = (1.0, 1.0, 1.0)
LINE = (0.82, 0.88, 0.95)


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
        stripped = raw_line.strip()
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
        if len(stripped) >= 3 and stripped[0].isdigit() and stripped[1] == "." and stripped[2] == " ":
            flush_paragraph()
            blocks.append({"type": "numbered", "text": stripped})
            continue
        paragraph_lines.append(stripped)

    flush_paragraph()
    return blocks


def split_document(blocks: list[dict[str, object]]) -> tuple[str, str, list[dict[str, object]]]:
    title = "Daniel Fire User Guide"
    subtitle = "Current workflow for Diagram, Timing, and Print."
    content = list(blocks)
    if content and content[0]["type"] == "h1":
      title = str(content.pop(0)["text"])
    if content and content[0]["type"] == "paragraph":
      subtitle = str(content.pop(0)["text"])
    return title, subtitle, content


def block_height(block: dict[str, object]) -> int:
    block_type = str(block["type"])
    if block_type == "h2":
        return 36
    if block_type == "h3":
        return 22
    text = str(block["text"])
    width = 86
    if block_type == "bullet":
        width = 80
    if block_type == "numbered":
        width = 78
    line_count = len(wrap_text(text, width))
    return line_count * BODY_LEADING + 10


def build_layout(blocks: list[dict[str, object]]) -> list[list[dict[str, object]]]:
    usable_height = PAGE_HEIGHT - TOP_MARGIN - BOTTOM_MARGIN - 48
    pages: list[list[dict[str, object]]] = [[]]
    current_height = 0

    def ensure_space(height_needed: int) -> None:
        nonlocal current_height
        if current_height + height_needed <= usable_height:
            return
        pages.append([])
        current_height = 0

    for block in blocks:
        height = block_height(block)
        ensure_space(height)
        pages[-1].append(block)
        current_height += height

    return pages


def rgb_fill(rgb: tuple[float, float, float]) -> str:
    return f"{rgb[0]} {rgb[1]} {rgb[2]} rg"


def rgb_stroke(rgb: tuple[float, float, float]) -> str:
    return f"{rgb[0]} {rgb[1]} {rgb[2]} RG"


def text_line(font: str, size: float, x: float, y: float, text: str) -> str:
    return f"BT /{font} {size} Tf 1 0 0 1 {x:.2f} {y:.2f} Tm ({escape_pdf_text(text)}) Tj ET"


def cover_stream(title: str, subtitle: str, total_pages: int) -> bytes:
    commands: list[str] = []
    commands.append(rgb_fill(BLUE_LIGHT))
    commands.append(f"0 0 {PAGE_WIDTH} {PAGE_HEIGHT} re f")
    commands.append(rgb_fill(BLUE))
    commands.append(f"0 {PAGE_HEIGHT - 215} {PAGE_WIDTH} 215 re f")
    commands.append(rgb_fill(WHITE))
    commands.append(f"{LEFT_MARGIN} {PAGE_HEIGHT - 130} 185 26 re f")
    commands.append(rgb_fill(BLUE))
    commands.append(text_line("F2", 11, LEFT_MARGIN + 12, PAGE_HEIGHT - 113, "FIELD GUIDE"))
    commands.append(rgb_fill(WHITE))
    commands.append(text_line("F2", 30, LEFT_MARGIN, PAGE_HEIGHT - 175, title))

    subtitle_lines = wrap_text(subtitle, 60)
    y = PAGE_HEIGHT - 208
    for line in subtitle_lines:
        commands.append(text_line("F1", 13, LEFT_MARGIN, y, line))
        y -= 18

    card_x = LEFT_MARGIN
    card_y = PAGE_HEIGHT - 520
    card_w = PAGE_WIDTH - LEFT_MARGIN - RIGHT_MARGIN
    card_h = 214
    commands.append(rgb_fill(WHITE))
    commands.append(rgb_stroke(LINE))
    commands.append("1 w")
    commands.append(f"{card_x} {card_y} {card_w} {card_h} re B")
    commands.append(rgb_fill(BLUE))
    commands.append(text_line("F2", 16, card_x + 22, card_y + card_h - 34, "What this guide covers"))

    bullets = [
        "Diagram import, metadata, properties, and face-pattern assignment",
        "Whole-shot volume totals and rock density workflow",
        "Timing relationships, solving, and result preview",
        "Multi-page print tabs, label editing, and print controls",
    ]
    y = card_y + card_h - 62
    for bullet in bullets:
        commands.append(rgb_fill(TEXT))
        commands.append(text_line("F1", 11, card_x + 34, y, f"- {bullet}"))
        y -= 26

    commands.append(rgb_fill(MUTED))
    commands.append(text_line("F1", 9, PAGE_WIDTH - RIGHT_MARGIN - 80, BOTTOM_MARGIN - 6, f"Page 1 of {total_pages}"))
    return "\n".join(commands).encode("latin-1", "replace")


def page_stream(page_blocks: list[dict[str, object]], page_number: int, total_pages: int, title: str) -> bytes:
    commands: list[str] = []
    commands.append(rgb_fill(WHITE))
    commands.append(f"0 0 {PAGE_WIDTH} {PAGE_HEIGHT} re f")
    commands.append(rgb_fill(BLUE_SOFT))
    commands.append(f"0 {PAGE_HEIGHT - 40} {PAGE_WIDTH} 40 re f")
    commands.append(rgb_fill(BLUE))
    commands.append(text_line("F2", 11, LEFT_MARGIN, PAGE_HEIGHT - 26, title))
    commands.append(rgb_fill(MUTED))
    commands.append(text_line("F1", 9, PAGE_WIDTH - RIGHT_MARGIN - 80, PAGE_HEIGHT - 26, f"Page {page_number} of {total_pages}"))

    y = PAGE_HEIGHT - TOP_MARGIN - 20
    for block in page_blocks:
        block_type = str(block["type"])
        text = str(block["text"])
        if block_type == "h2":
            y -= 8
            commands.append(rgb_fill(BLUE_SOFT))
            commands.append(rgb_stroke(LINE))
            commands.append("1 w")
            commands.append(f"{LEFT_MARGIN} {y - 16} {PAGE_WIDTH - LEFT_MARGIN - RIGHT_MARGIN} 24 re B")
            commands.append(rgb_fill(BLUE))
            commands.append(text_line("F2", 14, LEFT_MARGIN + 14, y, text))
            y -= 30
            continue
        if block_type == "h3":
            commands.append(rgb_fill(BLUE))
            commands.append(text_line("F2", 11.5, LEFT_MARGIN, y, text))
            y -= 18
            continue

        if block_type == "numbered":
            marker, remainder = text.split(" ", 1)
            lines = wrap_text(remainder, 77)
            for index, line in enumerate(lines):
                commands.append(rgb_fill(TEXT))
                prefix = f"{marker} " if index == 0 else "    "
                commands.append(text_line("F1", BODY_FONT_SIZE, LEFT_MARGIN, y, prefix + line))
                y -= BODY_LEADING
            y -= 5
            continue

        if block_type == "bullet":
            lines = wrap_text(text, 80)
            for index, line in enumerate(lines):
                commands.append(rgb_fill(TEXT))
                prefix = "- " if index == 0 else "  "
                commands.append(text_line("F1", BODY_FONT_SIZE, LEFT_MARGIN + 8, y, prefix + line))
                y -= BODY_LEADING
            y -= 5
            continue

        lines = wrap_text(text, 86)
        for line in lines:
            commands.append(rgb_fill(TEXT))
            commands.append(text_line("F1", BODY_FONT_SIZE, LEFT_MARGIN, y, line))
            y -= BODY_LEADING
        y -= 6

    commands.append(rgb_stroke(LINE))
    commands.append("1 w")
    commands.append(f"{LEFT_MARGIN} {BOTTOM_MARGIN} {PAGE_WIDTH - LEFT_MARGIN - RIGHT_MARGIN} 0 l S")
    commands.append(rgb_fill(MUTED))
    commands.append(text_line("F1", 9, LEFT_MARGIN, BOTTOM_MARGIN - 14, "Generated from HOW_TO_USE.md for the current repo state."))
    return "\n".join(commands).encode("latin-1", "replace")


def build_pdf(title: str, subtitle: str, pages: list[list[dict[str, object]]]) -> bytes:
    objects: list[bytes] = []

    def add_object(payload: bytes) -> int:
        objects.append(payload)
        return len(objects)

    font_regular = add_object(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    font_bold = add_object(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")

    pages_placeholder_index = len(objects)
    objects.append(b"")
    pages_id = pages_placeholder_index + 1

    page_object_ids: list[int] = []
    total_pages = len(pages) + 1
    streams = [cover_stream(title, subtitle, total_pages)]
    for index, page_blocks in enumerate(pages, start=2):
        streams.append(page_stream(page_blocks, index, total_pages, title))

    for content in streams:
        content_id = add_object(b"<< /Length " + str(len(content)).encode("ascii") + b" >>\nstream\n" + content + b"\nendstream")
        page_payload = (
            f"<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 {PAGE_WIDTH} {PAGE_HEIGHT}] "
            f"/Resources << /Font << /F1 {font_regular} 0 R /F2 {font_bold} 0 R >> >> "
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
    pdf.extend(f"trailer\n<< /Size {len(objects) + 1} /Root {catalog_id} 0 R >>\n".encode("ascii"))
    pdf.extend(f"startxref\n{xref_offset}\n%%EOF\n".encode("ascii"))
    return bytes(pdf)


def main() -> None:
    markdown_text = SOURCE.read_text(encoding="utf-8")
    blocks = markdown_to_blocks(markdown_text)
    title, subtitle, content_blocks = split_document(blocks)
    pages = build_layout(content_blocks)
    OUTPUT.write_bytes(build_pdf(title, subtitle, pages))
    print(f"Wrote {OUTPUT}")
    print(f"Pages: {len(pages) + 1}")


if __name__ == "__main__":
    main()
