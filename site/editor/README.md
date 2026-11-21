# Editor

The add-on that turns the pdf.js viewer into the logbook editor. pdf.js loads
it from [`../pdfjs/web/viewer.html`](../pdfjs/web/viewer.html).

| File | What |
|------|------|
| `logbook.js`, `logbook.css` | the editor: bar, answer boxes, images, extra pages, sidebar, autosave, export |
| `aliases.json` | old logbook numbers to new ones, for saved work and `?logbook=` links ([how](../../templates/README.md#students-saved-work)) |
| `pdf-lib.min.js`, `fontkit.umd.min.js` | pdf-lib 1.17.1 and fontkit 1.1.1, for the export |
| `fonts/` | Inter, for the export (OFL licence in `Inter-OFL.txt`) |

## The export

Export paints every answer, drawing and image flat onto the page, so every
PDF viewer, Brightspace and Turnitin see the same thing. Images dragged or
pasted onto a page (pdf.js allows that) get a label and an entry in
`/LogbookFields` with their page and exercise, like the image boxes. The
editable layer (each page's own contents and annotations, and the form) is
parked under the key `/NB2420Editable`, which viewers ignore. Opening the
export in the editor puts it back and drops the overflow pages, so students
can keep working on the file they handed in. Exports from before this have
no parked layer and open flat.

## Changing the code

1. Edit `logbook.js` or `logbook.css`.
2. **Bump the version** in `../pdfjs/web/viewer.html` (`logbook.js?v=...` and
   `logbook.css?v=...`). Browsers cache these files for 10 minutes; a new
   version reaches students straight away.
3. Test locally (commands in [`tools/`](../../tools/README.md#used-by-the-automatic-build)): fill a
   logbook, insert an image, export, open the PDF, and run
   `python tools/logbooks_to_dataframe.py` on its folder. Check both: text the tool reads
   can still be invisible on the page.

For automated tests, `nb2420Logbook.setTestFile('<id of an input type=file>')`
followed by `nb2420Logbook.slotInsert('graph')` inserts an image without a
file dialog; `insertImagePage()` takes all the files in that input.
`nb2420Logbook.state()` returns slots, images and pages.
