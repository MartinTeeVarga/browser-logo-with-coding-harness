# Browser Logo — plan and progress

Status: Initial static application implemented. Full Berkeley conformance and live browser/Puter verification remain open.
Updated: 2026-10-23

Confirmed by user: Berkeley Logo is the language reference; native features are excluded. All AI requests must use each user's own quota/account. No application backend or application-owned shared AI quota. Puter.js is the confirmed AI provider.

## Product requirements

- Square drawing canvas takes most available page space.
- Editable, collapsible panel labeled `code`: right of canvas in landscape; below it in square/portrait viewports. Proposed landscape breakpoint: viewport aspect ratio > 1.2, subject to visual review.
- Panel labeled `chat`: below code in the landscape sidebar; below canvas/code in portrait. Input sends on Enter; Shift+Enter inserts a newline. No model picker, attachment tools, navigation, or decorative labels.
- Logo syntax highlighting. `Run` explicitly executes the current editor contents; AI edits never execute code.
- AI-backed chat reads current code and changes only editor code through a narrow browser harness.
- Reject invalid model output before modifying the editor. Retry repairs up to three times after the initial response, then report failure in chat and preserve code.

## Feasibility and decisions for review

1. **Language reference (confirmed):** Use the Berkeley Logo (UCBLogo) manual as the pinned compatibility reference, excluding native features. This is a substantial interpreter project, beyond turtle commands. Inventory every primitive and semantic feature before choosing to port an existing interpreter or implement one. Inspect reuse licenses first.
2. **Browser limits (confirmed):** Exclude native features such as OS shell commands and native filesystem/device integrations. Record excluded primitives in the compatibility matrix and return clear unsupported-feature diagnostics. Any virtual file operations need a separate explicit definition; native adapters are outside scope.
3. **Authentication constraints (confirmed):** Browser-only application; each user authorizes their own provider account and consumes their own allowance. Shared Firebase/Gemini project quota and a custom server proxy are rejected.
4. **AI provider (confirmed):** Use Puter.js browser sign-in and authorization against each user's own Puter allowance. No application backend, shared quota, or manually copied API keys. Verify the complete browser flow, available model quality, and allowance-exhaustion behavior during the initial integration. Select one model internally; no model picker. Do not initiate paid upgrades automatically.
5. **Validation limits:** Parsing and available static checks can reject malformed Logo and obvious errors. Dynamic instruction lists, generated procedures, and runtime values prevent a guarantee that every accepted program will execute successfully. Runtime diagnostics appear only after Run.

### User onboarding (confirmed: Puter.js)

User signs in/creates a Puter account and grants our website access. The browser SDK makes AI calls against that user's allowance. No developer backend or manually copied key. Provider signup/consent is user-controlled. Review allowance exhaustion and any provider upgrade prompts during integration; the app must report failures in chat and preserve editor contents. System-message support and model identifier were checked in official documentation. Actual account/model access remains unverified.

Firebase/shared quota is rejected. OpenRouter is an evaluated alternative, not part of the implementation.

## Implementation progress

- [x] Inspect the empty project and agree on Berkeley Logo without native features.
- [x] Confirm Puter, individual user allowances, no backend, and fully static hosting.
- [x] Build the responsive square canvas, collapsible code panel, chat, Run/Stop, and Logo syntax highlighting.
- [x] Integrate the Apache-licensed jslogo engine in a worker; extend it with Berkeley boolean words, protected quoted words, macros, cascade/transfer, goto/tag, pause/continue, stepping, special variables, and source-preserving FULLTEXT.
- [x] Add a non-executing worker validator using the engine reader/compiler, including procedure bodies and literal instruction templates.
- [x] Build the code replacement harness with current-source snapshots, three repair retries, atomic commits, revision conflict detection, and editor undo.
- [x] Connect the documented Puter browser SDK interface with system messages, a fixed text model, synchronous popup initiation, own-account usage, and provider error handling. Test these interfaces with mocks.
- [x] Add worker drawing/output/input, Stop, a 15-second execution bound, and local draft persistence.
- [x] Produce dependency-free Node development/build scripts and a relative-path static bundle. Include an optional manually triggered GitHub Pages workflow; no publication performed.
- [x] Record primitive inventory and compatibility gaps in `docs/COMPATIBILITY.md` and `docs/primitives.json`.
- [x] Pass 114 automated tests: language semantics, turtle geometry, worker lifecycle, actual app event handlers with DOM/editor adapters, AI retries/conflicts, runtime repair budgets, slow execution/source mapping, SDK mocks, account allowance behavior, and build integrity.
- [ ] Complete full non-native Berkeley conformance. Outstanding areas include exact error/recovery behavior, event action variables, original-line stepping details, legacy character representations, and inherited interpreter edge cases. The compatibility document is explicit about these limits.
- [ ] Verify responsive appearance and interactions in a live browser. The computer-use tool reported no available browser; both shell and Node preview listeners were denied by the environment with EPERM. No screenshots or browser QA are claimed.
- [ ] Verify live Puter sign-in, consent, model generation quality, and actual allowance-exhaustion prompts using a real user account. No account was available to authorize during this build; SDK integration was checked against official documentation and exercised with mocks.

