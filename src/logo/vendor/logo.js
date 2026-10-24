//
// Logo Interpreter in Javascript
//

// Copyright (C) 2011 Joshua Bell
//
// Modified for browser-logo, 2026. Local changes remain Apache-2.0.
// See THIRD_PARTY.md for a description of modifications.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

function LogoInterpreter(turtle, stream, savehook, resources) {
  'use strict';

  const self = this;
  const listSources = new WeakMap();
  function trackedTokens(tokens, locations, sourceText) {
    Object.defineProperties(tokens, {
      locations: {value: locations, configurable: true},
      sourceText: {value: sourceText, configurable: true},
      shift: {configurable: true, value: function() {
        this.locations.shift();
        return Array.prototype.shift.call(this);
      }},
      slice: {configurable: true, value: function(start, end) {
        return trackedTokens(Array.prototype.slice.call(this, start, end), this.locations.slice(start, end), this.sourceText);
      }}
    });
    return tokens;
  }
  // Preserve vertical-bar quoting through later RUN/RUNPARSE operations.
  const quotedPunctuation = ' \t\n\r()[]{}+-*/%=<>"\\~?|:;^';
  const protect = c => quotedPunctuation.includes(c) ? String.fromCharCode(0xE000 + c.charCodeAt(0)) : c;
  const unprotect = word => String(word).replace(/[\uE000-\uE0FF]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xE000));

  const UNARY_MINUS = '<UNARYMINUS>'; // Must not parse as a word

  const ERRORS = {
    BAD_INPUT: 4,
    NO_OUTPUT: 5,
    NOT_ENOUGH_INPUTS: 6,
    TOO_MANY_INPUTS: 8,
    BAD_OUTPUT: 9,
    MISSING_PAREN: 10,
    BAD_VAR: 11,
    BAD_PAREN: 12,
    ALREADY_DEFINED: 15,
    THROW_ERROR: 21,
    IS_PRIMITIVE: 22,
    BAD_PROC: 24,
    NO_TEST: 25,
    BAD_BRACKET: 26,
    BAD_BRACE: 27,
    USER_GENERATED: 35,
    MISSING_SPACE: 39
  };

  function saveproc(name, def) {
    if (savehook)
      savehook(String(name).toLowerCase(), def);
  }

  //----------------------------------------------------------------------
  //
  // Utilities
  //
  //----------------------------------------------------------------------

  function format(string, params) {
    return string.replace(/{(\w+)(:[UL])?}/g, (m, n, o) => {
      const s = (n === '_PROC_') ? self.stack.at(-1) : String(params[n]);
      switch (o) {
        case ':U': return s.toUpperCase();
        case ':L': return s.toLowerCase();
        default: return s;
      }
    });
  }

  // To support localized/customized messages, assign a lookup function:
  // instance.localize = s => {
  //   return {
  //     'Division by zero': 'Divido per nulo',
  //     'Index out of bounds': 'Indekso ekster limojn',
  //     ...
  //   }[s];
  // };
  this.localize = null;
  function __(string) {
    if (self.localize)
      return self.localize(string) || string;
    return string;
  }

  // Shortcut for common use of format() and __()
  function err(string, params, code) {
    // Allow callng as err(string, code)
    if (typeof params === 'number') {
      code = params;
      params = undefined;
    }
    const error = new LogoError('ERROR', undefined, format(__(string), params));
    if (code !== undefined)
      error.code = code;
    return error;
  }

  class LogoError extends Error {
    constructor(tag, value, message) {
      super(message || format(__('No CATCH for tag {tag}'), {tag: tag}));
      this.name = 'LogoError';
      this.tag = tag;
      this.value = value;
      this.proc = self.stack.at(-1);
      this.code = -1;
      this.line = self.currentLine || -1;
    }
  }

  // To handle additional keyword aliases (localizations, etc), assign
  // a function to keywordAlias. Input will be the uppercased word,
  // output must be one of the keywords (ELSE or END), or undefined.
  // For example:
  // logo.keywordAlias = name => {
  //   return {
  //     'ALIE': 'ELSE',
  //     'FINO': 'END'
  //     ...
  //   }[name];
  // };
  this.keywordAlias = null;
  function isKeyword(atom, match) {
    if (Type(atom) !== 'word')
      return false;
    atom = String(atom).toUpperCase();
    if (self.keywordAlias)
      atom = self.keywordAlias(atom) || atom;
    return atom === match;
  }

  // Returns a Promise that will resolve as soon as possible while ensuring
  // that control is yielded back to the event loop at least every 20ms.
  let lastTimeYielded = Date.now();
  async function yieldIfNeeded() {
    resources?.instruction();
    const currentTime = Date.now();
    if (currentTime - lastTimeYielded > 20) {
      lastTimeYielded = currentTime;
      await new Promise(resolve => {
        setTimeout(resolve, 0);
      });
    }
  }

  async function yieldForMS(msec) {
    // Not adding msec would generally cause a yield right after the wait.
    // Adding msec just once might cause additional tear of animations.
    lastTimeYielded = Date.now() + msec * 2;
    await new Promise(resolve => {
      setTimeout(resolve, msec);
    });
  }

  // Based on: https://www.jbouchard.net/chris/blog/2008/01/currying-in-javascript-fun-for-whole.html
  // Argument is `$$func$$` to avoid issue if passed function is named `func`.
  function to_arity($$func$$, arity) {
    if ($$func$$.length === arity)
      return $$func$$;
    // Local adaptation: procedure arity does not require JavaScript evaluation.
    Object.defineProperty($$func$$, 'length', { value: arity, configurable: true });
    return $$func$$;
  }


  //----------------------------------------------------------------------
  //
  // Classes
  //
  //----------------------------------------------------------------------

  // Adapted from:
  // https://stackoverflow.com/questions/424292/how-to-create-my-own-javascript-random-number-generator-that-i-can-also-set-the-s
  class PRNG {
    constructor(seed) {
      this.S = seed & 0x7fffffff, // seed
      this.A = 48271, // const
      this.M = 0x7fffffff, // const
      this.Q = this.M / this.A, // const
      this.R = this.M % this.A; // const

      this.next();
    }

    next() {
      const hi = this.S / this.Q,
            lo = this.S % this.Q,
            t = this.A * lo - this.R * hi;
      this.S = (t > 0) ? t : t + this.M;
      this.last = this.S / this.M;
      return this.last;
    }

    seed(x) {
      this.S = x & 0x7fffffff;
    }
  }

  class StringMap {
    constructor(case_fold) {
      this._map = new Map();
      this._case_fold = case_fold;
    }
    get(key) {
      key = this._case_fold ? unprotect(key).toLowerCase() : unprotect(key);
      return this._map.get(key);
    }
    set(key, value) {
      key = this._case_fold ? unprotect(key).toLowerCase() : unprotect(key);
      this._map.set(key, value);
    }
    has(key) {
      key = this._case_fold ? unprotect(key).toLowerCase() : unprotect(key);
      return this._map.has(key);
    }
    delete(key) {
      key = this._case_fold ? unprotect(key).toLowerCase() : unprotect(key);
      return this._map.delete(key);
    }
    keys() {
      const keys = [];
      this._map.forEach((value, key) => { keys.push(key); });
      return keys;
    }
    empty() {
      return this._map.size === 0;
    }
    forEach(fn) {
      return this._map.forEach((value, key) => { fn(key, value); });
    }
  }

  class LogoArray {
    constructor(size, origin) {
      resources?.allocate(size);
      this._array = [];
      this._array.length = size;
      for (let i = 0; i < this._array.length; ++i)
        this._array[i] = [];
      this._origin = origin;
    }
    static from(list, origin) {
      const array = new LogoArray(0, origin);
      resources?.allocate(list.length);
      array._array = [...list];
      return array;
    }

    item(i) {
      i = Number(i)|0;
      i -= this._origin;
      if (i < 0 || i >= this._array.length)
        throw err("{_PROC_}: Index out of bounds", ERRORS.BAD_INPUT);
      return this._array[i];
    }
    setItem(i, v) {
      i = Number(i)|0;
      i -= this._origin;
      if (i < 0 || i >= this._array.length)
        throw err("{_PROC_}: Index out of bounds", ERRORS.BAD_INPUT);
      this._array[i] = v;
    }
    get list() {
      return this._array;
    }
    get origin() {
      return this._origin;
    }
    get length() {
      return this._array.length;
    }
  }

  class Stream {
    constructor(string) {
      this._string = String(string);
      this._index = 0;
      this._vbar = false;
      this._skip();
    }
    get eof() {
      return this._index >= this._string.length;
    }
    peek() {
      let c = this._string.charAt(this._index);
      if (c === '\\')
        c += this._string.charAt(this._index + 1);
      else if (this._vbar && c) c = protect(c);
      return c;
    }
    get() {
      const start = this._index;
      const c = this._next();
      const end = this._index;
      this._skip();
      this.lastStart = start;
      this.lastEnd = end;
      return c;
    }
    _next() {
      let c = this._string.charAt(this._index++);
      if (c === '\\')
        c += this._vbar ? protect(this._string.charAt(this._index++)) : this._string.charAt(this._index++);
      else if (this._vbar && c) c = protect(c);
      return c;
    }
    _skip() {
      while (!this.eof) {
        if (this._string.charAt(this._index) === '|') {
          this._vbar = !this._vbar;
          ++this._index;
          continue;
        }
        if (this._vbar) return;
        let c = this.peek();
        if (c === '~' && this._string.charAt(this._index + 1) === '\n') {
          this._index += 2;
        } else if (c === ';') {
          do {
            c = this._next();
          } while (!this.eof && this.peek() !== '\n');
          if (c === '~')
            this._next();
        } else {
          return;
        }
      }
      if (this._vbar) throw err('Unterminated vertical-bar word', ERRORS.BAD_INPUT);
    }
    rest() {
      return this._string.substring(this._index);
    }
  }

  //----------------------------------------------------------------------
  //
  // Interpreter State
  //
  //----------------------------------------------------------------------

  self.turtle = turtle;
  self.stream = stream;
  self.routines = new StringMap(true);
  self.scopes = [new StringMap(true)];
  self.plists = new StringMap(true);
  self.prng = new PRNG(Math.random() * 0x7fffffff);
  self.forceBye = false;

  //----------------------------------------------------------------------
  //
  // Parsing
  //
  //----------------------------------------------------------------------

  // Used to return values from routines (thrown/caught)
  class Output {
    constructor(output) { this.output = output; }
    toString() { return this.output; }
    valueOf() { return this.output; }
  }

  // Used to stop processing cleanly
  class Bye { }
  class GoTo { constructor(tag) { this.tag = tag; } }

  function Type(atom) {
    if (atom === undefined) {
      // TODO: Should be caught higher upstream than this
      throw err("No output from procedure", ERRORS.NO_OUTPUT);
    } else if (typeof atom === 'string' || typeof atom === 'number') {
      return 'word';
    } else if (Array.isArray(atom)) {
      return 'list';
    } else if (atom instanceof LogoArray) {
      return 'array';
    } else if ('then' in Object(atom)) {
      throw new Error("Internal error: Unexpected value: a promise");
    } else if (!atom) {
      throw new Error("Internal error: Unexpected value: null");
    } else {
      throw new Error("Internal error: Unexpected value: unknown type");
    }
  }


  //
  // Tokenize into atoms / lists
  //
  // Input: string
  // Output: atom list (e.g. "to", "jump", "repeat", "random", 10, [ "fd", "10", "rt", "10" ], "end"
  //

  function parse(string, sourceInfo = {source: String(string), offset: 0}) {
    resources?.allocate(String(string).length);
    if (string === undefined) {
      return undefined; // TODO: Replace this with ...?
    }

    let atoms = [], locations = [],
        prev;

    const stream = new Stream(string);
    stream.sourceInfo = sourceInfo;
    while (stream.peek()) {
      let atom;

      // Ignore (but track) leading space - needed for unary minus disambiguation
      const leading_space = isWS(stream.peek());
      while (isWS(stream.peek()))
        stream.get();
      if (!stream.peek())
        break;
      locations.push(stream._index + sourceInfo.offset);

      if (stream.peek() === '[') {
        stream.get();
        atom = parseList(stream);
      } else if (stream.peek() === ']') {
        throw err("Unexpected ']'", ERRORS.BAD_BRACKET);
      } else if (stream.peek() === '{') {
        stream.get();
        atom = parseArray(stream);
      } else if (stream.peek() === '}') {
        throw err("Unexpected '}'", ERRORS.BAD_BRACE);
      } else if (stream.peek() === '"') {
        atom = parseQuoted(stream);
      } else if (isOwnWord(stream.peek())) {
        atom = stream.get();
      } else if (inRange(stream.peek(), '0', '9')) {
        atom = parseNumber(stream);
      } else if (OPERATOR_CHARS.includes(stream.peek())) {
        atom = parseOperator(stream);
        // From UCB Logo:

        // Minus sign means infix difference in ambiguous contexts
        // (when preceded by a complete expression), unless it is
        // preceded by a space and followed by a nonspace.

        // Minus sign means unary minus if the previous token is an
        // infix operator or open parenthesis, or it is preceded by a
        // space and followed by a nonspace.

        if (atom === '-') {
          const trailing_space = isWS(stream.peek());
          if (prev === undefined ||
              (Type(prev) === 'word' && isInfix(prev)) ||
              (Type(prev) === 'word' && prev === '(') ||
              (leading_space && !trailing_space)) {
            atom = UNARY_MINUS;
          }
        }
      } else if (!WORD_DELIMITER.includes(stream.peek())) {
        atom = parseWord(stream);
      } else {
        // NOTE: This shouldn't be reachable.
        throw err("Couldn't parse: '{string}'", { string: stream.rest });
      }
      atoms.push(atom);
      prev = atom;
    }

    return trackedTokens(atoms, locations, sourceInfo.source);
  }

  function inRange(x, a, b) {
    return a <= x && x <= b;
  }

  const WS_CHARS = ' \f\n\r\t\v';
  // OK to call with `undefined` (returns false)
  function isWS(c) {
    return c && WS_CHARS.includes(c);
  }

  // "After a quotation mark outside square brackets, a word is
  // delimited by a space, a square bracket, or a parenthesis."
  const QUOTED_DELIMITER = WS_CHARS + '[](){}';
  function parseQuoted(stream) {
    let word = '';
    while (!stream.eof && !QUOTED_DELIMITER.includes(stream.peek())) {
      const c = stream.get();
      word += (c.charAt(0) === '\\') ? c.charAt(1) : c.charAt(0);
    }
    return word;
  }

  // Non-standard: U+2190 ... U+2193 are arrows, parsed as own-words.
  const OWNWORD_CHARS = '\u2190\u2191\u2192\u2193';
  function isOwnWord(c) {
    return OWNWORD_CHARS.includes(c);
  }

  // "A word not after a quotation mark or inside square brackets is
  // delimited by a space, a bracket, a parenthesis, or an infix
  // operator +-*/=<>. Note that words following colons are in this
  // category. Note that quote and colon are not delimiters."
  const WORD_DELIMITER = WS_CHARS + '[](){}+-*/%^=<>';
  function parseWord(stream) {
    let word = '';
    while (!stream.eof && !WORD_DELIMITER.includes(stream.peek())) {
      const c = stream.get();
      word += (c.charAt(0) === '\\') ? c.charAt(1) : c.charAt(0);
    }
    return word;
  }

  // "Each infix operator character is a word in itself, except that
  // the two-character sequences <=, >=, and <> (the latter meaning
  // not-equal) with no intervening space are recognized as a single
  // word."
  const OPERATOR_CHARS = '+-*/%^=<>[]{}()';
  function parseOperator(stream) {
    let word = '';
    if (OPERATOR_CHARS.includes(stream.peek()))
      word += stream.get();
    if ((word === '<' && stream.peek() === '=') ||
        (word === '>' && stream.peek() === '=') ||
        (word === '<' && stream.peek() === '>')) {
      word += stream.get();
    }
    return word;
  }

  function isInfix(word) {
    return ['+', '-', '*', '/', '%', '^', '=', '<', '>', '<=', '>=', '<>']
      .includes(word);
  }

  function isOperator(word) {
    return isInfix(word) || ['[', ']', '{', '}', '(', ')'].includes(word);
  }

  // Non-standard: Numbers support exponential notation (e.g. 1.23e-45)
  function parseNumber(stream) {
    let word = '';
    while (inRange(stream.peek(), '0', '9'))
      word += stream.get();
    if (stream.peek() === '.')
      word += stream.get();
    if (inRange(stream.peek(), '0', '9')) {
      while (inRange(stream.peek(), '0', '9'))
        word += stream.get();
    }
    if (stream.peek() === 'E' || stream.peek() === 'e') {
      word += stream.get();
      if (stream.peek() === '-' || stream.peek() === '+')
        word += stream.get();
      while (inRange(stream.peek(), '0', '9'))
        word += stream.get();
    }
    return word;
  }

  // Includes leading - sign, unlike parseNumber().
  function isNumber(s) {
    return unprotect(s).match(/^-?([0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)$/);
  }

  function parseInteger(stream) {
    let word = '';
    if (stream.peek() === '-')
      word += stream.get();
    while (inRange(stream.peek(), '0', '9'))
      word += stream.get();
    return word;
  }

  function parseList(stream, depth = 0) {
    resources?.checkDepth(depth);
    const list = [];
    const start = stream.lastEnd;
    let atom = '',
        c, r;

    for (;;) {
      do {
        c = stream.get();
      } while (isWS(c));

      while (c && !isWS(c) && !'[]{}'.includes(c)) {
        atom += c;
        c = stream.get();
      }

      if (atom.length) {
        list.push(atom);
        atom = '';
      }

      if (!c)
        throw err("Expected ']'", ERRORS.BAD_BRACKET);
      if (isWS(c))
        continue;
      if (c === ']') {
        listSources.set(list, {
          raw: stream._string.slice(start, stream.lastStart),
          source: stream.sourceInfo.source,
          offset: stream.sourceInfo.offset + start,
          signature: stringify_nodecorate(list)
        });
        return list;
      }
      if (c === '[') {
        list.push(parseList(stream, depth + 1));
        continue;
      }
      if (c === '{') {
        list.push(parseArray(stream, depth + 1));
        continue;
      }
      if (c === '}')
        throw err("Unexpected '}'", ERRORS.BAD_BRACE);
      throw err("Unexpected '{c}'", {c: c});
    }
  }

  function parseArray(stream, depth = 0) {
    resources?.checkDepth(depth);
    const list = [];
    let origin = 1,
        atom = '',
        c, r;

    for (;;) {
      do {
        c = stream.get();
      } while (isWS(c));

      while (c && !isWS(c) && !'[]{}'.includes(c)) {
        atom += c;
        c = stream.get();
      }

      if (atom.length) {
        list.push(atom);
        atom = '';
      }

      if (!c)
        throw err("Expected '}'", ERRORS.BAD_BRACE);
      if (isWS(c))
        continue;
      if (c === '}') {
        while (isWS(stream.peek()))
          stream.get();
        if (stream.peek() === '@') {
          stream.get();
          while (isWS(stream.peek()))
            stream.get();
          origin = Number(parseInteger(stream) || 0);
        }
        return LogoArray.from(list, origin);
      }
      if (c === '[') {
        list.push(parseList(stream, depth + 1));
        continue;
      }
      if (c === ']')
        throw err("Unexpected ']'", ERRORS.BAD_BRACKET);
      if (c === '{') {
        list.push(parseArray(stream, depth + 1));
        continue;
      }
      throw err("Unexpected '{c}'", {c: c});
    }
  }

  // Needed when a word or list is treated as an expression or statements, e.g.:
  // input: ':x>10' or [ ':x>10' ] or [ ':x>', '10' ]
  // output: [ ':x', '>', '10' ]     (three words)
  function reparse(thing) {
    if (Type(thing) === 'list') {
      const source = listSources.get(thing);
      const signature = stringify_nodecorate(thing);
      if (self.onInstruction && source && source.source === self.rootSourceText && signature === source.signature) {
        // Preserve existing evaluation/tokenization semantics; use the raw
        // source parse only to map those tokens back to editor coordinates.
        const tokens = parse(signature.replace(/([\\;])/g, '\\$1'));
        const original = parse(source.raw, {source: source.source, offset: source.offset});
        function mapLocations(actual, mapped) {
          if (actual.length !== mapped.length) return actual;
          trackedTokens(actual, mapped.locations.slice(), source.source);
          actual.forEach((atom, i) => {
            if (!Array.isArray(atom) || !Array.isArray(mapped[i])) return;
            const info = listSources.get(mapped[i]);
            if (info) listSources.set(atom, {...info, signature: stringify_nodecorate(atom)});
          });
          return actual;
        }
        return mapLocations(tokens, original);
      }
      thing = stringify_nodecorate(thing).replace(/([\\;])/g, '\\$1');
    }
    return parse(thing);
  }

  function maybegetvar(name) {
    const lval = lvalue(name);
    return lval ? lval.value : undefined;
  }

  function getvar(name) {
    const value = maybegetvar(name);
    if (value !== undefined)
      return value;
    throw err("Don't know about variable {name:U}", {name: name}, ERRORS.BAD_VAR);
  }

  function getslot(name) {
    const value = self.slots ? self.slots(name) : undefined;
    if (value !== undefined)
      return value;
    throw err("Don't know about variable {name:U}", {name: name}, ERRORS.BAD_VAR);
  }

  function lvalue(name) {
    for (let i = self.scopes.length - 1; i >= 0; --i) {
      if (self.scopes[i].has(name)) {
        return self.scopes[i].get(name);
      }
    }
    return undefined;
  }

  function setvar(name, value) {
    value = copy(value);

    // Find the variable in existing scope
    let lval = lvalue(name);
    if (lval) {
      if (lval.traced) stream.write('MAKE "', name, ' ', stringify(value), '\n');
      lval.value = value;
    } else {
      // Otherwise, define a global
      lval = {value: value};
      self.scopes[0].set(name, lval);
    }
  }

  function local(name) {
    const scope = self.scopes.at(-1);
    scope.set(sexpr(name), {value: undefined});
  }

  function setlocal(name, value) {
    value = copy(value);
    const scope = self.scopes.at(-1);
    scope.set(sexpr(name), {value: value});
  }

  //----------------------------------------------------------------------
  //
  // Expression Evaluation
  //
  //----------------------------------------------------------------------

  // Expression               := RelationalExpression
  // RelationalExpression     := AdditiveExpression [ ( '=' | '<' | '>' | '<=' | '>=' | '<>' ) AdditiveExpression ... ]
  // AdditiveExpression       := MultiplicativeExpression [ ( '+' | '-' ) MultiplicativeExpression ... ]
  // MultiplicativeExpression := PowerExpression [ ( '*' | '/' | '%' ) PowerExpression ... ]
  // PowerExpression          := UnaryExpression [ '^' UnaryExpression ]
  // UnaryExpression          := ( '-' ) UnaryExpression
  //                           | FinalExpression
  // FinalExpression          := string-literal
  //                           | number-literal
  //                           | list
  //                           | variable-reference
  //                           | procedure-call
  //                           | '(' Expression ')'

  // Peek at the list to see if there are additional atoms from a set
  // of options.
  function peek(list, options) {
    if (list.length < 1) { return false; }
    const next = list[0];
    return options.some(x => next === x);

  }

  async function evaluateExpression(list) {
    try { return await (expression(list))(); }
    catch (error) { return await recoverError(error); }
  }
  async function recoverError(error) {
      const action = maybegetvar('erract');
      if (!(error instanceof LogoError) || error.tag !== 'ERROR' || error.recoveryAttempted || self.handlingError || !Array.isArray(action) || !action.length) throw error;
      error.recoveryAttempted = true;
      self.last_error = error;
      self.handlingError = true;
      try {
        try {
          const value = await self.execute(reparse(action), {returnResult: true});
          if (value !== undefined) return value;
        } catch (output) {
          if (output instanceof Output && output.output !== undefined) return output.output;
          throw output;
        }
        throw error;
      } finally { self.handlingError = false; }
  }

  function expression(list) {
    return relationalExpression(list);
  }

  function relationalExpression(list) {
    let lhs = additiveExpression(list);
    while (peek(list, ['=', '<', '>', '<=', '>=', '<>'])) {
      const op = list.shift();
      lhs = (lhs => {
        const rhs = additiveExpression(list);

        switch (op) {
        case "<": return async () => (aexpr(await lhs()) < aexpr(await rhs())) ? 'true' : 'false';
        case ">": return async () => (aexpr(await lhs()) > aexpr(await rhs())) ? 'true' : 'false';
        case "=": return async () => equal(await lhs(), await rhs()) ? 'true' : 'false';

        case "<=": return async () => (aexpr(await lhs()) <= aexpr(await rhs())) ? 'true' : 'false';
        case ">=": return async () => (aexpr(await lhs()) >= aexpr(await rhs())) ? 'true' : 'false';
        case "<>": return async () => !equal(await lhs(), await rhs()) ? 'true' : 'false';
        default: throw new Error("Internal error in expression parser");
        }
      })(lhs);
    }

    return lhs;
  }

  function additiveExpression(list) {
    let lhs = multiplicativeExpression(list);
    while (peek(list, ['+', '-'])) {
      const op = list.shift();
      lhs = (lhs => {
        const rhs = multiplicativeExpression(list);

        switch (op) {
        case "+": return async () => aexpr(await lhs()) + aexpr(await rhs());
        case "-": return async () => aexpr(await lhs()) - aexpr(await rhs());
        default: throw new Error("Internal error in expression parser");
        }
      })(lhs);
    }

    return lhs;
  }

  function multiplicativeExpression(list) {
    let lhs = powerExpression(list);
    while (peek(list, ['*', '/', '%'])) {
      const op = list.shift();
      lhs = (lhs => {
        const rhs = powerExpression(list);

        switch (op) {
        case "*": return async () => aexpr(await lhs()) * aexpr(await rhs());
        case "/": return async () => {
          const n = aexpr(await lhs()), d = aexpr(await rhs());
          if (d === 0) { throw err("Division by zero", ERRORS.BAD_INPUT); }
          return n / d;
        };
        case "%": return async () => {
          const n = aexpr(await lhs()), d = aexpr(await rhs());
          if (d === 0) { throw err("Division by zero", ERRORS.BAD_INPUT); }
          return n % d;
        };
        default: throw new Error("Internal error in expression parser");
        }
      })(lhs);
    }

    return lhs;
  }

  function powerExpression(list) {
    let lhs = unaryExpression(list);
    while (peek(list, ['^'])) {
      const op = list.shift();
      lhs = (lhs => {
        const rhs = unaryExpression(list);

        return async () => Math.pow(aexpr(await lhs()), aexpr(await rhs()));
      })(lhs);
    }

    return lhs;
  }

  function unaryExpression(list) {
    if (peek(list, [UNARY_MINUS])) {
      const op = list.shift();
      const rhs = unaryExpression(list);
      const result = async () => -aexpr(await rhs());
      if (Object.hasOwn(rhs, 'literal') && isNumber(rhs.literal)) result.literal = -Number(rhs.literal);
      return result;
    } else {
      return finalExpression(list);
    }
  }

  function finalExpression(list) {
    if (!list.length)
      throw err("Unexpected end of instructions", ERRORS.MISSING_PAREN);

    let atom = list.shift();

    let result, literal, varname;

    switch (Type(atom)) {
    case 'array':
    case 'list':
      return Object.assign(() => atom, {literal: atom});

    case 'word':
      if (isNumber(atom)) {
        // number literal
        atom = parseFloat(unprotect(atom));
        return Object.assign(() => atom, {literal: atom});
      }

      atom = String(atom);
      if (atom.charAt(0) === '"' || atom.charAt(0) === "'") {
        // string literal
        literal = atom.substring(1);
        return Object.assign(() => literal, {literal});
      }
      if (atom.charAt(0) === ':') {
        // variable
        varname = atom.substring(1);
        return () => getvar(varname);
      }
      if (atom.match(/^\?(?:\d*|in|out)$/i)) {
        // template slot
        return () => getslot(atom.substring(1));
      }
      if (atom === '(') {
        // parenthesized expression/procedure call
        if (list.length && Type(list[0]) === 'word' && self.routines.has(String(list[0])) &&
            !(list.length > 1 && Type(list[1]) === 'word' && isInfix(String(list[1])))) {
          // Lisp-style (procedure input ...) calling syntax
          atom = list.shift();
          return self.dispatch(atom, list, false);
        }
        // Standard parenthesized expression
        result = expression(list);

        if (!list.length)
          throw err("Expected ')'", ERRORS.MISSING_PAREN);
        if (!peek(list, [')']))
          throw err("Expected ')', saw {word}", { word: list.shift() }, ERRORS.MISSING_PAREN);
        list.shift();
        return result;
      }
      if (atom === ')')
        throw err("Unexpected ')'", ERRORS.BAD_PAREN);
      // Procedure dispatch
      return self.dispatch(atom, list, true);

    default: throw new Error("Internal error in expression parser");
    }
  }

  self.stack = [];

  function queueValidation(tokens, allowValue = false) {
    self.validationQueue.push({tokens, allowValue});
  }

  self.dispatch = (name, tokenlist, natural) => {
    name = name.toUpperCase();
    let procedure = self.routines.get(name);
    if (procedure?.unsupported) throw new Error(`${name} is a native feature and is unavailable in this browser.`);
    if (!procedure && String(maybegetvar('allowgetset')).toLowerCase() === 'true') {
      const setter = name.startsWith('SET'), variable = (setter ? name.slice(3) : name).toLowerCase();
      if (!self.validationQueue || setter || self.validationBindings?.has(unprotect(variable))) {
        procedure = setter ? value => setvar(variable, value) : () => getvar(variable);
        procedure.minimum = procedure.default = procedure.maximum = setter ? 1 : 0;
        if (setter) self.validationBindings?.add(unprotect(variable));
      }
    }
    if (!procedure) {

      // Give a helpful message in a common error case.
      let m;
      if ((m = /^(\w+?)(\d+)$/.exec(name)) && self.routines.get(m[1])) {
        throw err("Need a space between {name:U} and {value}",
                  { name: m[1], value: m[2] }, ERRORS.MISSING_SPACE);
      }

      throw err("Don't know how to {name:U}", { name: name }, ERRORS.BAD_PROC);
    }

    if (procedure.special) {
      // Special routines are built-ins that get handed the token list:
      // * workspace modifiers like TO that special-case varnames
      resources?.checkDepth(self.stack.length + 1);
      self.stack.push(name);
      try {
        procedure.call(self, tokenlist);
        return () => { };
      } finally {
        self.stack.pop();
      }
    }

    const args = [];
    const validationArgs = [];
    if (natural) {
      // Natural arity of the function
      const count = ['CONTINUE', 'CO'].includes(name) && !tokenlist.length ? 0 : procedure.default;
      for (let i = 0; i < count; ++i) {
        if (!tokenlist.length || peek(tokenlist, [')'])) {
          const syntax = procedure.logoContract ? ' Syntax: ' + procedure.logoContract.syntax : '';
          throw err('Not enough inputs for {name:U}' + syntax, {name}, ERRORS.NOT_ENOUGH_INPUTS);
        }
        validationArgs.push(tokenlist[0]);
        args.push(expression(tokenlist));
      }
    } else {
      // Caller specified argument count
      while (tokenlist.length && !peek(tokenlist, [')'])) {
        validationArgs.push(tokenlist[0]);
        args.push(expression(tokenlist));
      }
      if (!tokenlist.length || tokenlist[0] !== ')')
            throw err("Expected ')'", ERRORS.MISSING_PAREN);
      tokenlist.shift(); // Consume ')'

      if (args.length < procedure.minimum)
        throw err("Not enough inputs for {name:U}", {name: name}, ERRORS.NOT_ENOUGH_INPUTS);
      if (procedure.maximum !== -1 && args.length > procedure.maximum)
        throw err("Too many inputs for {name:U}", {name: name}, ERRORS.TOO_MANY_INPUTS);
    }

    if (self.validationQueue) {
      self.validateCall?.(procedure, name, args);
      // Compile literal instruction lists as well as the outer program.
      // Ordinary data lists are intentionally left as data.
      const blocks = {
        REPEAT: [1], FOREVER: [0], RUN: [0], RUNRESULT: [0],
        IF: [1, 2], IFELSE: [1, 2], IFTRUE: [0], IFT: [0], IFFALSE: [0], IFF: [0],
        CATCH: [1], FILLED: [1], ASK: [1], FOR: [1], DOTIMES: [1],
        WHILE: [0, 1], UNTIL: [0, 1], 'DO.WHILE': [0, 1], 'DO.UNTIL': [0, 1]
      };
      for (const i of blocks[name] || []) {
        const condition = (['WHILE', 'UNTIL'].includes(name) && i === 0) || (['DO.WHILE', 'DO.UNTIL'].includes(name) && i === 1);
        const allowValue = condition || ['RUN', 'RUNRESULT', 'IF', 'IFELSE', 'IFTRUE', 'IFT', 'IFFALSE', 'IFF', 'CATCH'].includes(name);
        if (Array.isArray(validationArgs[i])) queueValidation(reparse(validationArgs[i]), allowValue);
      }
      const queueTemplate = (template, allowValue = true) => {
        if (!Array.isArray(template) || !template.length) return;
        const body = Array.isArray(template[0])
          ? (template.length === 2 && Array.isArray(template[1]) ? template[1] : template.slice(1))
          : template;
        const procedureText = Array.isArray(template[0]) && template.length === 2 && Array.isArray(template[1]);
        queueValidation(reparse(body), allowValue && !procedureText);
      };
      if (['MAP', 'MAP.SE', 'FILTER', 'FIND', 'REDUCE', 'APPLY', 'INVOKE', 'CROSSMAP'].includes(name)) queueTemplate(validationArgs[0]);
      if (name === 'FOREACH') queueTemplate(validationArgs[1], false);
      if (['CASCADE', 'CASCADE.2'].includes(name)) {
        queueTemplate(validationArgs[0]);
        for (let i = 1; i < validationArgs.length; i += 2) queueTemplate(validationArgs[i]);
        if (validationArgs.length % 2 === 0) queueTemplate(validationArgs.at(-1));
      }
      if (name === 'TRANSFER') { queueTemplate(validationArgs[0]); queueTemplate(validationArgs[1]); }
      if (['CASE', 'COND'].includes(name)) {
        for (const clause of validationArgs[name === 'CASE' ? 1 : 0] || []) {
          if (!Array.isArray(clause)) continue;
          if (name === 'COND') queueTemplate(clause[0]);
          queueValidation(reparse(clause.slice(1)), true);
        }
      }
    }

    if (procedure.noeval) {
      return async () => {
        resources?.instruction();
        resources?.checkDepth(self.stack.length + 1);
        self.stack.push(name);
        try {
          return procedure.apply(self, args);
        } finally {
          self.stack.pop();
        }
      };
    }

    return async () => {
      resources?.instruction();
      resources?.checkDepth(self.stack.length + 1);
      self.stack.push(name);
      try {
        const a = [];
        for (const proc of args) {
          a.push(await proc());
        }
        if (procedure.traced) stream.write('(', name, ' ', joinText(a.map(value => stringify(value)), ' '), ')\n');
        const invoke = (inputs = a) => procedure.apply(self, inputs);
        const result = procedure.primitive && self.primitiveExecutor ? await self.primitiveExecutor(name, a, invoke) : await invoke();
        if (procedure.traced) stream.write(name, ' outputs ', result === undefined ? 'STOP' : stringify(result), '\n');
        return procedure.macro ? await run(result) : result;
      } catch (error) {
        return await recoverError(error);
      } finally {
        self.stack.pop();
      }
    };
  };

  //----------------------------------------------------------------------
  // Arithmetic expression convenience function
  //----------------------------------------------------------------------
  function aexpr(atom) {
    if (atom === undefined) {
      throw err("Expected number", ERRORS.BAD_INPUT);
    }
    switch (Type(atom)) {
    case 'word':
      if (isNumber(atom))
        return parseFloat(unprotect(atom));
      break;
    }
    throw err("Expected number", ERRORS.BAD_INPUT);
  }

  //----------------------------------------------------------------------
  // Boolean expression convenience function
  //----------------------------------------------------------------------
  function bexpr(atom) {
    if (atom === undefined) {
      throw err("Expected true or false ", ERRORS.BAD_INPUT);
    }
    switch (Type(atom)) {
    case 'word':
      if (String(atom).toLowerCase() == 'true')
        return true;
      if (String(atom).toLowerCase() == 'false')
        return false;
      if (isNumber(atom))
        throw err('Expected TRUE or FALSE', ERRORS.BAD_INPUT);
      break;
    }
    throw err("Expected true or false", ERRORS.BAD_INPUT);
  }

  //----------------------------------------------------------------------
  // String expression convenience function
  //----------------------------------------------------------------------
  function sexpr(atom) {
    if (atom === undefined) throw err("Expected string", ERRORS.BAD_INPUT);
    if (atom === UNARY_MINUS) return '-';
    if (Type(atom) === 'word') return String(atom);

    throw new err("Expected string", ERRORS.BAD_INPUT);
  }

  //----------------------------------------------------------------------
  // List expression convenience function
  //----------------------------------------------------------------------

  // 'list expression'
  // Takes an atom - if it is a list is is returned unchanged. If it
  // is a word a list of the characters is returned. If the procedure
  // returns a list, the output type should match the input type, so
  // use sifw().
  function lexpr(atom) {
    if (atom === undefined)
      throw err("{_PROC_}: Expected list", ERRORS.BAD_INPUT);
    switch (Type(atom)) {
    case 'word':
      resources?.allocate(String(atom).length);
      return [...String(atom)];
    case 'list':
      return copy(atom);
    }

    throw err("{_PROC_}: Expected list", ERRORS.BAD_INPUT);
  }

  // 'stringify if word'
  // Takes an atom which is to be the subject of lexpr() and a result
  // list. If the atom is a word, returns a word, otherwise a list.
  function sifw(atom, list) {
    return (Type(atom) === 'word') ? joinText(list.map(value => String(value))) : list;
  }

  //----------------------------------------------------------------------
  // Returns a deep copy of a value (word or list). Arrays are copied
  // by reference.
  //----------------------------------------------------------------------
  function copy(value, depth = 0) {
    resources?.checkDepth(depth);
    switch (Type(value)) {
    case 'list': {
      resources?.allocate(value.length);
      const result = value.map(item => copy(item, depth + 1));
      if (value.locations) trackedTokens(result, value.locations.slice(), value.sourceText);
      const info = listSources.get(value);
      if (info) listSources.set(result, info);
      return result;
    }
    default: return value;
    }
  }

  //----------------------------------------------------------------------
  // Deep compare of values (numbers, strings, lists)
  //----------------------------------------------------------------------
  function equal(a, b) {
    if (Type(a) !== Type(b)) return false;
    switch (Type(a)) {
    case 'word':
      if (typeof a === 'number' || typeof b === 'number')
        return Number(unprotect(a)) === Number(unprotect(b));
      else
        return String(maybegetvar('caseignoredp')).toLowerCase() !== 'false' ? unprotect(a).toLowerCase() === unprotect(b).toLowerCase() : unprotect(a) === unprotect(b);
    case 'list':
      if (a.length !== b.length)
        return false;
      for (let i = 0; i < a.length; ++i) {
        if (!equal(a[i], b[i]))
          return false;
      }
      return true;
    case 'array':
      return a === b;
    }
    return undefined;
  }

  //----------------------------------------------------------------------
  //
  // Execute a script
  //
  //----------------------------------------------------------------------

  //----------------------------------------------------------------------
  // Execute a sequence of statements
  //----------------------------------------------------------------------
  self.execute = async (statements, options = {}) => {
    // Operate on a copy so the original is not destroyed
    statements = statements.slice();

    let lastResult;
    while (statements.length) {
      resources?.instruction();
      const position = statements.sourceText === self.rootSourceText ? statements.locations?.[0] : undefined;
      if (typeof position === 'number') self.currentLine = self.rootSourceText.slice(0, position).split('\n').length;
      if (self.onInstruction) await self.onInstruction({line: self.currentLine || 1, procedure: self.stack.at(-1) || null});
      if (self.routines.get(self.stack.at(-1))?.stepped && !self.stepping) {
        self.stepping = true;
        try {
          await stream.read('Step: ' + unprotect(stringify_nodecorate(statements)) + ' — press Enter to continue');
        } finally { self.stepping = false; }
      }
      if (self.forceBye) {
        self.forceBye = false;
        throw new Bye;
      }
      const result = await evaluateExpression(statements);
      if (result !== undefined && !options.returnResult) {
        throw err("Don't know what to do with {result}", {result: result},
                  ERRORS.BAD_OUTPUT);
      }
      lastResult = result;
    }
    return lastResult;
  };

  // FIXME: should this confirm that something is running?
  self.bye = () => {
    self.forceBye = true;
  };

  let lastRun = Promise.resolve();

  // Call to insert an arbitrary task (callback) to be run in sequence
  // with pending calls to run. Useful in tests to do work just before
  // a subsequent assertion.
  self.queueTask = task => {
    const promise = lastRun.then(() => {
      return Promise.resolve(task());
    });
    lastRun = promise.catch(() =>{});
    return promise;
  };

  self.run = (string, options = {}) => {
    return self.queueTask(async () => {
      self.rootSourceText = String(string);
      self.currentLine = 1;
      // Parse it
      const atoms = parse(string);
      self.sourceDefinitions = new Map();
      for (let i = 0; i < atoms.length; ++i) {
        if (typeof atoms[i] !== 'string' || !['to', '.macro'].includes(atoms[i].toLowerCase())) continue;
        const name = String(atoms[i + 1]).toLowerCase(), start = atoms.locations[i];
        let end = i + 2;
        while (end < atoms.length && !isKeyword(atoms[end], 'END')) ++end;
        if (end >= atoms.length) continue;
        const definition = String(string).slice(start, atoms.locations[end] + 3).split('\n');
        if (!self.sourceDefinitions.has(name)) self.sourceDefinitions.set(name, []);
        self.sourceDefinitions.get(name).push(definition);
        i = end;
      }

      // And execute it!
      try {
        return await self.execute(atoms, options);
      } catch(err) {
        if (err instanceof Bye)
          return undefined;
        throw err;
      }
    });
  };

  // Local adaptation: compile a candidate without invoking its expressions.
  // Use a fresh instance for each validation; TO only registers definitions.
  self.validate = string => {
    const atoms = parse(string);
    for (let i = 0; i < atoms.length; ++i) {
      if (typeof atoms[i] === 'string' && ['to', '.macro'].includes(atoms[i].toLowerCase())) {
        const remaining = atoms.slice(i + 1).map(value => copy(value));
        self.routines.get(atoms[i].toLowerCase()).call(self, remaining);
        i = atoms.length - remaining.length - 1;
      } else if (['define', '.defmacro'].includes(String(atoms[i]).toLowerCase()) &&
                 typeof atoms[i + 1] === 'string' && atoms[i + 1].startsWith('"') &&
                 Array.isArray(atoms[i + 2])) {
        self.routines.get(String(atoms[i]).toLowerCase()).call(self, atoms[i + 1].slice(1), copy(atoms[i + 2]));
      }
    }
    self.validationQueue = [];
    queueValidation(atoms);
    self.validationBindings = new Set(self.scopes[0].keys());
    function discoverBindings(tokens) {
      tokens.forEach((atom, index) => {
        if (Array.isArray(atom)) discoverBindings(atom);
        if (['make', 'localmake', 'name'].includes(String(atom).toLowerCase())) {
          const word = tokens[index + (String(atom).toLowerCase() === 'name' ? 2 : 1)];
          if (typeof word === 'string' && word.startsWith('"')) self.validationBindings.add(unprotect(word.slice(1).toLowerCase()));
        }
      });
    }
    discoverBindings(atoms);
    self.routines.forEach((name, proc) => {
      if (!proc.primitive && proc.block) {
        for (const input of [...proc.inputs, ...proc.optional_inputs.map(x => x[0]), ...(proc.rest ? [proc.rest] : [])]) self.validationBindings.add(unprotect(input.toLowerCase()));
        queueValidation(proc.block.slice());
        for (const [, initial] of proc.optional_inputs || []) queueValidation(reparse(initial), true);
      }
    });
    try {
      let count = 0;
      while (self.validationQueue.length) {
        if (++count > 10000) throw new Error('Program is too complex to validate.');
        const {tokens, allowValue} = self.validationQueue.shift();
        const statements = tokens.slice();
        while (statements.length) {
          const compiled = expression(statements);
          if (Object.hasOwn(compiled, 'literal') && (!allowValue || statements.length)) {
            throw err('Unexpected standalone value {value}; a preceding command may have too many inputs', {value: stringify(compiled.literal)});
          }
        }
      }
      return true;
    } finally {
      delete self.validationQueue;
      delete self.validationBindings;
    }
  };

  self.definition = (name, proc) => {

    function defn(atom, depth = 0) {
      resources?.checkDepth(depth);
      switch (Type(atom)) {
      case 'word': return String(atom);
      case 'list': return '[ ' + joinText(atom.map(value => defn(value, depth + 1)), ' ') + ' ]';
      case 'array': return '{ ' + joinText(atom.list.map(value => defn(value, depth + 1)), ' ') + ' }' +
          (atom.origin === 1 ? '' : '@' + atom.origin);
      default: throw new Error("Internal error: unknown type");
      }
    }

    let def = "to " + name;

    def += proc.inputs.map(i => ' :' + i).join('');
    def += proc.optional_inputs.map(op =>
      ' [:' + op[0] + ' ' + joinText(op[1].map(value => defn(value)), ' ') + ']'
    ).join('');
    if (proc.rest)
      def += ' [:' + proc.rest + ']';
    if (proc.def !== undefined)
      def += ' ' + proc.def;

    def += "\n";
    def += "  " + joinText(proc.block.map(value => defn(value)), " ").replace(new RegExp(UNARY_MINUS + ' ', 'g'), '-');
    def += "\n" + "end";

    return def;
  };

  // API to allow pages to persist definitions
  self.procdefs = () => {
    const defs = [];
    self.routines.forEach((name, proc) => {
      if (!proc.primitive) {
        defs.push(self.definition(name, proc));
      }
    });
    return joinText(defs, "\n\n");
  };

  // API to allow aliasing. Can be used for localization. Does not
  // check for errors.
  self.copydef = (newname, oldname) => {
    self.routines.set(newname, self.routines.get(oldname));
  };

  //----------------------------------------------------------------------
  //
  // Built-In Proceedures
  //
  //----------------------------------------------------------------------

  // Basic form:
  //
  //  def("procname", (input1, input2, ...) => { ... return output; });
  //   * inputs are JavaScript strings, numbers, or Arrays
  //   * output is string, number, Array or undefined/no output
  //
  // Special forms:
  //
  //  def("procname", (tokenlist) => { ... }, {special: true});
  //   * input is Array (list) of tokens (words, numbers, Arrays)
  //   * used for implementation of special forms (e.g. TO inputs... statements... END)
  //
  //  def("procname", (fin, fin, ...) => { ... return op; }, {noeval: true});
  //   * inputs are arity-0 functions that evaluate to string, number Array
  //   * used for short-circuiting evaluation (AND, OR)
  //   * used for repeat evaluation (DO.WHILE, WHILE, DO.UNTIL, UNTIL)
  //

  // Check the resulting text size before joining, including intermediate
  // formatting. This also prevents small nested structures expanding unchecked.
  function joinText(parts, separator = '') {
    let length = Math.max(0, parts.length - 1) * separator.length;
    for (const part of parts) length += part.length;
    resources?.allocate(length);
    return parts.join(separator);
  }

  function stringify(thing, depth = 0) {
    resources?.checkDepth(depth);
    switch (Type(thing)) {
    case 'list':
      return "[" + joinText(thing.map(item => stringify(item, depth + 1)), " ") + "]";
    case 'array':
      return "{" + joinText(thing.list.map(item => stringify(item, depth + 1)), " ") + "}" +
        (thing.origin === 1 ? '' : '@' + thing.origin);
    default:
      return sexpr(thing);
    }
  }

  function stringify_nodecorate(thing, depth = 0) {
    resources?.checkDepth(depth);
    switch (Type(thing)) {
    case 'list':
      return joinText(thing.map(item => stringify(item, depth + 1)), " ");
    case 'array':
      return joinText(thing.list.map(item => stringify(item, depth + 1)), " ");
    default:
      return sexpr(thing);
    }
  }

  function formatOutput(thing, decorate = true, depth = 0) {
    resources?.checkDepth(depth);
    resources?.allocate(1);
    const depthLimit = maybegetvar('printdepthlimit'), widthLimit = maybegetvar('printwidthlimit');
    const width = isNumber(widthLimit) && Number(widthLimit) >= 0 ? Number(widthLimit) : Infinity;
    const type = Type(thing);
    if (type === 'list' || type === 'array') {
      if (isNumber(depthLimit) && Number(depthLimit) >= 0 && depth >= Number(depthLimit)) return '...';
      const items = type === 'list' ? thing : thing.list;
      const members = items.slice(0, width).map(value => formatOutput(value, true, depth + 1));
      if (items.length > width) members.push('...');
      const result = joinText(members, ' ');
      return decorate ? (type === 'list' ? '[' + result + ']' : '{' + result + '}' + (thing.origin === 1 ? '' : '@' + thing.origin)) : result;
    }
    let word = sexpr(thing);
    if (word.length > width) word = word.slice(0, width) + '...';
    if (String(maybegetvar('fullprintp')).toLowerCase() === 'true' && (!word || /[\s\uE000-\uE0FF]/.test(word))) return '|' + unprotect(word).replace(/([\\|])/g, '\\$1') + '|';
    return word;
  }

  function def(name, fn, props) {
    fn.minimum = fn.default = fn.maximum = fn.length;
    if (props) {
      Object.keys(props).forEach(key => {
        fn[key] = props[key];
      });
    }
    fn.primitive = true;
    if (Array.isArray(name)) {
      name.forEach(name => {
        self.routines.set(name, fn);
      });
    } else {
      self.routines.set(name, fn);
    }
  }

  //
  // Procedures and Flow Control
  //
  def("to", list => {
    const name = sexpr(list.shift());
    if (isNumber(name) || isOperator(name))
      throw err("TO: Expected identifier", ERRORS.BAD_INPUT);

    const inputs = []; // [var, ...]
    const optional_inputs = []; // [[var, [expr...]], ...]
    let rest = undefined; // undefined or var
    let length = undefined; // undefined or number
    const block = [], blockLocations = [];

    // Process inputs, then the statements of the block
    const REQUIRED = 0, OPTIONAL = 1, REST = 2, DEFAULT = 3, BLOCK = 4;
    let state = REQUIRED, sawEnd = false;
    while (list.length) {
      const location = list.locations?.[0];
      const atom = list.shift();
      if (isKeyword(atom, 'END')) {
        sawEnd = true;
        break;
      }

      if (state === REQUIRED) {
        if (Type(atom) === 'word' && String(atom).charAt(0) === ':') {
          inputs.push(atom.substring(1));
          continue;
        }
        state = OPTIONAL;
      }

      if (state === OPTIONAL) {
        if (Type(atom) === 'list' && atom.length > 1 &&
            String(atom[0]).charAt(0) === ':') {
          optional_inputs.push([atom.shift().substring(1), atom]);
          continue;
        }
        state = REST;
      }

      if (state === REST) {
        state = DEFAULT;
        if (Type(atom) === 'list' && atom.length === 1 &&
            String(atom[0]).charAt(0) === ':') {
          rest = atom[0].substring(1);
          continue;
        }
      }

      if (state === DEFAULT) {
        state = BLOCK;
        if (Type(atom) === 'word' && isNumber(atom)) {
          length = parseFloat(atom);
          continue;
        }
      }

      block.push(atom);
      blockLocations.push(location);
    }
    if (!sawEnd)
      throw err("TO: Expected END", ERRORS.BAD_INPUT);

    trackedTokens(block, blockLocations, list.sourceText);
    defineAndSaveProc(name, inputs, optional_inputs, rest, length, block);
    const original = self.sourceDefinitions?.get(name.toLowerCase())?.shift();
    if (original) self.routines.get(name).fulltext = original;
  }, {special: true});

  function defineAndSaveProc(name, inputs, optional_inputs, rest, def, block) {
    if (self.routines.has(name) && self.routines.get(name).primitive &&
        (self.routines.get(name).unsupported || !bexpr(maybegetvar('redefp') || 'false')))
      throw err("{_PROC_}: Can't redefine primitive {name:U}", { name: name },
                ERRORS.IS_PRIMITIVE);

    const proc = defineProc(name, inputs, optional_inputs, rest, def, block);
    self.routines.set(name, proc);

    // For DEF de-serialization
    proc.inputs = inputs;
    proc.optional_inputs = optional_inputs;
    proc.rest = rest;
    proc.def = def;
    proc.block = block;

    proc.minimum = inputs.length;
    proc.default = proc.length;
    proc.maximum = rest ? -1 : inputs.length + optional_inputs.length;

    saveproc(name, self.definition(name, proc));
  }

  function defineProc(name, inputs, optional_inputs, rest, def, block) {
    if (def !== undefined &&
        (def < inputs.length || (!rest && def > inputs.length + optional_inputs.length))) {
      if (name) {
        throw err("{_PROC_}: Bad default number of inputs for {name:U}", {name: name},
                  ERRORS.BAD_INPUT);
      } else {
        throw err("{_PROC_}: Bad default number of inputs for lambda", ERRORS.BAD_INPUT);
      }
    }

    const length = (def === undefined) ? inputs.length : def;

    // Closure over inputs and block to handle scopes, arguments and outputs
    return to_arity(async (...args) => {
      // Define a new scope
      const scope = new StringMap(true);
      self.scopes.push(scope);

      let i = 0;
      for (; i < inputs.length && i < args.length; ++i)
        scope.set(inputs[i], {value: args[i]});
      for (; i < inputs.length + optional_inputs.length && i < args.length; ++i) {
        const op = optional_inputs[i - inputs.length];
        scope.set(op[0], {value: args[i]});
      }
      for (; i < inputs.length + optional_inputs.length; ++i) {
        const op = optional_inputs[i - inputs.length];
        scope.set(op[0], {value: await evaluateExpression(reparse(op[1]))});
      }
      if (rest)
        scope.set(rest, {value: args.slice(i)});

      try {
        let instructions = block.slice();
        for (;;) {
          try { await self.execute(instructions); break; }
          catch (jump) {
            if (!(jump instanceof GoTo)) throw jump;
            const at = block.findIndex((token, index) => String(token).toLowerCase() === 'tag' && String(block[index + 1]).toLowerCase() === '"' + jump.tag.toLowerCase());
            if (at < 0) throw err('No TAG for {tag}', { tag: jump.tag });
            instructions = block.slice(at + 2);
          }
        }
        await yieldIfNeeded();
        return undefined;
      } catch (err) {
        if (err instanceof Output)
          return err.output;
        throw err;
      } finally {
        self.scopes.pop();
      }
    }, length);
  }


  def("def", list => {

    const name = sexpr(list);
    const proc = this.routines.get(name);
    if (!proc)
      throw err("{_PROC_}: Don't know how to {name:U}", { name: name }, ERRORS.BAD_PROC);
    if (!proc.inputs) {
      throw err("{_PROC_}: Can't show definition of primitive {name:U}", { name: name },
               ERRORS.IS_PRIMITIVE);
    }

    return this.definition(name, proc);
  });


  //----------------------------------------------------------------------
  //
  // 2. Data Structure Primitives
  //
  //----------------------------------------------------------------------

  //
  // 2.1 Constructors
  //

  def("word", (...words) => {
    return joinText(words.map(sexpr));
  }, {minimum: 0, default: 2, maximum: -1});

  def("list", (...things) => {
    resources?.allocate(things.length);
    return things.slice();
  }, {minimum: 0, default: 2, maximum: -1});

  def(["sentence", "se"], (...things) => {
    let list = [];
    for (let thing of things) {
      if (Type(thing) === 'list') {
        thing = lexpr(thing);
        resources?.allocate(list.length + thing.length);
        list = list.concat(thing);
      } else {
        resources?.checkSize(list.length + 1);
        resources?.allocate(1);
        list.push(thing);
      }
    }
    return list;
  }, {minimum: 0, default: 2, maximum: -1});

  def("fput", (thing, list) => {
    const l = lexpr(list);
    resources?.checkSize(l.length + 1);
    resources?.allocate(1);
    l.unshift(thing);
    return sifw(list, l);
  });

  def("lput", (thing, list) => {
    const l = lexpr(list);
    resources?.checkSize(l.length + 1);
    resources?.allocate(1);
    l.push(thing);
    return sifw(list, l);
  });

  def("array", (size, origin=undefined) => {
    size = aexpr(size);
    if (!Number.isSafeInteger(size) || size < 1)
      throw err("{_PROC_}: Array size must be positive integer", ERRORS.BAD_INPUT);
    origin = (origin === undefined) ? 1 : aexpr(origin);
    return new LogoArray(size, origin);
  }, {maximum: 2});

  def("mdarray", (sizes, origin=undefined) => {
    sizes = lexpr(sizes).map(aexpr);
    if (!sizes.length || sizes.some(size => !Number.isSafeInteger(size) || size < 1))
      throw err("{_PROC_}: Array size must be positive integer", ERRORS.BAD_INPUT);
    origin = (origin === undefined) ? 1 : aexpr(origin);

    // Preflight the full tree before allocating the first dimension.
    let product = 1, total = 0;
    for (const size of sizes) {
      resources?.checkSize(size);
      product *= size;
      total += product;
      resources?.checkAllocation(total);
    }
    resources?.checkDepth(sizes.length);

    function make(index) {
      const n = sizes[index], a = new LogoArray(n, origin);
      if (index + 1 < sizes.length) {
        for (let i = 0; i < n; ++i)
          a.setItem(i + origin, make(index + 1));
      }
      return a;
    }

    return make(0);
  }, {maximum: 2});

  def("listtoarray", (list, origin=undefined) => {
    list = lexpr(list);
    origin = (origin === undefined) ? 1 : aexpr(origin);
    return LogoArray.from(list, origin);
  }, {maximum: 2});

  def("arraytolist", array => {
    if (Type(array) !== 'array') {
      throw err("{_PROC_}: Expected array", ERRORS.BAD_INPUT);
    }
    resources?.allocate(array.length);
    return array.list.slice();
  });

  def("combine", (thing1, thing2) => {
    if (Type(thing2) !== 'list') {
      return this.routines.get('word')(thing1, thing2);
    } else {
      return this.routines.get('fput')(thing1, thing2);
    }
  });

  def("reverse", (list, tail=undefined) => {
    tail = (tail !== undefined) ? tail : (Type(list) === 'list' ? [] : '');
    const head = lexpr(list), rest = lexpr(tail);
    resources?.allocate(head.length + rest.length);
    return sifw(tail, head.reverse().concat(rest));
  }, {maximum: 2});

  this.gensym_index = 0;
  def("gensym", () => {
    ++this.gensym_index;
    return 'G' + this.gensym_index;
  });

  //
  // 2.2 Data Selectors
  //

  def("first", list => lexpr(list)[0]);

  def("firsts", list => lexpr(list).map(x => x[0]));

  def("last", list => { list = lexpr(list); return list.at(-1); });

  def(["butfirst", "bf"], list => sifw(list, lexpr(list).slice(1)));

  def(["butfirsts", "bfs"], list =>
      lexpr(list).map(x => sifw(x, lexpr(x).slice(1)))
     );

  def(["butlast", "bl"], list =>
      Type(list) === 'word' ? String(list).slice(0, -1) : lexpr(list).slice(0, -1)
     );

  function item(index, thing) {
    switch (Type(thing)) {
    case 'list':
      if (index < 1 || index > thing.length)
        throw err("{_PROC_}: Index out of bounds", ERRORS.BAD_INPUT);
      return thing[index - 1];
    case 'array':
      return thing.item(index);
    default:
      thing = sexpr(thing);
      if (index < 1 || index > thing.length)
        throw err("{_PROC_}: Index out of bounds", ERRORS.BAD_INPUT);
      return thing.charAt(index - 1);
    }
  }

  def("item", (index, thing) => {
    index = aexpr(index)|0;
    return item(index, thing);
  });

  def("mditem", (indexes, thing) => {
    indexes = lexpr(indexes).map(aexpr).map(n => n|0);
    while (indexes.length)
      thing = item(indexes.shift(), thing);
    return thing;
  });

  def("pick", list => {
    list = lexpr(list);
    const i = Math.floor(this.prng.next() * list.length);
    return list[i];
  });

  def("remove", (thing, list) =>
      sifw(list, lexpr(list).filter(x => !equal(x, thing)))
     );

  def("remdup", list => {
    const items = lexpr(list);
    return sifw(list, items.filter((x, i) => !items.slice(i + 1).some(value => equal(value, x))));
  });

  def("split", (thing, list) => {
    const l = lexpr(list);
    return lexpr(list)
      .reduce((ls, i) => (equal(i, thing) ? ls.push([]) : ls.at(-1).push(i), ls), [[]])
      .filter(l => l.length > 0)
      .map(e => sifw(list, e));
  });

  def("quoted", thing => {
    if (Type(thing) === 'word')
      return '"' + thing;
    return thing;
  });


  //
  // 2.3 Data Mutators
  //

  function contains(atom, value) {
    if (atom === value) return true;
    switch (Type(atom)) {
    case 'list':
      return atom.some(a => contains(a, value));
    case 'array':
      return atom.list.some(a => contains(a, value));
    default:
      return false;
    }
  }

  def("setitem", (index, array, value) => {
    index = aexpr(index);
    if (Type(array) !== 'array')
      throw err("{_PROC_}: Expected array", ERRORS.BAD_INPUT);
    if (contains(value, array))
      throw err("{_PROC_}: Can't create circular array", ERRORS.BAD_INPUT);
    array.setItem(index, value);
  });

  def("mdsetitem", (indexes, thing, value) => {
    indexes = lexpr(indexes).map(aexpr).map(n => n|0);
    if (Type(thing) !== 'array')
      throw err("{_PROC_}: Expected array", ERRORS.BAD_INPUT);
    if (contains(value, thing))
      throw err("{_PROC_}: Can't create circular array", ERRORS.BAD_INPUT);
    while (indexes.length > 1) {
      thing = item(indexes.shift(), thing);
      if (Type(thing) !== 'array')
        throw err("{_PROC_}: Expected array", ERRORS.BAD_INPUT);
    }
    thing.setItem(indexes.shift(), value);
  });

  def(".setfirst", (list, value) => {
     if (Type(list) !== 'list')
      throw err("{_PROC_}: Expected list", ERRORS.BAD_INPUT);
    list[0] = value;
  });

  def(".setbf", (list, value) => {
    if (Type(list) !== 'list')
      throw err("{_PROC_}: Expected non-empty list", ERRORS.BAD_INPUT);
    if (list.length < 1)
      throw err("{_PROC_}: Expected non-empty list", ERRORS.BAD_INPUT);
    value = lexpr(value);
    list.length = 1;
    list.push.apply(list, value);
  });

  def(".setitem", (index, array, value) => {
    index = aexpr(index);
    if (Type(array) !== 'array')
      throw err("{_PROC_}: Expected array", ERRORS.BAD_INPUT);
    array.setItem(index, value);
  });

  def("push", (stackname, thing) => {
    const got = getvar(stackname);
    const stack = lexpr(got);
    stack.unshift(thing);
    setvar(stackname, sifw(got, stack));
  });

  def("pop", stackname => {
    const got = getvar(stackname);
    const stack = lexpr(got);
    const atom = stack.shift();
    setvar(stackname, sifw(got, stack));
    return atom;
  });

  def("queue", (stackname, thing) => {
    const got = getvar(stackname);
    const queue = lexpr(got);
    queue.push(thing);
    setvar(stackname, sifw(got, queue));
  });

  def("dequeue", stackname => {
    const got = getvar(stackname);
    const queue = lexpr(got);
    const atom = queue.shift();
    setvar(stackname, sifw(got, queue));
    return atom;
  });


  //
  // 2.4 Predicates
  //

  def(["wordp", "word?"], thing => Type(thing) === 'word' ? 'true' : 'false');
  def(["listp", "list?"], thing => Type(thing) === 'list' ? 'true' : 'false');
  def(["arrayp", "array?"], thing => Type(thing) === 'array' ? 'true' : 'false');
  def(["numberp", "number?"], thing =>
      Type(thing) === 'word' && isNumber(thing) ? 'true' : 'false'
  );
  def(["numberwang"], thing => this.prng.next() < 0.5 ? 'true' : 'false');

  def(["equalp", "equal?"], (a, b) => equal(a, b) ? 'true' : 'false');
  def(["notequalp", "notequal?"], (a, b) => !equal(a, b) ? 'true' : 'false');

  def(["emptyp", "empty?"], thing => {
    switch (Type(thing)) {
    case 'word': return String(thing).length === 0 ? 'true' : 'false';
    case 'list': return thing.length === 0 ? 'true' : 'false';
    default: return 'false';
    }
  });
  def(["beforep", "before?"], (word1, word2) =>
      (String(maybegetvar('caseignoredp')).toLowerCase() !== 'false' ? unprotect(sexpr(word1)).toLowerCase() < unprotect(sexpr(word2)).toLowerCase() : unprotect(sexpr(word1)) < unprotect(sexpr(word2))) ? 'true' : 'false'
     );

  def(".eq", (a, b) => a === b && a && typeof a === 'object' ? "true" : "false");

  def(['vbarredp', 'vbarred?', 'backslashedp', 'backslashed?'], char => /^[\uE000-\uE0FF]$/.test(sexpr(char)) ? 'true' : 'false');

  def(["memberp", "member?"], (thing, list) =>
      lexpr(list).some(x => equal(x, thing)) ? 'true' : 'false'
     );


  def(["substringp", "substring?"], (word1, word2) =>
      Type(word1) !== 'word' || Type(word2) !== 'word' ? 'false' :
      (String(maybegetvar('caseignoredp')).toLowerCase() !== 'false' ? unprotect(sexpr(word2)).toLowerCase().includes(unprotect(sexpr(word1)).toLowerCase()) : unprotect(sexpr(word2)).includes(unprotect(sexpr(word1)))) ? 'true' : 'false'
     );

  //
  // 2.5 Queries
  //

  def("count", thing => {
    if (Type(thing) === 'array')
      return thing.length;
    return lexpr(thing).length;
  });
  def("ascii", chr => unprotect(sexpr(chr)).charCodeAt(0));
  // Not Supported: rawascii
  def("char", integer => String.fromCharCode(aexpr(integer)));

  def("member", (thing, input) => {
    let list = lexpr(input);
    const index = list.findIndex(x => equal(x, thing));
    list = (index === -1) ? [] : list.slice(index);
    return sifw(input, list);
 });

  def("lowercase", word => sexpr(word).toLowerCase());
  def("uppercase", word => sexpr(word).toUpperCase());

  def("standout", word => {
    // Hack: Convert English alphanumerics to Mathematical Bold
    return [...sexpr(word)]
      .map(c => {
        let u = c.codePointAt(0);
        if ('A' <= c && c <= 'Z') {
          u = u - 'A'.codePointAt(0) + 0x1D400;
        } else if ('a' <= c && c <= 'z') {
          u = u - 'a'.codePointAt(0) + 0x1D41A;
        } else if ('0' <= c && c <= '9') {
          u = u - '0'.codePointAt(0) + 0x1D7CE;
        } else {
          return c;
        }
        return String.fromCodePoint(u);
      })
      .join('');
  });

  def("parse", word => parse('[' + sexpr(word) + ']')[0]);

  def("runparse", word => parse(sexpr(word)));

  //----------------------------------------------------------------------
  //
  // 3. Communication
  //
  //----------------------------------------------------------------------

  // 3.1 Transmitters

  def(["print", "pr"], (...things) => {
    const s = joinText(things.map(thing => formatOutput(thing, false)), " ");
    return this.stream.write(s, "\n");
  }, {minimum: 0, default: 1, maximum: -1});
  def("type", (...things) => {
    const s = joinText(things.map(thing => formatOutput(thing, false)));
    return this.stream.write(s);
  }, {minimum: 0, default: 1, maximum: -1});
  def("show", (...things) => {
    const s = joinText(things.map(thing => formatOutput(thing)), " ");
    return this.stream.write(s, "\n");
  }, {minimum: 0, default: 1, maximum: -1});

  // 3.2 Receivers

  def("readlist", async (promptstr=undefined) => {
    const word = (promptstr !== undefined)
          ? await stream.read(stringify_nodecorate(promptstr))
          : await stream.read();
    return parse('[' + word + ']')[0];
  }, {maximum: 1});

  def("readword", (promptstr=undefined) => {
    if (promptstr !== undefined)
      return stream.read(stringify_nodecorate(promptstr));
    else
      return stream.read();
  }, {maximum: 1});


  // Not Supported: readrawline
  // Not Supported: readchar
  // Not Supported: readchars
  // Not Supported: shell

  // 3.3 File Access

  // Not Supported: setprefix
  // Not Supported: prefix
  // Not Supported: openread
  // Not Supported: openwrite
  // Not Supported: openappend
  // Not Supported: openupdate
  // Not Supported: close
  // Not Supported: allopen
  // Not Supported: closeall
  // Not Supported: erasefile
  // Not Supported: dribble
  // Not Supported: nodribble
  // Not Supported: setread
  // Not Supported: setwrite
  // Not Supported: reader
  // Not Supported: writer
  // Not Supported: setreadpos
  // Not Supported: setwritepos
  // Not Supported: readpos
  // Not Supported: writepos
  // Not Supported: eofp
  // Not Supported: filep

  // 3.4 Terminal Access

  // Not Supported: keyp

  def(["cleartext", "ct"], () => this.stream.clear());

  // Not Supported: setcursor
  // Not Supported: cursor
  // Not Supported: setmargins

  def('settextcolor', color => {
    this.stream.color = parseColor(color);
  });

  def('textcolor', () => this.stream.color);

  def('increasefont', () => {
    this.stream.textsize = Math.round(this.stream.textsize * 1.25);
  });

  def('decreasefont', () => {
    this.stream.textsize = Math.round(this.stream.textsize / 1.25);
  });

  def('settextsize', size => {
    this.stream.textsize = aexpr(size);
  });

  def('textsize', () => this.stream.textsize);

  def('setfont', size => {
    this.stream.font = sexpr(size);
  });

  def('font', () => this.stream.font);


  //----------------------------------------------------------------------
  //
  // 4. Arithmetic
  //
  //----------------------------------------------------------------------
  // 4.1 Numeric Operations


  def("sum", (...args) => args.map(aexpr).reduce((a, b) => a + b, 0),
      {minimum: 0, default: 2, maximum: -1});

  def("difference", (a, b) => aexpr(a) - aexpr(b));

  def("minus", a => -aexpr(a));

  def("product", (...args) => args.map(aexpr).reduce((a, b) => a * b, 1),
      {minimum: 0, default: 2, maximum: -1});

  def("quotient", (a, b) => {
    const numerator = b === undefined ? 1 : aexpr(a);
    const denominator = b === undefined ? aexpr(a) : aexpr(b);
    if (denominator === 0) throw err('Division by zero', ERRORS.BAD_INPUT);
    return numerator / denominator;
  }, {minimum: 1});

  def("remainder", (num1, num2) => {
    num1 = aexpr(num1); num2 = aexpr(num2);
    if (num2 === 0) throw err('Division by zero', ERRORS.BAD_INPUT);
    return num1 % num2;
  });

  def("modulo", (num1, num2) => {
    num1 = aexpr(num1);
    num2 = aexpr(num2);
    if (num2 === 0) throw err('Division by zero', ERRORS.BAD_INPUT);
    return ((num1 % num2) + num2) % num2;
  });

  def("power", (a, b) => Math.pow(aexpr(a), aexpr(b)));
  def("sqrt", a => Math.sqrt(aexpr(a)));
  def("exp", a => Math.exp(aexpr(a)));
  def("log10", a => Math.log(aexpr(a)) / Math.LN10);
  def("ln", a => Math.log(aexpr(a)));


  function deg2rad(d) { return d / 180 * Math.PI; }
  function rad2deg(r) { return r * 180 / Math.PI; }

  def("arctan", (a, b=undefined) => {
    if (b !== undefined) {
      const x = aexpr(a);
      const y = aexpr(b);
      return rad2deg(Math.atan2(y, x));
    } else {
      return rad2deg(Math.atan(aexpr(a)));
    }
  }, {maximum: 2});

  def("sin", a => Math.sin(deg2rad(aexpr(a))));
  def("cos", a => Math.cos(deg2rad(aexpr(a))));
  def("tan", a => Math.tan(deg2rad(aexpr(a))));

  def("radarctan", (a, b=undefined) => {
    if (b !== undefined) {
      const x = aexpr(a);
      const y = aexpr(b);
      return Math.atan2(y, x);
    } else {
      return Math.atan(aexpr(a));
    }
  }, {maximum: 2});

  def("radsin", a => Math.sin(aexpr(a)));
  def("radcos", a => Math.cos(aexpr(a)));
  def("radtan", a => Math.tan(aexpr(a)));

  def("abs", a => Math.abs(aexpr(a)));


  function truncate(x) { return parseInt(x, 10); }

  def("int", a => truncate(aexpr(a)));
  def("round", a => Math.round(aexpr(a)));

  def("iseq", (a, b) => {
    a = truncate(aexpr(a));
    b = truncate(aexpr(b));
    resources?.allocate(Math.abs(b - a) + 1);
    const step = (a < b) ? 1 : -1;
    const list = [];
    for (let i = a; (step > 0) ? (i <= b) : (i >= b); i += step) {
      list.push(i);
    }
    return list;
  });


  def("rseq", (from, to, count) => {
    from = aexpr(from);
    to = aexpr(to);
    count = truncate(aexpr(count));
    if (!Number.isSafeInteger(count) || count < 1) throw err('RSEQ needs a positive count', ERRORS.BAD_INPUT);
    resources?.allocate(count);
    if (count === 1) return [from];
    return Array.from({length: count}, (_, i) => from + (to - from) * i / (count - 1));
  });

  // 4.2 Numeric Predicates

  def(["greaterp", "greater?"], (a, b) => aexpr(a) > aexpr(b) ? 'true' : 'false');
  def(["greaterequalp", "greaterequal?"], (a, b) => aexpr(a) >= aexpr(b) ? 'true' : 'false');
  def(["lessp", "less?"], (a, b) => aexpr(a) < aexpr(b) ? 'true' : 'false');
  def(["lessequalp", "lessequal?"], (a, b) => aexpr(a) <= aexpr(b) ? 'true' : 'false');

  // 4.3 Random Numbers

  def("random", (a, b=undefined) => {
    if (b === undefined) {
      const max = aexpr(a);
      return Math.floor(this.prng.next() * max);
    } else {
      const start = aexpr(a);
      const end = aexpr(b);
      return Math.floor(this.prng.next() * (end - start + 1)) + start;
    }
  }, {maximum: 2});

  def("rerandom", (expr=undefined) => {
    const seed = (expr !== undefined) ? aexpr(expr) : 2345678901;
    return this.prng.seed(seed);
  }, {maximum: 1});

  // 4.4 Print Formatting

  def("form", (num, width, precision) => {
    num = aexpr(num);
    width = aexpr(width);
    precision = aexpr(precision);

    return num.toFixed(precision).padStart(width);
  });

  // 4.5 Bitwise Operations


  def("bitand", (...args) => args.map(aexpr).reduce((a, b) => a & b, -1),
      {minimum: 0, default: 2, maximum: -1});
  def("bitor", (...args) => args.map(aexpr).reduce((a, b) => a | b, 0),
      {minimum: 0, default: 2, maximum: -1});
  def("bitxor", (...args) => args.map(aexpr).reduce((a, b) => a ^ b, 0),
      {minimum: 0, default: 2, maximum: -1});
  def("bitnot", num => ~aexpr(num));


  def("ashift", (num1, num2) => {
    num1 = truncate(aexpr(num1));
    num2 = truncate(aexpr(num2));
    return num2 >= 0 ? num1 << num2 : num1 >> -num2;
  });

  def("lshift", (num1, num2) => {
    num1 = truncate(aexpr(num1));
    num2 = truncate(aexpr(num2));
    return num2 >= 0 ? num1 << num2 : num1 >>> -num2;
  });


  //----------------------------------------------------------------------
  //
  // 5. Logical Operations
  //
  //----------------------------------------------------------------------

  def("true", () => "true");
  def("false", () => "false");

  def("and", (...args) => booleanReduce(args, value => value, 1),
      {noeval: true, minimum: 0, default: 2, maximum: -1});

  def("or", (...args) => booleanReduce(args, value => !value, 0),
      {noeval: true, minimum: 0, default: 2, maximum: -1});

  async function booleanReduce(args, test, value) {
    while (args.length) {
      const result = bexpr(await args.shift()());
      if (!test(result))
        return result ? 'true' : 'false';
      value = result;
    }
    return value ? 'true' : 'false';
  }

  def("xor", (...args) => args.map(bexpr).reduce((a, b) => a !== b, false) ? 'true' : 'false',
      {minimum: 0, default: 2, maximum: -1});

  def("not", a => !bexpr(a) ? 'true' : 'false');

  //----------------------------------------------------------------------
  //
  // 6. Graphics
  //
  //----------------------------------------------------------------------
  // 6.1 Turtle Motion

  def(["forward", "fd"], a => turtle.move(aexpr(a)));
  def(["back", "bk"], a => turtle.move(-aexpr(a)));
  def(["left", "lt"], a => turtle.turn(-aexpr(a)));
  def(["right", "rt"], a => turtle.turn(aexpr(a)));

  // Left arrow:
  def(["\u2190"], () => turtle.turn(-15));
  // Right arrow:
  def(["\u2192"], () => turtle.turn(15));
  // Up arrow:
  def(["\u2191"], () => turtle.move(10));
  // Down arrow:
  def(["\u2193"], () => turtle.move(-10));


  def("setpos", l => {
    if (Type(l) !== 'list') throw err('SETPOS expects one [x y] list; use SETXY x y for two numbers', ERRORS.BAD_INPUT);
    l = lexpr(l);
    if (l.length !== 2) throw err("{_PROC_}: Expected list of length 2", ERRORS.BAD_INPUT);
    turtle.position = [aexpr(l[0]), aexpr(l[1])];
  });
  def("setxy", (x, y) => { turtle.position = [aexpr(x), aexpr(y)]; });
  def("setx", x => { turtle.position = [aexpr(x), undefined]; });
  def("sety", y => { turtle.position = [undefined, aexpr(y)]; });
  def(["setheading", "seth"], a => { turtle.heading = aexpr(a); });

  def("home", () => turtle.home());

  def("arc", (angle, radius) => turtle.arc(aexpr(angle), aexpr(radius)));

  //
  // 6.2 Turtle Motion Queries
  //

  def("pos", () => turtle.position);
  def("xcor", () => turtle.position[0]);
  def("ycor", () => turtle.position[1]);
  def("heading", () => turtle.heading);
  def("towards", l => {
    l = lexpr(l);
    if (l.length !== 2) throw err("{_PROC_}: Expected list of length 2", ERRORS.BAD_INPUT);
    return turtle.towards(aexpr(l[0]), aexpr(l[1]));
  });

  def("scrunch", () => turtle.scrunch);
  def("bounds", () => turtle.bounds);

  //
  // 6.3 Turtle and Window Control
  //

  def(["showturtle", "st"], () => { turtle.visible = true; });
  def(["hideturtle", "ht"], () => { turtle.visible = false; });
  def("clean", () => { turtle.clear(); });
  def(["clearscreen", "cs"], () => { turtle.clearscreen(); });

  def("wrap", () => { turtle.turtlemode = 'wrap'; });
  def("window", () => { turtle.turtlemode = 'window'; });
  def("fence", () => { turtle.turtlemode = 'fence'; });

  def("fill", () => { turtle.fill(); });

  def("filled", async (fillcolor, statements) => {
    fillcolor = parseColor(fillcolor);
    turtle.beginpath();
    try {
      await runNoResult(statements);
    } finally {
      turtle.fillpath(fillcolor);
    }
  });

  def("label", (...args) => {
    const s = joinText(args.map(value => stringify_nodecorate(value)), " ");
    return turtle.drawtext(unprotect(s));
  }, {minimum: 1, default: 1, maximum: -1});

  def("setlabelheight", a => { turtle.fontsize = aexpr(a); });

  def("setlabelfont", a => { turtle.fontname = sexpr(a); });

  // Not Supported: textscreen
  // Not Supported: fullscreen
  // Not Supported: splitscreen

  def("setscrunch", (sx, sy) => {
    sx = aexpr(sx);
    sy = aexpr(sy);
    if (!isFinite(sx) || sx === 0 || !isFinite(sy) || sy === 0)
      throw err("{_PROC_}: Expected non-zero values", ERRORS.BAD_INPUT);
    turtle.scrunch = [sx, sy];
  });

  // Not Supported: refresh
  // Not Supported: norefresh

  def("setturtle", (index) => {
    index = aexpr(index)|0;
    if (index < 1)
      throw err("{_PROC_}: Expected positive turtle index", ERRORS.BAD_INPUT);
    turtle.currentturtle = index - 1;
  });

  def("ask", async (index, statements) => {
    index = aexpr(index)|0;
    if (index < 1)
      throw err("{_PROC_}: Expected positive turtle index", ERRORS.BAD_INPUT);
    const originalturtle = turtle.currentturtle;
    turtle.currentturtle = index - 1;
    try {
      await runNoResult(statements);
    } finally {
      turtle.currentturtle = originalturtle;
    }
  });

  def("clearturtles", () => {
    turtle.clearturtles();
  });

  //
  // 6.4 Turtle and Window Queries
  //

  def(["shownp", "shown?"], () => turtle.visible ? 'true' : 'false');

  // Not Supported: screenmode

  def("turtlemode", () => turtle.turtlemode.toUpperCase());

  def("labelsize", () => [turtle.fontsize, turtle.fontsize]);

  def("labelfont", () => turtle.fontname);

  def("turtles", () => turtle.turtles);

  def("turtle", () => turtle.currentturtle + 1);

  //
  // 6.5 Pen and Background Control
  //
  def(["pendown", "pd"], () => { turtle.pendown = true; });
  def(["penup", "pu"], () => { turtle.pendown = false; });

  def(["penpaint", "ppt"], () => { turtle.penmode = 'paint'; });
  def(["penerase", "pe"], () => { turtle.penmode = 'erase'; });
  def(["penreverse", "px"], () => { turtle.penmode = 'reverse'; });

  // To handle additional color names (localizations, etc):
  // logo.colorAlias = (name) => {
  //   return {internationalorange: '#FF4F00', ... }[name];
  // };
  this.colorAlias = null;

  const PALETTE = {
    0: "black", 1: "blue", 2: "lime", 3: "cyan",
    4: "red", 5: "magenta", 6: "yellow", 7: "white",
    8: "brown", 9: "tan", 10: "green", 11: "aquamarine",
    12: "salmon", 13: "purple", 14: "orange", 15: "gray"
  };

  function parseColor(color) {
    function adjust(n) {
      // Clamp into 0...99
      n = Math.min(100, Math.max(0, n));
      // Scale to 0...255
      return Math.floor(n * 255 / 100);
    }
    if (Type(color) === 'list') {
      const r = adjust(aexpr(color[0]));
      const g = adjust(aexpr(color[1]));
      const b = adjust(aexpr(color[2]));
      const rr = (r < 16 ? "0" : "") + r.toString(16);
      const gg = (g < 16 ? "0" : "") + g.toString(16);
      const bb = (b < 16 ? "0" : "") + b.toString(16);
      return '#' + rr + gg + bb;
    }
    color = sexpr(color);
    if (Object.prototype.hasOwnProperty.call(PALETTE, color))
      return PALETTE[color];
    if (self.colorAlias)
      return self.colorAlias(color) || color;
    return color;
  }

  def(["setpencolor", "setpc", "setcolor"], (color) => {
    turtle.color = parseColor(color);
  });

  def("setpalette", (colornumber, color) => {
    colornumber = aexpr(colornumber);
    if (colornumber < 8)
      throw err("{_PROC_}: Expected number greater than 8", ERRORS.BAD_INPUT);
    PALETTE[colornumber] = parseColor(color);
  });

  def(["setpensize", "setwidth", "setpw"], a => {
    if (Type(a) === 'list')
      turtle.penwidth = aexpr(a[0]);
    else
      turtle.penwidth = aexpr(a);
  });

  // Not Supported: setpenpattern
  // Not Supported: setpen

  def(["setbackground", "setbg", "setscreencolor", "setsc"], color => {
    turtle.bgcolor = parseColor(color);
  });

  //
  // 6.6 Pen Queries
  //

  def(["pendownp", "pendown?"], () => turtle.pendown ? 'true' : 'false');

  def("penmode", () => turtle.penmode.toUpperCase());

  def(["pencolor", "pc"], () => turtle.color);

  def("palette", colornumber => PALETTE[aexpr(colornumber)]);

  def("pensize", () => [turtle.penwidth, turtle.penwidth]);

  // Not Supported: pen

  def(["background", "bg", "getscreencolor", "getsc"], () => turtle.bgcolor);

  // 6.7 Saving and Loading Pictures

  // Not Supported: savepict
  // Not Supported: loadpict
  // Not Supported: epspict

  // 6.8 Mouse Queries

  def("mousepos", () => turtle.mousepos);

  def("clickpos", () => turtle.clickpos);

  def(["buttonp", "button?"], () => turtle.button > 0 ? 'true' : 'false');

  def("button", () => turtle.button);

  def("touches", () => turtle.touches);

  // Extensions

  def("bitcut", (w, h) => turtle.copy(w, h));

  def("bitpaste", () => turtle.paste());

  //----------------------------------------------------------------------
  //
  // 7. Workspace Management
  //
  //----------------------------------------------------------------------
  // 7.1 Procedure Definition

  def("define", (name, list) => {
    name = sexpr(name);
    list = lexpr(list);
    if (list.length != 2)
      throw err("{_PROC_}: Expected list of length 2", ERRORS.BAD_INPUT);

    defineAndSaveProc(name, ...parseDefineList(list));
  });

  function parseDefineList(list) {
    const inputs = [];
    const optional_inputs = [];
    let rest = undefined;
    let def = undefined;
    const block = reparse(lexpr(list[1]));

    const ins = lexpr(list[0]);
    const REQUIRED = 0, OPTIONAL = 1, REST = 2, DEFAULT = 3, ERROR = 4;
    let state = REQUIRED;
    while (ins.length) {
      const atom = ins.shift();
      if (state === REQUIRED) {
        if (Type(atom) === 'word') {
          inputs.push(atom);
          continue;
        }
        state = OPTIONAL;
      }

      if (state === OPTIONAL) {
        if (Type(atom) === 'list' && atom.length > 1 && Type(atom[0]) === 'word') {
          optional_inputs.push([atom.shift(), atom]);
          continue;
        }
        state = REST;
      }

      if (state === REST) {
        state = DEFAULT;
        if (Type(atom) === 'list' && atom.length === 1 && Type(atom[0]) === 'word') {
          rest = atom[0];
          continue;
        }
      }

      if (state === DEFAULT) {
        state = ERROR;
        if (Type(atom) === 'word' && isNumber(atom)) {
          def = parseFloat(atom);
          continue;
        }
      }

      throw err("{_PROC_}: Unexpected inputs", ERRORS.BAD_INPUT);
    }

    return [inputs, optional_inputs, rest, def, block];
  }

  def("text", name => {
    const proc = this.routines.get(sexpr(name));
    if (!proc)
      throw err("{_PROC_}: Don't know how to {name:U}", { name: name }, ERRORS.BAD_PROC);
    if (!proc.inputs) {
      throw err("{_PROC_}: Can't show definition of primitive {name:U}", { name: name },
               ERRORS.IS_PRIMITIVE);
    }

    const inputs = proc.inputs.concat(proc.optional_inputs);
    if (proc.rest)
      inputs.push([proc.rest]);
    if (proc.def !== undefined)
      inputs.push(proc.def);
    return [inputs, proc.block];
  });

  // Not Supported: fulltext

  def("copydef", (newname, oldname) => {

    newname = sexpr(newname);
    oldname = sexpr(oldname);

    if (!this.routines.has(oldname)) {
      throw err("{_PROC_}: Don't know how to {name:U}", { name: oldname }, ERRORS.BAD_PROC);
    }

    if (this.routines.has(newname)) {
      if (this.routines.get(newname).special) {
        throw err("{_PROC_}: Can't overwrite special {name:U}", { name: newname },
                  ERRORS.BAD_INPUT);
      }
      if (this.routines.get(newname).primitive && !bexpr(maybegetvar("redefp") || "false")) {
        throw err("{_PROC_}: Can't overwrite primitives unless REDEFP is TRUE",
                 ERRORS.BAD_INPUT);
      }
    }

    this.routines.set(newname, this.routines.get(oldname));
    // TODO: This is broken if copying a built-in, so disable for now
    //saveproc(newname, this.definition(newname, this.routines.get(newname)));
  });


  // 7.2 Variable Definition

  def("make", (varname, value) => {
    setvar(sexpr(varname), value);
  });

  def("name", (value, varname) => {
    setvar(sexpr(varname), value);
  });

  def("local", (...varnames) => {
    varnames.forEach((name) => { local(sexpr(name)); });
  }, {minimum: 1, default: 1, maximum: -1});

  def("localmake", (varname, value) => {
    setlocal(sexpr(varname), value);
  });

  def("thing", varname => getvar(sexpr(varname)));

  def("global", (...varnames) => {
    const globalscope = this.scopes[0];
    varnames.forEach((name) => {
      globalscope.set(sexpr(name), {value: undefined}); });
  }, {minimum: 1, default: 1, maximum: -1});

  //
  // 7.3 Property Lists
  //

  def("pprop", (plistname, propname, value) => {
    plistname = sexpr(plistname);
    propname = sexpr(propname);
    let plist = this.plists.get(plistname);
    if (!plist) {
      plist = new StringMap(true);
      this.plists.set(plistname, plist);
    }
    plist.set(propname, value);
  });

  def("gprop", (plistname, propname) => {
    plistname = sexpr(plistname);
    propname = sexpr(propname);
    const plist = this.plists.get(plistname);
    if (!plist || !plist.has(propname))
      return [];
    return plist.get(propname);
  });

  def("remprop", (plistname, propname) => {
    plistname = sexpr(plistname);
    propname = sexpr(propname);
    const plist = this.plists.get(plistname);
    if (plist) {
      plist.delete(propname);
      if (plist.empty()) {
        // TODO: Do this? Loses state, e.g. unburies if buried
        this.plists.delete(plistname);
      }
    }
  });

  def("plist", plistname => {
    plistname = sexpr(plistname);
    const plist = this.plists.get(plistname);
    if (!plist)
      return [];

    const result = [];
    plist.forEach((key, value) => {
      result.push(key);
      result.push(copy(value));
    });
    return result;
  });

  //
  // 7.4 Workspace Predicates
  //

  def(["procedurep", "procedure?"], name => {
    name = sexpr(name);
    return this.routines.has(name) ? 'true' : 'false';
  });

  def(["primitivep", "primitive?"], name => {
    name = sexpr(name);
    return (this.routines.has(name) &&
            this.routines.get(name).primitive) ? 'true' : 'false';
  });

  def(["definedp", "defined?"], name => {
    name = sexpr(name);
    return (this.routines.has(name) &&
            !this.routines.get(name).primitive) ? 'true' : 'false';
  });

  def(["namep", "name?"], varname => {
    try {
      return getvar(sexpr(varname)) !== undefined ? 'true' : 'false';
    } catch (e) {
      return 'false';
    }
  });

  def(["plistp", "plist?"], plistname => {
    plistname = sexpr(plistname);
    return this.plists.has(plistname) ? 'true' : 'false';
  });

  //
  // 7.5 Workspace Queries
  //

  def("contents", () => [
      this.routines.keys().filter(x => {
        return !this.routines.get(x).primitive && !this.routines.get(x).buried;
      }),
      this.scopes.reduce(
        (list, scope) => {
          return list.concat(scope.keys().filter(x => !scope.get(x).buried)); },
        []),
      this.plists.keys().filter(x => {
        return !this.plists.get(x).buried;
      })
    ]
  );

  def("buried", () => [
      this.routines.keys().filter(x => {
        return !this.routines.get(x).primitive && this.routines.get(x).buried; }),
      this.scopes.reduce(
        (list, scope) => {
          return list.concat(scope.keys().filter(x => scope.get(x).buried)); },
        []),
      this.plists.keys().filter(x => this.plists.get(x).buried)
    ]
  );

  def("traced", () => [
      this.routines.keys().filter(x => {
        return !this.routines.get(x).primitive && this.routines.get(x).traced; }),
      this.scopes.reduce(
        (list, scope) => {
          return list.concat(scope.keys().filter(x => scope.get(x).traced)); },
        []),
      this.plists.keys().filter(x => this.plists.get(x).traced)
    ]
  );

  def(["stepped"], () => [
      this.routines.keys().filter(x => {
        return !this.routines.get(x).primitive && this.routines.get(x).stepped; }),
      this.scopes.reduce(
        (list, scope) => {
          return list.concat(scope.keys().filter(x => scope.get(x).stepped)); },
        []),
      this.plists.keys().filter(x => this.plists.get(x).stepped)
    ]
  );

  def("procedures", () => this.routines.keys().filter(
    x => !this.routines.get(x).primitive && !this.routines.get(x).buried
  ));

  def("primitives", () => this.routines.keys().filter(
    x => this.routines.get(x).primitive & !this.routines.get(x).buried
  ));

  def("globals", () => {
    const globalscope = this.scopes[0];
    return globalscope.keys().filter(x => !globalscope.get(x).buried);
  });

  def("names", () => [
      [],
      this.scopes.reduce((list, scope) => {
        return list.concat(scope.keys().filter(x => {
          return !scope.get(x).buried; })); }, [])
    ]
  );

  def("plists", () => [
      [],
      [],
      this.plists.keys().filter(x => {
        return !this.plists.get(x).buried;
      })
    ]
  );

  def("namelist", varname => {
    if (Type(varname) === 'list')
      varname = lexpr(varname);
    else
      varname = [sexpr(varname)];
    return [[], varname];
  });

  def("pllist", plname => {
    if (Type(plname) === 'list') {
      plname = lexpr(plname);
    } else {
      plname = [sexpr(plname)];
    }
    return [[], [], plname];
  });


  def("arity", name => {
    name = sexpr(name);
    const proc = this.routines.get(name);
    if (!proc)
      throw err("{_PROC_}: Don't know how to {name:U}", { name: name }, ERRORS.BAD_PROC);
    if (proc.special)
      return [-1, -1, -1];

    return [
      proc.minimum,
      proc.default,
      proc.maximum
    ];
  });

  // Not Supported: nodes

  // 7.6 Workspace Inspection

  //
  // 7.7 Workspace Control
  //

  function contentslist(list) {
    if (list !== undefined && Type(list) === 'word')
      return [[list], [], []];
    if (list !== undefined && Type(list) === 'list' && list.length && Type(list[0]) === 'word')
      return [lexpr(list), [], []];
    list = lexpr(list);
    while (list && list.length < 3)
      list.push([]);
    return [lexpr(list[0]), lexpr(list[1]), lexpr(list[2])];
  }

  def("erase", list => {
    const [procs, vars, plists] = contentslist(list);

    // Delete procedures
    procs.forEach(name => {
      name = sexpr(name);
      if (this.routines.has(name)) {
        if (this.routines.get(name).special)
          throw err("Can't {_PROC_} special {name:U}", { name: name }, ERRORS.BAD_INPUT);
        if (!this.routines.get(name).primitive || bexpr(maybegetvar("redefp") || "false")) {
          this.routines.delete(name);
          saveproc(name);
        } else {
          throw err("Can't {_PROC_} primitives unless REDEFP is TRUE", ERRORS.BAD_INPUT);
        }
      }
    });

    // Delete variables
    // TODO: global only?
    this.scopes.forEach(scope => {
      vars.forEach(name => {
        name = sexpr(name);
        scope.delete(name);
      });
    });

    // Delete property lists
    plists.forEach(name => {
      name = sexpr(name);
      this.plists.delete(name);
    });
  });

  // TODO: lots of redundant logic here -- clean this up
  def("erall", () => {
    this.routines.keys()
      .filter(x => !this.routines.get(x).primitive && !this.routines.get(x).buried)
      .forEach(name => {
        this.routines.delete(name);
        saveproc(name);
      });

    this.scopes.forEach(scope => {
      scope.keys()
        .filter(x => !scope.get(x).buried)
        .forEach(name => {
          scope.delete(name);
        });
    });

    this.plists.keys()
      .filter(x => !this.plists.get(x).buried)
      .forEach(name => {
        this.plists.delete(name);
      });
  });

  def("erps", () => {
    this.routines.keys()
      .filter(x => !this.routines.get(x).primitive && !this.routines.get(x).buried)
      .forEach(name => {
        this.routines.delete(name);
        saveproc(name);
      });
  });

  def("erns", () => {
    this.scopes.forEach(scope => {
      scope.keys()
        .filter(x => !scope.get(x).buried)
        .forEach(name => {
          scope.delete(name);
        });
    });
  });

  def("erpls", () => {
    this.plists.keys()
      .filter(x => !this.plists.get(x).buried)
      .forEach(key => {
        this.plists.delete(key);
      });
  });

  def("ern", varname => {
    let varnamelist;
    if (Type(varname) === 'list')
      varnamelist = lexpr(varname);
    else
      varnamelist = [sexpr(varname)];

    this.scopes.forEach(scope => {
      varnamelist.forEach(name => {
        name = sexpr(name);
        scope.delete(name);
      });
    });
  });

  def("erpl", plname => {
    let plnamelist;
    if (Type(plname) === 'list') {
      plnamelist = lexpr(plname);
    } else {
      plnamelist = [sexpr(plname)];
    }

    plnamelist.forEach(name => {
      name = sexpr(name);
      this.plists.delete(name);
    });
  });

  def("bury", list => {
    const [procs, vars, plists] = contentslist(list);

    // Bury procedures
    procs.forEach(name => {
      name = sexpr(name);
      if (this.routines.has(name))
        this.routines.get(name).buried = true;
    });

    // Bury variables
    // TODO: global only?
    this.scopes.forEach(scope => {
      vars.forEach(name => {
        name = sexpr(name);
        if (scope.has(name))
          scope.get(name).buried = true;
      });
    });

    // Bury property lists
    plists.forEach(name => {
      name = sexpr(name);
      if (this.plists.has(name))
        this.plists.get(name).buried = true;
    });
  });

  def("buryall", () => {
    this.routines.forEach((name, proc) => {
      proc.buried = true;
    });

    this.scopes.forEach(scope => {
      scope.forEach((name, entry) => {
        entry.buried = true;
      });
    });

    this.plists.forEach((name, entry) => {
      entry.buried = true;
    });
  });

  def("buryname", varname => {
    const bury = this.routines.get('bury');
    const namelist = this.routines.get('namelist');
    return bury.call(this, namelist.call(this, varname));
  });

  def("unbury", list => {
    const [procs, vars, plists] = contentslist(list);

    // Procedures
    procs.forEach(name => {
      name = sexpr(name);
      if (this.routines.has(name))
        this.routines.get(name).buried = false;
    });

    // Variables
    // TODO: global only?
    this.scopes.forEach(scope => {
      vars.forEach(name => {
        name = sexpr(name);
        if (scope.has(name))
          scope.get(name).buried = false;
      });
    });

    // Property lists
    plists.forEach(name => {
      name = sexpr(name);
      if (this.plists.has(name))
        this.plists.get(name).buried = false;
    });
  });

  def("unburyall", () => {
    this.routines.forEach((name, proc) => {
      proc.buried = false;
    });

    this.scopes.forEach(scope => {
      scope.forEach((name, entry) => {
        entry.buried = false;
      });
    });

    this.plists.forEach((name, entry) => {
      entry.buried = false;
    });
  });

  def("unburyname", (varname) => {
    const unbury = this.routines.get('unbury');
    const namelist = this.routines.get('namelist');
    return unbury.call(this, namelist.call(this, varname));
  });

  def(["buriedp", "buried?"], list => {
    const [procs, vars, plists] = contentslist(list);

    // Procedures
    if (procs.length) {
      const name = sexpr(procs[0]);
      return (this.routines.has(name) && this.routines.get(name).buried) ? 'true' : 'false';
    }

    // Variables
    if (vars.length) {
      const name = sexpr(vars[0]);
      // TODO: global only?
      return (this.scopes[0].has(name) && this.scopes[0].get(name).buried) ? 'true' : 'false';
    }

    // Property lists
    if (plists.length) {
      const name = sexpr(plists[0]);
      return (this.plists.has(name) && this.plists.get(name).buried) ? 'true' : 'false';
    }

    return 'false';
  });

  //----------------------------------------------------------------------
  //
  // 8. Control Structures
  //
  //----------------------------------------------------------------------

  //
  // 8.1 Control
  //

  function run(statements) {
    return self.execute(reparse(statements), {returnResult: true});
  }

  function runNoResult(statements) {
    return self.execute(reparse(statements));
  }

  def("run", statements => {
    return run(statements);
  });

  def("runresult", async statements => {
    const result = await run(statements);
    if (result !== undefined)
      return [result];
    else
      return [];
  });

  def("repeat", async (count, statements) => {
    count = aexpr(count);
    const old_repcount = this.repcount;
    let i = 1;
    try {
      while (i <= count) {
        this.repcount = i++;
        await runNoResult(statements);
        await yieldIfNeeded();
      }
    } finally {
      this.repcount = old_repcount;
    }
  });

  def("forever", async statements => {
    const old_repcount = this.repcount;
    let i = 1;
    try {
      for (;;) {
        this.repcount = i++;
        await runNoResult(statements);
        await yieldIfNeeded();
      }
    } finally {
      this.repcount = old_repcount;
    }
  });

  const TEMPLATE_ITERCOUNT_NAME = 'template.itercount';
  const TEMPLATE_LISTS_NAME = 'template.lists';

  def(["repcount"], () => this.repcount);
  def(["#"], () => maybegetvar(TEMPLATE_ITERCOUNT_NAME) ?? this.repcount);

  def("if", async (tf, statements, statements2=undefined) => {
    if (Type(tf) === 'list')
      tf = evaluateExpression(reparse(tf));

    tf = bexpr(await tf);
    if (!statements2) {
      return tf ? run(statements) : undefined;
    } else {
      return run(tf ? statements : statements2);
    }
  }, {maximum: 3});

  def("ifelse", async (tf, statements1, statements2) => {
    if (Type(tf) === 'list')
      tf = evaluateExpression(reparse(tf));

    tf = bexpr(await tf);

    return run(tf ? statements1 : statements2);
  });

  def("test", async tf => {
    if (Type(tf) === 'list')
      tf = evaluateExpression(reparse(tf));

    tf = bexpr(await tf);
    // NOTE: A property on the scope, not within the scope
    this.scopes.at(-1)._test = tf;
  });

  def(["iftrue", "ift"], statements => {
    const tf = this.scopes.at(-1)._test;
    if (tf === undefined)
      throw err('{_PROC_}: Called without TEST', ERRORS.NO_TEST);
    return tf ? run(statements) : undefined;
  });

  def(["iffalse", "iff"], statements => {
    const tf = this.scopes.at(-1)._test;
    if (tf === undefined)
      throw err('{_PROC_}: Called without TEST', ERRORS.NO_TEST);
    return !tf ? run(statements) : undefined;
  });

  def("stop", () => {
    throw new Output();
  });

  def(["output", "op"], atom => {
    throw new Output(atom);
  });

  this.last_error = undefined;

  def("catch", async (tag, instructionlist) => {
    tag = sexpr(tag).toUpperCase();
    try {
      return await run(instructionlist);
    } catch(error) {
      if (error.code === 'RESOURCE_LIMIT') throw error;
      if (!(error instanceof LogoError) || error.tag !== tag)
        throw error;
      this.last_error = error;
      return error.value;
    }
  }, {maximum: 2});

  def("throw", (tag, value=undefined) => {
    tag = sexpr(tag).toUpperCase();
    const error = new LogoError(tag, value);
    error.code = (value !== undefined) ? ERRORS.USER_GENERATED : ERRORS.THROW_ERROR;
    throw error;
  }, {maximum: 2});

  def("error", () => {
    if (!this.last_error)
      return [];

    const list = [
      this.last_error.code,
      this.last_error.message,
      this.last_error.proc,
      this.last_error.line
    ];
    this.last_error = undefined;
    return list;
  });

  // Not Supported: pause
  // Not Supported: continue

  def("wait", time => {
    return yieldForMS(Math.ceil(aexpr(time) / 60 * 1000));
  });

  def("bye", () => {
    throw new Bye;
  });

  def(".maybeoutput", value => {
    throw new Output(value);
  });

  // Not Supported: goto
  // Not Supported: tag

  def("ignore", value => {
  });

  def("`", async list => {
    list = lexpr(list);
    let out = [];
    while (list.length) {
      let member = list.shift();

      // TODO: Nested backquotes: "Substitution is done only for
      // commas at the same depth as the backquote in which they are
      // found."
      if (member === ',' && list.length) {
        out.push(await run(list.shift()));
      } else if (member === ',@' && list.length) {
        const result = await run(list.shift());
        resources?.allocate(out.length + (Array.isArray(result) ? result.length : 1));
        out = out.concat(result);
      } else if (Type(member) === 'word' && /^,@.+/.test(member)) {
        const result = await run(member.substring(2));
        resources?.allocate(out.length + (Array.isArray(result) ? result.length : 1));
        out = out.concat(result);
      } else if (Type(member) === 'word' && /^,.+/.test(member)) {
        out.push(await run(member.substring(1)));
      } else if (Type(member) === 'word' && /^",/.test(member)) {
        const result = await run(member.substring(2));
        out.push('"' + (Type(result) === 'list' ? result[0] : result));
      } else if (Type(member) === 'word' && /^:,/.test(member)) {
        const result = await run(member.substring(2));
        out.push(':' + (Type(result) === 'list' ? result[0] : result));
      } else {
        out.push(member);
      }
    }
    return out;
  });

  def("for", async (control, statements) => {
    control = lexpr(control);

    function sign(x) { return x < 0 ? -1 : x > 0 ? 1 : 0; }

    const varname = sexpr(control[0]);

    let start = await evaluateExpression(reparse(control[1]));
    let current = start;

    let limit = await evaluateExpression(reparse(control[2]));

    let step = control.length === 4 ? await evaluateExpression(reparse(control[3]))
        : (limit < start ? -1 : 1);

    while (sign(current - limit) !== sign(step)) {
      setlocal(varname, current);
      await runNoResult(statements);
      current += step;
      await yieldIfNeeded();
    }
  });

  def("dotimes", async (control, statements) => {
    control = reparse(lexpr(control));

    const varname = sexpr(control.shift());
    const times = aexpr(await evaluateExpression(control));
    for (let current = 1; current <= times; ++current) {
      setlocal(varname, current);
      await runNoResult(statements);
      await yieldIfNeeded();
    }
  });

  function checkevalblock(block) {
    block = block();
    if (Type(block) === 'list') { return block; }
    throw err("{_PROC_}: Expected block", ERRORS.BAD_INPUT);
  }

  def("do.while", async (block, tfexpression) => {
    block = checkevalblock(block);
    for (;;) {
      await runNoResult(block);
      let tf = await tfexpression();
      if (Type(tf) === 'list')
        tf = await evaluateExpression(reparse(tf));
      if (!bexpr(tf))
        break;
      await yieldIfNeeded();
    }
  }, {noeval: true});

  def("while", async (tfexpression, block) => {
    block = checkevalblock(block);
    for (;;) {
      let tf = await tfexpression();
      if (Type(tf) === 'list')
        tf = await evaluateExpression(reparse(tf));
      if (!bexpr(tf))
        break;
      await runNoResult(block);
      await yieldIfNeeded();
    }
  }, {noeval: true});

  def("do.until", async (block, tfexpression) => {
    block = checkevalblock(block);
    for (;;) {
      await runNoResult(block);
      let tf = await tfexpression();
      if (Type(tf) === 'list')
        tf = await evaluateExpression(reparse(tf));
      if (bexpr(tf))
        break;
      await yieldIfNeeded();
    }
  }, {noeval: true});

  def("until", async (tfexpression, block) => {
    block = checkevalblock(block);
    for (;;) {
      let tf = await tfexpression();
      if (Type(tf) === 'list')
        tf = await evaluateExpression(reparse(tf));
      if (bexpr(tf))
        break;
      await runNoResult(block);
      await yieldIfNeeded();
    }
  }, {noeval: true});

  def("case", (value, clauses) => {
    clauses = lexpr(clauses);

    for (let i = 0; i < clauses.length; ++i) {
      const clause = lexpr(clauses[i]);
      const first = clause.shift();
      if (isKeyword(first, 'ELSE'))
        return evaluateExpression(reparse(clause));
      if (lexpr(first).some(x => equal(x, value)))
        return evaluateExpression(reparse(clause));
    }
    return undefined;
  });

  def("cond", async clauses => {
    clauses = lexpr(clauses);
    while (clauses.length) {
      const clause = lexpr(clauses.shift());
      const first = clause.shift();
      if (isKeyword(first, 'ELSE'))
        return await evaluateExpression(reparse(clause));
      const result = await evaluateExpression(reparse(lexpr(first)));
      if (bexpr(result))
        return await evaluateExpression(reparse(clause));
    }
    return undefined;
  });

  //
  // 8.2 Template-based Iteration
  //

  function processTemplate(template, options = {}) {
    if (Type(template) === 'list') {
      if (template.length >= 2 && Type(template[0]) === 'list' && Type(template[1]) === 'list') {
        // 'procedure text' form
        return defineProc(undefined, ...parseDefineList(template));
      } else if (template.length > 1 && Type(template[0]) === 'list') {
        // 'named-slot' a.k.a. 'lambda' form
        const vars = template.shift();
        return async function(...args) {
          vars.forEach((name, index) => { setlocal(name, args[index]); });
          return await (options.returnResult ? run(template) : runNoResult(template));
        };
      } else {
        // 'explicit-slot' form
        return async function(...args) {
          const previousSlots = self.slots;
          self.slots = (name) => args[name === '' ? 0 : name - 1];
          try {
            return await (options.returnResult ? run(template) : runNoResult(template));
          } finally {
            self.slots = previousSlots;
          }
        };
      }
    } else {
      // 'named-procedure' form
      const procname = sexpr(template);
      const routine = self.routines.get(procname);
      if (!routine)
        throw err("{_PROC_}: Don't know how to {name:U}", { name: procname }, ERRORS.BAD_PROC);
      if (routine.special || routine.noeval || routine.unsupported)
        throw err("Can't apply {_PROC_} to special {name:U}", { name: procname }, ERRORS.BAD_INPUT);
      return routine;
    }
  }


  //
  // Higher order functions
  //

  def("apply", (template, list) => {
    const routine = processTemplate(template, {returnResult: true});
    return routine.apply(this, lexpr(list));
  });

  def("invoke", (template, ...args) => {
    const routine = processTemplate(template, {returnResult: true});
    return routine.apply(this, args);
  }, {minimum: 1, default: 2, maximum: -1});


  def("foreach", async (list, template) => {
    const routine = processTemplate(template);
    list = lexpr(list);

    self.scopes.push(new StringMap(true));
    try {
      setlocal(TEMPLATE_LISTS_NAME, list);
      let count = 0;
      while (list.length) {
        setlocal(TEMPLATE_ITERCOUNT_NAME, ++count);
        await routine.call(this, list.shift());
        await yieldIfNeeded();
      }
    } finally {
      self.scopes.pop();
    }
  });

  def("?rest", () => {
    return getvar(TEMPLATE_LISTS_NAME).slice(getvar(TEMPLATE_ITERCOUNT_NAME));
  });

  def("map", async (template, ...lists) => {
    const result = [];
    await map(template, lists, thing => {
      resources?.checkSize(result.length + 1);
      resources?.allocate(1);
      result.push(thing);
    });
    return result;
  }, {minimum: 2, default: 2, maximum: -1});

  def("map.se", async (template, ...lists) => {
    let result = [];
    await map(template, lists, thing => {
      if (Type(thing) === 'list') {
        resources?.allocate(result.length + thing.length);
        result = result.concat(thing);
      } else {
        resources?.checkSize(result.length + 1);
        resources?.allocate(1);
        result.push(thing);
      }
    });
    return result;
  }, {minimum: 2, default: 2, maximum: -1});

  async function map(template, lists, handle) {
    const routine = processTemplate(template, {returnResult: true});
    lists = lists.map(lexpr);
    if (!lists.length)
      throw err("{_PROC_}: Expected list", ERRORS.BAD_INPUT);

    self.scopes.push(new StringMap(true));
    try {
      setlocal(TEMPLATE_LISTS_NAME, lists[0]);
      let count = 0;
      const mapped = [];
      while (lists[0].length) {
        const args = lists.map(l => {
          if (!l.length)
            throw err("{_PROC_}: Expected lists of equal length", ERRORS.BAD_INPUT);
          return l.shift();
        });
        setlocal(TEMPLATE_ITERCOUNT_NAME, ++count);
        handle(await routine.apply(this, args));
        await yieldIfNeeded();
      }
      return mapped;
    } finally {
      self.scopes.pop();
    }
  }

  def("filter", async (template, list) => {
    const routine = processTemplate(template, {returnResult: true});
    list = lexpr(list);

    self.scopes.push(new StringMap(true));
    try {
      setlocal(TEMPLATE_LISTS_NAME, list);
      let count = 0;
      const filtered = [];
      while (list.length) {
        const item = list.shift();
        setlocal(TEMPLATE_ITERCOUNT_NAME, ++count);
        const value = await routine.call(this, item);
        if (bexpr(value))
          filtered.push(item);
        await yieldIfNeeded();
      }
      return filtered;
    } finally {
      self.scopes.pop();
    }
  });

  def("find", async (template, list) => {
    const routine = processTemplate(template, {returnResult: true});
    list = lexpr(list);

    self.scopes.push(new StringMap(true));
    try {
      setlocal(TEMPLATE_LISTS_NAME, list);
      let count = 0;
      while (list.length) {
        const item = list.shift();
        setlocal(TEMPLATE_ITERCOUNT_NAME, ++count);
        const value = await routine.call(this, item);
        if (bexpr(value))
          return item;
        await yieldIfNeeded();
      }
      return [];
    } finally {
      self.scopes.pop();
    }
  });

  def("reduce", async (template, list, initial=undefined) => {
    const routine = processTemplate(template, {returnResult: true});
    list = lexpr(list);
    let value = initial !== undefined ? initial : list.pop();

    while (list.length) {
      value = await routine.call(this, list.pop(), value);
      await yieldIfNeeded();
    }
    return value;
  }, {maximum: 3});


  def("crossmap", async (template, ...lists) => {
    const routine = processTemplate(template, {returnResult: true});

    lists = lists.map(lexpr);
    if (!lists.length)
      throw err("{_PROC_}: Expected list", ERRORS.BAD_INPUT);

    // Special case: if only one element is present, use as list of lists.
    if (lists.length === 1)
      lists = lists[0].map(lexpr);

    let combinations = 1;
    for (const list of lists) combinations *= list.length;
    resources?.allocate(combinations);
    const indexes = lists.map(() => 0);
    let done = false;

    const mapped = [];
    while (!done) {
      const args = indexes.map((v, i) => lists[i][v]);
      let pos = indexes.length - 1;
      ++indexes[pos];
      while (indexes[pos] === lists[pos].length) {
        if (pos === 0) {
          done = true;
          break;
        }
        indexes[pos] = 0;
        pos--;
        ++indexes[pos];
      }
      const value = await routine.apply(this, args);
      mapped.push(value);
      await yieldIfNeeded();
    }
    return mapped;
  }, {minimum: 2, default: 2, maximum: -1});

  // Local Berkeley compatibility additions.
  async function cascade(endtest, ...pairs) {
    const final = pairs.length % 2 ? processTemplate(pairs.pop(), {returnResult: true}) : null;
    if (!pairs.length || pairs.length % 2) throw err('CASCADE needs template/value pairs');
    const templates = [], values = [];
    for (let i = 0; i < pairs.length; i += 2) {
      templates.push(processTemplate(pairs[i], {returnResult: true}));
      values.push(pairs[i + 1]);
    }
    const count = isNumber(endtest) ? aexpr(endtest) : null;
    if (count !== null && (count < 0 || count % 1)) throw err('CASCADE needs a nonnegative integer');
    const end = count === null ? processTemplate(endtest, {returnResult: true}) : null;
    self.scopes.push(new StringMap(true));
    try {
      for (let i = 0; ; ++i) {
        setlocal(TEMPLATE_ITERCOUNT_NAME, i + 1);
        if (count !== null ? i >= count : bexpr(await end(...values))) break;
        const previous = values.slice();
        for (let t = 0; t < templates.length; ++t) values[t] = await templates[t](...previous);
        await yieldIfNeeded();
      }
      return final ? await final(...values) : values[0];
    } finally { self.scopes.pop(); }
  }
  def('cascade', cascade, {minimum: 3, default: 3, maximum: -1});
  def('cascade.2', (...args) => cascade(...args), {minimum: 5, default: 5, maximum: 5});
  def('transfer', async (endtest, template, inbasket) => {
    const items = lexpr(inbasket), end = Array.isArray(endtest) && !endtest.length ? null : reparse(endtest);
    const code = reparse(template);
    const oldSlots = self.slots;
    let out = [], input;
    self.slots = name => name.toLowerCase() === 'in' ? input : name.toLowerCase() === 'out' ? out : undefined;
    try {
      while (items.length) {
        input = items.shift();
        // ?IN and ?OUT are recognized as slots by the local reader extension.
        if (end && bexpr(await self.execute(end, {returnResult: true}))) break;
        out = await self.execute(code, {returnResult: true});
        await yieldIfNeeded();
      }
      return out;
    } finally { self.slots = oldSlots; }
  });
  def('tag', word => { sexpr(word); });
  def('goto', word => { throw new GoTo(sexpr(word)); });
  def('.macro', tokens => {
    const name = sexpr(tokens[0]);
    self.routines.get('to').call(self, tokens);
    self.routines.get(name).macro = true;
  }, {special: true});
  def('.defmacro', (name, text) => {
    self.routines.get('define').call(self, name, text);
    self.routines.get(sexpr(name)).macro = true;
  });
  def(['macrop', 'macro?'], name => self.routines.get(sexpr(name))?.macro ? 'true' : 'false');
  def('macroexpand', async instructions => {
    instructions = lexpr(instructions);
    const proc = self.routines.get(sexpr(instructions.shift()));
    if (!proc?.macro) throw err('MACROEXPAND needs a macro call');
    const args = [];
    while (instructions.length) args.push(await evaluateExpression(instructions));
    return proc(...args);
  });
  def('rawascii', chr => unprotect(sexpr(chr)).charCodeAt(0));
  def('readrawline', () => stream.read());
  let charBuffer = '';
  async function readChar() {
    if (!charBuffer) charBuffer = await stream.read();
    const char = charBuffer.charAt(0); charBuffer = charBuffer.slice(1);
    return char || [];
  }
  def(['readchar', 'rc'], readChar);
  def(['readchars', 'rcs'], async num => {
    num = aexpr(num);
    if (num < 0 || num % 1) throw err('READCHARS needs a nonnegative integer');
    let result = '';
    while (result.length < num) {
      const char = await readChar();
      if (Array.isArray(char)) break;
      result += char;
    }
    return result || [];
  });
  def('fulltext', name => {
    const proc = self.routines.get(sexpr(name));
    if (!proc || proc.primitive) throw err('FULLTEXT needs a user procedure');
    return proc.fulltext ? proc.fulltext.slice() : self.definition(name, proc).split('\n').map(line => parse(line));
  });
  def('pen', () => [turtle.pendown ? 'pendown' : 'penup', 'pen' + turtle.penmode, turtle.penwidth, turtle.color]);
  def('setpen', state => {
    state = lexpr(state);
    if (state.length < 4) throw err('SETPEN needs a PEN state list');
    turtle.pendown = String(state[0]).toLowerCase() === 'pendown';
    turtle.penmode = String(state[1]).toLowerCase().replace(/^pen/, '');
    turtle.penwidth = aexpr(state[2]); turtle.color = parseColor(state[3]);
  });
  def('setshape', value => {
    value = sexpr(value).toLowerCase();
    if (!['0', '1', 'triangle', 'turtle'].includes(value)) throw err('SETSHAPE needs TRIANGLE or TURTLE');
    turtle.shape = value === '0' || value === 'triangle' ? 'triangle' : 'turtle';
  });
  def('shape', () => (turtle.shape || 'triangle').toUpperCase());
  function selectedEntries(contents) {
    contents = lexpr(contents);
    if (!Array.isArray(contents[0])) contents = [contents];
    return [
      ...(contents[0] || []).map(name => self.routines.get(sexpr(name))),
      ...(contents[1] || []).map(name => lvalue(sexpr(name))),
      ...(contents[2] || []).map(name => self.plists.get(sexpr(name)))
    ].filter(Boolean);
  }
  def('trace', contents => { selectedEntries(contents).forEach(entry => { entry.traced = true; }); });
  def('untrace', contents => { selectedEntries(contents).forEach(entry => { entry.traced = false; }); });
  def(['tracedp', 'traced?'], contents => selectedEntries(contents)[0]?.traced ? 'true' : 'false');
  def('step', contents => { selectedEntries(contents).forEach(entry => { entry.stepped = true; }); });
  def('unstep', contents => { selectedEntries(contents).forEach(entry => { entry.stepped = false; }); });
  def(['steppedp', 'stepped?'], contents => selectedEntries(contents)[0]?.stepped ? 'true' : 'false');
  class Continue { constructor(value) { this.value = value; } }
  def(['continue', 'co'], (value = undefined) => { throw new Continue(value); }, {minimum: 0, default: 1, maximum: 1});
  def('pause', async () => {
    for (;;) {
      const source = await stream.read('Paused. Enter Logo instructions, or CO to continue.');
      try { await self.execute(parse(source)); }
      catch (value) { if (value instanceof Continue) return value.value; throw value; }
    }
  });
  def(['printout', 'po'], contents => {
    contents = lexpr(contents);
    if (!Array.isArray(contents[0])) contents = [contents];
    for (const name of contents[0] || []) {
      const proc = self.routines.get(sexpr(name));
      if (proc && !proc.primitive) stream.write(self.definition(name, proc), '\n');
    }
    for (const name of contents[1] || []) stream.write('make "', name, ' ', stringify(getvar(sexpr(name))), '\n');
    for (const name of contents[2] || []) {
      const list = self.routines.get('plist')(name);
      for (let i = 0; i < list.length; i += 2) stream.write('pprop "', name, ' "', list[i], ' ', stringify(list[i + 1]), '\n');
    }
  });
  def('poall', () => self.routines.get('po')(self.routines.get('contents')()));
  def('pops', () => self.routines.get('po')(self.routines.get('procedures')()));
  def('pons', () => self.routines.get('po')(self.routines.get('names')()));
  def('popls', () => self.routines.get('po')(self.routines.get('plists')()));
  def('pon', name => self.routines.get('po')([[], lexpr(name)]));
  def('popl', name => self.routines.get('po')([[], [], lexpr(name)]));
  def('pot', names => {
    for (const name of lexpr(names)) {
      const proc = self.routines.get(sexpr(name));
      if (proc && !proc.primitive) stream.write('to ', name, ' ', proc.inputs.map(x => ':' + x).join(' '), '\n');
    }
  });
  def('pots', () => self.routines.get('pot')(self.routines.get('procedures')()));
  for (const [alias, original] of Object.entries({rl:'readlist', rw:'readword', er:'erase', settc:'settextcolor', settextfont:'setfont'})) {
    if (self.routines.has(original)) self.routines.set(alias, self.routines.get(original));
  }
  setvar('caseignoredp', 'true');
  setvar('allowgetset', 'true');
  setvar('unburyonedit', 'true');
  setvar('logoversion', 0.1);
  setvar('logoplatform', 'browser');
  for (const name of ['caseignoredp', 'allowgetset', 'unburyonedit', 'logoversion', 'logoplatform']) self.scopes[0].get(name).buried = true;

  // Helper for testing that wraps a result in a Promise
  def(".promise", async value => value);

  def(".verify_bound_ignore", value => {
    if (this === undefined)
      throw new Error("Internal error: Unbound procedure");
  });
  def(".verify_bound_identity", value => {
    if (this === undefined)
      throw new Error("Internal error: Unbound procedure");
    return value;
  });
}

// Local module bridge; upstream remains vendored with its license header.
globalThis.LogoInterpreter = LogoInterpreter;

