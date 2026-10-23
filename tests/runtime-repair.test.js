const logoReply = source => '```logo\n' + source.trim() + '\n```';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { repairCode, RuntimeRepairBudget } from '../src/harness.js';
import { validateLogo } from '../src/logo/runtime.js';

function setup(source = 'make "distance "oops fd :distance') {
  const editor = { source, revision: 0 };
  const budget = new RuntimeRepairBudget();
  const commits = [];
  const options = {
    diagnostic: { message: 'Expected number', procedure: 'FD', phase: 'execution', line: 1 },
    prompt: 'Only Logo.', readEditor: () => ({ ...editor }),
    validate: validateLogo, onAttempt: () => budget.use(),
    commit: source => { commits.push(source); editor.source = source; editor.revision++; }
  };
  return { editor, budget, commits, options };
}

test('the goulash FILLED error is rejected before it reaches the editor', async () => {
  const source = await readFile(new URL('./fixtures/goulash-invalid.logo', import.meta.url), 'utf8');
  assert.throws(() => validateLogo(source), /FILLED.*color.*instructions/);
  const corrected = await readFile(new URL('../examples/goulash.logo', import.meta.url), 'utf8');
  validateLogo(corrected);
});

test('runtime diagnostic and failed source are sent for repair, then only validated code is committed', async () => {
  const state = setup();
  const snapshot = { ...state.editor };
  const result = await repairCode({
    ...state.options, failedSnapshot: snapshot,
    generate: async messages => {
      assert.match(messages.at(-1).content, /Expected number/);
      assert.match(messages.at(-1).content, /"procedure":"FD"/);
      assert.match(messages.at(-1).content, /distance/);
      return logoReply('fd 20');
    }
  });
  assert.equal(result.source, 'fd 20');
  assert.deepEqual(state.commits, ['fd 20']);
  assert.equal(state.budget.used, 1);
});

test('returning the unchanged failed program triggers repair and exhausts after three calls', async () => {
  const state = setup(); let calls = 0;
  await assert.rejects(repairCode({
    ...state.options, failedSnapshot: { ...state.editor },
    generate: async () => { calls++; return logoReply(state.editor.source); }
  }), error => error.code === 'validation');
  assert.equal(calls, 3); assert.equal(state.budget.remaining, 0);
  assert.equal(state.commits.length, 0);
});

test('invalid repair responses receive diagnostics and a valid correction is applied', async () => {
  const state = setup(); let calls = 0;
  await repairCode({
    ...state.options, failedSnapshot: { ...state.editor },
    generate: async messages => {
      if (++calls === 1) return logoReply('filled [fd 10]');
      assert.match(messages.at(-1).content, /FILLED/);
      return logoReply('filled [10 20 30] [repeat 4 [fd 10 rt 90]]');
    }
  });
  assert.equal(calls, 2); assert.equal(state.commits.length, 1);
});

test('runtime repairs share a three-call budget across repeated manual Runs', async () => {
  const state = setup(); let calls = 0;
  for (let run = 0; run < 3; ++run) {
    await repairCode({
      ...state.options, failedSnapshot: { ...state.editor }, maxAttempts: state.budget.remaining,
      generate: async () => logoReply(`fd ${++calls}`)
    });
  }
  assert.equal(calls, 3); assert.equal(state.budget.remaining, 0);
  assert.throws(() => state.budget.use(), error => error.code === 'repair_limit');
  state.budget.reset(); assert.equal(state.budget.remaining, 3);
});

test('edits made since the failed Run prevent an automatic request', async () => {
  const state = setup(); const failedSnapshot = { ...state.editor };
  state.editor.source = 'fd 99'; state.editor.revision++;
  await assert.rejects(repairCode({
    ...state.options, failedSnapshot, generate: async () => assert.fail('Stale source must not be submitted')
  }), error => error.code === 'conflict');
  assert.equal(state.editor.source, 'fd 99'); assert.equal(state.budget.used, 0);
});

test('an edit during runtime repair is preserved', async () => {
  const state = setup(); const failedSnapshot = { ...state.editor };
  await assert.rejects(repairCode({
    ...state.options, failedSnapshot,
    generate: async () => { state.editor.source = 'fd 77'; state.editor.revision++; return logoReply('fd 10'); }
  }), error => error.code === 'conflict');
  assert.equal(state.editor.source, 'fd 77'); assert.equal(state.commits.length, 0);
});

test('repair does not execute the returned program', async () => {
  const state = setup();
  await repairCode({ ...state.options, generate: async () => logoReply('forever [fd 1]') });
  assert.equal(state.editor.source, 'forever [fd 1]');
});

test('runtime repair requires corrected code even when the response is valid conversation', async () => {
  const state = setup(); let calls = 0;
  await assert.rejects(repairCode({...state.options, generate:async () => {calls++;return 'FD needs a number in Logo.';}}), error=>error.code==='validation');
  assert.equal(calls, 3); assert.equal(state.commits.length, 0);
});
