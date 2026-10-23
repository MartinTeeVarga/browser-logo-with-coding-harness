import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceCode } from '../src/harness.js';
import { validateLogo } from '../src/logo/runtime.js';
import { providerError } from '../src/puter.js';

function setup(generate) {
  const editor = { source: 'fd 20', revision: 0 };
  let commits = 0;
  const options = {
    request: 'Draw a square', prompt: 'Only Logo.', readEditor: () => ({ ...editor }),
    commit: source => { editor.source = source; editor.revision++; commits++; },
    generate, validate: validateLogo
  };
  return { editor, options, commits: () => commits };
}
test('valid Logo replaces code once and supplies current source', async () => {
  const state = setup(async messages => {
    assert.match(messages.at(-1).content, /fd 20/);
    return 'repeat 4 [fd 30 rt 90]';
  });
  const result = await replaceCode(state.options);
  assert.equal(result.repairs, 0); assert.equal(state.commits(), 1);
  assert.equal(state.editor.source, 'repeat 4 [fd 30 rt 90]');
});
test('repair receives diagnostics; invalid output never reaches editor', async () => {
  let calls = 0;
  const state = setup(async messages => {
    ++calls;
    if (calls === 1) return '```logo\nfd 10\n```';
    assert.match(messages.at(-1).content, /Markdown/);
    assert.equal(state.commits(), 0);
    return 'fd 10';
  });
  const result = await replaceCode(state.options);
  assert.equal(result.repairs, 1); assert.equal(calls, 2); assert.equal(state.commits(), 1);
});
test('initial attempt plus exactly three repairs, then preserve source', async () => {
  let calls = 0;
  const state = setup(async () => { calls++; return 'console.log("hello")'; });
  await assert.rejects(replaceCode(state.options), error => error.code === 'validation');
  assert.equal(calls, 4); assert.equal(state.commits(), 0); assert.equal(state.editor.source, 'fd 20');
});
test('editing during generation preserves the user’s version', async () => {
  const state = setup(async () => { state.editor.source = 'fd 77'; state.editor.revision++; return 'fd 10'; });
  await assert.rejects(replaceCode(state.options), error => error.code === 'conflict');
  assert.equal(state.editor.source, 'fd 77'); assert.equal(state.commits(), 0);
});
test('editing during validation also prevents commit', async () => {
  const state = setup(async () => 'fd 10');
  state.options.validate = async () => { state.editor.revision++; state.editor.source = 'rt 45'; };
  await assert.rejects(replaceCode(state.options), error => error.code === 'conflict');
  assert.equal(state.commits(), 0); assert.equal(state.editor.source, 'rt 45');
});
test('provider failures are not retried as validation repairs', async () => {
  let calls = 0;
  const state = setup(async () => { calls++; throw new Error('quota exhausted'); });
  await assert.rejects(replaceCode(state.options), /quota/);
  assert.equal(calls, 1); assert.equal(state.commits(), 0);
});
test('empty provider output is repaired', async () => {
  let calls = 0;
  const state = setup(async () => ++calls === 1 ? '' : 'fd 10');
  assert.equal((await replaceCode(state.options)).repairs, 1);
});
test('provider errors explain cancellation, quota, and blocked popups', () => {
  assert.match(providerError({ code: 'popup_blocked' }), /Allow/);
  assert.match(providerError({ code: 'auth_window_closed' }), /cancelled/);
  assert.match(providerError({ code: 'insufficient_funds' }), /allowance/);
});
