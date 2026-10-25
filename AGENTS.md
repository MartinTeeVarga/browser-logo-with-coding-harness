# Agent instructions

The original task and agreed plan are in [PLAN.md](PLAN.md). Keep [PROGRESS.md](PROGRESS.md) up to date with substantive changes, verification, and remaining limitations.

## Product and layout

- Build a friendly, simple Logo drawing website without decorative headings or unrelated sections. The small application menu contains the turtle (About), Examples, and a direct GitHub repository link without a submenu. About explains Logo and credits/licenses; example selection loads editable code and never runs it. Link license documents to their readable GitHub pages.
- Label the two panels exactly `code` and `chat`.
- Keep the canvas square and anchored to the left. In landscape, code and chat use all remaining horizontal space. In square/portrait viewports, place the panels below the canvas.
- Keep code editable, collapsible, and syntax-highlighted for the actual interpreter dialect.
- Keep chat controls minimal: send on Enter; Shift+Enter inserts a newline. Slash commands are handled locally, starting with `/model` and a searchable model chooser. Do not send slash commands to the LLM.
- Provide a draggable, keyboard-accessible divider between code and chat, preserving the preferred size ratio locally. Collapse temporarily hides the divider without losing that preference.
- Keep the welcome mark, favicon, and animated turtle pen visually consistent: a minimal rounded turtle with an oval shell and geometric shell detail.
- Use “code,” not “flower,” in the initial canvas instruction. The chat welcome invites drawing requests, code changes, and questions about Logo.
- Provide a three-position speed slider beside Run: Slow (original pacing), Fast (one-tenth of the animation delays), and Instant (unpaced). Animated modes highlight/autoscroll the executing source line and use a visible turtle as the moving pen in its current color, without changing language results. Run shows a triangle while idle and a square while running.

## Language and execution

- Berkeley Logo is the reference dialect, excluding native platform features. Full non-native language support is the goal.
- Do not claim full conformance while known gaps remain. Record limitations in `docs/COMPATIBILITY.md`.
- Program execution requires an explicit Run action. AI edits, restored drafts, and validation never execute candidate code.
- Keep execution in a worker so runaway code can be stopped without freezing the page. Enforce allocation, value-size, nesting/call-depth, turtle, and execution-step budgets in every speed; animation must never control safety.
- Output character and message budgets are cumulative for each Run. CLEARTEXT cannot reset them. Batch small writes and validate received output before DOM updates.
- Resource-limit and watchdog failures stop locally without automatic AI repair; do not spend user quota on safety stops.
- Ground the AI prompt in the interpreter's real signatures. `SETPOS [x y]`, `SETXY x y`, and `ARC angle radius` must not be confused. Heading 0 is north/up; 90 is east/right.

## AI and harness

- Use Puter with each user's own account and allowance. No application-owned shared quota or backend proxy.
- Default to `openai/gpt-6-luna`. Let users select any chat/completion model in Puter’s live catalog using `/model`; persist the selection and print it before the allowance. No silent model fallback. Capture the selection for each request and all its repairs; pass model-specific reasoning options only to supported models.
- Use reported token pricing for model cost bands: $ up to $2, $$ up to $15, $$$ above $15 for 1M input plus 1M output tokens. Show unknown pricing explicitly and actual rates when available; do not infer prices from names.
- Keep chat about Logo: explanation, drawing ideas, debugging, and learning. Prompt the model to steer unrelated requests back to Logo.
- Replies may contain conversational prose and optionally exactly one fenced `logo` block with the complete replacement program. No block means no editor change. Extract only the block contents, validate them as Logo, and keep explanations in chat. Reject foreign, untagged, multiple, empty, or malformed code blocks; never guess prose to be editor code.
- Code repairs must return a corrected complete Logo block; prose alone cannot satisfy a repair. Topic steering for prose is a prompt instruction, not a deterministic semantic guarantee.
- The harness may read the current code snapshot and replace editor code. It has no execution, filesystem, network, or browser tools available to the model.
- Validate before applying. After the initial response, allow up to three repair attempts with diagnostics. On failure, preserve code and report the failure in chat.
- Preserve user edits made during generation. Commit validated changes atomically and make them undoable.
- After an explicit Run reports a program error, automatically submit the failed source and interpreter diagnostic for repair when already signed in. Share a three-call budget across runtime repair attempts for that program. Repaired code still waits for an explicit Run; do not automatically execute it or open a background authentication popup.
- Read Puter allowance only for an already authenticated account. Do not trigger login just to display usage. Usage lookup failure must not break chat or appear as a zero balance.

## Development and delivery

- Prefer readability and simplicity over clever code. Use explicit control flow, small focused modules, and straightforward security checks. Centralize checks where practical and keep them easy to review; avoid unnecessary abstractions.
- Deploy static files only. Node is for local development, tests, and builds; no runtime application server or secrets are required.
- Preserve relative asset paths and GitHub Pages repository-subpath support.
- Keep `PLAN.md` for the original task and agreed plan, and update `PROGRESS.md` with substantive changes and verification.
- Run appropriate tests and the static build after functional changes. Distinguish mocked checks from live browser/model verification.
- License original project code/documentation under MIT. Keep modified jslogo files under Apache-2.0 and preserve CodeMirror's MIT license. Include license texts/attributions in static distributions.
- Preserve third-party notices and document modifications to vendored code, including prominent change notices in Apache-licensed files.
- Keep work in local Git and commit completed changes when requested. Do not publish or push merely because a local commit was requested.
