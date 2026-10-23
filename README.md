# Logo

A quiet, browser-based drawing space: a square canvas, a collapsible Logo editor, and chat powered by the user's own Puter account.

## Run locally

Node 20 or newer is sufficient. There are no npm dependencies to install.

```sh
npm run dev
```

Open `http://127.0.0.1:5173`. Press **Run** to draw the starter flower. Type a request into chat and press Enter; Puter opens its sign-in/authorization popup when needed. Shift+Enter adds a newline. AI edits remain unexecuted until Run. The editor supports undo, including AI replacements, and saves the code draft locally in the browser.

The square canvas is anchored to the left. In landscape, it grows to fit the window height and the code/chat panels fill the remaining width, without a centered maximum-width wrapper. Square/portrait windows stack the panels below the canvas. The initial instruction reads “Press Run to try the code.”

Run becomes Stop during execution. Programs run in a dedicated worker. Normal mode has a 15-second execution limit. A program that requests input gets an input field below the canvas; time spent awaiting input does not count toward that limit. Program output also appears below the canvas when needed.

Turn on the sliding **Slow mode** switch beside Run to animate movement and turns, show pen changes, and follow the active source line with highlighting and autoscroll. Code expands automatically when a slow run starts. You can toggle the switch during execution; Stop remains available. Slow mode uses a 15-second no-progress watchdog and a 20,000-instruction limit, so intentional animation can take longer than a normal run. An execution cursor stays visible during slow playback even when the program uses HIDETURTLE; it does not change the value of SHOWNP or the final drawing. Dynamically assembled instructions without an original source location use the calling line.

## Static hosting

```sh
npm run build
```

Upload the **contents of `dist/`** to GitHub Pages or any static host. All application asset paths are relative, so both a custom domain and a repository subpath such as `/browser-logo/` work. There is no server endpoint, environment variable, application API key, or shared inference quota.

For GitHub Pages, a manually triggered workflow is included at `.github/workflows/pages.yml`. In the repository's Pages settings, select **GitHub Actions** as the source, then run the workflow. The repository owner controls publication; this project has not been deployed by the coding agent.

`npm run preview` serves the built site locally. You can also open `dist/index.html` directly to use the interpreter, but **Puter authentication requires HTTP localhost or HTTPS hosting**, not a `file://` origin.

Only AI chat requires internet access. The drawing engine, editor, styles, and syntax highlighting are included in the static files. A current browser with module workers, OffscreenCanvas, and createImageBitmap is required.

## AI and code validation

The Puter adapter uses `openai/gpt-6-luna` with medium reasoning, selected internally in `src/puter.js`. This model is listed in [Puter's model catalog](https://developer.puter.com/ai/models/). Puter's SDK is loaded from its official `https://js.puter.com/v2/` endpoint. Users authorize their own accounts; model usage and any repair attempts consume their individual Puter allowance. The app never buys credits or switches models automatically. Provider-owned upgrade or permission dialogs remain under the user's control.

The harness supplies conversation context and the current editor snapshot to the model. The only accepted result is a complete Logo replacement. It rejects tool calls, Markdown wrappers, non-Logo syntax, invalid literal instruction bodies, and native commands before applying the response. It permits the first generation plus three repair requests with parser diagnostics. Invalid responses never enter the editor. A revision check prevents generation from overwriting user edits made in the meantime.

Validation reads and compiles in a separate worker without running candidate instructions. It cannot prove that a dynamic Logo program will finish or avoid runtime errors. See [compatibility notes](docs/COMPATIBILITY.md) for the exact implementation status; **full Berkeley Logo conformance is not yet complete**.

The prompt and literal input checks share a dialect contract in `src/logo/dialect.js`. In particular, `setpos` takes one coordinate list (`setpos [-380 -240]`), `setxy` takes two numbers (`setxy -380 -240`), and `arc` takes angle before radius (`arc 100 14`). Heading 0 points up; heading 90 points right. A corrected [house example](examples/house.logo) is included.

`FILLED` also requires two inputs: `filled color [instructions]`. The prompt and validator reject a missing color, including the reported goulash example; [corrected code](examples/goulash.logo) is included.

When an explicit Run reports a program error, the app automatically sends the failed source and interpreter diagnostic (including procedure/line when available) to Puter for repair. Only a validated correction enters the editor, as an undoable change, and **you press Run to execute it**. Three model calls are allowed across automatic runtime repairs for the current program; a manual edit, new chat edit, or successful Run resets that budget. Returning unchanged failed code is rejected. User edits made since the failed Run are preserved. Automatic repair requires an existing Puter sign-in and never opens a background login popup. Infrastructure errors such as a worker failing to start are reported rather than submitted as code repairs.

After sign-in, the chat footer shows the remaining allowance for the whole Puter account when available through [`getMonthlyUsage()`](https://docs.puter.com/Auth/getMonthlyUsage/). It refreshes after each request (including repairs/failures) and when the page regains focus. Explicit credit units are preserved; the documented microcent amounts are converted to USD. No token-count estimate is invented. If the lookup fails or is unsupported, the footer says the allowance is unavailable and chat continues normally. Signed-out users are never prompted to authenticate just for this status read.

Chat messages, the current program, and repair diagnostics go directly from the browser to Puter. This project stores only code and collapse preference in local browser storage; it has no database or analytics.

## Verify

```sh
npm test
npm run build
```

The tests cover interpreter semantics, turtle geometry, worker input/output, invalid code, runtime repair budgets, stale/concurrent edits, actual app event handlers with DOM/editor adapters, slow execution/source mapping, Puter SDK integration through mocks, and static build integrity. Browser visual review and live Puter account access must be checked in a real browser; neither was available in the build environment.

## Credits

- Logo and turtle engine adapted from [Joshua Bell's jslogo](https://github.com/inexorabletash/jslogo), Apache 2.0. Local changes are listed in [THIRD_PARTY.md](THIRD_PARTY.md).
- [CodeMirror 5](https://codemirror.net/5/), MIT license, with a local Logo syntax mode.
- [Puter.js](https://docs.puter.com/) for browser authentication and AI access.

See [PROGRESS.md](PROGRESS.md) for completed work and outstanding verification.

The original requirements and agreed plan are in [PLAN.md](PLAN.md). Established project rules are in [agent.md](agent.md), with [AGENTS.md](AGENTS.md) as the agent entry point.
