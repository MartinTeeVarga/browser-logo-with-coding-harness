import test from 'node:test';
import assert from 'node:assert/strict';
import { createInterpreter, validateLogo } from '../src/logo/runtime.js';
import { ExecutionBudget, OutputBudget, RESOURCE_LIMITS } from '../src/logo/resources.js';
import { createProgramOutput } from '../src/logo/output.js';

const resourceError = error => error.code === 'RESOURCE_LIMIT';

for (const source of [
  'make "a array 1000000000',
  'make "a mdarray [10000 10000]',
  'make "a mdarray [100000 100000 100000]',
  'make "a iseq 1 1000000000',
  'make "a rseq 0 1 1000000000',
  'copydef "huge "array make "a huge 1000000000',
  'run [make "a array 1000000000]',
  'make "s "x repeat 30 [make "s word :s :s]',
  'make "s [x] repeat 30 [make "s sentence :s :s]',
  'make "s [x] repeat 30 [make "s list :s :s]',
  'make "s "x repeat 16 [make "s word :s :s] (print :s :s :s :s)',
  'make "a iseq 1 1000 make "b crossmap "sum :a :a',
  'to recurse output recurse end show recurse',
  'make "a array 1 .setitem 1 :a :a show :a',
  'catch "error [make "a array 1000000000]',
  'make "erract [output 1] make "a array 1000000000'
]) {
  test(`resource guard rejects: ${source}`, async () => {
    const logo = createInterpreter();
    await assert.rejects(logo.run(source), resourceError);
  });
}

test('multi-dimensional budget includes intermediate arrays before constructing the tree', async () => {
  const turtle = {};
  const logo = createInterpreter(turtle);
  const before = turtle.resources.allocations;
  await assert.rejects(logo.run('make "a mdarray [10000 10000]'), resourceError);
  assert.ok(turtle.resources.allocations - before < 1000);
});

test('the allocation budget is cumulative even when arrays are overwritten', async () => {
  const logo = createInterpreter();
  await assert.rejects(logo.run('repeat 30 [make "a array 100000]'), /allocation limit/);
});

test('small arrays, computed dimensions, strings, and dynamic commands retain their behavior', async () => {
  let output = '';
  const logo = createInterpreter({}, {write: (...parts) => {output += parts.join('');}});
  await logo.run('make "n 3 make "a mdarray (list 2 :n) mdsetitem [2 3] :a 7 show mditem [2 3] :a run [print word "a "b] show iseq 3 1');
  assert.equal(output, '7\nab\n[3 2 1]\n');
});

test('deep source nesting is rejected before JavaScript stack exhaustion', () => {
  const source = 'show ' + '['.repeat(1000) + 'x' + ']'.repeat(1000);
  assert.throws(() => validateLogo(source), resourceError);
});

test('limits remain terminal after the first budget failure', () => {
  const budget = new ExecutionBudget();
  assert.throws(() => budget.allocate(RESOURCE_LIMITS.valueSize + 1), resourceError);
  assert.throws(() => budget.allocate(1), resourceError);
  assert.throws(() => budget.instruction(), resourceError);
});

test('output accepts the exact character boundary and clears never restore it', () => {
  const budget = new OutputBudget();
  budget.accept('x'.repeat(20000));
  budget.accept(); // clear
  assert.throws(() => budget.accept('x'), resourceError);
});

test('empty writes and clear operations still consume the output message allowance', () => {
  const budget = new OutputBudget();
  for (let i = 0; i < RESOURCE_LIMITS.outputMessages; i++) budget.accept();
  assert.throws(() => budget.accept(), resourceError);
});

test('stream batches small writes and preserves write/clear/write order', () => {
  const messages = [];
  const output = createProgramOutput(message => messages.push(message));
  try {
    output.write('a'); output.write('b');
    assert.equal(messages.length, 0);
    output.clear(); output.write('c'); output.flush();
    assert.deepEqual(messages, [
      {type:'output', value:'ab'}, {type:'clear-output'}, {type:'output', value:'c'}
    ]);
  } finally { output.dispose(); }
});
