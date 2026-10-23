import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createInterpreter } from '../src/logo/runtime.js';
import { createSlowExecution } from '../src/logo/slow.js';

globalThis.self = globalThis;
globalThis.requestAnimationFrame = () => 0;
await import('../src/logo/vendor/turtle.js');
function context() {
  return new Proxy({canvas: {width: 1000, height: 1000}}, {
    get: (target, key) => key in target ? target[key] : () => {},
    set: (target, key, value) => { target[key] = value; return true; }
  });
}
function session({slow = true, afterFrame = () => {}, speed = 'slow', instructionLimit} = {}) {
  const turtle = new CanvasTurtle(context(), context(), 1000, 1000);
  const logo = createInterpreter(turtle, {write() {}, read: async () => ''});
  const lines = [], frames = [], delays = [];
  const mode = {enabled: slow, speed};
  const pacing = createSlowExecution({
    turtle, instructionLimit, enabled: () => mode.enabled, speed: () => mode.speed,
    wait: async ms => { delays.push(ms); },
    frame: async () => { frames.push({pos: turtle.position.slice(), heading: turtle.heading, color: turtle.color}); afterFrame(mode, frames.length); },
    step: info => lines.push(info.line)
  });
  logo.onInstruction = pacing.onInstruction;
  logo.primitiveExecutor = pacing.primitiveExecutor;
  return {logo, turtle, lines, frames, delays, mode};
}

test('source lines follow procedure calls and repeated instruction blocks', async () => {
  const state = session();
  await state.logo.run('to f :n\n  repeat :n [\n    fd 16\n    rt 90\n  ]\nend\nf 2');
  assert.deepEqual(state.lines, [1, 7, 2, 3, 4, 3, 4]);
});

test('nested loops retain their actual editor source lines', async () => {
  const state = session();
  await state.logo.run('repeat 2 [\n  repeat 2 [\n    fd 16\n    rt 90\n  ]\n]');
  assert.deepEqual(state.lines, [1, 2, 3, 4, 3, 4, 2, 3, 4, 3, 4]);
});

test('slow movement emits intermediate states and preserves the final result', async () => {
  const source = 'pu setxy -40 -20 setheading 90 pd fd 80 rt 45 bk 20 setpos [20 20] setx 30 sety 40 setpencolor [20 40 80]';
  const fast = session({slow: false}), slow = session();
  await fast.logo.run(source); await slow.logo.run(source);
  assert.deepEqual(slow.turtle.position, fast.turtle.position);
  assert.ok(Math.abs(slow.turtle.heading - fast.turtle.heading) < 1e-8);
  assert.equal(slow.turtle.color, fast.turtle.color);
  assert.ok(slow.frames.length > 20);
  assert.ok(slow.frames.some(frame => frame.pos[0] > -40 && frame.pos[0] < 40));
  assert.equal(fast.frames.length, 0); assert.equal(fast.delays.length, 0);
});

test('switching Slow mode off midway completes the current movement correctly', async () => {
  const state = session({afterFrame: (mode, frames) => { if (frames === 2) mode.enabled = false; }});
  await state.logo.run('fd 80 rt 90');
  assert.deepEqual(state.turtle.position.map(Math.round), [0, 80]);
  assert.equal(state.turtle.heading, 90);
  assert.equal(state.frames.length, 2);
});

test('slow programs cannot run an unbounded instruction stream', async () => {
  const state = session({instructionLimit: 5});
  await assert.rejects(state.logo.run('forever [fd 1]'), /instruction limit/);
});

test('the corrected goulash executes in slow mode with valid line locations', async () => {
  const source = await readFile(new URL('../examples/goulash.logo', import.meta.url), 'utf8');
  const state = session();
  await state.logo.run(source);
  assert.ok(state.lines.length > 1000);
  assert.ok(state.lines.every(line => line > 0 && line <= source.split('\n').length));
  assert.ok(state.frames.every(frame => frame.pos.every(Number.isFinite)));
});


test('Fast preserves the animation path with ten times shorter pacing delays', async () => {
  const slow = session(), fast = session({speed: 'fast'});
  const source = 'fd 24 rt 15 setxy 20 30 setheading 90 setpc 4';
  await slow.logo.run(source); await fast.logo.run(source);
  assert.deepEqual(fast.frames, slow.frames);
  assert.deepEqual(fast.delays, slow.delays.map(ms => ms / 10));
  assert.ok(slow.delays.includes(90)); assert.ok(slow.delays.includes(20));
});

test('speed can change to Fast within an animated movement', async () => {
  const state = session({afterFrame: mode => {mode.speed='fast';}});
  await state.logo.run('fd 24');
  assert.deepEqual(state.delays, [90, 2, 2, 2]);
});

test('animated pen uses the turtle silhouette even with triangle shape and hidden turtle', () => {
  const calls = [];
  const cursor = context();
  cursor.ellipse = (...shape) => calls.push(shape);
  cursor.stroke = () => calls.push(cursor.strokeStyle);
  const turtle = new CanvasTurtle(context(), cursor, 1000, 1000);
  turtle.visible=false; turtle.showExecutionCursor=true; turtle.color='red';
  turtle.render();
  assert.ok(calls.some(point => Array.isArray(point) && point[0]===32 && point[1]===33 && point[2]===13 && point[3]===16));
  assert.ok(calls.includes('red'));
  assert.equal(turtle.visible, false); assert.equal(turtle.shape, 'triangle');
  calls.length=0; turtle.color='blue'; turtle.render();
  assert.ok(calls.includes('blue'));
});