Implementation choice: use plain JavaScript, vendored CodeMirror 5, and dependency-free Node scripts instead of the earlier proposed React/Vite scaffold. This keeps the application entirely static, removes the dependency installation requirement, and supports repository-subpath hosting. The build bundles worker sources so the interpreter also works from a directly opened built HTML file; Puter still requires an HTTP/HTTPS origin.

Local commands: `npm run dev`, `npm test`, `npm run build`, `npm run preview`. Static output: `dist/`.

## Harness contract and base prompt

Only one model-driven mutation: replace the editor's complete Logo source. The model receives a current-source snapshot and recent conversation. It has no execution, browser, network, or filesystem tools.

The current base prompt in `src/harness.js` supports Logo-focused discussion and redirects unrelated requests toward Logo. Prose-only replies are shown in chat without modifying code. Exactly one fenced `logo` block supplies a complete replacement program; explanation outside it stays in chat. Runnable examples also replace the editor, so the prompt avoids blocks for ordinary discussion. This replaces the original raw-source-only contract.

Validation pipeline: response size/explicit fence protocol → extract Logo block → dialect-aware reader/compiler and procedure-aware static checks → revision check → atomic undoable editor update. Reject foreign/untagged, multiple, empty, or malformed blocks. Never guess prose to be code or execute candidates during validation. Initial responses get up to three repair retries. Rejected code updates and runtime repairs cannot be completed with prose alone. Logo-only topic steering relies on the prompt/model; static code validation retains its documented dynamic-language limits.

## References

- Berkeley Logo manual: https://people.eecs.berkeley.edu/~bh/usermanual
- Berkeley Logo project: https://people.eecs.berkeley.edu/~bh/logo.html
- Gemini OAuth: https://ai.google.dev/gemini-api/docs/oauth
- Google browser authorization: https://developers.google.com/identity/oauth2/web/guides/overview
- Gemini API key security: https://ai.google.dev/gemini-api/docs/api-key
- Gemini free-tier availability/pricing: https://ai.google.dev/gemini-api/docs/pricing
- Firebase AI Logic browser integration: https://firebase.google.com/docs/ai-logic
- Firebase AI Logic setup: https://firebase.google.com/docs/ai-logic/get-started?platform=web
- Firebase AI Logic free-tier requirements: https://firebase.google.com/docs/ai-logic/pricing

Next work: live browser/Puter verification and the remaining Berkeley conformance work. See README.md for local use and static hosting.

## Follow-up: invalid house generation and Luna 6

- User confirmed local operation and provided a generated house program that fails. Reproduced the first failure: `setpos -380 -240` supplies two numbers, whereas Berkeley/jslogo SETPOS requires one `[x y]` list. SETXY is the two-number primitive.
- The initial prompt named Berkeley Logo but only supplied primitive names; it omitted concrete call signatures. The validator compiled the calls without checking literal input types and permitted unused literal values in procedure bodies. Both gaps are fixed.
- Added `src/logo/dialect.js`: one shared call-signature guide for the prompt and literal input validator, covering coordinate forms, ARC angle/radius order, headings, colors, and core control inputs. Candidate instructions remain unexecuted during validation.
- Added the exact original house as a failing fixture and a corrected `examples/house.logo`. Tests prove rejection/repair of the original, acceptance of computed/list coordinates, preservation of valid expression contexts, and execution of the corrected house with the real turtle engine.
- Switched from nano to `openai/gpt-6-luna` with medium reasoning at the user's request. Puter's current catalog and tutorial explicitly list this model. Retained the Puter endpoint, own-user quota model, and text-only/no-tools response contract. No silent fallback model.
- Live Luna generation remains unverified here; model selection and request settings are verified against provider documentation and adapter mocks. Refresh the running app to pick up these source changes.
- Model references: https://developer.puter.com/ai/models/ ; https://developer.puter.com/tutorials/free-unlimited-openai-api/ ; https://developers.openai.com/api/docs/models/gpt-6-luna

