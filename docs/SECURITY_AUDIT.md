# Security audit: static GitHub Pages deployment

Date: 2026-10-23. Reviewed commit: `f1648d8`.

Remediation update (2026-10-23): S3 and S4 are addressed by the follow-up below. Original finding descriptions and probe results are retained as audit history. Other findings remain open.

## Scope and conclusion

Source review of the page, AI adapter/harness, Logo runtime and worker boundary, storage, build, vendored runtime integration, and Pages workflow. Assumed deployment is the built `dist/` at `https://OWNER.github.io/browser-logo/`, with individual Puter sign-in. No application server or shared application API key exists.

No direct chat-to-HTML injection or Logo-to-JavaScript execution path was found in the reviewed application paths. This is not proof that the interpreter or vendored editor is free of vulnerabilities. The main exposures are a fully trusted, mutable remote SDK, a potentially shared Pages origin, and incomplete resource budgets for untrusted programs. Keep arbitrary programs behind manual Run.

This was a local source audit with bounded probes and the existing automated tests. No deployed URL was supplied: actual HTTP response headers, browser framing behavior, GitHub repository/environment settings, live Puter consent/session isolation, current CDN bytes, and upstream dependency advisories were not verified. No account, billing, or production attack was exercised. Product behavior has not been changed by this audit.

## Prioritized findings

| ID | Severity | Finding | Evidence strength |
| --- | --- | --- | --- |
| S1 | High impact, conditional | Live third-party SDK executes with application-page privileges | Script inclusion confirmed; upstream compromise is a prerequisite, not an observed event |
| S2 | Medium, conditional | Project subpaths share the Pages origin and storage | Platform behavior and app storage confirmed; an untrusted sibling project is a prerequisite |
| S3 | Medium | Program allocations have no memory budget | Unbounded allocation paths reviewed; oversized source accepted; only bounded allocation executed |
| S4 | Medium | CLEARTEXT bypasses cumulative output protection | Reproduced in the actual drawing worker |
| S5 | Low; potentially Medium for deceptive UI | No application-defined CSP or framing protection | Source/build confirmed; actual deployed headers and clickjacking exploit untested |
| S6 | Low | Deployment workflow grants build jobs excessive permissions and uses mutable action tags | Workflow confirmed; no compromised action observed |

Severity considers this app's limited assets and manual Run requirement. None of these findings demonstrates arbitrary remote access to another visitor or the hosting account. S1 is a trust/supply-chain risk with high consequences, not a discovered Puter vulnerability.

### S1 — The live Puter script can bypass every application-level guard

