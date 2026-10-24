# Logo

A quiet, browser-based drawing space: a square canvas, a collapsible Logo editor, and chat powered by the user's own Puter account.

## Run locally

Node 20 or newer is sufficient. There are no npm dependencies to install.

```sh
npm run dev
```

Open `http://127.0.0.1:5173`. Press **Run** to draw the starter flower. Type a request into chat and press Enter; Puter opens its sign-in/authorization popup when needed. Shift+Enter adds a newline. AI edits remain unexecuted until Run. The editor supports undo, including AI replacements, and saves the code draft locally in the browser.

Drag the divider between code and chat to choose their size ratio. It also supports Arrow Up/Down and Home/End when focused, and remembers your choice. Collapsing code temporarily hides the divider.

The small turtle menu opens About, with a short explanation of Logo, authorship, and readable GitHub license links. **Examples → Mona Lisa** loads the supplied portrait program into the editor as an undoable change; press Run to draw it. The code is included at [examples/mona-lisa.logo](examples/mona-lisa.logo).

The square canvas is anchored to the left. In landscape, it grows to fit the window height and the code/chat panels fill the remaining width, without a centered maximum-width wrapper. Square/portrait windows stack the panels below the canvas. The initial instruction reads “Press Run to try the code.”

Run becomes Stop during execution. Programs run in a dedicated worker. Normal mode has a 15-second execution limit. The chat welcome invites drawing requests, code changes, and questions about Logo. A program that requests input gets an input field below the canvas; time spent awaiting input does not count toward that limit. Program output also appears below the canvas when needed.

Use the speed slider beside Run: **Slow** keeps the original animation speed, **Fast** uses ten times shorter pacing delays, and **Instant** runs without animation delays. Both animated speeds use a turtle as the moving pen, follow its current pen color, and highlight/autoscroll the active source line. Code expands automatically when an animated run starts. You can change speed during execution; the selection is saved locally. The Run triangle becomes a Stop square while running. Animated modes use a 15-second no-progress watchdog, so intentional animation can take longer than an Instant run. Every speed shares the same execution-step and allocation limits. The turtle stays visible during animated playback even when the program uses HIDETURTLE; it does not change the value of SHOWNP or the final drawing. Dynamically assembled instructions without an original source location use the calling line.

Browser safety limits apply independently of speed:

| Limit per Run | Allowance |
| --- | --- |
| Evaluation/loop/graphics steps | 20,000 |
| Individual word or collection | 100,000 characters/elements |
| Cumulative allocation units | 2,000,000 |
| Data nesting / call depth | 100 |
| Turtle indices | 0–63 |
| Total output | 20,000 characters |
| Output operations, including empty writes and clears | 1,000 |

Allocation units account for guarded collection slots, word construction, copies, parsing, and formatting. They are conservative application counters, not measured JavaScript heap bytes. Multidimensional arrays are checked before construction. Limits also apply to aliases and generated Logo; data-size/copy checks apply during validation. Small output writes are batched, and the page independently checks received output. Clearing output does not restore its allowance. Resource-limit and watchdog stops preserve the editor and do not trigger automatic AI repair. Each manual Run gets fresh budgets.

## Static hosting

```sh
npm run build
```

Upload the **contents of `dist/`** to GitHub Pages or any static host. All application asset paths are relative, so both a custom domain and a repository subpath such as `/browser-logo/` work. There is no server endpoint, environment variable, application API key, or shared inference quota.

GitHub Pages is deployed by `.github/workflows/pages.yml` on every push to `main`, after tests and the static build pass. You can also run **Actions → Publish static Logo site → Run workflow** manually. Pages uses **GitHub Actions** as its publishing source. The live site is https://martinteevarga.github.io/browser-logo-with-coding-harness/.

`npm run preview` serves the built site locally. You can also open `dist/index.html` directly to use the interpreter, but **Puter authentication requires HTTP localhost or HTTPS hosting**, not a `file://` origin.

Only AI chat requires internet access. The drawing engine, editor, styles, and syntax highlighting are included in the static files. A current browser with module workers, OffscreenCanvas, and createImageBitmap is required.

## AI and code validation