## Follow-up: layout, allowance, and repository records

- Anchored the canvas to the left, removed the centered maximum-width wrapper, and sized the landscape grid to one square canvas plus panels filling the rest of the window. Retained portrait/square stacking and code collapse behavior.
- Changed the empty canvas instruction to “Press Run to try the code.”
- Added the authenticated `getMonthlyUsage()` status read. The chat footer shows the account-wide remaining amount and percentage when available, with correct documented microcent conversion and support for explicitly labeled credit units.
- Refresh usage after sign-in, after each chat request, and on window focus. Reads have an eight-second UI timeout and a revision guard against stale responses. They never trigger login, block model generation, or turn a successful code edit into an error. Missing/invalid data displays unavailable rather than zero.
- Official API/schema references: https://docs.puter.com/Auth/getMonthlyUsage/ ; https://docs.puter.com/Objects/monthlyusage/ . SDK source was checked to confirm the public method is a direct authenticated metering read.
- Added `PLAN.md` with the original task and later confirmed decisions, established agent rules (now consolidated in `AGENTS.md`).
- Verification: all 84 automated tests and `npm run build` pass. New allowance tests cover signed-out behavior, account amounts, credits, unavailable/malformed responses, zero, and small balances. Live account usage and visual browser review were not accessible to the coding agent; the user has confirmed the existing application runs locally.
- Git request: attempted `git init -b main`; the environment rejected creating `the repository metadata directory` with `Operation not permitted`. No local repository or commit was created. All source is ready for the owner to run `git init -b main`, `git add .`, and `git commit -m "Build static Logo workspace with Puter chat and usage"` from this project directory.

## Follow-up: runtime repairs and Slow mode

- Reproduced the exact goulash sample: it passed the original static checks but threw `Expected number` in FILLED at runtime. FILLED requires a color plus an instruction list. Added that shared signature, better missing-input diagnostics, the original failing fixture, and `examples/goulash.logo` with explicit fill colors and correct path start positions.
- Worker failures now distinguish validation/execution errors from infrastructure/setup/rendering failures and include interpreter procedure, code, and source line where available.
- Program failures after explicit Run trigger automatic repair for an existing Puter session. The failed snapshot and diagnostic go to the same code-only harness; valid corrections are undoable and are never automatically executed. A shared three-call budget prevents repeated manual Runs from causing unbounded repair requests. Stale failures/newer edits are preserved, unchanged failed responses are rejected, and work is serialized with chat. Signed-out users are directed to connect through chat without an automatic popup.
- Added the requested sliding Slow mode switch. The worker emits source-line steps through procedure bodies and nested literal instruction blocks; CodeMirror highlights and scrolls to the current line. Movements, absolute positions, headings, relative turns, and pen appearance updates are paced, with a presentation-only visible cursor even when the Logo program hides its turtle. Switching off mid-run completes the operation; Stop remains explicit.
- Slow mode uses a no-progress watchdog and an instruction cap rather than counting deliberate animation toward the normal run's 15-second duration. Literal source mapping preserves the evaluator's original tokenization; generated code without a mapped origin uses the current calling line.
- Verification: all 104 automated tests pass, including the exact goulash rejection/corrected execution, runtime error diagnostics, repair exhaustion and edit preservation, real app event wiring without auto-execution, nested source-line sequences, slow/fast final-state equivalence, mode switching, and worker step/frame delivery. Live UI visual review and real model repair quality remain unverified in this environment.
- Commit requested again. `git status` confirmed there is still no local repository; another `git init -b main` attempt was rejected with `Operation not permitted` for `.git`. No commit has been created. This was the delivery blocker at that time; the repository now exists, but Git metadata writes remain blocked as recorded below.

Provider research references (2026-10-23):
- https://docs.puter.com/user-pays-model/
- https://docs.puter.com/security/
- https://openrouter.ai/docs/guides/overview/auth/oauth
- https://openrouter.ai/docs/api_reference/limits
- https://github.com/pollinations/pollinations/blob/main/BRING_YOUR_OWN_POLLEN.md

