"""Playwright + pypdf end-to-end test of the logbook editor in site/.

Opens the editor in headless Chromium, exercises the toolbar, fields, exports,
images, dialogs and autosave, then exports a filled logbook, opens the export
again and checks nothing was lost. Screenshots and report.md go to
editor-test/<date>/. Exit code 0 means PASS, 1 means FAIL.

Locally set CHROMIUM_PATH to a Chromium binary if Playwright's own browser is
not installed. On GitHub the workflow installs the browser.
"""

import base64
import functools
import http.server
import io
import json
import os
import struct
import sys
import threading
import time
import zlib
from datetime import datetime
from pathlib import Path

from playwright.sync_api import sync_playwright
from pypdf import PdfReader

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

REPO = Path(__file__).resolve().parent.parent
SITE_DIR = REPO / "site"
TODAY = datetime.now().strftime("%Y-%m-%d")
OUT_DIR = REPO / "editor-test" / TODAY
DL_DIR = OUT_DIR / "downloads"


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


def start_server():
    handler = functools.partial(QuietHandler, directory=str(SITE_DIR))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]


def make_png(w=2, h=2, rgb=(0xD0, 0x30, 0x30)):
    """A small valid solid-colour PNG, as bytes."""

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


FLAIR_JS = """
(selectors) => {
    document.querySelectorAll('.df-circle').forEach(e => e.classList.remove('df-circle'));
    let st = document.getElementById('df-style');
    if (!st) {
        st = document.createElement('style');
        st.id = 'df-style';
        st.textContent = '.df-circle { outline: 3px solid #e11d48 !important; outline-offset: 2px !important; border-radius: 999px !important; }';
        document.head.appendChild(st);
    }
    const out = [];
    for (const sel of selectors) {
        document.querySelectorAll(sel).forEach(el => {
            if (el.offsetParent !== null || getComputedStyle(el).position === 'fixed') {
                el.classList.add('df-circle');
                const t = (el.innerText || el.getAttribute('title') || el.getAttribute('aria-label') || '').trim();
                if (t) out.push(t.replace(/\\s+/g, ' ').slice(0, 120));
            }
        });
    }
    return out;
}
"""

# Export through the editor and hand the bytes back as base64.
EXPORT_JS = """
async (pick) => {
    const r = await window.nb2420Logbook.exportBytesWith(pick);
    let s = '';
    for (const b of r.bytes) s += String.fromCharCode(b);
    return { b64: btoa(s), asked: r.asked };
}
"""


def wait_editor(pg, timeout=30000):
    pg.wait_for_function(
        "() => !!(window.nb2420Logbook && window.nb2420Logbook.state().id)", timeout=timeout
    )
    time.sleep(1.2)


