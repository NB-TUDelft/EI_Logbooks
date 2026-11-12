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
    added: 'LogbookAdded', kind: 'LogbookPageKind', exercise: 'LogbookExercise',
  };

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
    slots: [],            // [{name, ordinal, rect:[x1,y1,x2,y2], exercise}]
    pageInfo: [],         // per page: {added, kind, exercise}
    exercises: [],        // [{title, page}] from bookmarks
    images: {},           // metadata log, mirrors Info /LogbookImages
    lastHash: null, savedHash: null, opCount: 0,
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
    for (const kid of kids) el.append(kid);
    return el;
  };
  const ansi = s => String(s).replace(/[‒-―]/g, '-').replace(/[^\x20-\x7e\xa0-\xff\n]/g, '?');
  const nowIso = () => new Date().toISOString();
  const toast = (msg, ms = 3500) => {
    const t = $('div', { class: 'lb-toast', role: 'status' }, msg);
    document.body.append(t);
    setTimeout(() => t.remove(), ms);
  };

  function pickFile(accept = 'image/*') {
    return new Promise(resolve => {
      const input = $('input', { type: 'file', accept, class: 'lb-hidden-input' });
      input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
      input.addEventListener('cancel', () => { resolve(null); input.remove(); });
      document.body.append(input);
      input.click();
    });
  }
  // Exposed so automated tests can feed a file without an OS dialog.
  let testFileHook = null;
  const getImageFile = () => testFileHook ? Promise.resolve(testFileHook()) : pickFile();

  // Any image the browser can decode becomes a JPEG (handles PNG, WebP, HEIC
  // where supported, EXIF rotation), at most 2400 px on the long side.
  async function imageRecord(file) {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = $('canvas', { width: w, height: h });
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
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

  async function autosaveNow(fromTransform = false) {
    const a = app(), doc = a && a.pdfDocument;
    if (!doc || !state.id || doc !== state.doc) return; // id not (yet) for this document
    if ((state.busy && !fromTransform) || state.restorePending || state.otherTab || state.wiped) return;
    if (state.opCount === 0 && doc.annotationStorage.size === 0) return; // nothing changed yet
    const hash = doc.annotationStorage.serializable.hash + ':' + state.opCount;
    if (hash === state.lastHash) return;
    const id = state.id;
    if (!fromTransform) state.busy = true;
    try {
      const bytes = await doc.saveDocument();
      if (a.pdfDocument !== doc || state.id !== id) return;
      await idb.put(id, { bytes, time: nowIso(), filename: state.filename });
      state.lastHash = hash;
      setSaveBadge('Saved in this browser ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), 'ok');
    } catch (err) {
      console.warn('[logbook] autosave failed', err);
      setSaveBadge('Not saved in this browser: export to keep your work', 'warn');
    } finally {
      if (!fromTransform) state.busy = false;
    }
  }
  setInterval(autosaveNow, AUTOSAVE_MS);

  // Leaving with changes that were never saved to a file: ask first.
  window.addEventListener('beforeunload', e => {
    if (!state.wiped && state.lastHash && state.lastHash !== state.savedHash && state.opCountOrEdits()) {
      e.preventDefault(); e.returnValue = '';
    }
  });
  state.opCountOrEdits = () => {
    const doc = app() && app().pdfDocument;
    return state.opCount > 0 || (doc && doc.annotationStorage.size > 0);
  };

  let badge;
  function setSaveBadge(text, tone = '') {
    if (!badge) return;
    badge.textContent = text;
    badge.dataset.tone = tone;
  }

  async function offerRestore() {
    document.querySelectorAll('.lb-restore').forEach(b => b.remove());
    state.restorePending = false;
    const id = state.id, doc = state.doc;
    const rec = await idb.get(id);
    if (!rec || !rec.bytes || state.doc !== doc) return;
    const when = new Date(rec.time);
    const label = when.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    // Until the student chooses, autosave must not overwrite the stored work.
    state.restorePending = true;
    const done = () => { bar.remove(); state.restorePending = false; };
    const bar = $('div', { class: 'lb-restore', role: 'alert' },
      $('div', { class: 'lb-restore-text' }, $('strong', {}, 'Continue where you left off?'),
        $('span', {}, `This browser has your work on this logbook from ${label}.`)),
      $('button', { class: 'lb-btn lb-primary', onclick: async () => {
        done();
        if (state.doc !== doc) return;
        try { await reopen(rec.bytes); toast('Work restored.'); }
        catch (err) { toast('Could not restore: ' + err.message); }
      } }, 'Restore my work'),
      $('button', { class: 'lb-btn', onclick: async () => {
        if (!await askConfirm('Start fresh?',
          `Your saved work from ${label} will be deleted from this browser and cannot be recovered.`,
          'Start fresh')) return;
        done(); await idb.del(id);
      } }, 'Start fresh'));
    document.body.append(bar);
  }

  // ----------------------------------------------------------- reading
  async function readOutline(doc) {
    const out = [];
    const items = (await doc.getOutline()) || [];
    const walk = async list => {
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
        out.push({ title: it.title, page, top });
        if (it.items && it.items.length) await walk(it.items);
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
      return { added, kind: kind && kind.decodeText ? kind.decodeText() : null, exercise: ex && ex.decodeText ? ex.decodeText() : null };
    });
    state.id = infoStr(KEY.id) || (a._docFilename || 'logbook.pdf').replace(/\.pdf$/i, '').replace(/[_ ]edited$/i, '');
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
      const page = templateIndexOf(s.ordinal);
      // section that starts above the slot's top edge on its page, or earlier
      const slotTop = Math.max(s.rect[1], s.rect[3]);
      let found = null;
      for (const e of state.exercises) {
        if (e.page < 0) continue;
        if (e.page < page || (e.page === page && (e.top === null || e.top >= slotTop))) found = e.title;
      }
      s.exercise = s.exercise || found || GENERAL;
    }
  }

  // ------------------------------------------------------------ rewriting
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
        state.slots.map(({ name, ordinal, rect, exercise }) => ({ name, ordinal, rect, exercise })))));
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
      toast('That did not work: ' + err.message);
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
    const pageIndex = templateIndexOf(slot.ordinal);
    await transform(async pl => {
      const page = pl.getPage(pageIndex);
      removeAnnotsByNM(page, slotNM(slot.name));
      try { const f = pl.getForm().getField('img_' + slot.name); pl.getForm().removeField(f); } catch (_) {}
      if (!rec) { delete state.images['slot:' + slot.name]; return; }
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
    }, pageIndex + 1);
  }

  function markAdded(page, kind, exercise) {
    page.node.set(PDFName.of(KEY.added), PDFBool.True);
    page.node.set(PDFName.of(KEY.kind), PDFHexString.fromText(kind));
    if (exercise) page.node.set(PDFName.of(KEY.exercise), PDFHexString.fromText(exercise));
  }

  // Added pages always go at the end of the logbook (no reordering).
  // A text page is one big text field, so what is written on it stays readable by code.
  async function insertBlankPage() {
    const a = app();
    const at = a.pagesCount;
    const exercise = exerciseForPage(a.pdfViewer.currentPageNumber - 1);
    await transform(async pl => {
      const { width: W, height: H } = pl.getPage(0).getSize();
      const page = pl.insertPage(at, [W, H]);
      const bold = await pl.embedFont(StandardFonts.HelveticaBold);
      const regular = await pl.embedFont(StandardFonts.Helvetica);
      const M = 40;
      page.drawText(ansi('Text for: ' + exercise), { x: M, y: H - M - 12, size: 12, font: bold, maxWidth: W - 2 * M });
      page.drawText('Added page', { x: M, y: H - M - 28, size: 8, font: regular, color: rgb(0.45, 0.45, 0.45) });
      const id = 'added_text_' + Date.now().toString(36);
      const field = pl.getForm().createTextField(id);
      field.enableMultiline();
      field.addToPage(page, { x: M, y: M, width: W - 2 * M, height: H - 2 * M - 40, font: regular, borderWidth: 0.5,
                              borderColor: rgb(0.6, 0.6, 0.6), backgroundColor: rgb(0.97, 0.98, 0.98) });
      field.setFontSize(10);
      markAdded(page, 'text', exercise);
    }, at + 1);
  }

  async function insertImagePage() {
    const at = app().pagesCount;
    const exercise = await askExercise(exerciseForPage(app().pdfViewer.currentPageNumber - 1));
    if (!exercise) return;
    const file = await getImageFile();
    if (!file) return;
    let rec;
    try { rec = await imageRecord(file); } catch (err) { toast('Could not read that image (' + err.message + '). Try a JPEG or PNG.'); return; }
    await transform(async pl => {
      const { width: W, height: H } = pl.getPage(0).getSize();
      const page = pl.insertPage(at, [W, H]);
      const bold = await pl.embedFont(StandardFonts.HelveticaBold);
      const regular = await pl.embedFont(StandardFonts.Helvetica);
      const M = 40, notesH = 120;
      page.drawText(ansi('Image for: ' + exercise), { x: M, y: H - M - 12, size: 12, font: bold, maxWidth: W - 2 * M });
      page.drawText(ansi('Added page  |  file: ' + rec.meta.original_filename), { x: M, y: H - M - 28, size: 8, font: regular, color: rgb(0.45, 0.45, 0.45) });
      const top = H - M - 40, bottom = M + notesH + 24;
      const fit = contain(rec.w, rec.h, W - 2 * M, top - bottom);
      const img = await pl.embedJpg(rec.bytes);
      page.drawImage(img, { x: (W - fit.w) / 2, y: bottom + (top - bottom - fit.h) / 2, width: fit.w, height: fit.h });
      page.drawText('Notes:', { x: M, y: M + notesH + 6, size: 9, font: bold });
      const id = 'added_notes_' + Date.now().toString(36);
      const notes = pl.getForm().createTextField(id);
      notes.enableMultiline();
      notes.addToPage(page, { x: M, y: M, width: W - 2 * M, height: notesH, font: regular, borderWidth: 0.5, borderColor: rgb(0.6, 0.6, 0.6), backgroundColor: rgb(0.97, 0.98, 0.98) });
      notes.setFontSize(9);
      markAdded(page, 'image', exercise);
      state.images['page:' + id] = { ...rec.meta, kind: 'page', exercise, notes_field: id };
    }, at + 1);
  }

  async function deleteCurrentPage() {
    const n = app().pdfViewer.currentPageNumber;
    const info = state.pageInfo[n - 1];
    if (!info || !info.added) { toast('Pages of the logbook itself cannot be deleted. Only pages you added can.'); return; }
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

  function askExercise(preselect) {
    const choices = [...new Set([...state.exercises.map(e => e.title), GENERAL])];
    const select = $('select', { class: 'lb-select', 'aria-label': 'Exercise' },
      ...choices.map(c => { const o = $('option', {}, c); if (c === preselect) o.selected = true; return o; }));
    return modal('Add image page', [
      $('p', { class: 'lb-modal-text' }, 'The image goes on a new page at the end of your logbook, with a box for notes.'),
      $('label', { class: 'lb-field' }, $('span', {}, 'Which exercise is it for?'), select)],
      [{ text: 'Cancel', value: null }, { text: 'Choose image', primary: true, id: 'lbExerciseOk', value: () => select.value }]);
  }

  const askConfirm = (title, text, ok) => modal(title, [$('p', { class: 'lb-modal-text' }, text)],
    [{ text: 'Cancel', value: false }, { text: ok, primary: true, danger: true, id: 'lbConfirmOk', value: true }]);

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

  function wrapLines(text, font, size, width) {
    const out = [];
    for (const para of text.split('\n')) {
      let line = '';
      for (const word of para.split(/ +/)) {
        const tryLine = line ? line + ' ' + word : word;
        if (font.widthOfTextAtSize(tryLine, size) <= width) { line = tryLine; continue; }
        if (line) out.push(line);
        line = '';
        let piece = '';
        for (const ch of word) {                                  // words longer than the box
          if (font.widthOfTextAtSize(piece + ch, size) > width && piece) { out.push(piece); piece = ''; }
          piece += ch;
        }
        line = piece;
      }
      out.push(line);
    }
    return out;
  }

  function drawFieldText(page, font, charset, rect, value, da, ff, q) {
    const x1 = Math.min(rect[0], rect[2]), x2 = Math.max(rect[0], rect[2]);
    const y1 = Math.min(rect[1], rect[3]), y2 = Math.max(rect[1], rect[3]);
    const w = x2 - x1, h = y2 - y1, pad = 2;
    const text = [...value.replace(/\r\n?/g, '\n')]
      .map(c => (c === '\n' || charset.has(c.codePointAt(0))) ? c : '?').join('');
    const sizeDA = parseFloat((da.match(/([\d.]+)\s+Tf/) || [])[1]) || 0;
    let color = rgb(0, 0, 0);
    const mRgb = da.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/), mG = da.match(/([\d.]+)\s+g(\s|$)/);
    if (mRgb) color = rgb(+mRgb[1], +mRgb[2], +mRgb[3]); else if (mG) color = rgb(+mG[1], +mG[1], +mG[1]);
    const xFor = (line, size) => {
      const tw = font.widthOfTextAtSize(line, size);
      return q === 1 ? x1 + (w - tw) / 2 : q === 2 ? x2 - pad - tw : x1 + pad;
    };
    if (ff & 4096) {                                              // multi-line
      let size = sizeDA || 10, lines = wrapLines(text, font, size, w - 2 * pad);
      while (size > 5 && lines.length * size * 1.2 > h - 2 * pad) {
        size -= 0.5; lines = wrapLines(text, font, size, w - 2 * pad);
      }
      lines.forEach((line, i) => {
        if (line) page.drawText(line, { x: xFor(line, size), y: y2 - pad - size * (0.9 + 1.2 * i), size, font, color });
      });
    } else {
      const line = text.replace(/\n/g, ' ');
      let size = sizeDA || Math.min(12, (h - 2) / 1.2);
      while (size > 4 && font.widthOfTextAtSize(line, size) > w - 2 * pad) size -= 0.5;
      page.drawText(line, { x: xFor(line, size), y: y1 + h / 2 - size * 0.35, size, font, color });
    }
  }

  async function flattenedBytes() {
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
    const exact = { pages: [], fields: {}, checks: {}, images: {} };       // the same, verbatim, in the Info dict
    const slotMeta = name => state.images['slot:' + name] || {};
    const imageLabel = (slot, m) => `[[NB2420:image slot="${slot}" filled="yes"${attr('exercise', m.exercise)}` +
      `${attr('file', m.original_filename)}${attr('sha256', m.sha256)}${attr('sha512', m.sha512)}]]`;

    for (const [pageIndex, page] of pl.getPages().entries()) {
      const key = fontKey(page);
      const { height: PH } = page.getSize();
      const info = state.pageInfo[pageIndex] || {};
      label(page, key, `[[NB2420:page n="${pageIndex + 1}"${attr('kind', info.added ? info.kind : 'template')}${attr('exercise', info.exercise)}]]`, 2, PH - 6);
      exact.pages.push({ n: pageIndex + 1, kind: info.added ? info.kind : 'template', exercise: info.exercise || null });
      const annots = page.node.lookup(N('Annots'));
      const list = annots instanceof PDFArray ? annots : ctx.obj([]);
      const keep = [], ops = [], texts = [], labels = [];
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
            texts.push([rectHere, value, textOf(inherit(d, 'DA') || daDefault), ff, qv ? qv.asNumber() : 0, name]);
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
      for (const [rect, value, da, ff, q, name] of texts) {
        const x1 = Math.min(rect[0], rect[2]), x2 = Math.max(rect[0], rect[2]);
        const y1 = Math.min(rect[1], rect[3]), y2 = Math.max(rect[1], rect[3]);
        label(page, key, `[[NB2420:field name="${name}"]]`, x1, y2 - 4);
        if (value.trim()) drawFieldText(page, font, charset, rect, value, da, ff, q);
        label(page, key, '[[/NB2420:field]]', x2 - 20, y1 + 1);
      }
    }
    pl.catalog.delete(N('AcroForm'));
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
    if (!app()?.pdfDocument || state.busy) return;
    state.busy = true;
    document.body.classList.add('lb-busy');
    setSaveBadge('Preparing your PDF…');
    try {
      const bytes = await flattenedBytes();
      downloadBytes(bytes, (state.id || 'logbook') + '.pdf');
      state.savedHash = state.lastHash;
      setSaveBadge('Exported ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), 'ok');
      toast('Exported. Hand in this PDF on Brightspace.', 6000);
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
      $('button', { type: 'button', class: 'lb-tb lb-zoom-btn', title: 'Fit to width', 'aria-label': 'Fit to width',
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
      menuItem('lbMenuEditable', 'Download editable copy', () => originals.download?.()),
      menuItem('lbMenuOpen', 'Open a saved copy…', () => a().eventBus.dispatch('openfile', { source: window })),
      menuItem('lbMenuPrint', 'Print', () => window.print()),
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

    const bar = $('header', { id: 'lbBar' },
      $('div', { class: 'lb-row' }, ui.title, nav, zoom, tools, pages, right));
    document.body.prepend(bar);
    document.body.classList.add('lb-custom');
    // pdf.js lays out the pages below var(--toolbar-height): make that our bar's height.
    const fit = () => {
      outer.style.setProperty('--toolbar-height', bar.offsetHeight + 'px');
      document.documentElement.style.setProperty('--lb-bar-h', bar.offsetHeight + 'px');
    };
    new ResizeObserver(fit).observe(bar); fit();
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
      `This removes your progress for ${what} from this browser. Anything you have not exported as a PDF will be lost.`,
      'Continue')) return;
    if (!await askConfirm('Are you sure?',
      `Your progress for ${what} cannot be recovered afterwards. Close other tabs with a logbook first, or they will save it again.`,
      all ? 'Delete everything' : 'Delete my work')) return;
    state.wiped = true;
    const ok = all ? await idb.wipeAll() : await idb.wipe(state.id);
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
      const s = $('button', { type: 'button', class: 'lb-swatch' + (col === c.color ? ' lb-on' : ''), title: 'Colour', 'aria-label': 'Colour ' + col,
        onclick: () => { c.color = col; apply(); } });
      s.style.setProperty('--sw', col);
      ui.style.append(s);
    }
    if (st.sizes) {
      ui.style.append($('span', { class: 'lb-style-sep' }));
      for (const [v, lab] of st.sizes) ui.style.append($('button', { type: 'button', class: 'lb-size' + (v === c.size ? ' lb-on' : ''),
        title: 'Size ' + lab, onclick: () => { c.size = v; apply(); } }, lab));
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
      if (templateIndexOf(slot.ordinal) !== pageNumber - 1) continue;
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
        $('button', { class: 'lb-btn lb-primary', 'data-act': 'slot-insert', onclick: insert }, filled ? 'Replace image' : 'Insert image'));
      if (filled) bar.append($('button', { class: 'lb-btn', 'data-act': 'slot-remove', onclick: () => placeInSlot(slot, null) }, 'Remove'));
      box.append(bar);
      pv.div.append(box);
    }
  }

  // -------------------------------------------------------------- wiring
  // Tell other tabs which logbook is open here; the later tab turns its autosave off.
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('nb2420-logbooks') : null;
  if (channel) channel.onmessage = ({ data }) => {
    if (!data || data.id !== state.id || !state.id) return;
    if (data.type === 'hello' && !state.otherTab) channel.postMessage({ type: 'taken', id: state.id });
    if (data.type === 'taken' && !state.otherTab) {
      state.otherTab = true;
      setSaveBadge('Autosave off: open in another tab');
      toast('This logbook is also open in another tab. Autosave is off here, so keep working in one tab.', 9000);
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
      state.savedHash = null;
      state.otherTab = false;
    }
    const doc = a.pdfDocument;
    await analyse();
    if (a.pdfDocument !== doc) return; // another file was opened meanwhile
    state.doc = doc;
    buildBar();
    syncTitle();
    updateDeleteButton();
    for (let i = 1; i <= a.pagesCount; i++) decoratePage(i);
    state.reopening = false;
    if (state.onAnalysed) { state.onAnalysed(); state.onAnalysed = null; }
    if (fresh) {
      setSaveBadge('');
      if (channel) channel.postMessage({ type: 'hello', id: state.id });
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
      state.savedHash = state.lastHash;
      setSaveBadge('Editable copy downloaded', 'ok');
    };
    a.downloadOrSave = async () => {
      toast('Your work is saved in this browser automatically. Use Export PDF to hand it in.', 5000);
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
      a.eventBus.on('scalechanging', syncZoom);
      a.eventBus.on('pagesloaded', () => { syncPage(); syncZoom(); });
      a.eventBus.on('annotationeditormodechanged', ({ mode }) => syncMode(mode));
      a.eventBus.on('documentloaded', () => onDocumentLoaded().catch(err => {
        console.error('[logbook]', err);
        state.reopening = false;
        if (state.onAnalysed) state.onAnalysed(); // do not leave a waiting action hanging
      }));
      a.eventBus.on('pagerendered', ({ pageNumber }) => decoratePage(pageNumber));
      a.eventBus.on('pagechanging', updateDeleteButton);
    });
  }, 20);

  // Read-only state and a file hook for automated tests.
  window.nb2420Logbook = {
    state: () => JSON.parse(JSON.stringify({
      id: state.id, slots: state.slots, exercises: state.exercises, pageInfo: state.pageInfo, images: state.images,
    })),
    // Takes the id of a file input, so test drivers in sandboxes need not pass a function.
    setTestFile: id => { testFileHook = () => document.getElementById(id)?.files[0] || null; },
    autosaveNow, exportPdf,
    insertBlankPage, insertImagePage, deleteCurrentPage,
    slotInsert: name => document.querySelector(`.lb-slot[data-slot="${name}"] [data-act="slot-insert"]`)?.click(),
  };
})();
