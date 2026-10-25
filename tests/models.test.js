import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelPricing, normalizeModels } from '../src/models.js';

const cost = (input, output, tokens = 1000000) => ({currency:'usd-cents',tokens,input,output});

test('cost bands convert cents per token block and include exact boundaries', () => {
  assert.equal(modelPricing(cost(10, 50)).band, '$');
  assert.equal(modelPricing(cost(100, 100)).band, '$');
  assert.equal(modelPricing(cost(200, 1000)).band, '$$');
  assert.equal(modelPricing(cost(500, 1000)).band, '$$');
  assert.equal(modelPricing(cost(500, 2500)).band, '$$$');
  assert.equal(modelPricing(cost(0.01, 0.05, 1000)).band, '$');
  assert.match(modelPricing(cost(500, 2500)).description, /\$5.00 input \/ \$25.00 output/);
  assert.match(modelPricing(cost(0, 0)).description, /Free/);
});

test('unknown, unsupported, and malformed pricing is not presented as cheap or free', () => {
  for (const value of [null, {}, {...cost(1, 2),currency:'credits'}, cost(-1, 2), cost(1, NaN), cost(1, 2, 0)]) {
    assert.equal(modelPricing(value).band, '?');
    assert.equal(modelPricing(value).description, 'Price unavailable');
  }
});

test('catalog preserves every provider and explicit variant ID without a model allowlist', () => {
  const models = normalizeModels([
    {id:'future/vendor-model:free',provider:'future',name:'New model',cost:cost(0, 0)},
    {id:'provider/model',provider:'provider',max_tokens:4000},
    {id:'provider/model',name:'duplicate'}, null, {id:''}
  ]);
  assert.equal(models.length, 2);
  assert.ok(models.some(model=>model.id==='future/vendor-model:free'));
  assert.equal(models.find(model=>model.id==='provider/model').maxTokens, 4000);
  assert.throws(()=>normalizeModels({}), /invalid model catalog/);
  assert.throws(()=>normalizeModels([]), /no available chat models/);
});

test('live Puter pricing resolves provider-specific keys with verified USD-cent conversion', async () => {
  const catalog=JSON.parse(await readFile(new URL('./fixtures/puter-model-pricing.json',import.meta.url),'utf8'));
  const models=normalizeModels(catalog);
  const luna=models.find(model=>model.id==='gpt-6-luna');
  assert.equal(luna.pricing.band,'$');
  assert.equal(luna.pricing.description,'$0.10 input / $0.50 output per 1M tokens');
  const sol=models.find(model=>model.id==='gpt-6.1-sol');
  assert.equal(sol.pricing.band,'$$');
  assert.equal(sol.pricing.description,'$2.00 input / $10.00 output per 1M tokens');
  assert.equal(models.find(model=>model.id==='claude-sonnet-5-5').pricing.description,sol.pricing.description);
  assert.equal(models.find(model=>model.id==='openrouter:openai/gpt-6.1-sol').pricing.description,sol.pricing.description);
  assert.equal(models.find(model=>model.id==='infron:openai/gpt-6-luna:flex').pricing.description,'$0.05 input / $0.25 output per 1M tokens');
  assert.equal(models.find(model=>model.id==='decision-model-preview').pricing.band,'?');
});

test('live pricing preserves zero rates and does not mistake cache rates for ordinary input', () => {
  const make=(input,output)=>({id:'test',costs_currency:'usd-cents',input_cost_key:'input_tokens',output_cost_key:'output_tokens',costs:{tokens:1000000,input_tokens:input,output_tokens:output,cache_read_input_tokens:0.01}});
  assert.match(normalizeModels([make(0,0)])[0].pricing.description,/Free/);
  assert.equal(normalizeModels([make(300,1500)])[0].pricing.band,'$$$');
  assert.equal(normalizeModels([make(undefined,1500)])[0].pricing.band,'?');
});

test('Latest includes current requested families and Kimi across provider routes and variants', async () => {
  const {isLatestModel}=await import('../src/models.js');
  for (const id of [
    'gpt-6-luna','openai/gpt-6-astra-pro','infron:openai/gpt-6.1-sol:flex',
    'claude-opus-5-5','anthropic/claude-sonnet-5.5','claude-haiku-5-5','claude-fable-5-1',
    'google/gemini-4-argon','gemini-3.8-flash','gemini-3.5-flash-lite','gemini-3.1-pro-preview',
    'mistral-large-4','mistral-medium-2604','mistral-small-2603','openrouter:mistralai/devstral-2512',
    'x-ai/grok-4.7','deepseek/deepseek-v4.1-flash-1017','deepseek-v4-pro-0813',
    'kimi-k3','moonshotai/kimi-k3.1-pro','infron:moonshotai/kimi-k3:priority'
  ]) assert.equal(isLatestModel({id}),true,id);
  for (const id of ['gpt-5.6-sol','gpt-6.2-sol','claude-sonnet-5','claude-opus-4-8','gemini-2.5-pro','mistral-small-creative','grok-4.6','kimi-k2.7-code','sao10k/l3.3-70b-euryale-v2.3']) {
    assert.equal(isLatestModel({id}),false,id);
  }
  assert.equal(isLatestModel({id:'opaque-route',aliases:['google/gemini-4-argon']}),true);
});
