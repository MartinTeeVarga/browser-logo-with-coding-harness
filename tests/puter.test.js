import test from 'node:test';
import assert from 'node:assert/strict';
import { connectPuter, generate, MODEL, getRemainingAllowance, formatAllowance } from '../src/puter.js';

test('Puter authentication opens synchronously on the user action', async () => {
  let signedIn = false, opened = 0;
  globalThis.puter = { auth: { isSignedIn: () => signedIn, signIn: () => { opened++; signedIn = true; return Promise.resolve(); } }, ai: { chat() {} } };
  const promise = connectPuter();
  assert.equal(opened, 1);
  await promise; await connectPuter();
  assert.equal(opened, 1);
  delete globalThis.puter;
});
test('AI adapter requests text with no tools and returns normalized content', async () => {
  globalThis.puter = { auth: {}, ai: { chat: async (messages, options) => {
    assert.equal(options.model, MODEL); assert.equal(options.normalize, true);
    assert.equal(options.model, 'openai/gpt-6-luna');
    assert.equal(options.reasoning_effort, 'medium');
    assert.equal(options.tools, undefined); assert.ok(options.signal instanceof AbortSignal);
    assert.equal(messages[0].role, 'system');
    return { message: { content: 'fd 30' }, finish_reason: 'stop' };
  } } };
  assert.equal(await generate([{ role: 'system', content: 'Only Logo' }]), 'fd 30');
  delete globalThis.puter;
});
test('tool calls and truncated responses cannot reach the editor', async () => {
  globalThis.puter = { auth: {}, ai: { chat: async () => ({ message: { content: 'fd 10', tool_calls: [{ name: 'execute' }] } }) } };
  assert.equal(await generate([]), '');
  globalThis.puter.ai.chat = async () => ({ message: { content: 'fd 10' }, finish_reason: 'length' });
  assert.equal(await generate([]), '');
  delete globalThis.puter;
});

test('usage status never signs in or calls the API for a signed-out user', async () => {
  globalThis.puter = { auth: { isSignedIn: () => false, signIn: () => assert.fail('Unexpected popup'), getMonthlyUsage: () => assert.fail('Unexpected usage request') } };
  assert.equal(await getRemainingAllowance(), null);
  delete globalThis.puter;
  assert.equal(await getRemainingAllowance(), null);
});

test('usage reads the account allowance and converts documented microcent units', async () => {
  globalThis.puter = { auth: { isSignedIn: () => true, getMonthlyUsage: async () => ({ allowanceInfo: { remaining: 1000000, monthUsageAllowance: 2000000 } }) } };
  const allowance = await getRemainingAllowance();
  assert.deepEqual(allowance, { remaining: 1000000, total: 2000000, unit: 'microcents' });
  assert.equal(formatAllowance(allowance), 'Puter · $0.01 remaining (50%)');
  delete globalThis.puter;
});

test('explicit credit units are displayed without currency conversion', async () => {
  globalThis.puter = { auth: { isSignedIn: () => true, getMonthlyUsage: async () => ({ allowanceInfo: { remaining: 1200, monthUsageAllowance: 2000, unit: 'credits' } }) } };
  assert.equal(formatAllowance(await getRemainingAllowance()), 'Puter · 1,200 credits remaining (60%)');
  delete globalThis.puter;
});

test('response-level unit metadata also prevents treating credits as microcents', async () => {
  globalThis.puter = { auth: { isSignedIn: () => true, getMonthlyUsage: async () => ({ unit: 'credits', allowanceInfo: { remaining: 1200, monthUsageAllowance: 2000 } }) } };
  assert.equal(formatAllowance(await getRemainingAllowance()), 'Puter · 1,200 credits remaining (60%)');
  delete globalThis.puter;
});

test('missing or invalid usage is unavailable, not a fabricated zero balance', async () => {
  for (const info of [null, {}, { remaining: '100' }, { remaining: NaN }]) {
    globalThis.puter = { auth: { isSignedIn: () => true, getMonthlyUsage: async () => ({ allowanceInfo: info }) } };
    assert.equal(await getRemainingAllowance(), null);
  }
  assert.equal(formatAllowance(null), null);
  delete globalThis.puter;
});

test('usage preserves zero balances and does not round tiny balances to zero', () => {
  assert.equal(formatAllowance({ remaining: 0, total: 100, unit: 'credits' }), 'Puter · 0 credits remaining (0%)');
  assert.equal(formatAllowance({ remaining: 1, total: 2000000, unit: 'microcents' }), 'Puter · <$0.0001 remaining (<0.1%)');
});

test('selected models and output limits reach the provider without foreign reasoning options', async () => {
  globalThis.puter = {auth:{},ai:{chat:async (messages, options) => {
    assert.equal(options.model, 'anthropic/claude-test');
    assert.equal(options.max_tokens, 4000);
    assert.equal(options.reasoning_effort, undefined);
    assert.equal(options.normalize, true);
    assert.equal(messages[0].cache_control, undefined); // Caching was a question, not an implementation request.
    return {message:{content:'A Logo explanation.'}};
  }}};
  try {assert.equal(await generate([{role:'system',content:'Logo'}], 'anthropic/claude-test', 4000), 'A Logo explanation.');}
  finally {delete globalThis.puter;}
});

test('model catalog listing does not authenticate or generate and reports server failures', async () => {
  globalThis.puter = {auth:{signIn:()=>assert.fail('Unexpected sign-in')},ai:{chat:()=>assert.fail('Unexpected generation'),listModels:async()=>[{id:'new/model',cost:{currency:'usd-cents',tokens:1000000,input:1,output:2}}]}};
  try {
    const {loadModels} = await import('../src/puter.js');
    assert.equal((await loadModels())[0].id, 'new/model');
    globalThis.puter.ai.listModels=async()=>{throw new Error('Catalog unavailable');};
    await assert.rejects(loadModels(), /Catalog unavailable/);
  } finally {delete globalThis.puter;}
});

test('Stop forwards cancellation to Puter and returns even if the SDK ignores it', async () => {
  let resolve, providerSignal;
  const controller=new AbortController();
  globalThis.puter={auth:{},ai:{chat:(messages,options)=>{providerSignal=options.signal;return new Promise(done=>{resolve=done;});}}};
  try {
    const result=generate([],MODEL,12000,controller.signal);
    controller.abort();
    await assert.rejects(result,error=>error.name==='AbortError');
    assert.equal(providerSignal.aborted,true);
    resolve({message:{content:'late response'}});
  } finally {delete globalThis.puter;}
});
