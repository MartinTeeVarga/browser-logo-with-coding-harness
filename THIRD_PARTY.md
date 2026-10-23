# Third-party components

## jslogo

Source: https://github.com/inexorabletash/jslogo (main, retrieved 2026-10-23).

Files: `src/logo/vendor/logo.js`, `src/logo/vendor/turtle.js`.

Copyright (C) 2011 Joshua Bell. Apache License 2.0. Original license notice is retained in both files. The full license is included in `src/logo/vendor/APACHE-2.0.txt` and the upstream notice in `src/logo/vendor/LICENSE.md`.

Local modifications to `logo.js`:

- Module/global bridge and a non-executing compilation API.
- Static checking of literal instruction lists, templates, procedure bodies, and forward procedure references.
- Explicit resource-budget hooks for arrays, multidimensional preflight, generated collections/words, recursive copies/formatting, source nesting, calls, and execution/loop steps. Limits remain active for aliases and generated Logo.
- Literal-expression metadata, shared primitive input contracts, standalone-input checks in command bodies, and strict runtime SETPOS list inputs.
- JavaScript-free procedure arity handling; no eval or Function constructor.
- Logo TRUE/FALSE words, case-insensitive comparison by default, protected vertical-bar words, optional-input handling, numeric error/edge-case fixes, and standard Error objects.
- Additional Berkeley operations: CASCADE, CASCADE.2, TRANSFER, GOTO/TAG, macros, raw/character input, source-preserving FULLTEXT, PEN/SETPEN, shape selection, procedure tracing, debugger input, special-variable handling, workspace printout and aliases.
- Native-feature rejection is applied through `src/logo/runtime.js`.
- Source metadata on token lists and copied literal lists, execution-line callbacks, and a primitive execution hook for Slow mode. Existing evaluation tokens are preserved when mapping literal blocks back to the editor.

`turtle.js` adds TRIANGLE/TURTLE cursor selection, preserves shape/pen width in turtle state, draws the cursor in the pen color, and supports a presentation-only slow execution cursor. The application provides an OffscreenCanvas worker adapter, a worker-compatible flood fill, bitmap delivery, pointer state, and interpolated motion/turn pacing.

Turtle movement/wrapping consumes the execution budget and turtle indices are bounded before state growth. The turtle silhouette now matches the simplified rounded welcome mark and favicon. Additional turtle renderer modification: expose synchronous frame rendering, refresh the cursor after pen-color changes, and use the turtle silhouette as the animated execution pen without altering Logo shape or visibility state.

## CodeMirror

CodeMirror 5.65.16, minified distribution obtained from the cdnjs repository:
https://github.com/cdnjs/cdnjs/blob/master/ajax/libs/codemirror/5.65.16/codemirror.min.js

Styles and license from https://github.com/codemirror/codemirror5 (retrieved 2026-10-23).

Files: `public/vendor/codemirror.js`, `public/vendor/codemirror.css`, `public/vendor/CODEMIRROR-LICENSE`.

MIT license. Copyright Marijn Haverbeke and others. The application supplies its own Logo mode and visual theme.

## Puter.js

Loaded at runtime from the official https://js.puter.com/v2/ endpoint. It is not vendored in this repository. This is the sole external JavaScript dependency and is required only for account authorization and AI access.
