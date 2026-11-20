# NB2420 logbooks

Students of NB2420 Electronic Instrumentation fill in their lab logbook in the
browser, add graphs and photos, and export the PDF they hand in on Brightspace.
Everything runs in the student's own browser; nothing is uploaded.

<!-- site-url -->
**Site:** https://nb-tudelft.github.io/EI_Logbooks/

**Highlighted on the start page:** 2.2 Timed acquisitions (change it in [`templates/highlight.txt`](templates/highlight.txt))
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
| [`templates/`](templates/) | a copy of those, made by the workflow, plus our shared parts and the Highlight list | the Highlight box; how the copy works |
| [`site/`](site/) | the website | changing how the site works |
| [`site/logbook/aliases.json`](site/logbook/aliases.json) | maps old logbook numbers to new ones, so students keep their saved work ([how](templates/README.md#students-saved-work)) | merging or renumbering a logbook |
| [`tools/`](tools/) | all submissions into one table, and the build scripts | reading handed-in logbooks |

## How it publishes

Every push to `main`, and every night, runs [the workflow](.github/workflows/pages.yml).
It first copies the logbooks from the course book into `templates/`, then
publishes the site on GitHub Pages. Only when a logbook (or the build tools)
changed does it rebuild the PDFs, with the newest version of the
[renderer](https://github.com/NB-TUDelft/sphinx-typst-render), and commit them
together with the copied logbooks, the logbook list and the links above. So a
change in the book is on the site the next morning. To do it straight away:
**Actions** → *build and publish* → **Run workflow**. If it fails with "No artifacts named
github-pages", that is GitHub, not you: press **Re-run jobs**.
