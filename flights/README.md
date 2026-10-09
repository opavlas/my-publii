# /flights

Two interactive pages from a cosmic-ray dosimetry campaign flown with a **Timepix2**
silicon pixel detector.

| | |
|---|---|
| [**Dose Field at 11 km**](https://pahoclock.com/flights/) | three airliner legs replayed over the CARI-7A simulated dose field at cruise altitude, measured against model |
| [**The Pfotzer Maximum**](https://pahoclock.com/flights/balloons.html) | two stratospheric balloon flights, dose rate against altitude through the Regener–Pfotzer maximum |

## Contents

```
index.html         the flight page
replay_data.js     its tracks, model and dose field          275 kB
frames_data.js     its detector frames                       5.4 MB
balloons.html      the balloon page
balloon_data.js    its ascent and profile data               1.6 MB
```

Each page is a single HTML file — a `<style>`, some `<canvas>` markup and one inline
`<script>` — with its data loaded beforehand as plain globals. No framework, no build
step, no server-side code. Static hosting is all that is required.

## Generated — do not edit here

These files are built from sources in the analysis project (`presentation/`) by
`deploy_site.py`, which wraps each page in a full HTML document and rewrites the
navigation to relative paths. Edits made directly in this folder are overwritten on
the next deploy.

To update: re-run `deploy_site.py`, then commit and push. GitHub Pages serves this
branch directly — no Actions workflow, no build on the server — so a push is live
within about a minute.

## Notes

- All internal references are relative, so the folder also works opened from disk.
- No cookies, no storage, no tracking, no network calls. The only external request is
  to Google Fonts.
- The `.js` bundles are plain text and contain the full measured dataset.
