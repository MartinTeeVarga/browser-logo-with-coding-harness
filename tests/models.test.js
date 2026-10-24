import test from 'node:test';
import assert from 'node:assert/strict';
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