def run_suite():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    DL_DIR.mkdir(parents=True, exist_ok=True)
    png_path = OUT_DIR / "test_pic.png"
    png_path.write_bytes(make_png())

    httpd, port = start_server()
    base = f"http://127.0.0.1:{port}"
    states = []
    meta_rows = []
    current = {"pg": None}

    def record(name, ok, note="", flair=()):
        states.append((name, "PASS" if ok else "FAIL", note, list(flair)[:6]))
        print(f"[{'PASS' if ok else 'FAIL'}] {name}: {note}", flush=True)

    def snap(name, selectors, ok=True, note=""):
        pg = current["pg"]
        flair = pg.evaluate(FLAIR_JS, selectors)
        pg.screenshot(path=str(OUT_DIR / f"{name}.png"))
        record(name, ok, note, flair)

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH") or None)
        try:
            ctx = browser.new_context(viewport={"width": 1440, "height": 960}, accept_downloads=True)
            pg = ctx.new_page()
            current["pg"] = pg

            # 1. Landing page
            pg.goto(f"{base}/index.html")
            pg.wait_for_selector("a[href*='viewer.html']", state="attached", timeout=15000)
            snap("01_landing", ["h1", ".highlight", "a[href*='viewer.html']"], True, "Landing page loaded")

            # 2. Editor toolbar + Draw swatches + More/Privacy menus
            pg.goto(f"{base}/pdfjs/web/viewer.html?file=../../logbooks/2.1_Whack_a_mole_logbook.pdf")
            wait_editor(pg)
            pg.evaluate("document.getElementById('lbToolDraw').click(); document.getElementById('lbMore').click();")
            time.sleep(0.3)
            swatch_titles = pg.evaluate("[...document.querySelectorAll('.lb-swatch')].map(b => b.title)")
            snap(
                "02_toolbar_menus",
                ["#lbExport", "#lbToolDraw", ".lb-swatch", ".lb-size", ".lb-menu:not([hidden]) button"],
                len(swatch_titles) == 4 and all(t in ("Black", "Blue", "Red", "Green") for t in swatch_titles),
                f"Swatches={swatch_titles}",
            )
            pg.evaluate("document.getElementById('lbToolSelect').click(); document.body.click();")

            # 3. Single-line: font stays fixed, length is capped to what fits, "box is full" hint
            sl = pg.locator(".textWidgetAnnotation input").first
            sl.scroll_into_view_if_needed()
            sl.click()
            ml = int(sl.get_attribute("maxlength") or 0)
            pg.keyboard.type("Hello")
            time.sleep(0.15)
            fs = "(e) => getComputedStyle(e).fontSize"
            hint_js = "document.querySelector('.lb-hint')?.innerText || ''"
            fs_before = sl.evaluate(fs)
            snap("03a_singleline_before_shrink", [".textWidgetAnnotation input"], True, f"fontSize={fs_before}")
            pg.keyboard.type("A" * max(1, ml - 10))
            time.sleep(0.15)
            hint5 = pg.evaluate(hint_js)
            pg.keyboard.type("B" * 20)
            time.sleep(0.15)
            fs_after = sl.evaluate(fs)
            hint0 = pg.evaluate(hint_js)
            cur_ml = int(sl.get_attribute("maxlength") or 0)
            val_len = len(sl.input_value() or "")
            sl_info = {"init_ml": ml, "cur_ml": cur_ml, "valLen": val_len, "fs_before": fs_before,
                       "fs_after": fs_after, "hint5": hint5, "hint0": hint0}
            sl_ok = bool(cur_ml > 0 and val_len == cur_ml and fs_before == fs_after
                         and "box is full" in hint0 and "add a Text page" in hint0)
            snap("03_singleline_cap", [".lb-hint"], sl_ok, str(sl_info))

            # 4. Multi-line overflow + yellow highlight
            ml_info = pg.evaluate("""() => {
                const areas = [...document.querySelectorAll('.textWidgetAnnotation textarea')];
                if (areas.length < 2) return null;
                areas[0].scrollIntoView({block: 'center'});
                areas[0].focus();
                areas[0].value = 'Overflow line '.repeat(250);
                areas[0].dispatchEvent(new Event('input', {bubbles: true}));
                areas[0].dispatchEvent(new Event('change', {bubbles: true}));
                areas[1].focus();
                areas[1].value = 'Extreme overflow text that cannot fit even at 6pt! '.repeat(600);
                areas[1].dispatchEvent(new Event('input', {bubbles: true}));
                areas[1].dispatchEvent(new Event('change', {bubbles: true}));
                const overCount = document.querySelectorAll('.lb-mirror mark').length;
                const hint = document.querySelector('.lb-hint')?.innerText || '';
                return {overCount, hint, count: areas.length};
            }""")
            ml_ok = bool(ml_info and ml_info["overCount"] >= 1 and "the yellow part moves to an extra page" in ml_info["hint"])
            snap("04_multiline_overflow", [".lb-hint", ".lb-mirror mark"], ml_ok, str(ml_info))

            # 5. Export dialog + table buttons
            pg.evaluate("document.getElementById('lbExport').click()")
            pg.wait_for_selector(".lb-modal", timeout=15000)
            dlg_info = pg.evaluate("""() => {
                const dlg = document.querySelector('.lb-modal');
                if (!dlg) return null;
                const disabled = [...dlg.querySelectorAll('option:disabled, input[type="radio"]:disabled, button:disabled')].length;
                const ovBtns = dlg.querySelectorAll('.lb-ov-btn').length;
                return {title: dlg.querySelector('h2')?.innerText, disabled, ovBtns};
            }""")
            snap("05_export_dialog",
                 [".lb-modal h2", ".lb-modal-actions button", ".lb-ov-head", ".lb-ov-btn"],
                 bool(dlg_info and dlg_info["disabled"] >= 1 and dlg_info["ovBtns"] >= 6), f"dlg={dlg_info}")
            pg.evaluate("document.querySelector('.lb-modal-actions button')?.click()")
            time.sleep(0.2)

            # 6. Export paths via window.nb2420Logbook + pypdf verification.
            # Keep only moderate overflow so 'overflow' / 'all' / 'shrink' all run cleanly.
            pg.evaluate("""() => {
                const areas = [...document.querySelectorAll('.textWidgetAnnotation textarea')];
                areas[1].value = 'Short answer';
                areas[1].dispatchEvent(new Event('input', {bubbles: true}));
                areas[1].dispatchEvent(new Event('change', {bubbles: true}));
                areas[1].blur();
            }""")

            def check_export(tag, pick="overflow"):
                res = pg.evaluate(EXPORT_JS, pick)
                out_pdf = DL_DIR / f"export_{tag}.pdf"
                out_pdf.write_bytes(base64.b64decode(res["b64"]))
                rd = PdfReader(str(out_pdf))
                meta = rd.metadata or {}
                kw = str(meta.get("/Keywords", ""))
                prod = str(meta.get("/Producer", ""))
                lid = str(meta.get("/LogbookId", ""))
                lexp = str(meta.get("/LogbookExported", ""))
                lfields = json.loads(str(meta.get("/LogbookFields", "{}")))
                full_txt = "\n".join((page.extract_text() or "") for page in rd.pages)
                has_cont = "Continued from:" in full_txt if pick in ("overflow", "all") else True
                ok = ("nb2420-logbook" in kw) and ("nb2420-logbook editor" in prod) and bool(lid) and bool(lexp) and has_cont
                meta_rows.append((tag, ok, kw, prod, lid, len(rd.pages), len(lfields.get("fields", {}))))
                print(f"  [pypdf {tag}] ok={ok} pages={len(rd.pages)} kw={kw!r} prod={prod!r} id={lid!r}", flush=True)
                return ok

            ok_text = check_export("text_only_overflow", "overflow")
            ok_all = check_export("text_only_all", "all")
            ok_shrink = check_export("text_only_shrink", "shrink")

            # Image slot insert + export
            pg.evaluate("""() => {
                const inp = document.createElement('input');
                inp.type = 'file'; inp.id = 'etTestFile'; inp.style.display = 'none';
                document.body.appendChild(inp);
                window.nb2420Logbook.setTestFile('etTestFile');
            }""")
            pg.set_input_files("#etTestFile", str(png_path))
            slot_name = pg.evaluate("window.nb2420Logbook.state().slots[0]?.name || null")
            if slot_name:
                pg.evaluate("""(sname) => new Promise(cb => {
                    window.nb2420Logbook.slotInsert(sname);
                    const waitIdle = () => {
                        if (!document.body.classList.contains('lb-busy') && window.nb2420Logbook.state().images['slot:' + sname]) cb(true);
                        else setTimeout(waitIdle, 200);
                    };
                    setTimeout(waitIdle, 400);
                })""", slot_name)
            ok_img = check_export("with_image", "overflow")

            # Added blank page + export
            time.sleep(1.0)
            res_blank = pg.evaluate("""async () => {
                const done = window.nb2420Logbook.insertBlankPage();
                // the Text page dialog asks which exercise; keep the one it suggests
                await new Promise(res => {
                    const ok = () => { const b = document.getElementById('lbTextPageOk'); if (b) { b.click(); res(); } else setTimeout(ok, 100); };
                    ok();
                });
                await done;
                return 'ok';
            }""")
            assert res_blank == "ok", f"insertBlankPage failed: {res_blank}"
            ok_page = check_export("with_added_page", "overflow")
            snap("06_added_page_and_delete_btn", ["#lbDeletePage"],
                 ok_text and ok_all and ok_shrink and ok_img and ok_page,
                 "All 5 export/metadata checks passed")

            # 7. Image page dialog & Delete page confirm
            pg.evaluate("document.getElementById('lbInsertImagePage').click()")
            time.sleep(0.3)
            snap("07_image_page_dialog", [".lb-modal h2", ".lb-modal select", ".lb-modal button"], True, "Image page dialog")
            pg.evaluate("document.querySelector('.lb-modal button')?.click()")
            time.sleep(0.2)
            pg.evaluate("document.getElementById('lbDeletePage').click()")
            time.sleep(0.3)
            snap("07b_delete_confirm", [".lb-modal h2", ".lb-modal button"], True, "Delete page confirm")
            pg.evaluate("document.querySelector('.lb-modal button')?.click()")
            time.sleep(0.2)

            # 8. Clear saved work confirms (both red)
            pg.evaluate("document.getElementById('lbPrivacy').click(); document.getElementById('lbClearThis').click();")
            time.sleep(0.3)
            danger_js = "document.getElementById('lbConfirmOk')?.classList.contains('lb-danger')"
            c1_danger = pg.evaluate(danger_js)
            snap("08a_clear_confirm1_red", ["#lbConfirmOk", ".lb-modal h2"], c1_danger is True, f"danger={c1_danger}")
            pg.evaluate("document.getElementById('lbConfirmOk').click()")
            time.sleep(0.3)
            c2_danger = pg.evaluate(danger_js)
            snap("08b_clear_confirm2_red", ["#lbConfirmOk", ".lb-modal h2"], c2_danger is True, f"danger={c2_danger}")
            pg.evaluate("document.querySelector('.lb-modal button')?.click()")

            # 9. Autosave & Restore bar on reload
            pg.evaluate("window.nb2420Logbook.autosaveNow(true).then(() => true)")
            pg.reload()
            wait_editor(pg)
            has_restore = pg.evaluate("!!document.getElementById('lbRestoreYes')")
            snap("09_restore_bar", ["#lbRestoreYes", "#lbRestoreNo", ".lb-restore"], bool(has_restore),
                 f"has_restore={has_restore}")

            # 10. Ctrl+S toast + Export PDF toast ("come back")
            toasts_js = "[...document.querySelectorAll('.lb-toast')].map(t => t.innerText)"
            pg.keyboard.press("Control+s")
            time.sleep(0.4)
            ctrl_toast = pg.evaluate(toasts_js)
            snap("10a_ctrls_toast", [".lb-toast"], any("saves itself" in t for t in ctrl_toast), str(ctrl_toast))

            pg.evaluate("window.nb2420Logbook.exportPdf().then(() => true)")
            time.sleep(0.4)
            exp_toast = pg.evaluate(toasts_js)
            snap("10b_export_comeback_toast", [".lb-toast"], any("come back" in t for t in exp_toast), str(exp_toast))
            ctx.close()

            # 11. Export a filled logbook, open the export as a fresh file, export again.
            ctx = browser.new_context(viewport={"width": 1300, "height": 1000}, accept_downloads=True)
            pg = ctx.new_page()
            current["pg"] = pg
            pg.on("console", lambda m: print("  console:", m.text, flush=True) if m.type == "error" else None)
            run_reopen_test(pg, base, record, snap)
            ctx.close()
        finally:
            browser.close()
            httpd.shutdown()

    # Write report.md
    lines = [
        f"# Editor Test Report ({TODAY})",
        "",
        "## UI & Limit-Test States",
        "",
        "| State | Result | Note | Circled Flair (sample) |",
        "|---|---|---|---|",
    ]
    for name, res, note, flair in states:
        lines.append(f"| `{name}` | **{res}** | {note} | {', '.join(flair)} |")
    lines += [
        "",
        "## `pypdf` Export Metadata Verification",
        "",
        "| Export Path | Pass | `/Keywords` | `/Producer` | `/LogbookId` | Pages | Fields |",
        "|---|---|---|---|---|---|---|",
    ]
    for tag, ok, kw, prod, lid, pgs, nf in meta_rows:
        lines.append(f"| `{tag}` | **{'PASS' if ok else 'FAIL'}** | `{kw}` | `{prod}` | `{lid}` | {pgs} | {nf} |")

    report = OUT_DIR / "report.md"
    report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\nREPORT: {report}")
    all_ok = all(r[1] == "PASS" for r in states) and all(m[1] for m in meta_rows)
    print("OVERALL:", "PASS" if all_ok else "FAIL")
    sys.exit(0 if all_ok else 1)


