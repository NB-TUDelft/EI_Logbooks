/* NB2420 logbook add-on for the pdf.js viewer.
 *
 * Adds to the stock viewer (which already does forms, text, draw, highlight,
 * free images, comments, signatures, print and save):
 *   - image slots: an "Insert image" button on each reserved graph box; the
 *     image is fitted inside the box and tagged with its exercise
 *   - inserting blank pages and image pages after the current page, and
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
  const { PDFDocument, PDFName, PDFString, PDFHexString, PDFBool, PDFArray, PDFDict,
          StandardFonts, rgb, drawImage: opDrawImage, pushGraphicsState, popGraphicsState,
          degrees } = PDFLib;

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
    o.set('enableComment', true);           // as in Firefox
    o.set('enableSignatureEditor', true);   // as in Firefox
    o.set('enableScripting', false);        // logbooks need no PDF scripts
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
    let sha256 = null;
    try {
      const d = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      sha256 = [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (_) { /* optional */ }
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()), w, h,
      meta: { original_filename: file.name, original_width: bmp.width, original_height: bmp.height, sha256, inserted: nowIso() },
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
    };
  })();

  async function autosaveNow(fromTransform = false) {
    const a = app(), doc = a && a.pdfDocument;
    if (!doc || !state.id || doc !== state.doc) return; // id not (yet) for this document
    if ((state.busy && !fromTransform) || state.restorePending || state.otherTab) return;
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
      setSaveBadge('Autosaved ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (err) {
      console.warn('[logbook] autosave failed', err);
      setSaveBadge('Autosave unavailable: save with Ctrl+S');
    } finally {
      if (!fromTransform) state.busy = false;
    }
  }
  setInterval(autosaveNow, AUTOSAVE_MS);

  // Leaving with changes that were never saved to a file: ask first.
  window.addEventListener('beforeunload', e => {
    if (state.lastHash && state.lastHash !== state.savedHash && state.opCountOrEdits()) {
      e.preventDefault(); e.returnValue = '';
    }
  });
  state.opCountOrEdits = () => {
    const doc = app() && app().pdfDocument;
    return state.opCount > 0 || (doc && doc.annotationStorage.size > 0);
  };

  let badge;
  function setSaveBadge(text) {
    if (!badge) return;
    badge.textContent = text;
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
      $('span', {}, `You have unsaved work on this logbook from ${label}.`),
      $('button', { class: 'lb-btn lb-primary', onclick: async () => {
        done();
        if (state.doc !== doc) return;
        try { await reopen(rec.bytes); toast('Work restored.'); }
        catch (err) { toast('Could not restore: ' + err.message); }
      } }, 'Restore my work'),
      $('button', { class: 'lb-btn', onclick: async () => { done(); await idb.del(id); } }, 'Start fresh'));
    document.getElementById('viewerContainer').before(bar);
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
      const bytes = await pl.save();
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

  async function insertBlankPage() {
    const at = app().pdfViewer.currentPageNumber; // insert after this page
    const exercise = exerciseForPage(at - 1);
    await transform(async pl => {
      const size = pl.getPage(0).getSize();
      const page = pl.insertPage(at, [size.width, size.height]);
      const font = await pl.embedFont(StandardFonts.Helvetica);
      page.drawText(ansi('Added page  |  ' + exercise), { x: 40, y: size.height - 30, size: 8, font, color: rgb(0.45, 0.45, 0.45) });
      markAdded(page, 'blank', exercise);
    }, at + 1);
  }

  async function insertImagePage() {
    const at = app().pdfViewer.currentPageNumber;
    const exercise = await askExercise(exerciseForPage(at - 1));
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
    if (!confirm(`Delete page ${n} (a page you added)?`)) return;
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
  function askExercise(preselect) {
    return new Promise(resolve => {
      const choices = [...new Set([...state.exercises.map(e => e.title), GENERAL])];
      const select = $('select', { class: 'lb-select', 'aria-label': 'Exercise' },
        ...choices.map(c => { const o = $('option', {}, c); if (c === preselect) o.selected = true; return o; }));
      const close = v => { overlay.remove(); resolve(v); };
      const overlay = $('div', { class: 'lb-modal-backdrop', onclick: e => { if (e.target === overlay) close(null); } },
        $('div', { class: 'lb-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Add image page' },
          $('h2', {}, 'Add image page'),
          $('label', {}, 'Which exercise is this image for?', select),
          $('div', { class: 'lb-modal-actions' },
            $('button', { class: 'lb-btn', onclick: () => close(null) }, 'Cancel'),
            $('button', { class: 'lb-btn lb-primary', id: 'lbExerciseOk', onclick: () => close(select.value) }, 'Choose image'))));
      overlay.addEventListener('keydown', e => { if (e.key === 'Escape') close(null); });
      document.body.append(overlay);
      select.focus();
    });
  }

  function svgIcon(path) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('aria-hidden', 'true');
    s.innerHTML = path;
    return s;
  }
  const ICONS = {
    blank: '<path d="M4 1.5h5l3 3v10H4z" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M8 7v5M5.5 9.5h5" stroke="currentColor" stroke-width="1.2"/>',
    image: '<rect x="1.5" y="2.5" width="13" height="11" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="5.5" cy="6" r="1.3" fill="currentColor"/><path d="M2 12l4-4 3 3 2-2 3 3" fill="none" stroke="currentColor" stroke-width="1.2"/>',
    del: '<path d="M3 4h10M6 4V2.5h4V4M4.5 4l.7 9.5h5.6l.7-9.5" fill="none" stroke="currentColor" stroke-width="1.2"/>',
  };

  let delBtn;
  function buildToolbar() {
    if (document.getElementById('lbPageTools')) return;
    const sep = document.getElementById('editorModeSeparator');
    if (!sep) return;
    const mk = (id, label, icon, onclick) => {
      const b = $('button', { id, class: 'toolbarButton lb-toolbar-btn', type: 'button', title: label, 'aria-label': label, onclick });
      b.append(svgIcon(icon), $('span', {}, label));
      return b;
    };
    delBtn = mk('lbDeletePage', 'Delete page', ICONS.del, deleteCurrentPage);
    const group = $('div', { id: 'lbPageTools', class: 'toolbarHorizontalGroup' },
      mk('lbInsertBlank', 'Insert blank page', ICONS.blank, insertBlankPage),
      mk('lbInsertImagePage', 'Insert image page', ICONS.image, insertImagePage),
      delBtn);
    sep.before($('div', { class: 'verticalToolbarSeparator' }), group);
    badge = $('span', { id: 'lbSaveBadge', class: 'toolbarLabel lb-badge' }, '');
    document.getElementById('toolbarViewerRight').prepend(badge);
  }

  function updateDeleteButton() {
    if (!delBtn) return;
    const info = state.pageInfo[app().pdfViewer.currentPageNumber - 1];
    delBtn.disabled = !(info && info.added);
    delBtn.title = delBtn.disabled ? 'Only pages you added can be deleted' : 'Delete this added page';
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
    buildToolbar();
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

  function wrapSave(a) {
    for (const m of ['save', 'download']) {
      const orig = a[m].bind(a);
      a[m] = async (...args) => {
        await orig(...args);
        state.savedHash = state.lastHash;
        setSaveBadge('Saved to file');
      };
    }
  }

  const ready = setInterval(() => {
    const a = app();
    if (!a || !a.initializedPromise) return;
    clearInterval(ready);
    a.initializedPromise.then(() => {
      wrapSave(a);
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
    autosaveNow,
    insertBlankPage, insertImagePage, deleteCurrentPage,
    slotInsert: name => document.querySelector(`.lb-slot[data-slot="${name}"] [data-act="slot-insert"]`)?.click(),
  };
})();
