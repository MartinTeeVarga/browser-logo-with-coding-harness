import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createInterpreter, validateLogo, NATIVE_FEATURES } from '../src/logo/runtime.js';

function runtime() {
  let output = '';
  const logo = createInterpreter({}, { write: (...values) => { output += values.join(''); }, clear: () => { output = ''; }, read: async () => 'hello world' });
  return { logo, output: () => output };
}
const cases = [
  ['arithmetic and precedence', 'show sum 2 product 3 4', '14\n'],
  ['degree trig', 'show round sin 90', '1\n'],
  ['lists and words', 'show sentence [a b] [c d] print word "hello "world', '[a b c d]\nhelloworld\n'],
  ['Logo boolean values', 'show equalp 2 2 show not false show and true false', 'true\ntrue\nfalse\n'],
  ['case-insensitive words', 'show equalp "Hello "HELLO make "caseignoredp "false show equalp "Hello "HELLO', 'true\nfalse\n'],
  ['special-variable booleans are case-insensitive', 'make "caseignoredp "FALSE show equalp "Hello "HELLO', 'false\n'],
  ['recursive procedures', 'to factorial :n if :n = 0 [output 1] output :n * factorial (:n - 1) end show factorial 6', '720\n'],
  ['dynamic scope', 'to inner output :x end to outer :x output inner end show outer 42', '42\n'],
  ['localmake', 'make "x 1 to f localmake "x 7 print :x end f print :x', '7\n1\n'],
  ['optional inputs', 'to f :x [:y 5] output :x + :y end show f 2 show (f 2 8)', '7\n10\n'],
  ['rest inputs', 'to f :x [:rest] output fput :x :rest end show (f 1 2 3)', '[1 2 3]\n'],
  ['mutable arrays and custom origin', 'make "a (array 3 0) setitem 0 :a "apple show item 0 :a', 'apple\n'],
  ['multidimensional arrays', 'make "a mdarray [2 3] mdsetitem [1 2] :a 8 show mditem [1 2] :a', '8\n'],
  ['property lists', 'pprop "bird "color "green show gprop "bird "color', 'green\n'],
  ['repeat and repcount', 'repeat 3 [print repcount]', '1\n2\n3\n'],
  ['while with Logo booleans', 'make "n 0 while [:n < 3] [make "n :n + 1] show :n', '3\n'],
  ['for', 'for [i 1 3] [print :i]', '1\n2\n3\n'],
  ['catch and throw', 'show catch "tag [(throw "tag 42)]', '42\n'],
  ['map with slots', 'show map [? * 2] [1 2 3]', '[2 4 6]\n'],
  ['map with named inputs', 'show map [[x] :x * :x] [1 2 3]', '[1 4 9]\n'],
  ['filter', 'show filter [? > 2] [1 2 3 4]', '[3 4]\n'],
  ['reduce', 'show reduce "sum [1 2 3 4]', '10\n'],
  ['apply', 'show apply "sum [2 3 4]', '9\n'],
  ['cascade iteration', 'show cascade 5 [# * ?] 1', '120\n'],
  ['parallel cascade', 'show (cascade 10 [?1 + ?2] 1 [?1] 0)', '89\n'],
  ['transfer slots', 'show transfer [equalp count ?out 2] [lput ?in ?out] [a b c]', '[a b]\n'],
  ['goto and tag', 'to countdown :n tag "again make "n :n - 1 if :n > 0 [goto "again] output :n end show countdown 4', '0\n'],
  ['macros', '.macro twice :code output sentence :code :code end twice [print "hi] show macrop "twice', 'hi\nhi\ntrue\n'],
  ['define procedure data', 'define "double [[x] [output :x * 2]] show double 8', '16\n'],
  ['run instruction lists', 'make "instructions [print "hello] run :instructions', 'hello\n'],
  ['readlist input', 'show readlist', '[hello world]\n'],
  ['vertical-bar quoted words', 'print "|hello world| show vbarredp first "|(|', 'hello world\ntrue\n'],
  ['vertical-bar quoting survives RUN', 'run [print "|hello world|]', 'hello world\n'],
  ['quoted variable names', 'make "|two words| 42 show :|two words|', '42\n'],
  ['protected and unprotected characters compare equally', 'show equalp "|hello world| "hello\\ world', 'true\n'],
  ['modulo uses the sign of the divisor', 'show modulo -5 3 show modulo 5 -3', '1\n-1\n'],
  ['real sequences handle equal endpoints', 'show rseq 2 2 3 show rseq 1 3 1', '[2 2 2]\n[1]\n'],
  ['implicit setters and getters', 'setfoo 7 print foo', '7\n'],
  ['implicit getters after MAKE', 'make "foo 8 print foo', '8\n'],
  ['ERRACT can provide a recovery value', 'make "erract [output 7] print quotient 1 0', '7\n'],
  ['REMDUP keeps rightmost equal members', 'show remdup [a b A c b]', '[A c b]\n'],
  ['print limits do not change evaluation', 'make "printwidthlimit 2 show [a b c] show count [a b c]', '[a b ...]\n3\n'],
  ['print depth limit', 'make "printdepthlimit 1 show [a [b c]]', '[a ...]\n'],
  ['full printing of quoted words', 'make "fullprintp "true print "|hello world|', '|hello world|\n'],
];
for (const [name, source, expected] of cases) test(name, async () => {
  validateLogo(source);
  const { logo, output } = runtime();
  await logo.run(source);
  assert.equal(output(), expected);
});

test('validation checks literal nested bodies and procedure calls without executing', () => {
  for (const source of ['repeat 3 [fd]', 'to f :x typo :x end f 1', 'show map [wrong ?] [1]', 'if true [repeat 4 [fd]]', '```logo\nfd 1\n```', '<script>alert(1)</script>', '{"code": "fd 10"}', '']) assert.throws(() => validateLogo(source), undefined, source);
  validateLogo('forever [fd 1]'); // Must not enter the loop during validation.
  validateLogo('to a b end to b a end'); // Forward references and mutual recursion.
});

test('all native features are rejected', () => {
  for (const feature of NATIVE_FEATURES) assert.throws(() => validateLogo(feature), /native feature/);
});

test('the starter program validates', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const starter = source.match(/const STARTER = `([\s\S]*?)`;/)[1];
  validateLogo(starter);
});

test('syntax errors and runtime errors remain separate', async () => {
  validateLogo('print quotient 1 0');
  await assert.rejects(runtime().logo.run('print quotient 1 0'), /Division by zero/);
});

test('FULLTEXT preserves source lines and comments', async () => {
  const logo = createInterpreter();
  await logo.run('to f :x\n  ; a comment\n  output :x\nend');
  assert.deepEqual(await logo.run('fulltext "f', { returnResult: true }), ['to f :x', '  ; a comment', '  output :x', 'end']);
});

test('PAUSE resumes in the same scope with CONTINUE', async () => {
  let output = '';
  const logo = createInterpreter({}, { write: (...parts) => { output += parts.join(''); }, read: async () => 'co :x' });
  await logo.run('to f :x output pause end print f 42');
  assert.equal(output, '42\n');
});

test('STEP requests input and UNSTEP removes the marker', async () => {
  let reads = 0;
  const logo = createInterpreter({}, { write() {}, read: async () => { reads++; return ''; } });
  await logo.run('to f print "a print "b end step "f f unstep "f f');
  assert.equal(reads, 2);
});
