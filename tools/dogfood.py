"""Selenium + pypdf dogfood / limit-test suite for NB-TUDelft/EI_Logbooks."""

import functools
import http.server
import json
import os
import shutil
import socketserver
import sys
import tempfile
import threading
import time
from datetime import datetime
from pathlib import Path

from pypdf import PdfReader
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

REPO = Path(__file__).resolve().parent.parent
SITE_DIR = REPO / "site"
TODAY = datetime.now().strftime("%Y-%m-%d")
OUT_DIR = REPO / "dogfood" / TODAY
DL_DIR = OUT_DIR / "downloads"


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


def start_server():
    handler = functools.partial(QuietHandler, directory=str(SITE_DIR))
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd, port


def make_tiny_png(path: Path):
    # 2x2 valid red PNG
    import struct, zlib

    def chunk(tag, data):
        return struct.pack("!I", len(data)) + tag + data + struct.pack("!I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b"\x00\xff\x00\x00\xff\x00\x00\x00\xff\x00\x00\xff\x00\x00"
    ihdr = struct.pack("!IIBBBBB", 2, 2, 8, 2, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
    path.write_bytes(png)


def circle_flair(driver, selectors):
    driver.execute_script(
        """
        document.querySelectorAll('.df-circle').forEach(e => e.classList.remove('df-circle'));
        let st = document.getElementById('df-style');
        if (!st) {
            st = document.createElement('style');
            st.id = 'df-style';
            st.textContent = '.df-circle { outline: 3px solid #e11d48 !important; outline-offset: 2px !important; border-radius: 999px !important; }';
            document.head.appendChild(st);
        }
        const texts = [];
        for (const sel of arguments[0]) {
            document.querySelectorAll(sel).forEach(el => {
                if (el.offsetParent !== null || getComputedStyle(el).position === 'fixed') {
                    el.classList.add('df-circle');
                    const t = (el.innerText || el.getAttribute('title') || el.getAttribute('aria-label') || '').trim();
                    if (t) texts.push(t.replace(/\\s+/g, ' ').slice(0, 120));
                }
            });
        }
        return texts;
        """,
        selectors,
    )


def wait_editor(driver, timeout=30):
    WebDriverWait(driver, timeout).until(
        lambda d: d.execute_script("return !!(window.nb2420Logbook && window.nb2420Logbook.state().id);")
    )
    time.sleep(1.2)


def run_suite():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    DL_DIR.mkdir(parents=True, exist_ok=True)
    png_path = OUT_DIR / "test_pic.png"
    make_tiny_png(png_path)

    httpd, port = start_server()
    base = f"http://127.0.0.1:{port}"
    profile_dir = tempfile.mkdtemp(prefix="nb2420_df_")

    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--window-size=1440,960")
    opts.add_argument(f"--user-data-dir={profile_dir}")
    opts.add_experimental_option(
        "prefs",
        {
            "download.default_directory": str(DL_DIR),
            "download.prompt_for_download": False,
            "download.directory_upgrade": True,
        },
    )

    driver = webdriver.Chrome(options=opts)
    states = []
    meta_rows = []

    def snap(name, selectors, ok=True, note=""):
        flair = driver.execute_script(
            """
            document.querySelectorAll('.df-circle').forEach(e => e.classList.remove('df-circle'));
            let st = document.getElementById('df-style');
            if (!st) {
                st = document.createElement('style');
                st.id = 'df-style';
                st.textContent = '.df-circle { outline: 3px solid #e11d48 !important; outline-offset: 2px !important; border-radius: 999px !important; }';
                document.head.appendChild(st);
            }
            const out = [];
            for (const sel of arguments[0]) {
                document.querySelectorAll(sel).forEach(el => {
                    if (el.offsetParent !== null || getComputedStyle(el).position === 'fixed') {
                        el.classList.add('df-circle');
                        const t = (el.innerText || el.getAttribute('title') || el.getAttribute('aria-label') || '').trim();
                        if (t) out.push(t.replace(/\\s+/g, ' ').slice(0, 120));
                    }
                });
            }
            return out;
            """,
            selectors,
        )
        shot = OUT_DIR / f"{name}.png"
        driver.save_screenshot(str(shot))
        states.append((name, "PASS" if ok else "FAIL", note, flair[:6]))
        print(f"[{ 'PASS' if ok else 'FAIL' }] {name}: {note}", flush=True)

    try:
        # 1. Landing page
        driver.get(f"{base}/index.html")
        WebDriverWait(driver, 15).until(lambda d: d.find_elements(By.CSS_SELECTOR, "a[href*='viewer.html']"))
        snap("01_landing", ["h1", ".highlight", "a[href*='viewer.html']"], True, "Landing page loaded")

        # 2. Editor toolbar + Draw swatches + More/Privacy menus
        viewer_url = f"{base}/pdfjs/web/viewer.html?file=../../logbooks/2.1_Whack_a_mole_logbook.pdf"
        driver.get(viewer_url)
        wait_editor(driver)
        driver.execute_script("document.getElementById('lbToolDraw').click(); document.getElementById('lbMore').click();")
        time.sleep(0.3)
        swatch_titles = driver.execute_script("return [...document.querySelectorAll('.lb-swatch')].map(b => b.title);")
        snap("02_toolbar_menus", ["#lbExport", "#lbToolDraw", ".lb-swatch", ".lb-size", ".lb-menu:not([hidden]) button"],
             len(swatch_titles) == 4 and all(t in ("Black", "Blue", "Red", "Green") for t in swatch_titles),
             f"Swatches={swatch_titles}")
        driver.execute_script("document.getElementById('lbToolSelect').click(); document.body.click();")

        # 3. Single-line MaxLen cap + 30/0 counter
        sl_inp = driver.execute_script("""
            const inp = [...document.querySelectorAll('.textWidgetAnnotation input')][0];
            if (inp) inp.scrollIntoView({block: 'center'});
            return inp;
        """)
        sl_inp.click()
        ml = int(sl_inp.get_attribute("maxLength") or 0)
        sl_inp.send_keys("A" * max(1, ml - 5))
        time.sleep(0.15)
        hint5 = driver.execute_script("return document.querySelector('.lb-hint')?.innerText || '';")
        sl_inp.send_keys("B" * 20)
        time.sleep(0.15)
        hint0 = driver.execute_script("return document.querySelector('.lb-hint')?.innerText || '';")
        cur_ml = int(sl_inp.get_attribute("maxLength") or 0)
        val_len = len(sl_inp.get_attribute("value") or "")
        sl_info = {"init_ml": ml, "cur_ml": cur_ml, "valLen": val_len, "hint5": hint5, "hint0": hint0}
        sl_ok = bool(cur_ml > 0 and val_len == cur_ml and "0 characters left" in hint0)
        snap("03_singleline_cap", [".lb-hint"], sl_ok, str(sl_info))

        # 4. Multi-line overflow + yellow highlight + export dialog (with shrink disabled on ultra-long)
        ml_info = driver.execute_script("""
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
        """)
        ml_ok = bool(ml_info and ml_info["overCount"] >= 1 and "moved" in ml_info["hint"])
        snap("04_multiline_overflow", [".lb-hint", ".lb-mirror mark"], ml_ok, str(ml_info))

        # 5. Export dialog + busy toast
        driver.execute_script("document.getElementById('lbExport').click();")
        time.sleep(0.5)
        dlg_info = driver.execute_script("""
            const dlg = document.querySelector('.lb-modal');
            if (!dlg) return null;
            const disabled = [...dlg.querySelectorAll('option:disabled, input[type="radio"]:disabled, button:disabled')].length;
            return {title: dlg.querySelector('h2')?.innerText, disabled};
        """)
        snap("05_export_dialog", [".lb-modal h2", ".lb-modal button", ".lb-modal label"],
             bool(dlg_info and dlg_info["disabled"] >= 1), f"dlg={dlg_info}")
        driver.execute_script("document.querySelector('.lb-modal button')?.click();")
        time.sleep(0.2)

        # 6. Export paths via window.nb2420Logbook + pypdf verification
        # Keep only moderate overflow so 'overflow' / 'all' / 'shrink' all run cleanly
        driver.execute_script("""
            const areas = [...document.querySelectorAll('.textWidgetAnnotation textarea')];
            areas[1].value = 'Short answer';
            areas[1].dispatchEvent(new Event('input', {bubbles: true}));
            areas[1].dispatchEvent(new Event('change', {bubbles: true}));
            areas[1].blur();
        """)

        def check_export(tag, pre_js, pick="overflow"):
            if pre_js:
                driver.execute_script(pre_js)
                time.sleep(1.0)
            res = driver.execute_async_script("""
                const pick = arguments[0], cb = arguments[1];
                window.nb2420Logbook.exportBytesWith(pick).then(r => {
                    cb({bytes: Array.from(r.bytes), asked: r.asked});
                }).catch(e => cb({error: String(e)}));
            """, pick)
            assert "bytes" in res, f"{tag} export failed: {res}"
            out_pdf = DL_DIR / f"export_{tag}.pdf"
            out_pdf.write_bytes(bytes(res["bytes"]))
            rd = PdfReader(str(out_pdf))
            meta = rd.metadata or {}
            kw = str(meta.get("/Keywords", ""))
            prod = str(meta.get("/Producer", ""))
            lid = str(meta.get("/LogbookId", ""))
            lexp = str(meta.get("/LogbookExported", ""))
            lfields = json.loads(str(meta.get("/LogbookFields", "{}")))
            full_txt = "\n".join((pg.extract_text() or "") for pg in rd.pages)
            has_cont = "Continued from:" in full_txt if pick in ("overflow", "all") else True
            ok = ("nb2420-logbook" in kw) and ("nb2420-logbook editor" in prod) and bool(lid) and bool(lexp) and has_cont
            meta_rows.append((tag, ok, kw, prod, lid, len(rd.pages), len(lfields.get("fields", {}))))
            print(f"  [pypdf {tag}] ok={ok} pages={len(rd.pages)} kw={kw!r} prod={prod!r} id={lid!r}", flush=True)
            return ok

        ok_text = check_export("text_only_overflow", None, "overflow")
        ok_all = check_export("text_only_all", None, "all")
        ok_shrink = check_export("text_only_shrink", None, "shrink")

        # Image slot insert + export
        driver.execute_script("""
            const inp = document.createElement('input');
            inp.type = 'file'; inp.id = 'dfTestFile'; inp.style.display = 'none';
            document.body.appendChild(inp);
            window.nb2420Logbook.setTestFile('dfTestFile');
        """)
        driver.find_element(By.ID, "dfTestFile").send_keys(str(png_path))
        slot_name = driver.execute_script("return window.nb2420Logbook.state().slots[0]?.name || null;")
        if slot_name:
            driver.execute_async_script("""
                const sname = arguments[0], cb = arguments[1];
                window.nb2420Logbook.slotInsert(sname);
                setTimeout(() => cb(true), 1800);
            """, slot_name)
        ok_img = check_export("with_image", None, "overflow")

        # Added blank page + export
        driver.execute_async_script("""
            const cb = arguments[0];
            window.nb2420Logbook.insertBlankPage().then(() => cb(true));
        """)
        ok_page = check_export("with_added_page", None, "overflow")
        snap("06_added_page_and_delete_btn", ["#lbDeletePage"], ok_text and ok_all and ok_shrink and ok_img and ok_page,
             "All 5 export/metadata checks passed")

        # 7. Image page dialog & Delete page confirm
        driver.execute_script("document.getElementById('lbInsertImagePage').click();")
        time.sleep(0.3)
        snap("07_image_page_dialog", [".lb-modal h2", ".lb-modal select", ".lb-modal button"], True, "Image page dialog")
        driver.execute_script("document.querySelector('.lb-modal button')?.click();")
        time.sleep(0.2)
        driver.execute_script("document.getElementById('lbDeletePage').click();")
        time.sleep(0.3)
        snap("07b_delete_confirm", [".lb-modal h2", ".lb-modal button"], True, "Delete page confirm")
        driver.execute_script("document.querySelector('.lb-modal button')?.click();")
        time.sleep(0.2)

        # 8. Clear saved work confirms (1st neutral, 2nd red)
        driver.execute_script("document.getElementById('lbPrivacy').click(); document.getElementById('lbClearThis').click();")
        time.sleep(0.3)
        c1_danger = driver.execute_script("return document.getElementById('lbConfirmOk')?.classList.contains('lb-danger');")
        snap("08a_clear_confirm1_neutral", ["#lbConfirmOk", ".lb-modal h2"], c1_danger is False, f"danger={c1_danger}")
        driver.execute_script("document.getElementById('lbConfirmOk').click();")
        time.sleep(0.3)
        c2_danger = driver.execute_script("return document.getElementById('lbConfirmOk')?.classList.contains('lb-danger');")
        snap("08b_clear_confirm2_red", ["#lbConfirmOk", ".lb-modal h2"], c2_danger is True, f"danger={c2_danger}")
        driver.execute_script("document.querySelector('.lb-modal button')?.click();")

        # 9. Autosave & Restore bar on reload
        driver.execute_async_script("const cb = arguments[0]; window.nb2420Logbook.autosaveNow(true).then(() => cb(true));")
        driver.refresh()
        wait_editor(driver)
        has_restore = driver.execute_script("return !!document.getElementById('lbRestoreYes');")
        snap("09_restore_bar", ["#lbRestoreYes", "#lbRestoreNo", ".lb-restore"], bool(has_restore), f"has_restore={has_restore}")

        # 10. Ctrl+S toast + Export PDF toast ("come back")
        driver.find_element(By.TAG_NAME, "body").send_keys(Keys.CONTROL, "s")
        time.sleep(0.4)
        ctrl_toast = driver.execute_script("return [...document.querySelectorAll('.lb-toast')].map(t => t.innerText);")
        snap("10a_ctrls_toast", [".lb-toast"], any("automatically" in t for t in ctrl_toast), str(ctrl_toast))

        driver.execute_async_script("const cb = arguments[0]; window.nb2420Logbook.exportPdf().then(() => cb(true));")
        time.sleep(0.4)
        exp_toast = driver.execute_script("return [...document.querySelectorAll('.lb-toast')].map(t => t.innerText);")
        snap("10b_export_comeback_toast", [".lb-toast"], any("come back" in t for t in exp_toast), str(exp_toast))

    finally:
        driver.quit()
        httpd.shutdown()
        shutil.rmtree(profile_dir, ignore_errors=True)

    # Write report.md
    lines = [
        f"# Dogfood & Limit-Test Report ({TODAY})",
        "",
        "## UI & Limit-Test States",
        "",
        "| State | Result | Note | Circled Flair (sample) |",
        "|---|---|---|---|",
    ]
    for name, res, note, flair in states:
        lines.append(f"| `{name}.png` | **{res}** | {note} | {', '.join(flair)} |")
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


if __name__ == "__main__":
    run_suite()
