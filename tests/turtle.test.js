import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createInterpreter, validateLogo } from '../src/logo/runtime.js';

globalThis.self = globalThis;
globalThis.requestAnimationFrame = () => 0;
await import('../src/logo/vendor/turtle.js');
function context() {
  const operations = [];
  const ctx = new Proxy({ operations, canvas: { width: 1000, height: 1000 } }, {
    get: (target, key) => key in target ? target[key] : (...args) => operations.push([key, ...args]),
    set: (target, key, value) => { target[key] = value; return true; }
  });
  return ctx;
}
test('square draws four sides and returns to origin', async () => {
  const drawing = context(), cursor = context();
  const turtle = new CanvasTurtle(drawing, cursor, 1000, 1000);
  const logo = createInterpreter(turtle);
  await logo.run('repeat 4 [fd 100 rt 90]');
  assert.ok(Math.abs(turtle.position[0]) < 1e-8);
  assert.ok(Math.abs(turtle.position[1]) < 1e-8);
  assert.equal(drawing.operations.filter(op => op[0] === 'lineTo').length, 4);
});
test('pen up moves without drawing, and heading follows Logo conventions', async () => {
  const drawing = context(), turtle = new CanvasTurtle(drawing, context(), 1000, 1000);
  await createInterpreter(turtle).run('pu fd 80 rt 90 fd 40');
  assert.deepEqual(turtle.position.map(Math.round), [40, 80]);
  assert.equal(turtle.heading, 90);
  assert.equal(drawing.operations.filter(op => op[0] === 'lineTo').length, 0);
});
test('starter flower draws and finishes without leaving the canvas', async () => {
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const starter = main.match(/const STARTER = `([\s\S]*?)`;/)[1];
  const drawing = context(), turtle = new CanvasTurtle(drawing, context(), 1000, 1000);
  await createInterpreter(turtle).run(starter);
  assert.equal(turtle.visible, false);
  assert.ok(drawing.operations.filter(op => op[0] === 'lineTo').length > 1000);
  const points = drawing.operations.filter(op => op[0] === 'lineTo');
  assert.ok(points.every(([, x, y]) => Math.abs(x) < 500 && Math.abs(y) < 500));
});

test('corrected house runs with actual turtle semantics and stays inside the canvas', async () => {
  const source = await readFile(new URL('../examples/house.logo', import.meta.url), 'utf8');
  validateLogo(source);
  const drawing = context(), turtle = new CanvasTurtle(drawing, context(), 1000, 1000);
  await createInterpreter(turtle).run(source);
  const points = drawing.operations.filter(op => op[0] === 'lineTo');
  assert.ok(points.length > 15);
  assert.ok(points.every(([, x, y]) => Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) < 500 && Math.abs(y) < 500));
  assert.equal(turtle.visible, false);
});

test('corrected goulash runs with FILLED color and instruction inputs', async () => {
  const source = await readFile(new URL('../examples/goulash.logo', import.meta.url), 'utf8');
  validateLogo(source);
  const turtle = new CanvasTurtle(context(), context(), 1000, 1000);
  await createInterpreter(turtle).run(source);
  assert.ok(turtle.position.every(Number.isFinite));
  assert.equal(turtle.visible, false);
});

test('supplied Mona Lisa validates and draws within the canvas with the real turtle', async () => {
  const source=await readFile(new URL('../examples/mona-lisa.logo',import.meta.url),'utf8');
  validateLogo(source);
  const drawing=context(), turtle=new CanvasTurtle(drawing, context(), 1000, 1000);
  await createInterpreter(turtle).run(source);
  const points=drawing.operations.filter(op=>op[0]==='lineTo');
  assert.ok(points.length > 400);
  assert.ok(points.every(([,x,y])=>Number.isFinite(x) && Number.isFinite(y) && Math.abs(x)<500 && Math.abs(y)<500));
  assert.equal(turtle.visible, false);
});

for (const file of ['pelican-bicycle-sol-6.1.logo', 'pelican-bicycle-luna-6.logo']) {
  test(`${file} validates and draws within the canvas`, async () => {
    const source=await readFile(new URL('../examples/'+file,import.meta.url),'utf8');
    validateLogo(source);
    const drawing=context(), turtle=new CanvasTurtle(drawing, context(), 1000, 1000);
    await createInterpreter(turtle).run(source);
    const points=drawing.operations.filter(op=>op[0]==='lineTo');
    assert.ok(points.length>400);
    assert.ok(points.every(([,x,y])=>Number.isFinite(x) && Number.isFinite(y) && Math.abs(x)<500 && Math.abs(y)<500));
    assert.equal(turtle.visible,false);
  });
}
