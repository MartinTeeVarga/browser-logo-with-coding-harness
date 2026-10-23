# Established project rules

## Product and layout

- Build a friendly, simple Logo drawing website. No navigation, decorative headings, or unrelated website sections.
- Label the two panels exactly `code` and `chat`.
- Keep the canvas square and anchored to the left. In landscape, code and chat use all remaining horizontal space. In square/portrait viewports, place the panels below the canvas.
- Keep code editable, collapsible, and syntax-highlighted for the actual interpreter dialect.
- Keep chat controls minimal: send on Enter; Shift+Enter inserts a newline. No model picker or extra chat tools.
- Use “code,” not “flower,” in the initial canvas instruction.
- Provide a sliding Slow mode switch beside Run. Slow mode highlights/autoscrolls the executing source line and animates the turtle without changing the program's results.

## Language and execution

- Berkeley Logo is the reference dialect, excluding native platform features. Full non-native language support is the goal.
- Do not claim full conformance while known gaps remain. Record limitations in `docs/COMPATIBILITY.md`.
- Program execution requires an explicit Run action. AI edits, restored drafts, and validation never execute candidate code.
- Keep execution in a worker so runaway code can be stopped without freezing the page.
- Ground the AI prompt in the interpreter's real signatures. `SETPOS [x y]`, `SETXY x y`, and `ARC angle radius` must not be confused. Heading 0 is north/up; 90 is east/right.

## AI and harness

- Use Puter with each user's own account and allowance. No application-owned shared quota or backend proxy.
- The selected model is `openai/gpt-6-luna`, with medium reasoning. No silent model fallback.
- The model returns only complete Logo source, without Markdown fences, prose, JSON, or foreign code.
- The harness may read the current code snapshot and replace editor code. It has no execution, filesystem, network, or browser tools available to the model.
- Validate before applying. After the initial response, allow up to three repair attempts with diagnostics. On failure, preserve code and report the failure in chat.
- Preserve user edits made during generation. Commit validated changes atomically and make them undoable.
- After an explicit Run reports a program error, automatically submit the failed source and interpreter diagnostic for repair when already signed in. Share a three-call budget across runtime repair attempts for that program. Repaired code still waits for an explicit Run; do not automatically execute it or open a background authentication popup.
- Read Puter allowance only for an already authenticated account. Do not trigger login just to display usage. Usage lookup failure must not break chat or appear as a zero balance.

## Development and delivery

- Deploy static files only. Node is for local development, tests, and builds; no runtime application server or secrets are required.
- Preserve relative asset paths and GitHub Pages repository-subpath support.
- Keep `PLAN.md` for the original task and agreed plan, and update `PROGRESS.md` with substantive changes and verification.
- Run appropriate tests and the static build after functional changes. Distinguish mocked checks from live browser/model verification.
- Preserve third-party notices and document modifications to vendored code.
- Keep work in local Git and commit completed changes when requested. Do not publish or push merely because a local commit was requested.
