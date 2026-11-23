# Puxian (谱线)

[简体中文](README.zh-CN.md)

This cleaned open-source release is a fresh snapshot with no previous Git history. The production site is [818189.xyz](https://818189.xyz/). The release uses a plain installation guide in place of the branded assets, replaces two short score examples with original studies, and omits internal development materials.

Puxian is a browser-based music notation and practice workbench. Use it to write a short melody, prepare a part for a transposing instrument, or turn a hummed phrase into an editable draft. By default, drafts stay in the current browser and do not sync across devices. Export anything you want to keep if you clear browser storage or switch devices.

## Features

- Enter notes with numbered notation (jianpu), pitch names or an on-screen keyboard. View staff and numbered notation and edit chords, voices, lyrics and expression marks.
- Transpose the music to change its sounding pitch, or select a transposing instrument to change the written part while preserving sounding pitch.
- Play the score, loop a passage or use a metronome. Export PNG, SVG, MIDI and MusicXML, copy numbered notation, or use the browser to print or save a PDF.
- Import MusicXML (including compressed MXL), MIDI and Guitar Pro 5 (GP5). Imports can omit or simplify material depending on the format. See [GP5 import](docs/gp5-import.md) for its supported subset.
- Transcribe a short recording or audio file in the browser. Start with a clear solo melody, then check pitches, onsets and note lengths in the draft.
- Recognize printed staff notation from images or PDF pages in the browser when the optional model is available. Images and PDF pages are processed locally. Review the preview before replacing the score.

## Run locally

Use Node.js 22 (22.12 or later in the 22.x series) and npm.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite.

## Optional score recognition model

The printed-score recognition engine uses the [SMT GrandStaff model](https://huggingface.co/antoniorv6/smt-grandstaff), whose model card specifies MIT. Weights are excluded from Git. With Python 3.11, uv, curl and git installed, run:

```sh
bash scripts/omr/download-export.sh
```

The script checks the pinned upstream files, exports ONNX assets and verifies them against the repository manifest. It places them in the ignored `public/models/omr/` directory. Builds succeed with that directory absent. Recognition then fails to load its model unless the configured host provides it. See [local score recognition](docs/local-omr.md) for revisions, checksums, caching and limitations.

## Environment

These optional Vite settings are public and can be exposed in a client build.

```dotenv
VITE_AUTH_ENABLED=false
VITE_OMR_MODEL_BASE=/models/omr/
```

The first disables the optional web sign-in gate. The second sets the model asset base URL and requires a trailing slash. The default model path is same-origin. Server-side Grok OAuth is disabled unless both `GROK_AUTH_CLIENT_ID` and `GROK_AUTH_CLIENT_SECRET` are configured. Keep secrets out of `VITE_*` values and keep local `.env` files out of Git.

## Tests

```sh
npm test
npm run build:static
npx playwright install chromium firefox
npm run verify:static
npm run test:omr
```

`npm test` runs the Node test suite. Static verification uses Python 3 and Playwright browser binaries, plus the browser system libraries required on your OS. It includes a simulated recognition worker. `test:omr` uses the static build, Python 3, Playwright Chromium and real model files. Its real-model checks require the weights and a Linux environment with `timeout` and `/proc/uptime`. The browser checks still run when weights are absent. See the [static build guide](docs/static-mobile-build.md) and [recognition test instructions](docs/local-omr.md).

## Build and package

- `npm run build` builds the server-backed web app with Nitro and invokes the migration script. The migration step skips when a database connection is unconfigured. Use this build for a host that supports the web server runtime and its optional server features.
- `npm run build:static` produces `dist-static/` for an HTTP static host or the iOS shell. It runs without a database or migrations. The package has no server API, hosted sign-in or server-side data features. Serve it over HTTP for local checks or HTTPS for hosting.
- Capacitor wraps the static build in an iOS shell. See the [iOS verification notes](docs/capacitor-ios-verify.md) for Xcode setup and device checks. Some physical-device checks remain pending. App Store distribution has not been completed.

## Known limitations

- Score recognition and audio transcription produce drafts for manual correction. Check pitches, onsets, durations and the full passage. Complex rhythms and accompaniment can reduce transcription accuracy. Printed-score recognition works best with clear, upright paired staves. Handwritten scores, numbered scores, distorted photos and complex full scores can fail. Recognition can omit or add notes, misread meter or voices, and lose some notation or layout.
- On the hosted site, loading effects previously caused GPU freezes in some Mac Chrome and high-DPI setups. The snapshot includes a mitigation. Stability still awaits confirmation on the affected physical hardware.

## License

Puxian's original code is [MIT licensed](LICENSE). Third-party code, fonts, model weights and example scores retain their own terms. These include alphaTab under MPL-2.0 and its integrated notices, SIL OFL fonts, and CC BY or CC BY-SA scores with attribution requirements. See [third-party notices](docs/third-party.md) and [example score sources](docs/pd-examples.md).
