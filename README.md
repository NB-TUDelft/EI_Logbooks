# NB2420 logbooks

Students of NB2420 Electronic Instrumentation fill in their lab logbook in the
browser, add graphs and photos, and export the PDF they hand in on Brightspace.
Everything runs in the student's own browser; nothing is uploaded.

<!-- site-url -->
**Site:** https://nb-tudelft.github.io/EI_Logbooks/
<!-- /site-url -->

<details>
<summary>Direct link per logbook</summary>

<!-- logbook-links -->
- [0.1 Template](https://nb-tudelft.github.io/EI_Logbooks/?logbook=0.1)
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
| [`templates/`](templates/) | the logbooks, as Typst files | adding or changing a logbook |
| [`site/`](site/) | the website | changing how the site works |
| [`tools/`](tools/) | all submissions into one table, and the build scripts | reading handed-in logbooks |

## How it publishes

Every push to `main` runs [the workflow](.github/workflows/pages.yml) and
publishes the site on GitHub Pages. Only when `templates/` (or the build
tools) changed does it first rebuild the PDFs, with the newest version of the
[renderer](https://github.com/NB-TUDelft/sphinx-typst-render), and commit them
together with the logbook list and the links above. To rebuild by hand:
**Actions** → *build and publish* → **Run workflow**. If it fails with "No artifacts named
github-pages", that is GitHub, not you: press **Re-run jobs**.