## Follow-up: conversational Logo replies (2026-10-23)

- Added Logo-focused conversation and the explicit single fenced `logo` block convention. Explanations remain chat text; only extracted, validated source reaches the editor. Conversation retains complete replies in memory for follow-up questions.
- Preserved manual Run, undo, concurrent edit protection, initial-plus-three validation attempts, and the shared runtime repair budget. Prose cannot bypass a failed code repair.
- Updated README, original plan/current decisions, agent rules, and compatibility notes. Added protocol, discussion, mixed-response, repair, and app event regression tests.
- Verification: all 114 automated tests pass and `npm run build` succeeds. Live model adherence and browser visual review remain unverified here.
- The repository exists and the original application is committed as `609558f`. The requested follow-up commit was attempted, but both staging and commit failed because creating `.git/index.lock` returned `Operation not permitted`. Changes remain in the working tree; no follow-up commit, push, or publication occurred.

## Follow-up: drawing speed and turtle pen (2026-10-23)

- Replaced the Slow mode switch with an accessible three-position Slow / Fast / Instant range slider, saved locally and adjustable during execution. Existing Slow preferences migrate to the new setting. Fast divides both instruction and movement delays by ten; rendering/browser scheduling adds its own overhead.
- Animated modes show a turtle silhouette at the current pen position, including when the program hides the turtle. Its color refreshes with the pen color; explicit frame rendering keeps the cursor aligned with drawing updates. Language visibility and shape remain unchanged.
- Run uses a square Stop icon throughout execution and restores its triangle afterward. The chat welcome now invites drawing requests, code changes, and Logo questions.
- Verification: all 117 automated tests pass, covering speed ratios/final-state equivalence, changing speed during motion, turtle rendering/color, slider event wiring, and Run/Stop icons. Static build succeeds. Live browser visual review remains unverified.

## Follow-up: consistent stylized turtle (2026-10-23)

- Matched the animated pen to the welcome turtle and favicon, simplifying all three to rounded flippers/head, an oval shell, and a single geometric shell detail. The moving turtle retains pen color and heading.
- Verification: all 117 automated tests pass and the static build succeeds. Browser visual review remains unverified.

## Security audit for GitHub Pages (2026-10-23)

- Reviewed `f1648d8` for a static Pages deployment. Findings, threat assumptions, source references, bounded reproductions, and remediation order are in `docs/SECURITY_AUDIT.md`.
- Confirmed CLEARTEXT resets the output counter: the real worker emitted 50,000 characters over ten clears without hitting the 20,000-character guard. Reviewed unbudgeted allocation paths and validated oversized allocation requests without executing dangerous sizes.
- Recorded conditional remote-SDK/shared-origin risks and browser policy/deployment workflow hardening gaps. No direct chat-XSS or Logo-to-JavaScript execution path was found in reviewed paths; this is not a comprehensive security guarantee.
- All 117 tests pass. No live deployment headers, browser exploit, real provider account, OOM stress test, or upstream advisory scan was verified. Application behavior is unchanged; findings remain open.

## Security fixes: allocation and output limits (2026-10-23)

- Addressed audit S3/S4 (user findings 2/3). Added a focused shared budget module, explicit interpreter allocation/depth/step checks, multidimensional preflight, and turtle limits. Budgets apply at every speed and through aliases/generated code. Animation now handles presentation only.
- Extracted buffered program output with cumulative character/operation budgets that clears cannot reset. Added independent receiving-page checks before DOM changes. Resource and watchdog stops preserve code and do not consume automatic AI repair quota.
- Recorded the preference for simple, readable code over cleverness in the agent instructions (now consolidated in `AGENTS.md`). Updated README, compatibility/third-party notes, plan, and the audit's remediation status.
- Verification: all 154 tests pass and static build succeeds, including the original allocation/output reproductions, empty loops at all speeds, nested/cyclic structures, expanded output, and receiving-page rejection. Counters are conservative application allocation units, not exact heap-byte limits. Live browser low-memory testing remains outstanding.

## Agent instruction consolidation (2026-10-24)

- Consolidated all established rules and the original agent entry-point guidance into the conventional root `AGENTS.md`. Removed the duplicate lowercase file and updated README/plan/progress references.
- Verified the diff and references. Documentation-only change; application tests/build were not rerun.
