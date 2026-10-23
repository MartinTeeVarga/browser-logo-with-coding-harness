# Berkeley Logo compatibility

Reference: [Berkeley Logo user manual](https://people.eecs.berkeley.edu/~bh/usermanual). Native platform features are excluded by product decision.

**This is a working browser interpreter, not yet a fully conforming Berkeley Logo implementation.** The inherited jslogo engine implements a broad subset; local extensions close several gaps. The current registry has 370 non-native primitive names, including aliases and browser extensions. The exact list is in [primitives.json](primitives.json). Registry presence is not proof of complete semantic compatibility.

## Implemented and exercised

| Area | Coverage |
| --- | --- |
| Drawing | Motion, headings, positions, arcs, pen control, RGB/palette colors, backgrounds, turtle visibility, wrap/window/fence modes, filled paths, flood fill, labels, scrunch, multiple turtles |
| Procedures | TO/END, recursive calls, dynamically scoped variables, local/global bindings, optional/rest inputs, DEFINE/TEXT/COPYDEF, arity queries |
| Data | Words, lists, arrays, multidimensional arrays, constructors, selectors, mutators, predicates, property lists, vertical-bar quoted words |
| Evaluation | Arithmetic, degree/radian functions, Logo TRUE/FALSE words, comparisons, logical operations, explicit RUN |
| Control | REPEAT/REPCOUNT, IF/IFELSE, loops, OUTPUT/STOP, CATCH/THROW, GOTO/TAG |
| Templates | APPLY, INVOKE, MAP, MAP.SE, FOREACH, FILTER, FIND, REDUCE, CROSSMAP, CASCADE, CASCADE.2, TRANSFER |
| Macros | .MACRO, .DEFMACRO, MACROP, MACROEXPAND; results run as Logo in the caller context |
| Interaction | PRINT/TYPE/SHOW, browser input for READLIST/READWORD and character reads; program output below canvas |
| Workspace | Inspection, erase, bury/unbury, procedure tracing, workspace printout, source-preserving FULLTEXT |

Tests exercise representative semantics and regressions. They do not yet constitute the complete Berkeley conformance suite.

## Explicit exclusions

Native shell/process operations; disk files, path prefixes and file streams; native editor launching; installed library/help locations; native picture formats; hardware-specific pen patterns; native terminal/window controls and desktop memory/GC introspection. Their recognized commands return an explicit native-feature diagnostic. See `NATIVE_FEATURES` in `src/logo/runtime.js` for the exact rejected names.

The browser is also a distinct platform: Unicode text, browser fonts, a square canvas, and automatic memory management replace desktop terminal/device behavior. There is no operating-system command line.

## Remaining compatibility work

| Area | Current limitation |
| --- | --- |
| Interactive debugger | PAUSE/CONTINUE and STEP/UNSTEP/STEPPEDP work through browser input. Stepping is per instruction rather than preserving the desktop terminal’s original line grouping. |
| Special variables | ALLOWGETSET, ERRACT value recovery, FULLPRINTP, print depth/width limits, CASEIGNOREDP and REDEFP are supported. Event action variables (BUTTONACT/KEYACT) and several startup/localization behaviors remain incomplete. |
| Procedure source | FULLTEXT preserves source lines/comments for TO definitions in the complete program. Definitions generated at runtime fall back to canonical data; exact continuation/formatting behavior still needs wider conformance tests. |
| Error reporting | Useful messages, selected Berkeley error codes, and source lines for directly mapped instructions are available. Full Berkeley recovery/error-code behavior and exact locations for generated instructions remain incomplete. |
| Legacy window/terminal controls | TEXTSCREEN/FULLSCREEN/SPLITSCREEN, screen mode queries, terminal cursor/margins, keyboard polling, REFRESH/NOREFRESH, remain native exclusions. Shape selection supports TRIANGLE and TURTLE. |
| Memory introspection | NODES, GC, and .SETSEGMENTSIZE are native exclusions: the desktop allocation model cannot be exposed by JavaScript. No synthetic node counts are returned. |
| Legacy character representation | Quoted punctuation is preserved internally through RUN and word/list operations. RAWASCII uses Unicode character values, without Berkeley's machine-specific control-character representation. |
| Tracing and serialization | Procedure tracing exists; traced variable/property changes and exact workspace serialization/printing still need conformance work. |
| Execution characteristics | No certified tail-call equivalence; browser time/output limits apply. Each Run starts a fresh workspace from the complete editor program. Slow mode preserves evaluation while pacing primitives and mapping literal source blocks; generated instruction lists fall back to their caller location. |

These are outstanding product requirements, not silently accepted alternatives to full non-native language support.

## Validation boundary

The chat protocol first extracts at most one explicitly fenced `logo` block. Prose-only replies leave code unchanged. Foreign/untagged, multiple, empty, and malformed blocks are rejected before language validation. Only the extracted source reaches the validator; explanations stay in chat. The system prompt steers conversation toward Logo, but natural-language topic compliance depends on model behavior.

The validator uses the interpreter's reader and expression compiler in a fresh instance. It registers literal procedure definitions and compiles their bodies, instruction lists, and templates without invoking candidate instructions. It rejects unknown procedures when they are statically visible. The shared dialect contract also checks known literal input types/shapes for core drawing/control primitives, including SETPOS's single coordinate list, SETXY's two numbers, and ARC's two numeric inputs. Standalone literals are rejected in command bodies, while expression contexts such as templates and IFELSE values still accept them.

Runtime-generated procedure names, instruction lists assembled from data, dynamic types, nontermination, and runtime exceptions cannot be proved safe or correct by these static checks. A program can pass validation and still fail after Run. Some otherwise valid dynamically defined programs may require additional validator support before acceptance.

No candidate is executed during chat validation, and no JavaScript is evaluated from Logo input.