Evidence: [index.html](../index.html#L13) loads `https://js.puter.com/v2/` on every visit, with no integrity hash. The script executes directly in the application document. [src/puter.js](../src/puter.js) exposes authenticated model calls through the global SDK.

If that script delivery is compromised, replacement JavaScript can read editor/chat DOM and origin storage, change the page or harness, and attempt authenticated Puter operations using the user's granted app permissions. The Logo validator, no-tools prompt, and worker do not constrain script already executing in the main page. This does not imply unrestricted access to the user's entire Puter account; provider permissions still apply. Session-token storage details were not audited.

Recommended fix: evaluate a reviewed, pinned SDK release or vendored snapshot with an explicit update process. If using SRI on a remote immutable asset, verify its CORS support and test sign-in/model calls; blindly hashing the moving `/v2/` endpoint would break the app on updates. Check secondary assets loaded by the SDK as well. A stronger design places the SDK/auth bridge on a separate origin with a strict, minimal message protocol and no editor access, but that is a larger architectural change. A CSP permitting the SDK cannot by itself make compromised allowed SDK code trustworthy.

References: [MDN: Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Subresource_Integrity), [Puter security/permissions](https://docs.puter.com/security/).

### S2 — A repository path is not an isolation boundary

Evidence: [src/main.js](../src/main.js#L64) restores and saves `logo.source.v1` in localStorage. Preferences use other `logo.*` keys. On default Pages hosting, `OWNER.github.io/one-project/` and `OWNER.github.io/browser-logo/` share the same scheme/host/port.

JavaScript running on another project under that same origin can read or alter the saved Logo draft. Two copies of this app also collide on the same storage keys. A compromised or less-trusted sibling site is therefore in the draft's trust boundary. General same-origin DOM access can also matter when pages are opened or framed together. This does not apply to arbitrary different owners on `OTHER.github.io`, which are different origins. The exact way Puter identifies applications under sibling paths remains unverified; do not assume independent account permissions for repository paths.

Recommended fix: use a dedicated hostname/custom subdomain for this app, maintain control of its DNS, and verify the custom domain in GitHub. Namespacing storage keys by deployment path prevents accidental collisions but does not protect against hostile same-origin JavaScript. Keep less-trusted Pages projects on separate hostnames.

References: [GitHub Pages URL structure](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [MDN: Same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy), [GitHub: custom domain security](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages).

### S3 — Valid Logo can request excessive memory before the watchdog fires

Evidence: [LogoArray constructor](../src/logo/vendor/logo.js#L248) creates one empty list per array element with no upper bound. ARRAY and MDARRAY at approximately lines 1710–1735 accept dimensions and recursively allocate. [src/main.js](../src/main.js#L233) terminates execution after 15 seconds without progress; [src/logo/slow.js](../src/logo/slow.js#L3) adds a 20,000-instruction limit only in animated mode. A single primitive can allocate a large amount of memory before either guard helps.

These programs pass static validation (deliberately NOT executed at these sizes):

```logo
make "a array 1000000000
```

```logo
make "a mdarray [10000 10000]
```

A bounded `array 2000` allocation was executed to confirm the path. Memory exhaustion/browser process failure was not induced. Predicted impact is local tab/browser resource exhaustion after a user presses Run on generated or pasted code. Workers improve responsiveness and cancellation, but do not provide an application-enforced memory quota. Input size caps cannot bound allocations generated from a short program.

Recommended fix: enforce a documented per-run allocation budget before creating arrays/lists/words, check multidimensional products safely, bound active turtles and generated collections, and apply an instruction budget in every speed. Audit stringification, recursive structures, and graphics operations for work occurring inside one primitive. Retain the wall-clock watchdog. Treat resource-limit failures as terminal local failures rather than automatically spending AI quota on repair. Budgets are browser execution limits, not dialect changes.

### S4 — Clearing the display resets the only output budget

Evidence: [src/logo/draw.worker.js](../src/logo/draw.worker.js#L73) counts characters in `write()`, but `clear()` resets `outputLength` to zero. [src/main.js](../src/main.js) immediately processes each output and clear-output message in the DOM. There is no cumulative message count/rate limit or batching/backpressure.

Bounded reproduction:

```logo
make "chunk "x
repeat 12 [make "chunk (word :chunk :chunk)]
repeat 10 [type :chunk cleartext]
```

This creates a 4,096-character word and produces 40,960 characters across ten clears. A local interpreter probe using the worker's counter policy confirmed that result. A separate probe against the actual drawing worker emitted a 5,000-character literal ten times with CLEARTEXT and completed with **50,000 output characters and ten clear messages**, despite the 20,000-character protection. Canvas APIs were mocked; the worker and interpreter were real.

Clearing keeps the visible buffer small, but does not undo messages already sent or DOM work already performed. A longer loop can create excess message/DOM traffic and undermine timely UI processing. Large-scale browser unresponsiveness was not tested.

Recommended fix: maintain separate visible-buffer and lifetime-output counters, and reset only the visible buffer on CLEARTEXT. Add a per-run message budget, batch text delivery, and cap total output in the receiving page as a second line of defense. Clear operations must also consume the message budget.

### S5 — Missing browser-level defense in depth

Evidence: [index.html](../index.html) has no CSP/referrer-policy metadata; [scripts/build.mjs](../scripts/build.mjs) copies the page and builds Blob workers without adding a policy. The repository contains no deployment mechanism defining CSP or anti-framing response headers. This is a source/configuration finding; the eventual hosting response headers must be inspected before concluding that a live page is frameable.

Without an applicable CSP, future HTML/script injection has fewer browser restrictions. Without anti-framing protection, deceptive framing could induce actions such as Run or Submit in an already authorized session. No framing exploit or provider-consent bypass was demonstrated. Rendering text with `textContent` already prevents the obvious chat-XSS path.

Recommended fix: test a restrictive meta CSP on the built app, permitting only the necessary script/frame/connect endpoints and `worker-src 'self' blob:` for the current bundle. Avoid `unsafe-eval`; verify CodeMirror's dynamic styles and Puter's actual popup/frame/API requirements before enforcing a policy. Set `base-uri 'none'`, `object-src 'none'`, and an appropriate `form-action`; add an explicit referrer policy. Do not publish an untested policy that breaks authentication.

`frame-ancestors` and X-Frame-Options require HTTP response headers; a meta `frame-ancestors` tag does not work. Standard Pages publication does not give this repository a general custom-header configuration; use a header-capable edge/custom-domain arrangement if anti-framing headers are required, and inspect the actual response. Browser-side refusal to run when framed can supplement this, but is not equivalent to header enforcement. No backend is needed for resource limits, SDK pinning, or the supported meta-policy protections.

References: [MDN: CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP), [worker-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/worker-src), [frame-ancestors limitations](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors).

### S6 — Narrow the deployment workflow's trust and privileges

Evidence: [.github/workflows/pages.yml](../.github/workflows/pages.yml#L4) grants `pages: write` and `id-token: write` globally, including the build job that runs repository tests. Actions are referenced by mutable major tags (`@v4`, etc.). All referenced actions are official GitHub actions, and the workflow is manual-only; no untrusted-PR trigger was found.

If repository build code or an action becomes malicious, the build job has more token permissions than needed. Mutable action tags increase update/supply-chain exposure. No compromise was observed.

Recommended fix: keep build permissions to `contents: read`, grant Pages/OIDC permissions only to the deploy job, use reviewed immutable action references or supported workflow dependency lockfiles, and configure deployment environment/branch protections in GitHub. Repository protection settings cannot be verified from these files.

Reference: [GitHub: secure use of Actions](https://docs.github.com/en/actions/reference/security/secure-use).

## Controls that held up in this review

- Chat bubbles, errors, output, and input prompts use textContent. No raw model content is passed to an application HTML rendering sink.
- The AI protocol requires one explicit Logo block. Tool calls and ambiguous/foreign fenced updates are rejected; natural-language topic steering is not treated as a security boundary.
- AI output is validated in a disposable worker with a four-second timeout; editor writes check the source revision and remain undoable. No candidate program runs during validation.
- Manual Run is preserved. Runtime repairs have a three-call budget and do not run corrections or open a background sign-in popup.
- Native features are replaced with throwing routines, and there is no exposed eval/Function bridge in the reviewed Logo engine. A bounded dynamic `run (list "shell)` probe passed static checking but was blocked at runtime with the native-feature diagnostic, demonstrating that enforcement also exists at execution.
- The interpreter uses Map-backed variable/procedure dictionaries. No obvious prototype-chain variable lookup escape was found.
- Assets are local apart from Puter, application code contains no embedded provider secret, and the static artifact does not package the repository's .git directory. There is no application server/database for SQL injection, application-server SSRF, or shared server-key theft. GitHub/SDK/CDN and the user's browser remain trusted services.
- A worker has no DOM, but still has browser network/storage capabilities available to its JavaScript. Safety depends on the Logo engine exposing no bridge to those capabilities; “runs in a worker” alone is not a complete hostile-JavaScript sandbox.

## Privacy and quota observations

The current editor snapshot and recent conversation are sent to Puter on chat. An interpreter error after Run can also send the complete failed program automatically when already signed in. These are existing authorized product features, not a discovered exfiltration exploit. Surface this clearly before first use, especially for manually entered programs, and tell users not to put secrets in programs or prompts. Provider-side retention, billing, and onward model processing were not audited.

One chat action can consume an initial model call plus three repairs; a failing program can consume a further three runtime-repair calls across reruns. The allowance display is informational, not a spending cap. Output tokens are capped per request, but input/history are not capped by a combined byte/token budget, and chat DOM nodes accumulate for the page lifetime. Add bounded request/history sizes and chat retention. A malicious or simply poor model response can consume repair quota without passing validation, but cannot directly schedule arbitrary tools or repeatedly execute itself. Local client limits do not replace provider-side quota/authorization enforcement.

## Recommended implementation order

1. Add allocation, cumulative output/message, and all-speed instruction budgets. Regression-test the bounded reproductions; exclude resource-limit errors from automatic AI repair.
2. Choose a dedicated deployment origin and a reviewed SDK update/pinning strategy.
3. Test/enforce a static-compatible CSP; decide whether header-based anti-framing warrants an edge layer. Preserve the no-backend requirement.
4. Restrict deployment job permissions and lock action dependencies. Add privacy/quota disclosure and bounded chat history/DOM.
5. On the real Pages URL, verify HTTPS enforcement, actual headers, framing, provider sign-in/isolation, generated-code attack cases, and low-memory behavior in Firefox and Chromium. Check upstream editor/runtime/SDK advisories as part of release maintenance.

Original audit verification: all 117 existing automated tests passed, including static artifact/build integrity. Bounded probes are described above. No OOM stress test, live browser exploit, or live provider request was performed. At the original audit, findings remained open and no security fixes, deployment, or commit had been made. See the remediation update below for S3/S4.


## Remediation: S3 and S4 (2026-10-23)

- `resources.js` centralizes named limits and straightforward execution/output budget classes. The interpreter enforces 20,000 evaluation/loop/graphics steps at every speed, 100,000-element/character value limits, 2,000,000 cumulative guarded allocation units, and depth 100. Multidimensional array allocation is preflighted; words, sequences, collection copying/expansion, and formatting are checked before large allocations. Turtle indices are restricted to 0–63. Aliases and dynamic Logo use the same checked implementation. CATCH/ERRACT cannot recover resource failures.
- Animation no longer owns or resets the execution budget. Runtime/validation use separate fresh interpreters; every manual Run starts fresh.
- `output.js` separates cumulative character/message accounting from buffered delivery. CLEARTEXT does not refund either allowance. Empty writes and clears consume the 1,000-operation limit. Small writes are batched; the page independently checks cumulative received output before updating the DOM.
- Resource-limit failures are tagged `RESOURCE_LIMIT` and never submitted for automatic runtime or validation repair. Watchdog stops also avoid AI calls.
- The original large allocation requests are now rejected before large construction. The original clear/write bypass now stops within the 20,000-character lifetime output budget. Regression tests cover real worker behavior, all speeds/empty loops, aliases/generated code, repeated allocations, nesting/cycles, expanding words/lists, formatting, message floods, and host-side enforcement.
- These are application-level work/allocation limits, not a formal proof of heap isolation. Native canvas/browser allocation overhead, interpreter implementation bugs, and device-specific memory limits still exist; retain worker isolation and wall-clock timeouts. Live low-memory/browser tests remain outstanding.
- Verification: 154 automated tests pass and the static build succeeds. Existing drawing examples retain their results. No live Puter calls or deployment were needed.
