# NB2420 logbooks

Students of NB2420 Electronic Instrumentation fill in their lab logbook in the
browser, add graphs and photos, and export the PDF they hand in on Brightspace.
Everything runs in the student's own browser; nothing is uploaded.

<!-- site-url -->
**Site:** https://nb-tudelft.github.io/EI_Logbooks/

**Highlighted on the start page:** 3.1 aliasing and anti aliasing (change it in [`templates/highlight.txt`](templates/highlight.txt))
<!-- /site-url -->

<details>
<summary>Direct link per logbook</summary>

<!-- logbook-links -->
- [1.1 voltage divider](https://nb-tudelft.github.io/EI_Logbooks/?logbook=1.1)
- [1.2 intro to oscilloscope and filters](https://nb-tudelft.github.io/EI_Logbooks/?logbook=1.2)
- [2.1 Whack a mole](https://nb-tudelft.github.io/EI_Logbooks/?logbook=2.1)
- [2.2 Timed acquisitions](https://nb-tudelft.github.io/EI_Logbooks/?logbook=2.2)
- [3.1 aliasing and anti aliasing](https://nb-tudelft.github.io/EI_Logbooks/?logbook=3.1)
- [4.1 opamp basics](https://nb-tudelft.github.io/EI_Logbooks/?logbook=4.1)
- [4.2 real opamps](https://nb-tudelft.github.io/EI_Logbooks/?logbook=4.2)
- [5.1 diode circuits](https://nb-tudelft.github.io/EI_Logbooks/?logbook=5.1)
- [5.2 differential measurements](https://nb-tudelft.github.io/EI_Logbooks/?logbook=5.2)
- [6.1 oscillators](https://nb-tudelft.github.io/EI_Logbooks/?logbook=6.1)
<!-- /logbook-links -->

</details>

## Where to look

| Folder | What | When you need it |
|--------|------|------------------|
| [course book](https://github.com/NB-TUDelft/Electronic_Instrumentation) `book/manuals/weekN/` | the logbooks, as Typst files: **the one place to write them** | adding or changing a logbook |
| [`templates/`](templates/) | a copy of those, plus our shared parts and the Highlight list | the Highlight box |
| [`site/`](site/) | the website | changing how the site works |
| [`site/logbook/aliases.json`](site/logbook/aliases.json) | maps old logbook numbers to new ones, so students keep their saved work ([how](templates/README.md#students-saved-work)) | merging or renumbering a logbook |
| [`tools/`](tools/) | all submissions into one table, and the build scripts | reading handed-in logbooks |

## How it publishes

[The workflow](.github/workflows/pages.yml) copies the logbooks from the course
book into `templates/`, rebuilds the PDFs if one changed, and publishes the site.
It runs:

- on every push to `main` here;
- when a log book entry changes in the course book: after its own check
  passes, the book's deploy starts this workflow for that exact book commit and
  waits for the result, so a failure here turns the book's run red too (once
  the book has its `LOGBOOKS_DISPATCH_TOKEN` secret);
- by hand: **Actions** → *build and publish* → **Run workflow**.

A run fails, and publishes nothing, if a logbook in the book is misnamed, in
the wrong week folder, doubled, imports something the site lacks or does not
build, or if a logbook was edited here by hand. Its summary page says what to fix.
The book runs the same check on its own pull requests, so most problems show up
there first.

"No artifacts named github-pages"? That is GitHub: press **Re-run jobs**.
