# Browser Logo — original task and plan

## Original task

Build a browser-based Logo programming-language interpreter with full language support. Users should primarily create and change programs through AI chat instead of writing code by hand.

The original requested interface:

1. A square drawing canvas occupying most of the page.
2. An editable code window, below the canvas for square/portrait viewports and to its right for landscape viewports. The code window is collapsible and has Logo syntax highlighting.
3. A chat window where AI writes and changes the code.

Use only the panel labels **code** and **chat**. Do not add navigation, decorative website headings, or extra chat controls. Enter sends a chat message. Code runs only when the user presses **Run**, never when the AI changes it.

The coding harness reads the current editor contents and can only change code in that editor. The original contract required the model to return only Logo source (superseded by the conversational reply convention below). Its base prompt must enforce that contract. Validate candidate Logo before applying it; if invalid, send diagnostics back and retry up to three times, then fail visibly and preserve the previous code.

The initial provider proposal was Gemini with a free tier and browser sign-in. The user requested a concise plan and a progress document before authorizing implementation.

## Confirmed decisions and later requirements

- Use **Berkeley Logo**, excluding native OS, filesystem, hardware, and desktop integration features. Full non-native conformance remains the goal; do not silently reduce this to turtle-only Logo.
- Use **Puter.js** so each user authorizes their own account and consumes their own allowance. No shared application quota, backend proxy, or manually copied API keys.
- Use **GPT-6 Luna**, currently `openai/gpt-6-luna`, with medium reasoning. Do not fall back to another model silently.
- The entire deployed site must be static and support GitHub Pages, including repository subpaths. Node is permitted for local development, tests, and builds.
- Keep the design friendly and simple. Anchor the canvas at the left; in landscape, code and chat fill all horizontal space remaining beside the square canvas.
- The initial canvas message says **“Press Run to try the code.”**
- Display the user's remaining Puter allowance when the API makes it available. Show unavailable status rather than inventing a balance, and keep chat usable if the lookup fails.
- Automatically repair interpreter errors reported after Run: submit the failed program and diagnostic, validate the response, preserve newer edits, and keep repaired execution manual.
- Provide a Slow / Fast / Instant speed slider. Slow retains the original pacing; Fast uses ten times shorter animation delays. Animated modes use a turtle as the moving pen, with source-line highlighting/autoscroll and current pen color. Run changes its triangle to a square while executing. The welcome invites drawings and Logo questions.
- Allow Logo-focused conversation with optional explanations. Exactly one fenced `logo` block supplies a complete editor replacement; prose-only answers leave the editor unchanged. Validate extracted code, reject foreign/ambiguous code blocks, and steer unrelated chat back to Logo. This supersedes the original source-only response contract.
- Keep a local Git repository and commit the work. Store these requirements and established agent rules in the project.

## Implementation plan and status

- [x] Build the static workspace and responsive code/chat layout.
- [x] Integrate and extend a browser Logo runtime with native-feature rejection and worker isolation.
- [x] Add syntax highlighting, manual Run/Stop, editor undo, and local code drafts.
- [x] Add the Puter account connection and model adapter.
- [x] Implement the narrow code-editing harness, parser validation, repair retries, and concurrent-edit protection.
- [x] Support Logo conversation and a single explicit Logo-block editor update, with protocol validation and preserved repair limits.
- [x] Share concrete Logo call signatures between the prompt and validator; cover reported house-code failures with regression tests.
- [x] Add left-aligned layout, flexible remaining panel width, corrected empty-state text, and account allowance display.
- [x] Add runtime error repair, FILLED signature validation, and a corrected goulash regression example.
- [x] Add Slow mode with source mapping through procedures/nested loops, interpolated turtle movement, and a visible execution cursor.
- [x] Add this plan, `agent.md`, and the agent entry point `AGENTS.md`.
- [ ] Complete full non-native Berkeley conformance; see `docs/COMPATIBILITY.md` for specific gaps.
- [ ] Complete visual/browser and live-account verification where environment access permits it.
- [x] Initialize Git and commit the original application (`609558f`). Follow-up staging/commit remains blocked by the environment denying `.git/index.lock`; see `PROGRESS.md`.

See `PROGRESS.md` for current verification results and implementation details.
