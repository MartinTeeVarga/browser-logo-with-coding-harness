const logoReply = source => '```logo\n' + source.trim() + '\n```';
import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceCode, parseLogoReply, basePrompt } from '../src/harness.js';
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
    return logoReply('repeat 4 [fd 30 rt 90]');
  });
  const result = await replaceCode(state.options);
  assert.equal(result.repairs, 0); assert.equal(state.commits(), 1);
  assert.equal(state.editor.source, 'repeat 4 [fd 30 rt 90]');
});
test('repair receives diagnostics; invalid output never reaches editor', async () => {
  let calls = 0;
  const state = setup(async messages => {
    ++calls;
    if (calls === 1) return '```javascript\nfd 10\n```';
    assert.match(messages.at(-1).content, /tagged logo/);
    assert.equal(state.commits(), 0);
    return logoReply('fd 10');
  });
  const result = await replaceCode(state.options);
  assert.equal(result.repairs, 1); assert.equal(calls, 2); assert.equal(state.commits(), 1);
});
test('initial attempt plus exactly three repairs, then preserve source', async () => {
  let calls = 0;
  const state = setup(async () => { calls++; return logoReply('console.log("hello")'); });
  await assert.rejects(replaceCode(state.options), error => error.code === 'validation');
  assert.equal(calls, 4); assert.equal(state.commits(), 0); assert.equal(state.editor.source, 'fd 20');
});
test('editing during generation preserves the user’s version', async () => {
  const state = setup(async () => { state.editor.source = 'fd 77'; state.editor.revision++; return logoReply('fd 10'); });
  await assert.rejects(replaceCode(state.options), error => error.code === 'conflict');
  assert.equal(state.editor.source, 'fd 77'); assert.equal(state.commits(), 0);
});
test('editing during validation also prevents commit', async () => {
  const state = setup(async () => logoReply('fd 10'));
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
  const state = setup(async () => ++calls === 1 ? '' : logoReply('fd 10'));
  assert.equal((await replaceCode(state.options)).repairs, 1);
});
test('provider errors explain cancellation, quota, and blocked popups', () => {
  assert.match(providerError({ code: 'popup_blocked' }), /Allow/);
  assert.match(providerError({ code: 'auth_window_closed' }), /cancelled/);
  assert.match(providerError({ code: 'insufficient_funds' }), /allowance/);
});

test('Logo discussion leaves the editor untouched without validating or committing', async () => {
  const state = setup(async () => 'REPEAT runs its Logo instruction list several times.');
  state.options.validate = () => assert.fail('Prose must not enter the Logo validator');
  const result = await replaceCode(state.options);
  assert.equal(result.source, null);
  assert.match(result.reply, /REPEAT/);
  assert.equal(state.commits(), 0);
  assert.equal(state.editor.source, 'fd 20');
});

test('one complete Logo block is extracted separately from explanations', async () => {
  const response = 'Here is a square.\n\n' + logoReply('repeat 4 [fd 30 rt 90]') + '\n\nPress Run to draw it.';
  const state = setup(async () => response);
  const result = await replaceCode(state.options);
  assert.equal(result.response, response);
  assert.equal(result.reply, 'Here is a square.\n\n\nPress Run to draw it.');
  assert.equal(state.editor.source, 'repeat 4 [fd 30 rt 90]');
});

test('foreign, ambiguous, empty, and malformed code blocks are rejected', () => {
  for (const response of [
    '```python\nprint(1)\n```', '```\nfd 10\n```',
    logoReply('fd 10') + '\n' + logoReply('rt 90'),
    '```logo\n```', '```logo\nfd 10', '~~~~logo\nfd 10\n~~~~',
    '```logo\nfd 10\n```javascript', 'Example: ```logo fd 10```',
    'a'.repeat(120001)
  ]) assert.throws(() => parseLogoReply(response), undefined, response.slice(0, 60));
  assert.deepEqual(parseLogoReply('```LOGO\r\nfd 10\r\n```'), {source:'fd 10',reply:''});
});

test('unfenced text never becomes editor code', async () => {
  const state = setup(async () => 'fd 10');
  assert.equal((await replaceCode(state.options)).source, null);
  assert.equal(state.commits(), 0);
});

test('prose cannot bypass a rejected code update', async () => {
  let calls = 0;
  const state = setup(async () => ++calls === 1 ? logoReply('fd [10]') : 'I fixed the Logo program.');
  await assert.rejects(replaceCode(state.options), error => error.code === 'validation');
  assert.equal(calls, 4); assert.equal(state.commits(), 0);
});

test('a conversational reply preserves edits made during generation', async () => {
  const state = setup(async () => {state.editor.source='fd 77';state.editor.revision++;return 'FD moves the Logo turtle forward.';});
  assert.equal((await replaceCode(state.options)).source, null);
  assert.equal(state.editor.source, 'fd 77');
});

test('prompt keeps conversation about Logo and establishes the editor convention', () => {
  const prompt = basePrompt([]);
  assert.match(prompt, /Keep every conversation about Logo/);
  assert.match(prompt, /unrelated requests.*steer/);
  assert.match(prompt, /exactly ONE fenced code block tagged logo/);
  assert.match(prompt, /prose only and no code block/);
  assert.match(prompt, /another language, even when asked/);
});

test('validation resource limits are terminal rather than consuming repair calls', async () => {
  let calls = 0;
  const state = setup(async () => {calls++;return logoReply('fd 10');});
  state.options.validate = () => {const error = new Error('Allocation limit');error.code='RESOURCE_LIMIT';throw error;};
  await assert.rejects(replaceCode(state.options), error => error.code==='RESOURCE_LIMIT');
  assert.equal(calls, 1); assert.equal(state.commits(), 0);
});

test('Stop discards a late provider result and never validates or commits it', async () => {
  let resolve;
  const controller=new AbortController();
  const state=setup(()=>new Promise(done=>{resolve=done;}));
  state.options.validate=()=>assert.fail('Stopped generation must not be validated');
  const result=replaceCode({...state.options,signal:controller.signal});
  controller.abort();
  await assert.rejects(result,error=>error.name==='AbortError');
  resolve(logoReply('fd 88'));
  await Promise.resolve();
  assert.equal(state.commits(),0);
});

test('Stop during validation preserves the editor and prevents validation retries', async () => {
  const controller=new AbortController();
  let finishValidation, calls=0, started;
  const ready=new Promise(resolve=>{started=resolve;});
  const state=setup(async()=>{calls++;return logoReply('fd 88');});
  state.options.validate=()=>new Promise(resolve=>{finishValidation=resolve;started();});
  const result=replaceCode({...state.options,signal:controller.signal});
  await ready;controller.abort();
  await assert.rejects(result,error=>error.name==='AbortError');
  finishValidation();await Promise.resolve();
  assert.equal(calls,1);assert.equal(state.commits(),0);
});

test('an already stopped request never calls the provider', async () => {
  const state=setup(()=>assert.fail('Stopped request must not start'));
  const controller=new AbortController();controller.abort();
  await assert.rejects(replaceCode({...state.options,signal:controller.signal}),error=>error.name==='AbortError');
});