The default model is `openai/gpt-6-luna`. Type **`/model`** and press Enter to open a searchable chooser populated by [`puter.ai.listModels()`](https://docs.puter.com/AI/listModels/). All returned chat/completion models and explicit variants can be selected; there is no provider allowlist. `/model claude` opens with a search, and unknown slash commands are reported locally without an AI request. The selected model is saved in your browser and displayed before the remaining allowance. Each chat or runtime repair captures that model for all its attempts. The adapter keeps medium reasoning for the default Luna model, uses provider defaults for other selections, and respects smaller advertised output limits. It does not fall back silently if a model is unavailable. Puter's SDK is loaded from its official `https://js.puter.com/v2/` endpoint. Users authorize their own accounts; model usage and any repair attempts consume their individual Puter allowance. The app never buys credits or switches models automatically. Provider-owned upgrade or permission dialogs remain under the user's control.

Chat can explain the current program, discuss drawing ideas, and teach Logo without changing the editor. The system prompt keeps conversation about Logo and steers unrelated requests toward a Logo activity. This topic steering relies on model behavior; the app does not claim a deterministic semantic filter for prose.

Model prices come from the catalog’s `cost` metadata (USD cents per token block), normalized to USD per million tokens. The chooser labels **$** cheap (up to $2), **$$** reasonable (up to $15), and **$$$** expensive (above $15), comparing a fixed workload of 1M input plus 1M output tokens. Individual input/output rates are shown. These are comparison bands, not a quote for a chat message; zero token rates are identified as free, and missing/unsupported pricing is marked `?` rather than guessed. Listing does not itself generate a completion or intentionally sign the user in.

The harness supplies recent conversation and the current editor snapshot. Replies use this convention:

- **Prose only:** display the answer in chat and leave the editor unchanged.
- **Exactly one fenced `logo` block:** treat its contents as the complete replacement program. Display any explanation outside the block in chat. Even a runnable example replaces the whole editor; the prompt avoids code blocks during discussion unless an edit is intended.

For example, an answer can say “Here is a square,” followed by:

```logo
repeat 4 [fd 100 rt 90]
```

Only `repeat 4 [fd 100 rt 90]` enters the editor, after validation. Untagged/foreign blocks, multiple blocks, empty or malformed fences, tool calls, non-Logo syntax, invalid literal instruction bodies, and native commands are rejected. Unfenced text is never guessed to be an editor update. The first response permits three repair requests with diagnostics; once a code update is rejected, prose alone cannot satisfy its repair. Invalid responses never enter the editor. A revision check prevents code updates from overwriting user edits made in the meantime. Chat text is rendered as plain text, without evaluating HTML.

Recent complete replies (including the Logo block when present) stay in memory as conversation context; only code is persisted locally.

Validation reads and compiles in a separate worker without running candidate instructions. It cannot prove that a dynamic Logo program will finish or avoid runtime errors. See [compatibility notes](docs/COMPATIBILITY.md) for the exact implementation status; **full Berkeley Logo conformance is not yet complete**.

The prompt and literal input checks share a dialect contract in `src/logo/dialect.js`. In particular, `setpos` takes one coordinate list (`setpos [-380 -240]`), `setxy` takes two numbers (`setxy -380 -240`), and `arc` takes angle before radius (`arc 100 14`). Heading 0 points up; heading 90 points right. A corrected [house example](examples/house.logo) is included.

`FILLED` also requires two inputs: `filled color [instructions]`. The prompt and validator reject a missing color, including the reported goulash example; [corrected code](examples/goulash.logo) is included.

When an explicit Run reports a program error, the app automatically sends the failed source and interpreter diagnostic (including procedure/line when available) to Puter for repair. Only a validated correction enters the editor, as an undoable change, and **you press Run to execute it**. Three model calls are allowed across automatic runtime repairs for the current program; a manual edit, new chat edit, or successful Run resets that budget. Returning unchanged failed code is rejected. User edits made since the failed Run are preserved. Automatic repair requires an existing Puter sign-in and never opens a background login popup. Infrastructure errors such as a worker failing to start are reported rather than submitted as code repairs.

After sign-in, the chat footer shows the remaining allowance for the whole Puter account when available through [`getMonthlyUsage()`](https://docs.puter.com/Auth/getMonthlyUsage/). It refreshes after each request (including repairs/failures) and when the page regains focus. Explicit credit units are preserved; the documented microcent amounts are converted to USD. No token-count estimate is invented. If the lookup fails or is unsupported, the footer says the allowance is unavailable and chat continues normally. Signed-out users are never prompted to authenticate just for this status read.

Chat messages, the current program, and repair diagnostics go directly from the browser to Puter. This project stores code, collapse/speed/panel-ratio preferences, and the selected model in local browser storage; it has no database or analytics.

## Verify

```sh
npm test
npm run build
```

The tests cover interpreter semantics, turtle geometry, worker input/output, invalid code, runtime repair budgets, stale/concurrent edits, actual app event handlers with DOM/editor adapters, slow execution/source mapping, Puter SDK integration through mocks, and static build integrity. Browser visual review and live Puter account access must be checked in a real browser; neither was available in the build environment.

## License

Original project code and documentation are available under the [MIT License](LICENSE). Vendored jslogo files, including local modifications, remain under Apache-2.0; CodeMirror retains its MIT license. Keep their license texts and copyright notices when redistributing. See [THIRD_PARTY.md](THIRD_PARTY.md) for scope and attribution. The static build includes the required license documents. Puter.js and its hosted services remain subject to their provider's terms.

## Credits

- Logo and turtle engine adapted from [Joshua Bell's jslogo](https://github.com/inexorabletash/jslogo), Apache 2.0. Local changes are listed in [THIRD_PARTY.md](THIRD_PARTY.md).
- [CodeMirror 5](https://codemirror.net/5/), MIT license, with a local Logo syntax mode.
- [Puter.js](https://docs.puter.com/) for browser authentication and AI access.

See [PROGRESS.md](PROGRESS.md) for completed work and outstanding verification.

The original requirements and agreed plan are in [PLAN.md](PLAN.md). Established project rules and agent instructions are in [AGENTS.md](AGENTS.md).
