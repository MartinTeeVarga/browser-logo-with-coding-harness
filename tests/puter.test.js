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
