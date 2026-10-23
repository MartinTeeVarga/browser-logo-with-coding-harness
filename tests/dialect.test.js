import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createInterpreter, primitiveNames, validateLogo } from '../src/logo/runtime.js';
import { DIALECT_CALLS } from '../src/logo/dialect.js';
import { basePrompt, replaceCode } from '../src/harness.js';

test('the reported house program is rejected with an actionable SETPOS diagnostic', async () => {
  const source = await readFile(new URL('./fixtures/house-invalid.logo', import.meta.url), 'utf8');
  assert.throws(() => validateLogo(source), /SETPOS.*\[x y\].*SETXY/);
});

test('literal argument shapes are checked in nested procedures and instruction lists', () => {
  for (const source of [
    'to house setpos -380 -240 end house',
    'repeat 2 [setpos 10 20]',
    'to house setpos [10 20 30] end house',
    'to house setpos [:x :y] end house',
    'to house setxy [10 20] [30 40] end house',
    'to house fd [10 20] end house',
    'to house arc [100 14] end house'
  ]) assert.throws(() => validateLogo(source), undefined, source);
});

test('unused literal inputs do not pass as statements inside procedures', () => {
  for (const source of ['to f fd 10 20 end f', 'to f fd 10 -20 end f', 'repeat 2 [fd 10 20]']) {
    assert.throws(() => validateLogo(source), /standalone value/);
  }
});

test('valid literal and computed points remain accepted', () => {
  for (const source of [
    'setpos [-380 -240]', 'setxy -380 -240',
    'make "x 10 make "y 20 setpos (list :x :y)',
    'make "x 10 make "y 20 setxy (:x + 10) (:y + 20)',
    'show map [10] [a b]', 'show ifelse true [10] [20]',
    'to f [:x 10] output :x end show f'
  ]) assert.doesNotThrow(() => validateLogo(source), source);
});

test('each prompt signature example compiles with the actual interpreter', () => {
  for (const call of DIALECT_CALLS) assert.doesNotThrow(() => validateLogo(call.example), call.syntax);
  const prompt = basePrompt(primitiveNames());
  assert.match(prompt, /jslogo-based Berkeley Logo/);
  assert.match(prompt, /SETPOS \[x y\]/);
  assert.match(prompt, /SETXY x y/);
  assert.match(prompt, /ARC angle radius/);
  assert.match(prompt, /90 east\/right/);
});

test('bad house output enters the repair loop and is never committed', async () => {
  const invalid = await readFile(new URL('./fixtures/house-invalid.logo', import.meta.url), 'utf8');
  const corrected = await readFile(new URL('../examples/house.logo', import.meta.url), 'utf8');
  let calls = 0;
  const commits = [];
  const result = await replaceCode({
    request: 'Draw a house', prompt: basePrompt(primitiveNames()),
    readEditor: () => ({ source: 'fd 10', revision: 0 }), commit: source => commits.push(source),
    validate: validateLogo,
    generate: async messages => {
      if (++calls === 1) return invalid;
      assert.match(messages.at(-1).content, /SETPOS.*SETXY/);
      assert.equal(commits.length, 0);
      return corrected;
    }
  });
  assert.equal(result.repairs, 1);
  assert.deepEqual(commits, [corrected]);
});

test('runtime also rejects dynamically computed scalar SETPOS input', async () => {
  const logo = createInterpreter();
  await assert.rejects(logo.run('make "point 12 setpos :point'), /SETPOS expects one \[x y\] list/);
});
