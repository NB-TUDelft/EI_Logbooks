/* NB2420 logbook add-on for the pdf.js viewer.
 *
 * Uses the stock viewer's forms, Draw tool and print; its free text,
 * highlight, image, comment and signature tools are off, so every answer
 * lives in a known field. Adds:
 *   - image slots: an "Insert image" button on each reserved graph box; the
 *     image is fitted inside the box and tagged with its exercise
 *   - a custom toolbar, and an Export button that writes a flattened hand-in PDF
 *     with invisible [[NB2420:...]] labels around every answer (for parsing)
 *   - appending text pages (one big field) and image pages at the end, and
 *     deleting pages that were added (the logbook's own pages are locked)
 *   - autosave in the browser (IndexedDB), with an offer to restore
 *
 * Every structural change round-trips through pdf-lib: the viewer's current
 * state (form values and annotations) is saved to bytes, changed, and opened
 * again on the same page. Bookkeeping lives in the PDF itself (Info keys and a
 * page-dictionary flag), so a saved logbook can be reopened and edited later.
 */
(() => {
  'use strict';
  const { PDFDocument, PDFName, PDFString, PDFHexString, PDFBool, PDFArray, PDFDict, PDFStream, PDFRef,
          StandardFonts, rgb, drawImage: opDrawImage, pushGraphicsState, popGraphicsState,
          concatTransformationMatrix, drawObject, degrees,
          beginText, endText, setFontAndSize, setTextRenderingMode, TextRenderingMode, setTextMatrix, showText } = PDFLib;

  const GENERAL = 'General / other';
  const A4 = [595.28, 841.89];
  const AUTOSAVE_MS = 3000;
  const KEY = {
    id: 'LogbookId', slots: 'LogbookSlots', images: 'LogbookImages',
    added: 'LogbookAdded', kind: 'LogbookPageKind', exercise: 'LogbookExercise', pageId: 'LogbookPageId',
  };
  // The export paints everything flat, and parks the editable layer (each
  // page's own contents and annotations, and the form) under this key, which
  // PDF viewers ignore. Opening the export in the editor puts it back. The
  // photos and drawings are stored once, shared by both, so the file barely grows.
  const PARK = 'NB2420Editable';

  // ---------------------------------------------------------------- options
  document.addEventListener('webviewerloaded', () => {
    const o = window.PDFViewerApplicationOptions;
    o.set('disablePreferences', true);      // same tools for every student
    // Nothing that drops loose content on arbitrary spots of a page: answers go
    // into the logbook's fields, so the exported PDF can be read by code.
    o.set('enableComment', false);
    o.set('enableSignatureEditor', false);
    o.set('enableHighlightFloatingButton', false);
    o.set('enableScripting', false);        // logbooks need no PDF scripts
    o.set('viewerCssTheme', 1);             // same light look in every browser and OS theme
    o.set('sidebarViewOnLoad', 0);          // no thumbnail sidebar: our own bar replaces the chrome
  });

  const app = () => window.PDFViewerApplication;
  const state = {
    id: null, filename: null, reopening: false, busy: false, onAnalysed: null,
    saveKey: null,        // autosave key: the logbook number ("2.3"), see logbookId()
    slots: [],            // [{name, ordinal, rect:[x1,y1,x2,y2], exercise}]
    pageInfo: [],         // per page: {added, kind, exercise}
    exercises: [],        // [{title, page}] from bookmarks
    images: {},           // metadata log, mirrors Info /LogbookImages
    lastHash: null, opCount: 0,
    doc: null,            // the pdfDocument that state.id belongs to
    restorePending: false, // restore bar shown: do not overwrite the stored work
    otherTab: false,      // same logbook open in another tab: autosave off here
  };

  // ------------------------------------------------------------- utilities
  const $ = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const kid of kids) if (kid != null && kid !== false) el.append(kid);
    return el;
  };
  const ansi = s => String(s).replace(/[‒-―]/g, '-').replace(/[^\x20-\x7e\xa0-\xff\n]/g, '?');
  const nowIso = () => new Date().toISOString();
  const toast = (msg, ms = 3500) => {
    document.querySelectorAll('.lb-toast').forEach(old => old.remove());   // one message at a time
    const t = $('div', { class: 'lb-toast', role: 'status' }, msg);
    document.body.append(t);
    setTimeout(() => t.remove(), ms);
  };

  function pickFile(accept = 'image/*', multiple = false) {
    return new Promise(resolve => {
      const input = $('input', { type: 'file', accept, class: 'lb-hidden-input', ...(multiple ? { multiple: '' } : {}) });
      input.addEventListener('change', () => { resolve(multiple ? [...input.files] : input.files[0] || null); input.remove(); });
      input.addEventListener('cancel', () => { resolve(null); input.remove(); });
      document.body.append(input);
      input.click();
    });
  }
  // Exposed so automated tests can feed a file without an OS dialog.
  let testFileHook = null;
  const IMAGE_TYPES = 'image/*,application/pdf,.pdf';
  const getImageFile = () => testFileHook ? Promise.resolve(testFileHook(false)) : pickFile(IMAGE_TYPES);
  const getImageFiles = () => testFileHook ? Promise.resolve(testFileHook(true)) : pickFile(IMAGE_TYPES, true);

  // A picture from the file: a bitmap for anything the browser decodes (JPEG,
  // PNG, GIF, WebP, AVIF, BMP; HEIC in Safari), an <img> for SVG, and page 1
  // rendered by pdf.js for a PDF (a plot exported as PDF, say).
  async function decodeImage(file) {
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      const task = globalThis.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
      try {
        const doc = await task.promise;
        const page = await doc.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: Math.min(6, 2400 / Math.max(base.width, base.height)) });
        const c = $('canvas', { width: Math.round(vp.width), height: Math.round(vp.height) });
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise;
        return c;
      } finally { task.destroy(); }
    }
    try { return await createImageBitmap(file); } catch (err) {
      // Only SVG needs an <img>: an <img> also "decodes" a broken JPEG or PNG
      // (cut off halfway, say) without an error, and would put half a picture in.
      if (!(file.type === 'image/svg+xml' || /\.svgz?$/i.test(file.name))) throw err;
      const url = URL.createObjectURL(file);
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        if (!img.naturalWidth || !img.naturalHeight) throw err;
        return img;
      } catch (_) { throw err; } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
    }
  }

  // Any picture becomes a JPEG (with EXIF rotation applied), at most 2400 px
  // on the long side.
  async function imageRecord(file) {
    const src = await decodeImage(file);
    const bmp = { width: src.naturalWidth || src.width, height: src.naturalHeight || src.height };
    const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = $('canvas', { width: w, height: h });
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(src, 0, 0, w, h);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.9));
    // Hashes of the file as the student picked it, before resizing and JPEG
    // re-encoding, so the same photo gives the same hash in every logbook.
    let sha256 = null, sha512 = null;
    try {
      const raw = await file.arrayBuffer();
      const hex = async alg => [...new Uint8Array(await crypto.subtle.digest(alg, raw))]
        .map(b => b.toString(16).padStart(2, '0')).join('');
      sha256 = await hex('SHA-256'); sha512 = await hex('SHA-512');
    } catch (_) { /* optional */ }
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()), w, h,
      meta: { original_filename: file.name, original_width: bmp.width, original_height: bmp.height, sha256, sha512, inserted: nowIso() },
    };
  }
  const contain = (w, h, bw, bh) => { const s = Math.min(bw / w, bh / h); return { w: w * s, h: h * s }; };

  // ------------------------------------------------------------- autosave
  const idb = (() => {
    let dbp;
    const open = () => dbp ||= new Promise((res, rej) => {
      const r = indexedDB.open('nb2420-logbooks', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('autosave');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const tx = async (mode, fn) => {
      const db = await open();
      return new Promise((res, rej) => {
        const t = db.transaction('autosave', mode);
        const req = fn(t.objectStore('autosave'));
        t.oncomplete = () => res(req && req.result);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error || new Error('storage transaction aborted')); // e.g. quota
      });
    };
    return {
      get: k => tx('readonly', s => s.get(k)).catch(() => null),
      keys: () => tx('readonly', s => s.getAllKeys()).catch(() => []),
      put: (k, v) => tx('readwrite', s => s.put(v, k)), // throws, so autosave can say it failed
      del: k => tx('readwrite', s => s.delete(k)).catch(() => null),
      // Privacy: remove saved work. If deleting fails, overwrite it with nothing first.
      async wipe(k) {
        try { await tx('readwrite', s => s.delete(k)); } catch (_) {
          await tx('readwrite', s => s.put({ bytes: new Uint8Array(0), time: null, wiped: true }, k)).catch(() => {});
          await tx('readwrite', s => s.delete(k)).catch(() => {});
        }
        return !(await tx('readonly', s => s.get(k)).catch(() => null))?.bytes?.length;
      },
      async wipeAll() {
        let keys = [];
        try { keys = await tx('readonly', s => s.getAllKeys()); } catch (_) {}
        try { await tx('readwrite', s => s.clear()); } catch (_) {
          for (const k of keys) await this.wipe(k);
        }
        let left = [];
        try { left = await tx('readonly', s => s.getAllKeys()); } catch (_) {}
        for (const k of left) await this.wipe(k);
        return true;
      },
    };
  })();

  // ------------------------------------------------- save keys and aliases
  // Saves are keyed by logbook number ("2.3"), not by file name, so two files for
  // the same logbook share one save and a renamed file keeps its students' work.
  // editor/aliases.json maps old keys or numbers to a new number ("keys") and
  // ?logbook= links to another number ("links"). Saves made under a file name
  // (before 2026-11-20) are moved to their number once, by migrateSaves().
  let aliases = { keys: {}, links: {} };
  const aliasesReady = fetch('../../editor/aliases.json', { cache: 'no-cache' })
    .then(r => r.ok ? r.json() : {})
    .then(j => { aliases = { keys: (j && j.keys) || {}, links: (j && j.links) || {} }; })
    .catch(() => {});
  function logbookId(key) {
    let k = String(key || '');
    k = aliases.keys[k] || k;
    const m = k.match(/^(\d+\.\d+)(?=[_ ]|$)/);
    if (m) k = m[1];
    return aliases.keys[k] || k;
  }
  const PREV = 'prev:';   // prev:<number>:<time> holds an older save of that logbook
  const hasBytes = r => !!(r && r.bytes && r.bytes.length);

  // Move every save to its logbook number. Nothing is deleted until the copy is
  // read back. When two saves meet, the newest becomes the save and the other is
  // kept as an older save the student can switch to.
  let migration;
  const migrateSaves = () => migration ||= (async () => {
    for (const k of await idb.keys()) {
      if (typeof k !== 'string' || k.startsWith(PREV)) continue;
      const target = logbookId(k);
      if (target === k) continue;
      const rec = await idb.get(k);
      if (!hasBytes(rec)) continue;
      const cur = await idb.get(target);
      let checks;
      if (!hasBytes(cur)) {
        await idb.put(target, rec);
        checks = [[target, rec]];
      } else {
        const recNewer = String(rec.time) > String(cur.time);
        const older = recNewer ? cur : rec, prevKey = `${PREV}${target}:${older.time}`;
        await idb.put(prevKey, older);
        checks = [[prevKey, older]];
        if (recNewer) { await idb.put(target, rec); checks.push([target, rec]); }
      }
      let ok = true;
      for (const [ck, want] of checks) {
        const got = await idb.get(ck);
        if (!hasBytes(got) || got.bytes.length !== want.bytes.length || got.time !== want.time) ok = false;
      }
      if (ok) await idb.del(k);
      else console.warn('[logbook] could not move save', k, '→', target);
    }
  })().catch(err => console.warn('[logbook] save migration', err));

  async function olderSaves(key) {
    const out = [];
    for (const k of await idb.keys()) {
      if (typeof k !== 'string' || !k.startsWith(`${PREV}${key}:`)) continue;
      const r = await idb.get(k);
      if (hasBytes(r)) out.push({ key: k, rec: r });
    }
    return out.sort((x, y) => String(y.rec.time).localeCompare(String(x.rec.time)));
  }

  async function autosaveNow(fromTransform = false) {
    const a = app(), doc = a && a.pdfDocument;
    if (!doc || !state.saveKey || doc !== state.doc) return; // id not (yet) for this document
    if ((state.busy && !fromTransform) || state.restorePending || state.otherTab || state.wiped) return;
    if (state.opCount === 0 && doc.annotationStorage.size === 0) return; // nothing changed yet
    const hash = doc.annotationStorage.serializable.hash + ':' + state.opCount;
    if (hash === state.lastHash) return;
    const id = state.saveKey;
    if (!fromTransform) state.busy = true;
    try {
      const bytes = await doc.saveDocument();
      if (a.pdfDocument !== doc || state.saveKey !== id) return;
      await idb.put(id, { bytes, time: nowIso(), filename: state.filename });
      state.lastHash = hash;
      setSaveBadge('Saved in this browser ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), 'ok');
    } catch (err) {
      console.warn('[logbook] autosave failed', err);
      setSaveBadge('Not saved. Export to keep your work.', 'warn');
    } finally {
      if (!fromTransform) state.busy = false;
    }
  }
  setInterval(autosaveNow, AUTOSAVE_MS);

  // No "leave site?" prompt: autosave keeps the work. pdf.js asks on its own once
  // a field changes; this capture listener on window is added before pdf.js
  // loads (this script runs first), so it runs first and stops pdf.js's.
  window.addEventListener('beforeunload', e => e.stopImmediatePropagation(), true);

  let badge;
  function setSaveBadge(text, tone = '') {
    if (!badge) return;
    badge.textContent = text;
    badge.dataset.tone = tone;
  }

  async function offerRestore() {
    document.querySelectorAll('.lb-restore').forEach(b => b.remove());
    state.restorePending = false;
    const id = state.saveKey, doc = state.doc;
    await migrateSaves();
    const rec = await idb.get(id);
    if (!hasBytes(rec) || state.doc !== doc) return;
    const older = (await olderSaves(id))[0];   // the newest older save, if any
    const fmt = t => new Date(t).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const label = fmt(rec.time);
    // Until the student chooses, autosave must not overwrite the stored work.
    state.restorePending = true;
    const done = () => { bar.remove(); state.restorePending = false; };
    const open = async bytes => {
      if (state.doc !== doc) return;
      try { await reopen(bytes); toast('Work restored.'); }
      catch (err) { toast('Could not restore: ' + err.message); }
    };
    const bar = $('div', { class: 'lb-restore', role: 'alert' },
      $('div', { class: 'lb-restore-text' }, $('strong', {}, 'Continue where you left off?'),
        $('span', {}, `This browser has your work on this logbook from ${label}.`)),
      $('button', { id: 'lbRestoreYes', type: 'button', class: 'lb-btn lb-primary', onclick: async () => {
        done(); await open(rec.bytes);
      } }, 'Restore my work'),
      older && $('button', { id: 'lbRestoreOlder', type: 'button', class: 'lb-btn', onclick: async () => {
        // Swap: the current save becomes an older save, so nothing is lost.
        done();
        try {
          await idb.put(`${PREV}${id}:${rec.time}`, rec);
          await idb.put(id, older.rec);
          await idb.del(older.key);
        } catch (err) { toast('Could not switch saves: ' + err.message); return; }
        await open(older.rec.bytes);
      } }, `Use older save (${fmt(older.rec.time)})`),
      $('button', { id: 'lbRestoreNo', type: 'button', class: 'lb-btn', onclick: async () => {
        if (!await askConfirm('Start fresh?',
          `Your saved work from ${label} will be deleted from this browser and cannot be recovered.`,
          'Start fresh')) return;
        done(); await idb.del(id);
      } }, 'Start fresh'));
    document.body.append(bar);
  }

  // ----------------------------------------------------------- reading
  // Sections and their sub-parts (subsection() in the templates), in page order.
  // A sub-part's title is "SECTION (Tasks ...) › Sub-part", so tags stay readable
  // on their own; `label` and `depth` are for the dropdown.
  async function readOutline(doc) {
    const out = [];
    const items = (await doc.getOutline()) || [];
    const walk = async (list, parent = null, depth = 0) => {
      for (const it of list) {
        let page = -1, top = null;
        try {
          let dest = it.dest;
          if (typeof dest === 'string') dest = await doc.getDestination(dest);
          if (Array.isArray(dest) && dest[0]) {
            page = typeof dest[0] === 'number' ? dest[0] : await doc.getPageIndex(dest[0]);
            if (dest[1] && dest[1].name === 'XYZ' && typeof dest[3] === 'number') top = dest[3];
          }
        } catch (_) {}
        const title = parent ? `${parent} › ${it.title}` : it.title;
        out.push({ title, label: it.title, depth, page, top });
        if (it.items && it.items.length) await walk(it.items, title, depth + 1);
      }
    };
    await walk(items);
    return out;
  }

  // Exercise for a page: the last section that starts on or before it.
  function exerciseForPage(pageIndex) {
    const pi = state.pageInfo[pageIndex];
    if (pi && pi.added && pi.exercise) return pi.exercise;
    let found = null;
    for (const e of state.exercises) if (e.page >= 0 && e.page <= pageIndex) found = e.title;
    return found || GENERAL;
  }

  const templateIndexOf = (ordinal) => {
    let n = -1;
    for (let i = 0; i < state.pageInfo.length; i++) {
      if (!state.pageInfo[i].added && ++n === ordinal) return i;
    }
    return -1;
  };
  // A template box is found by its template page; a box on an added page by that page's id.
  const slotPageIndex = slot => slot.pageId
    ? state.pageInfo.findIndex(p => p.id === slot.pageId) : templateIndexOf(slot.ordinal);

  async function analyse() {
    const a = app(), doc = a.pdfDocument;
    const bytes = await doc.getData();
    const pl = await PDFDocument.load(bytes, { updateMetadata: false });
    const info = pl.getInfoDict();
    const infoStr = k => {
      const v = info.lookup(PDFName.of(k));
      return v && v.decodeText ? v.decodeText() : null;
    };
    state.pageInfo = pl.getPages().map(p => {
      const added = p.node.lookup(PDFName.of(KEY.added)) === PDFBool.True;
      const kind = p.node.lookup(PDFName.of(KEY.kind));
      const ex = p.node.lookup(PDFName.of(KEY.exercise));
      const pid = p.node.lookup(PDFName.of(KEY.pageId));
      const text = v => v && v.decodeText ? v.decodeText() : null;
      return { added, kind: text(kind), exercise: text(ex), id: text(pid) };
    });
    state.id = infoStr(KEY.id) || (a._docFilename || 'logbook.pdf').replace(/\.pdf$/i, '').replace(/[_ ]edited$/i, '');
    state.saveKey = logbookId(state.id);
    const parse = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch (_) { return fallback; } };
    state.images = parse(infoStr(KEY.images), {});
    state.exercises = await readOutline(doc);

    const stored = parse(infoStr(KEY.slots), null);
    if (Array.isArray(stored)) {
      state.slots = stored;
    } else {
      // First open of a template: slots come from the img_* form fields.
      state.slots = [];
      // getFieldObjects() comes back empty in pdf.js 6 here, so read widgets per page.
      for (let p = 0; p < doc.numPages; p++) {
        const annots = await (await doc.getPage(p + 1)).getAnnotations({ intent: 'display' });
        for (const o of annots) {
          if (!o.fieldName || !o.fieldName.startsWith('img_') || !o.rect) continue;
          let ordinal = -1;
          for (let i = 0; i <= p; i++) if (!state.pageInfo[i].added) ordinal++;
          state.slots.push({ name: o.fieldName.slice(4), ordinal, rect: o.rect });
        }
      }
    }
    for (const s of state.slots) {
      if (s.pageId) continue;               // a box on an added page keeps the exercise it was made for
      s.exercise = s.exercise || exerciseAt(templateIndexOf(s.ordinal), Math.max(s.rect[1], s.rect[3]));
    }
  }

  // The section or sub-part that starts above a point (its top edge, in PDF
  // units) on a page, or earlier. Added pages carry their own.
  function exerciseAt(page, top) {
    const pi = state.pageInfo[page];
    if (pi && pi.added && pi.exercise) return pi.exercise;
    let found = null;
    for (const e of state.exercises) {
      if (e.page < 0) continue;
      if (e.page < page || (e.page === page && (e.top === null || e.top >= top))) found = e.title;
    }
    return found || GENERAL;
  }

  // ------------------------------------------------------------ rewriting
  // An exported log book opened again: its editable layer back in place, or
  // null when the file has none (not an export, or one from before parking).
  async function unparked(doc) {
    const info = (await doc.getMetadata().catch(() => null))?.info;
    // pdf.js does not pass custom Info keys on; the export's Producer and Keywords are standard ones.
    if (!/nb2420-logbook/.test(`${info?.Producer || ''} ${info?.Keywords || ''}`)) return null;
    const pl = await PDFDocument.load(await doc.getData(), { updateMetadata: false });
    const N = n => PDFName.of(n);
    const park = pl.catalog.lookup(N(PARK));
    if (!(park instanceof PDFDict)) return null;
    const own = park.lookup(N('PageCount'))?.asNumber?.() ?? pl.getPageCount();
    while (pl.getPageCount() > own) pl.removePage(pl.getPageCount() - 1);   // pages the overflow moved text to
    for (const page of pl.getPages()) {
      const p = page.node.lookup(N(PARK));
      if (!(p instanceof PDFDict)) continue;
      for (const k of ['Contents', 'Annots']) {
        const v = p.get(N(k));
        if (v) page.node.set(N(k), v); else page.node.delete(N(k));
      }
      page.node.delete(N(PARK));
    }
    const acro = park.get(N('AcroForm'));
    if (acro) pl.catalog.set(N('AcroForm'), acro);
    pl.catalog.delete(N(PARK));
    for (const k of ['LogbookExported', 'LogbookFields', 'Keywords']) pl.getInfoDict().delete(N(k));
    return pl.save({ updateFieldAppearances: false });
  }

  async function reopen(bytes) {
    const a = app();
    const page = a.pdfViewer.currentPageNumber;
    state.reopening = true;
    let timer;
    // Wait for the pages and for onDocumentLoaded to have read slots and tags.
    const pages = new Promise(r => a.eventBus.on('pagesloaded', r, { once: true }));
    const analysed = new Promise(r => { state.onAnalysed = r; });
    const timeout = new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error('the logbook took too long to reopen')), 60000);
    });
    try {
      await a.open({ data: bytes, filename: state.filename });
      await Promise.race([Promise.all([pages, analysed]), timeout]);
    } finally {
      clearTimeout(timer);
      state.onAnalysed = null;
    }
    a.pdfViewer.currentPageNumber = Math.min(page, a.pagesCount);
  }

  // Save the live viewer state, let `fn` change it with pdf-lib, reopen.
  async function transform(fn, targetPage) {
    const a = app();
    a.pdfViewer._layerProperties?.annotationEditorUIManager?.endCurrentEditing?.();
    while (state.busy) await new Promise(r => setTimeout(r, 50));
    state.busy = true;
    document.body.classList.add('lb-busy');
    try {
      const pl = await PDFDocument.load(await a.pdfDocument.saveDocument(), { updateMetadata: false });
      const result = await fn(pl);
      pl.setKeywords(['nb2420-logbook']);
      pl.getInfoDict().set(PDFName.of(KEY.id), PDFHexString.fromText(state.id));
      pl.getInfoDict().set(PDFName.of(KEY.slots), PDFHexString.fromText(JSON.stringify(
        state.slots.map(({ name, ordinal, pageId, rect, exercise }) => ({ name, ordinal, pageId, rect, exercise })))));
      pl.getInfoDict().set(PDFName.of(KEY.images), PDFHexString.fromText(JSON.stringify(state.images)));
      // pdf.js already wrote the field appearances (with fonts that cover Ω, µ, ...);
      // pdf-lib regenerating them with WinAnsi Helvetica would fail on those characters.
      const bytes = await pl.save({ updateFieldAppearances: false });
      state.opCount++;
      await reopen(bytes);  // busy stays set until the new document is up
      if (targetPage) app().pdfViewer.currentPageNumber = targetPage;
      await autosaveNow(true);
      return result;
    } catch (err) {
      console.error('[logbook]', err);
      toast('Something went wrong: ' + err.message);
    } finally {
      state.busy = false;
      document.body.classList.remove('lb-busy');
    }
  }

  const slotNM = name => 'nb2420-slot:' + name;

  function removeAnnotsByNM(page, nm) {
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) return;
    const keep = [];
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i);
      const d = page.doc.context.lookup(ref);
      const n = d instanceof PDFDict ? d.lookup(PDFName.of('NM')) : null;
      if (!(n && n.decodeText && n.decodeText() === nm)) keep.push(ref);
    }
    page.node.set(PDFName.of('Annots'), page.doc.context.obj(keep));
  }

  // The slot image is a Stamp annotation (not page content), so Replace and
  // Remove can take it out again cleanly.
  async function placeInSlot(slot, rec) {
    const pageIndex = slotPageIndex(slot);
    await transform(async pl => {
      const page = pl.getPage(pageIndex);
      removeAnnotsByNM(page, slotNM(slot.name));
      try { const f = pl.getForm().getField('img_' + slot.name); pl.getForm().removeField(f); } catch (_) {}
      if (!rec) { delete state.images['slot:' + slot.name]; return; }
      await stampImage(pl, page, slot, rec, pageIndex);
    }, pageIndex + 1);
  }

  // Put an image into a box as a Stamp annotation, centred and scaled to fit.
  async function stampImage(pl, page, slot, rec, pageIndex) {
      const [x1, y1, x2, y2] = slot.rect;
      const inset = 2;
      const fit = contain(rec.w, rec.h, (x2 - x1) - 2 * inset, (y2 - y1) - 2 * inset);
      const x = x1 + ((x2 - x1) - fit.w) / 2, y = y1 + ((y2 - y1) - fit.h) / 2;
      const img = await pl.embedJpg(rec.bytes);
      const ctx = pl.context;
      const ops = [pushGraphicsState(), ...opDrawImage('Im0', { x: 0, y: 0, width: fit.w, height: fit.h, rotate: degrees(0), xSkew: degrees(0), ySkew: degrees(0) }), popGraphicsState()];
      const ap = ctx.register(ctx.formXObject(ops, {
        BBox: [0, 0, fit.w, fit.h], Resources: { XObject: { Im0: img.ref } },
      }));
      const annot = ctx.register(ctx.obj({
        Type: 'Annot', Subtype: 'Stamp', Rect: [x, y, x + fit.w, y + fit.h], F: 4 | 128,
        NM: PDFString.of(slotNM(slot.name)),
        Contents: PDFHexString.fromText(ansi('Image for: ' + slot.exercise)),
        AP: { N: ap },
      }));
      page.node.addAnnot(annot);
      state.images['slot:' + slot.name] = { ...rec.meta, kind: 'slot', slot: slot.name, exercise: slot.exercise, page: pageIndex + 1 };
  }

  function markAdded(page, kind, exercise, pageId) {
    page.node.set(PDFName.of(KEY.added), PDFBool.True);
    if (pageId) page.node.set(PDFName.of(KEY.pageId), PDFHexString.fromText(pageId));
    page.node.set(PDFName.of(KEY.kind), PDFHexString.fromText(kind));
    if (exercise) page.node.set(PDFName.of(KEY.exercise), PDFHexString.fromText(exercise));
  }

  // Added pages always go at the end of the logbook (no reordering).
  // A text page is one big text field, so what is written on it stays readable by code.
  async function insertBlankPage() {
    const a = app();
    const at = a.pagesCount;
    const exercise = await askTextPage(exerciseForPage(a.pdfViewer.currentPageNumber - 1));
    if (!exercise) return;
    await transform(async pl => {
      const { width: W, height: H } = pl.getPage(0).getSize();
      const page = pl.insertPage(at, [W, H]);
      const bold = await pl.embedFont(StandardFonts.HelveticaBold);
      const regular = await pl.embedFont(StandardFonts.Helvetica);
      const M = 40;
      const head = ansi('Text for: ' + exercise);
      const headLines = wrapLines(head, bold, 12, W - 2 * M);
      headLines.forEach((ln, i) => ln && page.drawText(ln, { x: M, y: H - M - 12 - i * 15, size: 12, font: bold }));
      const subY = H - M - 12 - headLines.length * 15 - 2;
      page.drawText('Added page', { x: M, y: subY, size: 8, font: regular, color: rgb(0.45, 0.45, 0.45) });
      const id = 'added_text_' + Date.now().toString(36);
      const field = pl.getForm().createTextField(id);
      field.enableMultiline();
      const topGap = (H - subY) + 12;
      field.addToPage(page, { x: M, y: M, width: W - 2 * M, height: H - M - topGap, font: regular, borderWidth: 0.5,
                              borderColor: rgb(0.6, 0.6, 0.6), backgroundColor: rgb(0.97, 0.98, 0.98) });
      field.setFontSize(10);
      markAdded(page, 'text', exercise);
    }, at + 1);
  }

  // An image page holds a grid of image boxes (1 x 1 up to 3 across, 6 down)
  // and a notes box. The chosen images fill the boxes left to right, top to
  // bottom; each box can be filled, replaced or emptied later like any other.
  const GRID_MAX = { cols: 3, rows: 6 };
  async function insertImagePage() {
    const at = app().pagesCount;
    const choice = await askImagePage(exerciseForPage(app().pdfViewer.currentPageNumber - 1));
    if (!choice) return;
    const { exercise, cols, rows } = choice;
    const files = await getImageFiles();
    if (!files || !files.length) return;
    const recs = [];
    for (const file of files.slice(0, cols * rows)) {
      try { recs.push(await imageRecord(file)); }
      catch (err) { toast(`Could not read ${file.name} (${err.message}). Try a JPEG or PNG.`); }
    }
    if (!recs.length) return;
    if (files.length > cols * rows) toast(cols * rows === 1 ? 'Only the first image fits on this page.' : `Only the first ${cols * rows} images fit on this page.`);
    await transform(async pl => {
      const { width: W, height: H } = pl.getPage(0).getSize();
      const page = pl.insertPage(at, [W, H]);
      const bold = await pl.embedFont(StandardFonts.HelveticaBold);
      const regular = await pl.embedFont(StandardFonts.Helvetica);
      const M = 40, notesH = rows > 3 ? 90 : 120, gap = 8;
      const head = ansi('Image for: ' + exercise);
      const headLines = wrapLines(head, bold, 12, W - 2 * M);
      headLines.forEach((ln, i) => ln && page.drawText(ln, { x: M, y: H - M - 12 - i * 15, size: 12, font: bold }));
      const subY = H - M - 12 - headLines.length * 15 - 2;
      page.drawText('Added page', { x: M, y: subY, size: 8, font: regular, color: rgb(0.45, 0.45, 0.45) });
      const pageId = 'p' + Date.now().toString(36);
      const top = subY - 12, bottom = M + notesH + 24;
      const cw = (W - 2 * M - (cols - 1) * gap) / cols, ch = (top - bottom - (rows - 1) * gap) / rows;
      const cells = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const x = M + c * (cw + gap), y = top - (r + 1) * ch - r * gap;
        // the same box as an image box in the templates (logbook_common.typ image_slot)
        page.drawRectangle({ x, y, width: cw, height: ch, borderWidth: 0.5, borderColor: rgb(0.667, 0.667, 0.667), color: rgb(247 / 255, 249 / 255, 251 / 255) });
        const slot = { name: `${pageId}_r${r + 1}c${c + 1}`, pageId, rect: [x, y, x + cw, y + ch], exercise };
        state.slots.push(slot);
        cells.push(slot);
      }
      page.drawText('Notes:', { x: M, y: M + notesH + 6, size: 9, font: bold });
      const id = 'added_notes_' + Date.now().toString(36);
      const notes = pl.getForm().createTextField(id);
      notes.enableMultiline();
      notes.addToPage(page, { x: M, y: M, width: W - 2 * M, height: notesH, font: regular, borderWidth: 0.5, borderColor: rgb(0.6, 0.6, 0.6), backgroundColor: rgb(0.97, 0.98, 0.98) });
      notes.setFontSize(9);
      markAdded(page, 'image', exercise, pageId);
      for (let i = 0; i < recs.length; i++) await stampImage(pl, page, cells[i], recs[i], at);
    }, at + 1);
  }

  async function deleteCurrentPage() {
    const n = app().pdfViewer.currentPageNumber;
    const info = state.pageInfo[n - 1];
    if (!info || !info.added) return;
    if (!await askConfirm(`Delete page ${n}?`, 'This page and everything on it will be removed.', 'Delete page')) return;
    await transform(async pl => {
      // drop metadata of an image page's notes field on this page
      const page = pl.getPage(n - 1);
      const widgetIds = new Set();
      for (const f of pl.getForm().getFields()) {
        if (f.acroField.getWidgets().some(w => String(w.P && w.P()) === String(page.ref))) {
          widgetIds.add(f.getName());
          pl.getForm().removeField(f);
        }
      }
      for (const id of widgetIds) delete state.images['page:' + id];
      if (info.id) {                        // image boxes on this page, and their images
        for (const s of state.slots.filter(s => s.pageId === info.id)) delete state.images['slot:' + s.name];
        state.slots = state.slots.filter(s => s.pageId !== info.id);
      }
      pl.removePage(n - 1);
    }, Math.max(1, n - 1));
  }

  // ---------------------------------------------------------------- UI
  function modal(title, body, actions, label) {
    // actions: [{text, primary, danger, id, value}]; resolves with the chosen value (null on cancel)
    return new Promise(resolve => {
      const prev = document.activeElement;
      const close = v => { overlay.remove(); prev?.focus?.(); resolve(v); };
      const buttons = actions.map(x => $('button', {
        type: 'button', class: 'lb-btn' + (x.primary ? ' lb-primary' : '') + (x.danger ? ' lb-danger' : ''),
        ...(x.id ? { id: x.id } : {}), onclick: () => close(typeof x.value === 'function' ? x.value() : x.value) }, x.text));
      const dlg = $('div', { class: 'lb-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': label || title },
        $('h2', {}, title), ...body, $('div', { class: 'lb-modal-actions' }, ...buttons));
      const overlay = $('div', { class: 'lb-modal-backdrop', onclick: e => { if (e.target === overlay) close(null); } }, dlg);
      overlay.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.stopPropagation(); close(null); }
        if (e.key === 'Tab') { // keep focus inside the dialog
          const f = [...dlg.querySelectorAll('button, select, input, textarea')];
          const i = f.indexOf(document.activeElement);
          if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
          else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
        }
      });
      document.body.append(overlay);
      (dlg.querySelector('select, input') || buttons[buttons.length - 1]).focus();
    });
  }

  // Exercise and layout for a new image page. The layout picker works like
  // Word's insert-table grid: hover to preview, click to choose.
  // The exercise picker for added pages: sections, with their sub-parts indented.
  function exerciseSelect(preselect) {
    const seen = new Set(), opts = [];
    for (const e of [...state.exercises, { title: GENERAL, label: GENERAL, depth: 0 }]) {
      if (seen.has(e.title)) continue;
      seen.add(e.title);
      const o = $('option', { value: e.title }, '\u00a0\u00a0\u00a0\u00a0'.repeat(e.depth || 0) + (e.label || e.title));
      if (e.title === preselect) o.selected = true;
      opts.push(o);
    }
    return $('select', { class: 'lb-select', 'aria-label': 'Exercise' }, ...opts);
  }

  function askTextPage(preselect) {
    const select = exerciseSelect(preselect);
    return modal('Add text page', [
      $('p', { class: 'lb-modal-text' }, 'The text goes on a new page at the end.'),
      $('label', { class: 'lb-field' }, $('span', {}, 'Which exercise is it for?'), select)],
      [{ text: 'Cancel', value: null }, { text: 'Add page', primary: true, id: 'lbTextPageOk', value: () => select.value }]);
  }

  function askImagePage(preselect) {
    const select = exerciseSelect(preselect);
    let pick = { cols: 1, rows: 1 };
    const label = $('span', { class: 'lb-grid-label', 'aria-live': 'polite' });
    const grid = $('div', { class: 'lb-grid', role: 'grid', 'aria-label': 'Images on the page' });
    const show = (cols, rows) => {
      for (const cell of grid.children) {
        cell.classList.toggle('lb-on', +cell.dataset.c <= cols && +cell.dataset.r <= rows);
        cell.classList.toggle('lb-chosen', +cell.dataset.c === pick.cols && +cell.dataset.r === pick.rows);
      }
      const n = cols * rows;
      label.textContent = `${cols} × ${rows}: ${n} image${n > 1 ? 's' : ''}`;
    };
    for (let r = 1; r <= GRID_MAX.rows; r++) for (let c = 1; c <= GRID_MAX.cols; c++) {
      const cell = $('button', { type: 'button', class: 'lb-grid-cell', id: `lbGrid_${c}x${r}`, 'data-c': c, 'data-r': r,
        'aria-label': `${c} across, ${r} down`,
        onclick: () => { pick = { cols: c, rows: r }; show(c, r); } });
      cell.addEventListener('mouseenter', () => show(c, r));
      cell.addEventListener('focus', () => show(c, r));
      grid.append(cell);
    }
    grid.addEventListener('mouseleave', () => show(pick.cols, pick.rows));
    show(1, 1);
    return modal('Add image page', [
      $('p', { class: 'lb-modal-text' }, 'The images go on a new page at the end, with a box for notes. Choose several images at once to fill the grid.'),
      $('label', { class: 'lb-field' }, $('span', {}, 'Which exercise is it for?'), select),
      $('div', { class: 'lb-field' }, $('span', {}, 'How many images on the page?'), $('div', { class: 'lb-grid-wrap' }, grid, label))],
      [{ text: 'Cancel', value: null },
       { text: 'Choose images', primary: true, id: 'lbExerciseOk', value: () => ({ exercise: select.value, ...pick }) }]);
  }

  const askConfirm = (title, text, ok, danger = true) => modal(title, [$('p', { class: 'lb-modal-text' }, text)],
    [{ text: 'Cancel', value: false }, { text: ok, primary: true, danger, id: 'lbConfirmOk', value: true }]);

  // ------------------------------------------------------- flattened export
  // The hand-in PDF has no form fields or annotations left: every field value,
  // drawing, text box and image is painted into the page itself, so any PDF
  // reader or grading script sees it as ordinary page content.
  //
  // Form-field text is drawn here rather than taken from the viewer's
  // appearance streams: once a field holds a character outside WinAnsi
  // (Ω, µ, ...) pdf.js saves every field without an appearance. The text is set
  // in Liberation Sans (shipped with pdf.js), embedded as a subset.
  const SCRIPT_URL = (document.currentScript && document.currentScript.src) || location.href;
  let fieldFontBytes = null;
  async function loadFieldFont() {
    if (!window.fontkit) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = new URL('fontkit.umd.min.js', SCRIPT_URL).href;
        s.onload = resolve;
        s.onerror = () => reject(new Error('could not load the font tools'));
        document.head.append(s);
      });
    }
    if (!fieldFontBytes) {
      const r = await fetch(new URL('../pdfjs/web/standard_fonts/LiberationSans-Regular.ttf', SCRIPT_URL));
      if (!r.ok) throw new Error('could not load the font');
      fieldFontBytes = await r.arrayBuffer();
    }
    return fieldFontBytes;
  }

  // Lines as a textarea shows them: every space counts (leading and repeated
  // spaces too), a space at the end of a full line hangs there, and an empty
  // paragraph is an empty line.
  function wrapLines(text, font, size, width) {
    const out = [];
    for (const para of text.split('\n')) {
      let line = null;                                            // null: nothing on this line yet
      for (const word of para.split(' ')) {
        const tryLine = line === null ? word : line + ' ' + word;
        if (font.widthOfTextAtSize(tryLine, size) <= width) { line = tryLine; continue; }
        if (word === '') continue;                                // extra space at a line end
        if (line) out.push(line);
        line = '';
        let piece = '';
        for (const ch of word) {                                  // words longer than the box
          if (font.widthOfTextAtSize(piece + ch, size) > width && piece) { out.push(piece); piece = ''; }
          piece += ch;
        }
        line = piece;
      }
      out.push(line ?? '');
    }
    return out;
  }

  // Text fitting, shared by the export and the live hints. Boxes never grow:
  // text is drawn at the box's own size, and only shrinks when the student
  // picks that, never below MIN_PT.
  const MIN_PT = 6, PAD = 2, LEAD = 1.2;
  const boxOf = rect => {
    const x1 = Math.min(rect[0], rect[2]), x2 = Math.max(rect[0], rect[2]);
    const y1 = Math.min(rect[1], rect[3]), y2 = Math.max(rect[1], rect[3]);
    return { x1, x2, y1, y2, w: x2 - x1, h: y2 - y1 };
  };
  const daSize = da => parseFloat(((da || '').match(/([\d.]+)\s+Tf/) || [])[1]) || 0;
  const startSize = (ff, sizeDA, h) => sizeDA || ((ff & 4096) ? 10 : Math.min(12, (h - 2) / 1.2));
  const fitsAt = (font, text, multi, w, h, size, extraLines = 0) => multi
    ? (wrapLines(text, font, size, w - 2 * PAD).length + extraLines) * size * LEAD <= h - 2 * PAD
    : font.widthOfTextAtSize(text.replace(/\n/g, ' '), size) <= w - 2 * PAD;
  // Largest size from `start` down to MIN_PT (1 pt integer steps) at which the text fits; null if none.
  function fitSize(font, text, multi, w, h, start, extraLines = 0) {
    if (fitsAt(font, text, multi, w, h, start, extraLines)) return start;
    for (let s = Math.floor(start) - (Math.floor(start) === start ? 1 : 0); s >= MIN_PT; s -= 1) {
      if (fitsAt(font, text, multi, w, h, s, extraLines)) return s;
    }
    return null;
  }
  // Where a too-long answer is cut: after the last ".", "!", "?" or line break whose text
  // still fits (leaving `extraLines` free for the reference); else the last space; else 0.
  // A longer start never fits better than a shorter one, so a binary search
  // finds the last cut that fits: a handful of tries instead of one per word,
  // which kept long answers from freezing the page on every keystroke and zoom.
  function splitPoint(font, text, w, h, size, extraLines) {
    const ok = n => fitsAt(font, text.slice(0, n).trimEnd(), true, w, h, size, extraLines);
    const lastOk = cuts => {
      let lo = 0, hi = cuts.length - 1, best = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (ok(cuts[mid])) { best = cuts[mid]; lo = mid + 1; } else hi = mid - 1;
      }
      return best;
    };
    return lastOk([...text.matchAll(/[.!?](?=\s|$)|\n/g)].map(m => m.index + 1))
      || lastOk([...text.matchAll(/\s+/g)].map(m => m.index));
  }

  function drawFieldText(page, font, charset, rect, value, da, ff, q, opts = {}) {
    const { x1, x2, y1, y2, w, h } = boxOf(rect);
    const text = [...value.replace(/\r\n?/g, '\n')]
      .map(c => (c === '\n' || charset.has(c.codePointAt(0))) ? c : '?').join('');
    let color = rgb(0, 0, 0);
    const mRgb = da.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/), mG = da.match(/([\d.]+)\s+g(\s|$)/);
    if (mRgb) color = rgb(+mRgb[1], +mRgb[2], +mRgb[3]); else if (mG) color = rgb(+mG[1], +mG[1], +mG[1]);
    const xFor = (line, size) => {
      const tw = font.widthOfTextAtSize(line, size);
      return q === 1 ? x1 + (w - tw) / 2 : q === 2 ? x2 - PAD - tw : x1 + PAD;
    };
    const start = startSize(ff, daSize(da), h);
    const red = rgb(0.75, 0, 0);
    if (ff & 4096) {                                              // multi-line
      const size = opts.size || fitSize(font, text, true, w, h, start, opts.ref ? 1 : 0) || MIN_PT;
      const lines = text ? wrapLines(text, font, size, w - 2 * PAD) : [];
      const yAt = i => y2 - PAD - size * (0.9 + LEAD * i);
      lines.forEach((line, i) => {
        if (line && yAt(i) >= y1) page.drawText(line, { x: xFor(line, size), y: yAt(i), size, font, color });
      });
      if (opts.ref) {
        const rs = Math.min(9, size);
        page.drawText(opts.ref, { x: x1 + PAD, y: Math.max(y1 + PAD, yAt(lines.length) + (size - rs) * 0.9), size: rs, font, color: red });
      }
    } else {
      const line = text.replace(/\n/g, ' ');
      const size = opts.size || fitSize(font, line, false, w, h, start) || MIN_PT;
      page.drawText(line, { x: xFor(line, size), y: y1 + h / 2 - size * 0.35, size, font, color });
    }
  }

  // Ask once, on export, what to do with every answer that does not fit its box.
  // Resolves to {name: 'all' | 'overflow' | 'shrink'} or null on cancel.
  function askOverflow(items) {
    const picked = Object.fromEntries(items.map(it => [it.name, 'overflow']));
    const table = $('div', { class: 'lb-overflow-table' },
      $('div', { class: 'lb-ov-head' },
        $('span', {}, 'Question'),
        $('span', {}, 'Move the rest'),
        $('span', {}, 'Move all'),
        $('span', {}, 'Shrink text')));
    for (const it of items) {
      const rowBtns = [];
      const optDefs = [
        ['overflow', 'Move the rest', 'lb-ov-overflow', false],
        ['all', 'Move all', 'lb-ov-all', false],
        ['shrink', it.shrinkTo ? `Shrink (${it.shrinkTo} pt)` : 'Too long to shrink', 'lb-ov-shrink', !it.shrinkTo],
      ];
      for (const [val, label, cls, isDisabled] of optDefs) {
        const b = $('button', {
          type: 'button',
          class: `lb-ov-btn ${cls}` + (picked[it.name] === val ? ' lb-on' : ''),
          'data-field': it.name,
          'data-choice': val,
          'aria-pressed': String(picked[it.name] === val),
          onclick: () => {
            picked[it.name] = val;
            for (const rb of rowBtns) {
              const active = rb.dataset.choice === val;
              rb.classList.toggle('lb-on', active);
              rb.setAttribute('aria-pressed', String(active));
            }
          },
        }, label);
        if (isDisabled) b.disabled = true;
        rowBtns.push(b);
      }
      table.append($('div', { class: 'lb-ov-row' },
        $('div', { class: 'lb-ov-q' },
          $('strong', {}, it.label),
          $('span', {}, it.extra ? `page ${it.page} · ${it.extra} characters too many` : `page ${it.page}`)),
        ...rowBtns));
    }
    return modal('Some answers are too long', [
      $('p', { class: 'lb-modal-text' }, 'Boxes can\'t grow. Choose what to do with each answer. ' +
        'Moved text goes to an extra page at the end, after a full stop or a new line. The box says where it continues.'),
      table],
      [{ text: 'Cancel', value: null },
       { text: 'Export', primary: true, id: 'lbOverflowOk', value: () => ({ ...picked }) }],
      'Answers that do not fit');
  }

  async function flattenedBytes(decide = askOverflow) {
    const a = app();
    a.pdfViewer._layerProperties?.annotationEditorUIManager?.endCurrentEditing?.();
    const fontBytes = await loadFieldFont();
    const pl = await PDFDocument.load(await a.pdfDocument.saveDocument(), { updateMetadata: false });
    pl.registerFontkit(window.fontkit);
    const font = await pl.embedFont(fontBytes, { subset: true });
    const charset = new Set(font.getCharacterSet());
    const ctx = pl.context;
    const N = n => PDFName.of(n);
    const nums = arr => (arr instanceof PDFArray) ? arr.asArray().map(x => ctx.lookup(x).asNumber()) : null;
    const inherit = (d, key) => {
      for (let n = d, i = 0; n instanceof PDFDict && i < 20; n = n.lookup(N('Parent')), i++) {
        const v = n.lookup(N(key)); if (v !== undefined) return v;
      }
      return undefined;
    };
    const acro = pl.catalog.lookup(N('AcroForm'));
    const daDefault = acro instanceof PDFDict && acro.lookup(N('DA'));
    const textOf = v => (v && v.decodeText) ? v.decodeText() : '';
    const fieldName = d => {
      const parts = [];
      for (let n = d, i = 0; n instanceof PDFDict && i < 20; n = n.lookup(N('Parent')), i++) {
        const t = n.lookup(N('T')); if (t && t.decodeText) parts.unshift(t.decodeText());
      }
      return parts.join('.');
    };
    // Invisible labels: text in render mode 3 (not painted), which text
    // extraction (pypdf, pdfplumber, PyMuPDF, pdftotext) still returns. Every
    // answer is wrapped as [[NB2420:field name="…"]] value [[/NB2420:field]].
    const fontKey = n => n.node.newFontDictionary(font.name, font.ref);
    const safe = s => [...String(s).replace(/[\r\n]+/g, ' ')]
      .map(c => charset.has(c.codePointAt(0)) ? c : '?').join('');
    const label = (page, key, str, x, y) => page.pushOperators(
      beginText(), setFontAndSize(key, 4), setTextRenderingMode(TextRenderingMode.Invisible),
      setTextMatrix(1, 0, 0, 1, x, y), showText(font.encodeText(safe(str))),
      setTextRenderingMode(TextRenderingMode.Fill), endText());   // Tr is text state and survives ET: reset or the answers drawn next are invisible too
    const attr = (k, v) => v === undefined || v === null || v === '' ? '' : ` ${k}="${String(v).replace(/"/g, "'")}"`;   // swap quotes inside values only, so the label syntax keeps its own
    const exact = { pages: [], fields: {}, checks: {}, images: {}, overflow: {} };   // the same, verbatim, in the Info dict
    const texts = [];                                             // drawn after all pages, once overflow is decided
    const slotMeta = name => state.images['slot:' + name] || {};
    const imageLabel = (slot, m) => `[[NB2420:image slot="${slot}" filled="yes"${attr('exercise', m.exercise)}` +
      `${attr('file', m.original_filename)}${attr('sha256', m.sha256)}${attr('sha512', m.sha512)}]]`;

    const ownPages = pl.getPageCount();
    const copyOf = v => { const o = v && ctx.lookup(v); return o instanceof PDFArray ? ctx.obj(o.asArray()) : v; };
    for (const page of pl.getPages()) {
      const parked = {};
      for (const k of ['Contents', 'Annots']) if (page.node.get(N(k))) parked[k] = copyOf(page.node.get(N(k)));
      page.node.set(N(PARK), ctx.obj(parked));
    }
    let loose = 0;
    for (const [pageIndex, page] of pl.getPages().entries()) {
      const key = fontKey(page);
      const { height: PH } = page.getSize();
      const info = state.pageInfo[pageIndex] || {};
      label(page, key, `[[NB2420:page n="${pageIndex + 1}"${attr('kind', info.added ? info.kind : 'template')}${attr('exercise', info.exercise)}]]`, 2, PH - 6);
      exact.pages.push({ n: pageIndex + 1, kind: info.added ? info.kind : 'template', exercise: info.exercise || null });
      const annots = page.node.lookup(N('Annots'));
      const list = annots instanceof PDFArray ? annots : ctx.obj([]);
      const keep = [], ops = [], labels = [];
      for (let i = 0; i < list.size(); i++) {
        const ref = list.get(i);
        const d = ctx.lookup(ref);
        if (!(d instanceof PDFDict)) continue;
        const sub = String(d.lookup(N('Subtype')) || '');
        if (sub === '/Link') { keep.push(ref); continue; }        // bookmarks and links keep working
        if (sub === '/Popup') continue;
        const flags = d.lookup(N('F')); const f = flags ? flags.asNumber() : 0;
        if (f & 2 || f & 32) continue;                            // hidden / no-view
        const rectHere = nums(d.lookup(N('Rect')));
        const top = r => [Math.min(r[0], r[2]), Math.max(r[1], r[3]) - 4];
        if (sub === '/Widget' && fieldName(d).startsWith('img_')) {         // image slot left empty
          const slot = fieldName(d).slice(4);
          exact.images[slot] = null;
          if (rectHere) labels.push([`[[NB2420:image slot="${slot}" filled="no"]]`, ...top(rectHere)]);
          continue;
        }
        if (sub === '/Widget' && String(inherit(d, 'FT')) === '/Tx') {      // text field: draw its value
          const value = textOf(inherit(d, 'V'));
          const ffv = inherit(d, 'Ff'), qv = inherit(d, 'Q');
          const ff = ffv ? ffv.asNumber() : 0;
          if (rectHere && !(ff & 8192)) {
            const name = fieldName(d);
            exact.fields[name] = value;
            texts.push({ page, key, rect: rectHere, value, da: textOf(inherit(d, 'DA') || daDefault), ff, q: qv ? qv.asNumber() : 0,
              name, label: textOf(inherit(d, 'TU')) || name, pageNo: pageIndex + 1 });
            const pm = state.images['page:' + name];                         // notes field of an image page
            if (pm) {
              exact.images['page:' + name] = pm;
              labels.push([imageLabel('page:' + name, pm), Math.min(rectHere[0], rectHere[2]), Math.max(rectHere[1], rectHere[3]) + 14]);
            }
          }
          continue;
        }
        if (sub === '/Widget' && String(inherit(d, 'FT')) === '/Btn') {     // checkbox / radio
          const name = fieldName(d), as = d.lookup(N('AS'));
          const on = !!as && String(as) !== '/Off';
          exact.checks[name] = on ? String(as).slice(1) : null;
          if (rectHere) labels.push([`[[NB2420:check name="${name}" checked="${on ? 'yes' : 'no'}"]]`, ...top(rectHere)]);
        }
        const nm = textOf(d.lookup(N('NM')));
        if (nm.startsWith('nb2420-slot:') && rectHere) {                 // image in a slot
          const slot = nm.slice('nb2420-slot:'.length), m = slotMeta(slot);
          exact.images[slot] = m;
          labels.push([imageLabel(slot, m), ...top(rectHere)]);
        } else if (sub === '/Stamp' && rectHere) {                       // image dragged or pasted onto the page
          const id = `loose:${pageIndex + 1}-${++loose}`;
          const m = { kind: 'loose', page: pageIndex + 1, exercise: exerciseAt(pageIndex, Math.max(rectHere[1], rectHere[3])),
            rect: rectHere.map(v => Math.round(v * 10) / 10) };
          exact.images[id] = m;
          labels.push([`[[NB2420:image loose="${id.slice(6)}" filled="yes"${attr('exercise', m.exercise)}]]`, ...top(rectHere)]);
        }
        const ap = d.lookup(N('AP'));
        if (!(ap instanceof PDFDict)) continue;
        let apRef = ap.get(N('N')), n = ctx.lookup(apRef);
        if (n instanceof PDFDict) {                               // on/off states (checkboxes)
          const as = d.lookup(N('AS'));
          if (!as) continue;
          apRef = n.get(as); n = ctx.lookup(apRef);
        }
        if (!(n instanceof PDFStream)) continue;
        if (!(apRef instanceof PDFRef)) apRef = ctx.register(n);
        const bbox = nums(n.dict.lookup(N('BBox'))), rect = nums(d.lookup(N('Rect')));
        if (!bbox || !rect) continue;
        const m = nums(n.dict.lookup(N('Matrix'))) || [1, 0, 0, 1, 0, 0];
        // Map the appearance box (after its own Matrix) onto the annotation rectangle.
        const pts = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[0], bbox[3]], [bbox[2], bbox[3]]]
          .map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
        const bx1 = Math.min(...pts.map(p => p[0])), bx2 = Math.max(...pts.map(p => p[0]));
        const by1 = Math.min(...pts.map(p => p[1])), by2 = Math.max(...pts.map(p => p[1]));
        const rx1 = Math.min(rect[0], rect[2]), rx2 = Math.max(rect[0], rect[2]);
        const ry1 = Math.min(rect[1], rect[3]), ry2 = Math.max(rect[1], rect[3]);
        if (bx2 - bx1 < 1e-6 || by2 - by1 < 1e-6) continue;
        const sx = (rx2 - rx1) / (bx2 - bx1), sy = (ry2 - ry1) / (by2 - by1);
        const name = page.node.newXObject('Flat', apRef);
        ops.push(pushGraphicsState(), concatTransformationMatrix(sx, 0, 0, sy, rx1 - sx * bx1, ry1 - sy * by1),
          drawObject(name), popGraphicsState());
      }
      if (keep.length) page.node.set(N('Annots'), ctx.obj(keep)); else page.node.delete(N('Annots'));
      if (ops.length) page.pushOperators(...ops);
      for (const [str, x, y] of labels) label(page, key, str, x, y);
    }

    // Answers that do not fit their (fixed) box: ask once, then move or shrink.
    const clean = v => [...v.replace(/\r\n?/g, '\n')].map(c => (c === '\n' || charset.has(c.codePointAt(0))) ? c : '?').join('');
    const over = [];
    for (const t of texts) {
      if (!(t.ff & 4096) || !t.value.trim()) continue;
      const b = boxOf(t.rect), txt = clean(t.value), start = startSize(t.ff, daSize(t.da), b.h);
      if (fitsAt(font, txt, true, b.w, b.h, start)) continue;
      // Same rule as the live view: at the box's own size, the part that does not
      // fit (the yellow part) moves. Shrinking is the student's choice, offered
      // when the whole answer fits at MIN_PT or larger.
      const shrinkTo = fitSize(font, txt, true, b.w, b.h, start);
      const cut = splitPoint(font, txt, b.w, b.h, start, 1);
      Object.assign(t, { txt, cut });
      over.push({ name: t.name, label: t.label, page: t.pageNo, extra: txt.length - cut, shrinkTo, t });
    }
    const choice = over.length ? await decide(over) : {};
    if (!choice) return null;                                     // export cancelled
    const [PW, PH0] = (() => { const s = pl.getPage(0).getSize(); return [s.width, s.height]; })();
    const M = 50, BS = 10.5, grey = rgb(0.35, 0.35, 0.35);
    for (const o of over) {
      let c = choice[o.name] || 'overflow';
      if (c === 'shrink' && !o.shrinkTo) c = 'overflow';
      if (c === 'shrink') { o.t.opts = { size: o.shrinkTo }; exact.overflow[o.name] = { choice: c, size: o.shrinkTo }; continue; }
      const kept = c === 'all' ? '' : o.t.txt.slice(0, o.t.cut).trimEnd();
      const moved = c === 'all' ? o.t.txt : o.t.txt.slice(o.t.cut).trimStart();
      const first = pl.getPageCount() + 1, pages = [];
      let pg, key, y;
      const newPage = () => {
        pg = pl.addPage([PW, PH0]); key = fontKey(pg);
        const n = pl.getPageCount(); pages.push(n);
        label(pg, key, `[[NB2420:page n="${n}" kind="overflow"${attr('field', o.name)}]]`, 2, PH0 - 6);
        exact.pages.push({ n, kind: 'overflow', exercise: exerciseAt(o.t.pageNo - 1, Math.max(o.t.rect[1], o.t.rect[3])), field: o.name });
        y = PH0 - M;
      };
      newPage();
      const headLines = wrapLines(safe(`Continued from: ${o.label} (page ${o.page})`), font, 14, PW - 2 * M);
      headLines.forEach((ln, i) => ln && pg.drawText(ln, { x: M, y: y - 14 - i * 18, size: 14, font }));
      y -= 16 + headLines.length * 18;
      pg.drawText(c === 'all' ? 'The whole answer was moved here because it did not fit its box.'
        : 'The end of this answer was moved here because it did not fit its box.', { x: M, y, size: 9, font, color: grey });
      y -= 24;
      label(pg, key, `[[NB2420:overflow name="${o.name}"]]`, M, y + BS);
      for (const line of wrapLines(moved, font, BS, PW - 2 * M)) {
        if (y < M) { newPage(); y -= BS; }
        if (line) pg.drawText(line, { x: M, y, size: BS, font });
        y -= BS * LEAD;
      }
      label(pg, key, '[[/NB2420:overflow]]', M, Math.max(4, y));
      o.t.value = kept;
      o.t.opts = { ref: c === 'all' ? `Full text on page ${first}` : `(continued on page ${first})` };
      exact.overflow[o.name] = { choice: c, pages, moved };
    }
    for (const t of texts) {
      const { x1, x2, y1, y2 } = boxOf(t.rect);
      label(t.page, t.key, `[[NB2420:field name="${t.name}"]]`, x1, y2 - 4);
      if (t.value.trim() || t.opts?.ref) drawFieldText(t.page, font, charset, t.rect, t.value, t.da, t.ff, t.q, t.opts || {});
      label(t.page, t.key, '[[/NB2420:field]]', x2 - 20, y1 + 1);
    }
    const acroRef = pl.catalog.get(N('AcroForm'));
    pl.catalog.set(N(PARK), ctx.obj({ Version: 1, PageCount: ownPages, ...(acroRef ? { AcroForm: acroRef } : {}) }));
    pl.catalog.delete(N('AcroForm'));
    pl.setKeywords(['nb2420-logbook']);
    pl.setProducer('nb2420-logbook editor');
    if (state.id) pl.getInfoDict().set(N(KEY.id), PDFHexString.fromText(state.id));
    pl.getInfoDict().set(N('LogbookExported'), PDFHexString.fromText(nowIso()));
    pl.getInfoDict().set(N('LogbookFields'), PDFHexString.fromText(JSON.stringify(exact)));
    return pl.save({ updateFieldAppearances: false });
  }

  function downloadBytes(bytes, name) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const link = $('a', { href: url, download: name, class: 'lb-hidden-input' });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function exportPdf() {
    if (!app()?.pdfDocument) return;
    if (state.busy) { toast('Still preparing your PDF…', 3000); return; }
    state.busy = true;
    document.body.classList.add('lb-busy');
    setSaveBadge('Preparing your PDF…');
    try {
      const bytes = await flattenedBytes();
      if (!bytes) { setSaveBadge('Export cancelled', 'warn'); return; }
      downloadBytes(bytes, (state.id || 'logbook') + '.pdf');
      setSaveBadge('Exported ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), 'ok');
      toast('Exported. Hand in this PDF on Brightspace. You can come back to change it and export again.', 7000);
    } catch (err) {
      console.error('[logbook] export failed', err);
      setSaveBadge('Export failed', 'warn');
      toast('Export failed: ' + err.message, 8000);
    } finally {
      state.busy = false;
      document.body.classList.remove('lb-busy');
    }
  }

  function svgIcon(path) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('aria-hidden', 'true');
    s.innerHTML = path;
    return s;
  }
  const S = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
  const ICONS = {
    prev: `<path ${S} d="M12.5 4.5 7 10l5.5 5.5"/>`,
    next: `<path ${S} d="M7.5 4.5 13 10l-5.5 5.5"/>`,
    minus: `<path ${S} d="M5 10h10"/>`,
    plus: `<path ${S} d="M10 5v10M5 10h10"/>`,
    select: `<path ${S} d="M5 3.5l10 6.2-4.4 1.1-2.1 4.2z"/>`,
    draw: `<path ${S} d="M13.5 3.8l2.7 2.7-8.8 8.8-3.6.9.9-3.6z"/><path ${S} d="M11.6 5.7l2.7 2.7"/>`,
    blank: `<path ${S} d="M5 2.8h6.5l3.5 3.5v10.9H5z"/><path ${S} d="M10 9v5M7.5 11.5h5"/>`,
    imagePage: `<path ${S} d="M5 2.8h6.5l3.5 3.5v10.9H5z"/><path ${S} d="M6.8 15l2.4-2.6 1.8 1.7 1.3-1.2 1.4 1.5"/><circle cx="8.6" cy="9.4" r="1" fill="currentColor"/>`,
    trash: `<path ${S} d="M4 6h12M8 6V4h4v2M5.5 6l.8 10.5h7.4L14.5 6"/>`,
    export: `<path ${S} d="M10 3.5v9M6.3 8.8 10 12.5l3.7-3.7M4 15v1.5h12V15"/>`,
    shield: `<path ${S} d="M10 2.8l5.8 2.2v4.6c0 3.6-2.5 6.3-5.8 7.6-3.3-1.3-5.8-4-5.8-7.6V5z"/><path ${S} d="M7.6 10l1.7 1.7 3.2-3.4"/>`,
    pages: `<rect ${S} x="3" y="3.5" width="14" height="13" rx="1.5"/><path ${S} d="M7.5 3.5v13"/>`,
    more: '<circle cx="5" cy="10" r="1.4" fill="currentColor"/><circle cx="10" cy="10" r="1.4" fill="currentColor"/><circle cx="15" cy="10" r="1.4" fill="currentColor"/>',
  };
  const icon = name => { const s = svgIcon(ICONS[name]); s.setAttribute('viewBox', '0 0 20 20'); return s; };

  // pdf.js editor modes and their parameters (see AnnotationEditorType / ParamsType in pdf.mjs)
  // Only Select and Draw: free text boxes, highlights and stamps put loose
  // content anywhere on a page, which code reading the export cannot place.
  const MODE = { NONE: 0, INK: 15 };
  const PARAM = { INK_COLOR: 21, INK_THICKNESS: 22 };
  const STYLE = {
    [MODE.INK]: { colorParam: PARAM.INK_COLOR, colors: ['#1d1d1f', '#1f5fd1', '#c8321e', '#178a4c'],
                  sizeParam: PARAM.INK_THICKNESS, sizes: [[1, 'S'], [2, 'M'], [4, 'L']] },
  };
  const chosen = {}; // per mode: {color, size}

  const ui = {};
  function buildBar() {
    if (document.getElementById('lbBar')) return;
    const outer = document.getElementById('outerContainer');
    if (!outer) return;
    const btn = (id, label, iconName, onclick, opts = {}) => {
      const b = $('button', { id, type: 'button', class: 'lb-tb' + (opts.cls ? ' ' + opts.cls : ''), title: opts.title || label, 'aria-label': label, onclick });
      if (iconName) b.append(icon(iconName));
      if (opts.text) b.append($('span', { class: 'lb-tb-label' }, opts.text));
      return b;
    };
    const a = () => app();

    ui.title = $('div', { class: 'lb-title' }, $('span', { class: 'lb-mark' }, 'NB2420'), $('span', { class: 'lb-name' }, 'Logbook'));
    ui.pageInput = $('input', { id: 'lbPageNumber', class: 'lb-page-input', type: 'text', inputmode: 'numeric', 'aria-label': 'Page number', value: '1' });
    ui.pageInput.addEventListener('change', () => {
      const n = parseInt(ui.pageInput.value, 10);
      if (n >= 1 && n <= a().pagesCount) a().pdfViewer.currentPageNumber = n; else syncPage();
    });
    ui.pageInput.addEventListener('focus', () => ui.pageInput.select());
    ui.pageCount = $('span', { class: 'lb-page-count' }, '/ 1');
    ui.zoom = $('span', { class: 'lb-zoom-value', id: 'lbZoomValue' }, '100%');
    const nav = $('div', { class: 'lb-group', role: 'group', 'aria-label': 'Pages' },
      btn('lbPrev', 'Previous page', 'prev', () => a().pdfViewer.previousPage()),
      ui.pageInput, ui.pageCount,
      btn('lbNext', 'Next page', 'next', () => a().pdfViewer.nextPage()));
    const zoom = $('div', { class: 'lb-group lb-hide-sm', role: 'group', 'aria-label': 'Zoom' },
      btn('lbZoomOut', 'Zoom out', 'minus', () => a().pdfViewer.decreaseScale()),
      $('button', { id: 'lbZoomFit', type: 'button', class: 'lb-tb lb-zoom-btn', title: 'Fit to width', 'aria-label': 'Fit to width',
                    onclick: () => { a().pdfViewer.currentScaleValue = 'page-width'; } }, ui.zoom),
      btn('lbZoomIn', 'Zoom in', 'plus', () => a().pdfViewer.increaseScale()));

    ui.tools = {};
    const tool = (mode, id, label, iconName) => {
      const b = btn(id, label, iconName, () => setMode(ui.mode === mode && mode !== MODE.NONE ? MODE.NONE : mode),
        { cls: 'lb-tool', text: label });
      b.setAttribute('aria-pressed', 'false');
      ui.tools[mode] = b;
      return b;
    };
    const toolGroup = $('div', { class: 'lb-group lb-tools', role: 'toolbar', 'aria-label': 'Tools' },
      tool(MODE.NONE, 'lbToolSelect', 'Select', 'select'),
      tool(MODE.INK, 'lbToolDraw', 'Draw', 'draw'));
    ui.style = $('div', { class: 'lb-group lb-style', role: 'group', 'aria-label': 'Colour and size', hidden: '' });
    // colours and sizes float under the tools, so the bar never changes height
    const tools = $('div', { class: 'lb-tools-wrap' }, toolGroup, ui.style);

    ui.del = btn('lbDeletePage', 'Delete this page', 'trash', deleteCurrentPage, { cls: 'lb-danger-ghost', text: 'Delete page' });
    const pages = $('div', { class: 'lb-group', role: 'group', 'aria-label': 'Add pages' },
      btn('lbInsertImagePage', 'Add image page at the end', 'imagePage', insertImagePage, { text: 'Image page' }),
      btn('lbInsertBlank', 'Add a text page at the end', 'blank', insertBlankPage, { text: 'Text page' }),
      ui.del);

    badge = $('span', { id: 'lbSaveBadge', class: 'lb-status', role: 'status' }, '');
    ui.exportBtn = btn('lbExport', 'Export PDF to hand in', 'export', exportPdf, { cls: 'lb-export', text: 'Export PDF' });
    ui.menu = $('div', { class: 'lb-menu', role: 'menu', hidden: '' });
    const menuItem = (id, label, fn) => $('button', { id, type: 'button', class: 'lb-menu-item', role: 'menuitem',
      onclick: () => { closeMenu(); fn(); } }, label);
    ui.menu.append(
      menuItem('lbMenuOpen', 'Open a saved copy…', () => a().eventBus.dispatch('openfile', { source: window })),
      $('div', { class: 'lb-menu-sep' }),
      menuItem('lbMenuAll', 'All logbooks', () => { location.href = '../../index.html'; }));
    const moreBtn = btn('lbMore', 'More', 'more', e => { e.stopPropagation(); const open = ui.menu.hidden; closeMenu(); if (open) openMenu(); });
    moreBtn.setAttribute('aria-haspopup', 'menu');
    ui.pmenu = $('div', { class: 'lb-menu lb-privacy-menu', role: 'menu', hidden: '' },
      $('div', { class: 'lb-menu-note' }, 'Your work is stored only in this browser on this device.'),
      menuItem('lbClearThis', 'Delete saved work for this logbook…', () => clearSaved(false)),
      menuItem('lbClearAll', 'Delete saved work for all logbooks…', () => clearSaved(true)));
    ui.pmenu.querySelectorAll('.lb-menu-item').forEach(b => b.classList.add('lb-menu-danger'));
    const shieldBtn = btn('lbPrivacy', 'Privacy and stored data', 'shield', e => {
      e.stopPropagation(); const open = ui.pmenu.hidden; closeMenu(); if (open) { ui.pmenu.hidden = false; ui.pmenu.querySelector('button')?.focus(); }
    }, { cls: 'lb-privacy' });
    shieldBtn.setAttribute('aria-haspopup', 'menu');
    const right = $('div', { class: 'lb-right' }, badge, ui.exportBtn,
      $('div', { class: 'lb-menu-wrap' }, moreBtn, ui.menu),
      $('div', { class: 'lb-menu-wrap' }, shieldBtn, ui.pmenu));

    ui.sideBtn = btn('lbSidebar', 'Show or hide the page overview', 'pages', () => setSidebar(!side.open), { cls: 'lb-side-btn' });
    const bar = $('header', { id: 'lbBar' },
      $('div', { class: 'lb-row' }, ui.sideBtn, ui.title, nav, zoom, tools, pages, right));
    document.body.prepend(bar);
    document.body.classList.add('lb-custom');
    // pdf.js lays out the pages below var(--toolbar-height): make that our bar's height.
    const fit = () => {
      outer.style.setProperty('--toolbar-height', bar.offsetHeight + 'px');
      document.documentElement.style.setProperty('--lb-bar-h', bar.offsetHeight + 'px');
    };
    new ResizeObserver(fit).observe(bar); fit();
    // Rather than wrap to a second row, drop labels step by step until the bar
    // fits: tool labels, the save text (its dot stays), page button labels, the
    // logbook name. Every button keeps its tooltip. Phones may still wrap.
    const row = bar.firstElementChild, steps = ['lb-c1', 'lb-c2', 'lb-c3', 'lb-c4'];
    const wraps = () => { const kids = [...row.children].filter(k => k.offsetParent);
      return kids.some(k => k.offsetTop > kids[0].offsetTop + 8); };
    const compact = () => {
      bar.classList.remove(...steps);
      for (const s of steps) { if (!wraps()) break; bar.classList.add(s); }
    };
    let compactFrame = 0;
    const recompact = () => { cancelAnimationFrame(compactFrame); compactFrame = requestAnimationFrame(compact); };
    window.addEventListener('resize', recompact);
    new MutationObserver(recompact).observe(row, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
    recompact();
    buildSidebar();
    document.addEventListener('click', e => {
      if (!ui.menu.contains(e.target) && !ui.pmenu.contains(e.target)) closeMenu();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
    syncMode(MODE.NONE);
  }
  const openMenu = () => { ui.menu.hidden = false; ui.menu.querySelector('button')?.focus(); };
  const closeMenu = () => { if (ui.menu) ui.menu.hidden = true; if (ui.pmenu) ui.pmenu.hidden = true; };

  // Privacy: delete the work this browser keeps, after two confirmations.
  async function clearSaved(all) {
    const what = all ? 'all logbooks' : 'this logbook';
    if (!await askConfirm(`Delete saved work for ${what}?`,
      `This removes your work on ${what} from this browser. Anything you haven't exported is lost.`,
      'Continue')) return;
    if (!await askConfirm('Are you sure?',
      'You can\'t get it back. Close other logbook tabs first, or they will save it again.',
      all ? 'Delete everything' : 'Delete my work')) return;
    state.wiped = true;
    let ok = true;
    if (all) ok = await idb.wipeAll();
    else {
      // This logbook's save, its older saves, and any save not yet moved to its number.
      for (const k of await idb.keys()) {
        if (typeof k !== 'string') continue;
        if (k === state.saveKey || k.startsWith(`${PREV}${state.saveKey}:`) || (!k.startsWith(PREV) && logbookId(k) === state.saveKey))
          ok = (await idb.wipe(k)) && ok;
      }
    }
    toast(ok ? `Saved work for ${what} deleted. Reloading…` : 'Some saved work could not be removed.', 4000);
    if (ok) setTimeout(() => location.reload(), 1200);
  }

  function setMode(mode) {
    const a = app();
    if (!a?.pdfDocument) return;
    a.eventBus.dispatch('switchannotationeditormode', { source: window, mode });
  }
  function syncMode(mode) {
    ui.mode = mode;
    for (const [m, b] of Object.entries(ui.tools || {})) {
      const on = Number(m) === mode;
      b.classList.toggle('lb-on', on); b.setAttribute('aria-pressed', String(on));
    }
    buildStyle(mode);
  }
  const COLOR_NAMES = { '#1d1d1f': 'Black', '#1f5fd1': 'Blue', '#c8321e': 'Red', '#178a4c': 'Green' };
  function buildStyle(mode) {
    if (!ui.style) return;
    const st = STYLE[mode];
    ui.style.replaceChildren();
    ui.style.hidden = !st;
    if (!st) return;
    const c = chosen[mode] ||= { color: st.colors[0], size: st.sizes ? st.sizes[1][0] : null };
    const apply = () => {
      const bus = app().eventBus;
      bus.dispatch('switchannotationeditorparams', { source: window, type: st.colorParam, value: c.color });
      if (st.sizeParam) bus.dispatch('switchannotationeditorparams', { source: window, type: st.sizeParam, value: c.size });
      buildStyle(mode);
    };
    for (const col of st.colors) {
      const cname = COLOR_NAMES[col] || col;
      const s = $('button', { id: 'lbSwatch_' + cname.toLowerCase().replace(/[^a-z0-9]+/g, '_'), type: 'button',
        class: 'lb-swatch' + (col === c.color ? ' lb-on' : ''), title: cname, 'aria-label': 'Colour ' + cname,
        onclick: () => { c.color = col; apply(); } });
      s.style.setProperty('--sw', col);
      ui.style.append(s);
    }
    if (st.sizes) {
      ui.style.append($('span', { class: 'lb-style-sep' }));
      for (const [v, lab] of st.sizes) ui.style.append($('button', { id: 'lbSize_' + lab, type: 'button',
        class: 'lb-size' + (v === c.size ? ' lb-on' : ''), title: 'Size ' + lab, 'aria-label': 'Size ' + lab,
        onclick: () => { c.size = v; apply(); } }, lab));
    }
  }

  function syncPage() {
    const a = app();
    if (!ui.pageInput || !a?.pdfViewer) return;
    if (document.activeElement !== ui.pageInput) ui.pageInput.value = String(a.pdfViewer.currentPageNumber || 1);
    ui.pageCount.textContent = '/ ' + (a.pagesCount || 1);
  }
  function syncZoom() {
    const a = app();
    if (ui.zoom && a?.pdfViewer) ui.zoom.textContent = Math.round((a.pdfViewer.currentScale || 1) * 100) + '%';
  }
  function syncTitle() {
    if (!ui.title) return;
    const name = (state.id || 'Logbook').replace(/_logbook$/i, '').replace(/_/g, ' ');
    ui.title.querySelector('.lb-name').textContent = name;
    document.title = name + ' · NB2420 logbook';
  }

  // ----------------------------------------------------------- page sidebar
  // Our own page overview: pdf.js's sidebar also merges and reorders files,
  // which a logbook must not do. Thumbnails render when they scroll into view
  // (with what is typed and drawn so far); click one to go to that page.
  const SIDE_KEY = 'nb2420-sidebar', THUMB_W = 128;
  const side = { el: null, list: null, observer: null, open: false, doc: null, gen: 0 };
  const sideWanted = () => {
    try { const v = localStorage.getItem(SIDE_KEY); if (v) return v === 'open'; } catch (_) {}
    return innerWidth >= 1100;
  };
  function buildSidebar() {
    side.list = $('div', { class: 'lb-side-list' });
    side.el = $('nav', { id: 'lbSide', 'aria-label': 'Page overview' }, side.list);
    document.body.append(side.el);
    setSidebar(sideWanted(), false);
  }
  function setSidebar(open, remember = true) {
    side.open = open;
    document.body.classList.toggle('lb-side-open', open);
    side.el.inert = !open;
    ui.sideBtn?.setAttribute('aria-pressed', String(open));
    ui.sideBtn?.classList.toggle('lb-on', open);
    if (remember) { try { localStorage.setItem(SIDE_KEY, open ? 'open' : 'closed'); } catch (_) {} }
    if (open) fillSidebar();
    window.dispatchEvent(new Event('resize'));          // pdf.js fits the page to the new width
  }
  function fillSidebar() {
    const a = app(), doc = a?.pdfDocument;
    if (!side.list || !doc || !side.open) return;
    if (side.doc === doc && side.list.children.length === a.pagesCount) { markCurrent(); return; }
    side.doc = doc;
    const gen = ++side.gen;
    side.observer?.disconnect();
    side.list.replaceChildren();
    side.observer = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) { side.observer.unobserve(e.target); drawThumb(e.target, gen); }
    }, { root: side.el, rootMargin: '300px' });
    for (let n = 1; n <= a.pagesCount; n++) {
      const vp = a.pdfViewer.getPageView(n - 1)?.viewport;
      const canvas = $('canvas', { class: 'lb-thumb-canvas' });
      canvas.style.aspectRatio = vp ? `${vp.width} / ${vp.height}` : '1 / 1.414';
      const item = $('button', { type: 'button', class: 'lb-thumb', id: 'lbThumb_' + n, 'data-page': n, 'aria-label': 'Page ' + n,
        onclick: () => { a.pdfViewer.currentPageNumber = n; if (innerWidth < 700) setSidebar(false, false); } },
        canvas, $('span', { class: 'lb-thumb-num' }, String(n)));
      side.list.append(item);
      side.observer.observe(item);
    }
    markCurrent();
  }
  async function drawThumb(item, gen) {
    const n = +item.dataset.page, canvas = item.querySelector('canvas');
    try {
      const page = await app().pdfDocument.getPage(n);
      if (gen !== side.gen) return;
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: THUMB_W * (window.devicePixelRatio || 1) / base.width });
      canvas._lbTask?.cancel();             // a redraw replaces one still running
      await canvas._lbTask?.promise.catch(() => {});
      canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
      const mode = globalThis.pdfjsLib?.AnnotationMode?.ENABLE_STORAGE ?? 3;   // include typed answers
      const task = canvas._lbTask = page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: vp, annotationMode: mode });
      await task.promise;
    } catch (err) {
      if (err?.name !== 'RenderingCancelledException') console.warn('[logbook] thumbnail', n, err);
    }
  }
  let lastPage = 1;
  function markCurrent() {
    if (!side.list) return;
    const cur = app()?.pdfViewer?.currentPageNumber || 1;
    // Redraw the page just left, so its thumbnail shows what was typed there.
    if (side.open && lastPage !== cur) { const prev = side.list.querySelector(`[data-page="${lastPage}"]`); if (prev) drawThumb(prev, side.gen); }
    lastPage = cur;
    for (const it of side.list.children) {
      const on = +it.dataset.page === cur;
      it.classList.toggle('lb-current', on);
      if (on) it.setAttribute('aria-current', 'page'); else it.removeAttribute('aria-current');
    }
    side.list.querySelector('.lb-current')?.scrollIntoView({ block: 'nearest' });
  }

  function updateDeleteButton() {
    syncPage();
    if (!ui.del) return;
    const info = state.pageInfo[app().pdfViewer.currentPageNumber - 1];
    ui.del.hidden = !(info && info.added); // only pages the student added can go
  }

  // Slot buttons sit on top of the page, inside the reserved box.
  function decoratePage(pageNumber) {
    const pv = app().pdfViewer.getPageView(pageNumber - 1);
    if (!pv || !pv.div) return;
    pv.div.querySelectorAll('.lb-slot').forEach(e => e.remove());
    for (const slot of state.slots) {
      if (slotPageIndex(slot) !== pageNumber - 1) continue;
      // pdf.js 6 dropped convertToViewportRectangle; map both corners instead.
      const [x1, y1] = pv.viewport.convertToViewportPoint(slot.rect[0], slot.rect[1]);
      const [x2, y2] = pv.viewport.convertToViewportPoint(slot.rect[2], slot.rect[3]);
      const left = Math.min(x1, x2), top = Math.min(y1, y2);
      const width = Math.abs(x2 - x1), height = Math.abs(y2 - y1);
      const filled = !!state.images['slot:' + slot.name];
      const box = $('div', { class: 'lb-slot' + (filled ? ' lb-filled' : ''), 'data-slot': slot.name });
      Object.assign(box.style, { left: left + 'px', top: top + 'px', width: width + 'px', height: height + 'px' });
      const insert = async () => {
        const file = await getImageFile();
        if (!file) return;
        try { await placeInSlot(slot, await imageRecord(file)); }
        catch (err) { toast('Could not read that image (' + err.message + '). Try a JPEG or PNG.'); }
      };
      // An empty slot covers its placeholder field: clicking anywhere in it picks an image.
      if (!filled) box.addEventListener('click', e => { if (e.target === box) insert(); });
      const bar = $('div', { class: 'lb-slot-bar' },
        $('button', { id: 'lbSlotInsert_' + slot.name, type: 'button', class: 'lb-btn lb-primary', 'data-act': 'slot-insert', onclick: insert }, filled ? 'Replace image' : 'Insert image'));
      if (filled) bar.append($('button', { id: 'lbSlotRemove_' + slot.name, type: 'button', class: 'lb-btn', 'data-act': 'slot-remove', onclick: () => placeInSlot(slot, null) }, 'Remove'));
      box.append(bar);
      pv.div.append(box);
    }
  }

  // -------------------------------------------------------------- live hints
  // While typing, measure with the same font and fitting rules as the export:
  // single-line boxes stop at what fits at 6 pt; every box shows "N characters
  // left" from 30 left; multi-line text that will not fit is marked yellow.
  const HINT_FROM = 30;
  let measurer = null;
  async function liveFont() {
    if (measurer) return measurer;
    const bytes = await loadFieldFont();
    const face = new FontFace('LbLiberation', bytes.slice(0));
    await face.load();
    document.fonts.add(face);
    const cx = document.createElement('canvas').getContext('2d');
    // pt and px scale alike, so a width at "size px" is the width at size pt.
    measurer = { widthOfTextAtSize: (s, size) => { cx.font = `${size}px LbLiberation`; return cx.measureText(s).width; } };
    measurer.avg = size => measurer.widthOfTextAtSize('etaoinshrdlucmfwyp ', size) / 19;
    return measurer;
  }
  // pdf.js hides the form layer for a moment while it redraws at a new zoom,
  // which takes the cursor out of the box being typed in. Put it back, with
  // the same selection, once the box is shown again (unless the student has
  // clicked somewhere else by then). Its hint then comes back with it.
  const MAX_ZOOM = 4;
  // Watched until the student clicks or types somewhere else (or 10 s pass):
  // pdf.js can redraw, and drop the cursor, a while after the zoom itself.
  let zoomFocus = null;
  function keepFocusThroughZoom() {
    const el = document.activeElement;
    if (el && el.closest && el.closest('.annotationLayer') && 'selectionStart' in el)
      zoomFocus = { el, start: el.selectionStart, end: el.selectionEnd, scroll: el.scrollTop };
    if (!zoomFocus) return;
    const z = zoomFocus, running = !!z.until;
    z.until = performance.now() + 10000;
    if (running) return;
    const elsewhere = e => { if (!z.el.contains(e.target) && !e.ctrlKey && !e.metaKey && e.key !== 'Control') stop(); };
    const stop = () => {
      if (zoomFocus === z) zoomFocus = null;
      document.removeEventListener('pointerdown', elsewhere, true);
      document.removeEventListener('keydown', elsewhere, true);
    };
    document.addEventListener('pointerdown', elsewhere, true);
    document.addEventListener('keydown', elsewhere, true);
    const watch = () => {
      if (zoomFocus !== z) return stop();
      const active = document.activeElement;
      if (performance.now() > z.until || !z.el.isConnected || (active !== document.body && active !== z.el)) return stop();
      if (active === z.el) {                          // keep the latest selection
        z.start = z.el.selectionStart; z.end = z.el.selectionEnd; z.scroll = z.el.scrollTop;
      } else if (z.el.offsetParent && getComputedStyle(z.el).visibility !== 'hidden') {
        z.el.focus({ preventScroll: true });
        try { z.el.setSelectionRange(z.start, z.end); } catch (_) {}
        z.el.scrollTop = z.scroll;
      }
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  }

  // Every live box's update(). The yellow mark copies the box's font and padding
  // in px, so it is redrawn after each zoom (onZoom).
  const liveUpdates = new Set();
  let zoomFrame = 0;
  const onZoom = () => {
    cancelAnimationFrame(zoomFrame);
    zoomFrame = requestAnimationFrame(() => { for (const u of [...liveUpdates]) u(); });
  };
  const fieldsByPage = {};                                        // pageNumber -> Promise<[{id, rect, multi, start}]>
  function pageFields(pageNumber) {
    if (!fieldsByPage[pageNumber]) {
      fieldsByPage[pageNumber] = app().pdfDocument.getPage(pageNumber).then(p => p.getAnnotations()).then(list => list
        .filter(x => x.fieldType === 'Tx' && !x.readOnly && !(x.fieldFlags & 8192) && !String(x.fieldName).startsWith('img_'))
        .map(x => {
          const b = boxOf(x.rect), multi = !!x.multiLine;
          return { id: x.id, rect: x.rect, multi, b,
            start: startSize(multi ? 4096 : 0, x.defaultAppearanceData?.fontSize || 0, b.h) };
        }));
    }
    return fieldsByPage[pageNumber];
  }
  // What fits, for one box and its current text.
  // Measured at the box's own size: text is not shrunk while typing.
  function measure(f, font, text) {
    const { w, h } = f.b, avail = w - 2 * PAD, size = f.start, avgS = font.avg(size);
    if (!f.multi) {
      const used = font.widthOfTextAtSize(text.replace(/\n/g, ' '), size);
      return { left: Math.floor((avail - used) / avgS) };
    }
    if (fitsAt(font, text, true, w, h, size)) {
      const lines = text ? wrapLines(text, font, size, avail) : [''];
      const room = Math.floor((h - 2 * PAD) / (size * LEAD));
      const last = font.widthOfTextAtSize(lines[lines.length - 1], size);
      return { left: Math.floor((avail - last) / avgS) + (room - lines.length) * Math.floor(avail / avgS) };
    }
    const cut = splitPoint(font, text, w, h, size, 1);
    return { left: 0, cut, moved: text.length - cut };
  }
  function attachHints(pageNumber) {
    const pv = app().pdfViewer.getPageView(pageNumber - 1);
    if (!pv || !pv.div) return;
    Promise.all([pageFields(pageNumber), liveFont()]).then(([fields, font]) => {
      for (const f of fields) {
        const el = pv.div.querySelector(`.annotationLayer [data-element-id="${f.id}"]`);
        if (!el || el.dataset.lbHint) continue;
        el.dataset.lbHint = '1';
        const section = el.parentElement;
        let mirror = null, hint = null, sbWidth = 0;
        // Sizes and positions as calc(... * var(--total-scale-factor)), like pdf.js's
        // own, so they follow the zoom without being set again.
        const scaled = px => `calc(${px}px * var(--total-scale-factor))`;
        const place = () => {
          const v = pv.viewport;
          const [ax, ay] = v.convertToViewportPoint(f.b.x1, f.b.y1);
          const [bx, by] = v.convertToViewportPoint(f.b.x2, f.b.y2);
          return { left: scaled(Math.min(ax, bx) / v.scale), top: scaled((Math.max(ay, by) + 3) / v.scale) };
        };
        const update = () => {
          if (!el.isConnected) { liveUpdates.delete(update); return; }
          const text = el.value.replace(/\r\n?/g, '\n');
          el.style.fontSize = scaled(f.start);            // always the box's own size; shrinking is an export choice
          const m = measure(f, font, text);
          if (!f.multi) {
            const own = +(el.dataset.lbOwnMax ??= String(el.maxLength > 0 ? el.maxLength : Infinity));
            el.maxLength = Math.min(own, text.length + Math.max(0, m.left));
          }
          // yellow mark on the part that moves
          if (f.multi && m.cut !== undefined) {
            if (!mirror) { mirror = $('div', { class: 'lb-mirror', 'aria-hidden': 'true' }); section.insertBefore(mirror, el); }
            const cs = getComputedStyle(el);
            for (const p of ['font', 'letterSpacing', 'lineHeight', 'padding', 'textAlign', 'borderWidth', 'borderStyle', 'boxSizing'])
              mirror.style[p] = cs[p];
            mirror.style.borderColor = 'transparent';
            mirror.style.right = 'auto';
            // As wide as the box minus its scrollbar, so lines wrap where the box wraps them.
            // Measured only while the box is shown: pdf.js hides the layer for a moment on zoom.
            if (el.offsetWidth) sbWidth = el.offsetWidth - el.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
            mirror.style.width = `calc(100% - ${sbWidth}px)`;
            mirror.replaceChildren(document.createTextNode(text.slice(0, m.cut)), $('mark', {}, text.slice(m.cut) || ' '));
            mirror.scrollTop = el.scrollTop;
          } else if (mirror) { mirror.remove(); mirror = null; }
          // the hint, only while this box has focus
          const focused = document.activeElement === el;
          let msg = null;
          if (focused && m.moved) msg = 'Too long for this box. When you export, the yellow part moves to an extra page, after a full stop or a new line.';
          else if (focused && m.left <= 0) msg = 'This box is full. To write more, add a Text page.';
          else if (focused && m.left <= HINT_FROM) msg = `${m.left} characters left`;
          if (focused) for (const other of document.querySelectorAll('.lb-hint')) if (other !== hint) other.remove();   // one at a time
          if (!msg) { if (hint) { hint.remove(); hint = null; } return; }
          if (!hint || !hint.isConnected) { hint = $('div', { class: 'lb-hint', role: 'status' }); pv.div.append(hint); }
          hint.className = 'lb-hint' + (m.moved || m.left <= 0 ? ' lb-warn' : '');
          hint.textContent = msg;
          Object.assign(hint.style, place());
        };
        liveUpdates.add(update);
        el.addEventListener('input', update);
        el.addEventListener('focus', update);
        el.addEventListener('blur', update);
        el.addEventListener('scroll', () => { if (mirror) mirror.scrollTop = el.scrollTop; });
        update();
      }
    }).catch(err => console.warn('[logbook] live hints', err));
  }

  // -------------------------------------------------------------- wiring
  // Tell other tabs which logbook is open here; the later tab turns its autosave off.
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('nb2420-logbooks') : null;
  if (channel) channel.onmessage = ({ data }) => {
    if (!data || data.id !== state.saveKey || !state.saveKey) return;
    if (data.type === 'hello' && !state.otherTab) channel.postMessage({ type: 'taken', id: state.saveKey });
    if (data.type === 'taken' && !state.otherTab) {
      state.otherTab = true;
      setSaveBadge('Autosave off (open in another tab)');
      toast('This logbook is open in another tab too. Autosave is off here, so please work in one tab.', 9000);
    }
  };

  async function onDocumentLoaded() {
    const a = app();
    const fresh = !state.reopening; // a file the student opened, not our own rewrite
    if (fresh) {
      // New document: per-document bookkeeping starts over.
      state.doc = null;
      state.filename = a._docFilename || 'logbook.pdf';
      state.opCount = 0;
      state.lastHash = null;
      state.otherTab = false;
    }
    const doc = a.pdfDocument;
    if (fresh) {
      const editable = await unparked(doc).catch(err => { console.error('[logbook] could not reopen the export', err); return null; });
      if (editable && a.pdfDocument === doc) {
        await a.open({ data: editable, filename: state.filename });
        toast('Opened your exported log book. You can keep working on it.', 6000);
        return;
      }
    }
    await aliasesReady;   // logbookId() in analyse() needs the alias map
    await analyse();
    if (a.pdfDocument !== doc) return; // another file was opened meanwhile
    state.doc = doc;
    buildBar();
    syncTitle();
    updateDeleteButton();
    for (let i = 1; i <= a.pagesCount; i++) decoratePage(i);
    fillSidebar();
    state.reopening = false;
    if (state.onAnalysed) { state.onAnalysed(); state.onAnalysed = null; }
    if (fresh) {
      setSaveBadge('');
      if (channel) channel.postMessage({ type: 'hello', id: state.saveKey });
      await offerRestore();
    }
  }

  // The viewer's own save writes an editable copy (form fields kept); that stays
  // available in the menu. Ctrl+S does not download anything: work is kept in
  // the browser, and the Export button makes the hand-in PDF.
  const originals = {};
  function wrapSave(a) {
    const orig = a.download.bind(a);
    originals.download = async () => {
      await orig();
      setSaveBadge('Editable copy downloaded', 'ok');
    };
    a.downloadOrSave = async () => {
      toast('No need to save: your work saves itself in this browser. Use Export PDF to hand it in.', 5000);
    };
    // pdf.js bound its Ctrl+S handler before this override, so catch the key first.
    window.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 's' || e.key === 'S' || e.keyCode === 83)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        a.downloadOrSave();
      }
    }, true);
  }

  const ready = setInterval(() => {
    const a = app();
    if (!a || !a.initializedPromise) return;
    clearInterval(ready);
    a.initializedPromise.then(() => {
      wrapSave(a);
      buildBar();
      a.eventBus.on('scalechanging', ({ scale }) => {
        if (scale > MAX_ZOOM + 1e-6) { a.pdfViewer.currentScale = MAX_ZOOM; return; }   // pdf.js itself goes to 1000 %
        keepFocusThroughZoom();
        syncZoom(); onZoom();
      });
      a.eventBus.on('pagesloaded', () => { syncPage(); syncZoom(); });
      a.eventBus.on('annotationeditormodechanged', ({ mode }) => syncMode(mode));
      a.eventBus.on('documentloaded', () => onDocumentLoaded().catch(err => {
        console.error('[logbook]', err);
        state.reopening = false;
        if (state.onAnalysed) state.onAnalysed(); // do not leave a waiting action hanging
      }));
      a.eventBus.on('pagerendered', ({ pageNumber }) => decoratePage(pageNumber));
      a.eventBus.on('annotationlayerrendered', ({ pageNumber }) => attachHints(pageNumber));
      a.eventBus.on('pagechanging', () => { updateDeleteButton(); markCurrent(); });
    });
  }, 20);

  // Read-only state and a file hook for automated tests.
  window.nb2420Logbook = {
    state: () => JSON.parse(JSON.stringify({
      id: state.id, slots: state.slots, exercises: state.exercises, pageInfo: state.pageInfo, images: state.images,
    })),
    // Takes the id of a file input, so test drivers in sandboxes need not pass a function.
    setTestFile: id => { testFileHook = all => { const f = document.getElementById(id)?.files || [];
      return all ? [...f] : f[0] || null; }; },
    autosaveNow, exportPdf,
    // Export bytes with a scripted overflow choice ('all' | 'overflow' | 'shrink'), and the items it was asked about.
    exportBytesWith: async pick => { let asked = []; const b = await flattenedBytes(items => {
      asked = items.map(i => ({ name: i.name, page: i.page, extra: i.extra, shrinkTo: i.shrinkTo }));
      return Object.fromEntries(items.map(i => [i.name, pick])); }); return { bytes: b, asked }; },
    insertBlankPage, insertImagePage, deleteCurrentPage,
    slotInsert: name => document.querySelector(`.lb-slot[data-slot="${name}"] [data-act="slot-insert"]`)?.click(),
  };
})();
