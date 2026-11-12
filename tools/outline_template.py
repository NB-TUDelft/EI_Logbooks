"""Turn the printed text of logbook template PDFs into vector outlines.

Usage: python tools/outline_template.py site/logbooks/*.pdf   (rewrites in place)

The questions, headings and table labels are identical in every student's
logbook. As real text they count toward Turnitin similarity in every
submission. Drawn as outlines they look the same (and image-reading AI can
still read them), but text extraction returns only the student's answers and
the invisible NB2420 labels added at export.

Form fields, bookmarks and the document Info stay as they are: only each
page's own content stream is replaced by the same page drawn with text as
paths. Running it twice is harmless (an outlined page has no text left).
Needs: pip install pymupdf
"""
import os
import sys
import pymupdf

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')


def outline(path):
    doc = pymupdf.open(path)
    if not any(p.get_text().strip() for p in doc):
        return 'already outlined'
    for page in doc:
        # Page content without form widgets, text converted to paths.
        svg = page.get_svg_image(text_as_path=True, matrix=pymupdf.Identity)
        drawn = pymupdf.open(stream=svg.encode('utf-8'), filetype='svg')
        drawn = pymupdf.open('pdf', drawn.convert_to_pdf())
        for xref in page.get_contents():
            doc.update_stream(xref, b'')
        page.show_pdf_page(page.rect, drawn, 0)
    tmp = str(path) + '.tmp'
    doc.save(tmp, garbage=3, deflate=True)
    doc.close()
    os.replace(tmp, path)
    return 'outlined'


if __name__ == '__main__':
    for p in sys.argv[1:]:
        print(p, outline(p))