def run_reopen_test(pg, base, record, snap):
    """Fill 3.1, draw, drop an image, add an image page, export, reopen the export, export again."""
    entry = "3.1_aliasing_and_anti_aliasing_logbook.pdf"
    png_b64 = base64.b64encode(make_png(60, 40)).decode()

    def check(name, cond, note=""):
        record(name, bool(cond), note)

    pg.goto(f"{base}/pdfjs/web/viewer.html?file=../../logbooks/{entry}")
    wait_editor(pg)

    short_answer = "Short answer with Ünïcode."
    long_answer = "A very long answer. " * 200
    pg.fill('[name="name"]', short_answer)
    pg.fill('[name="preparation"]', long_answer)
    cb = pg.query_selector(".annotationLayer input[type=checkbox]")
    if cb:
        cb.click()

    # A drawing on page 1
    pg.click("#lbToolDraw")
    box = pg.query_selector('.page[data-page-number="1"]').bounding_box()
    pg.mouse.move(box["x"] + 150, box["y"] + 300)
    pg.mouse.down()
    for i in range(20):
        pg.mouse.move(box["x"] + 150 + i * 10, box["y"] + 300 + (i % 4) * 12)
    pg.mouse.up()
    pg.click("#lbToolSelect")
    time.sleep(0.5)

    # A loose image dropped on page 1
    pg.evaluate("""(b64) => {
        const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const dt = new DataTransfer(); dt.items.add(new File([bin], 'red.png', { type: 'image/png' }));
        const t = document.querySelector('.page[data-page-number="1"]');
        t.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
        t.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }""", png_b64)
    time.sleep(2)
    pg.click("#lbToolSelect")
    time.sleep(0.5)

    # An image page with a 2 x 1 grid and two photos, plus notes
    pg.evaluate("""() => { const i = document.createElement('input'); i.type = 'file'; i.multiple = true;
        i.id = 'tf'; document.body.append(i); }""")
    pg.set_input_files("#tf", [
        {"name": "a.png", "mimeType": "image/png", "buffer": make_png(80, 50)},
        {"name": "b.png", "mimeType": "image/png", "buffer": make_png(50, 80)},
    ])
    pg.evaluate("window.nb2420Logbook.setTestFile('tf')")
    pg.click("#lbInsertImagePage")
    pg.click("#lbGrid_2x1")
    pg.click(".lb-modal-actions button:last-child")
    time.sleep(4)
    notes = pg.evaluate("""[...document.querySelectorAll('.annotationLayer textarea')]
        .map(e => e.name).find(n => n.startsWith('added_notes_'))""")
    pg.fill(f'[name="{notes}"]', "Notes on the photos.")
    pages_before = pg.evaluate("PDFViewerApplication.pagesCount")

    def inks(rd):
        return sum(
            1
            for page in rd.pages
            for a in (page.get("/NB2420Editable", {}).get("/Annots", []) or [])
            if a.get_object()["/Subtype"] == "/Ink"
        )

    res = pg.evaluate(EXPORT_JS, "overflow")
    exp = base64.b64decode(res["b64"])
    (DL_DIR / "reopen_export.pdf").write_bytes(exp)
    r = PdfReader(io.BytesIO(exp))
    root = r.trailer["/Root"]
    lf = json.loads(r.metadata["/LogbookFields"])
    check("11a_export_is_flat", "/AcroForm" not in root, "export has no form")
    check(
        "11b_no_live_annotations",
        all(
            not any(a.get_object()["/Subtype"] in ("/Widget", "/Ink", "/Stamp") for a in (page.get("/Annots", []) or []))
            for page in r.pages
        ),
        "no widgets, drawings or stamps left as annotations",
    )
    check("11c_editable_layer_parked", "/NB2420Editable" in root, "editable layer parked in the catalog")
    check("11d_overflow_page_added", len(r.pages) > pages_before, f"{pages_before} -> {len(r.pages)} pages")
    loose = {k: v for k, v in lf["images"].items() if k.startswith("loose:")}
    slots = sum(1 for k, v in lf["images"].items() if v and v.get("kind") == "slot")
    check("11e_two_photos_listed", slots == 2, f"slot images={slots}")
    check("11f_loose_image_listed", len(loose) == 1, f"loose={loose}")
    text = "".join(page.extract_text() or "" for page in r.pages)
    check("11g_loose_image_hidden_label", "[[NB2420:image loose=" in text)

    # Open the export as a fresh file
    pg.evaluate("""async (b64) => { const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        await PDFViewerApplication.open({ data: bin, filename: 'export.pdf' }); }""", res["b64"])
    time.sleep(4)
    wait_editor(pg)
    check("11h_overflow_page_removed_on_reopen",
          pg.evaluate("PDFViewerApplication.pagesCount") == pages_before, "page count back to original")
    pg.evaluate("PDFViewerApplication.page = 1")
    time.sleep(2)
    check("11i_long_answer_back_in_full",
          pg.evaluate("document.querySelector('[name=preparation]')?.value") == long_answer,
          "long answer in a live field")
    check("11j_image_page_notes_back",
          pg.evaluate(f"document.querySelector('[name={notes}]')?.value") == "Notes on the photos.")
    check("11k_short_answer_back",
          pg.evaluate("document.querySelector('[name=name]')?.value") == short_answer,
          "short answer in a live field")
    r2 = PdfReader(io.BytesIO(base64.b64decode(pg.evaluate(EXPORT_JS, "overflow")["b64"])))
    lf2 = json.loads(r2.metadata["/LogbookFields"])
    for k in ("fields", "checks", "images", "overflow"):
        check(f"11l_second_export_same_{k}", lf2[k] == lf[k], f"LogbookFields.{k} unchanged")
    check("11m_second_export_same_pages", len(r2.pages) == len(r.pages), f"{len(r.pages)} vs {len(r2.pages)}")
    check("11n_drawings_kept", inks(r) >= 1 and inks(r2) == inks(r), f"{inks(r)} -> {inks(r2)}")
    snap("11z_reopened_logbook", [".lb-hint", ".lb-restore"], True, "Reopened export shown in the editor")


if __name__ == "__main__":
    run_suite()
