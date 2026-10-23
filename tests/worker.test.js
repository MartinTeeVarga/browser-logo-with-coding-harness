import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';

// Exercise the actual browser worker with Node message/canvas adapters.
// Geometry is checked separately; these tests cover lifecycle and isolation.
function worker() {
  const url = new URL('../src/logo/draw.worker.js', import.meta.url).href;
  return new Worker(`
    const {parentPort} = require('node:worker_threads');
    globalThis.self = globalThis;
    globalThis.postMessage = data => parentPort.postMessage(data);
    globalThis.OffscreenCanvas = class {
      constructor(w,h){ this.width=w; this.height=h; }
      getContext(){ return new Proxy({canvas:this}, {
        get:(target,key)=> key in target ? target[key] : (...args)=>{},
        set:(target,key,value)=>{target[key]=value;return true;}
      }); }
    };
    globalThis.createImageBitmap = async () => ({});
    import(${JSON.stringify(url)}).then(()=>{
      parentPort.on('message', data => globalThis.onmessage({data}));
      parentPort.postMessage({type:'ready'});
    });
  `, { eval: true });
}
async function execute(source, input = '', {slow = false, speed} = {}) {
  const instance = worker();
  let output = '', frames = 0;
  const steps = [];
  try {
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Worker test timed out')), 4000);
      instance.on('error', error => { clearTimeout(timeout); reject(error); });
      instance.on('message', data => {
        if (data.type === 'ready') instance.postMessage({type:'run',source,slow,speed});
        if (data.type === 'frame') frames++;
        if (data.type === 'step') steps.push(data.line);
        if (data.type === 'output') output += data.value;
        if (data.type === 'input') instance.postMessage({type:'input',value:input});
        if (data.type === 'error') { clearTimeout(timeout); resolve({error:data.message,diagnostic:data,output,frames,steps}); }
        if (data.type === 'done') { clearTimeout(timeout); resolve({output,frames,steps}); }
      });
    });
  } finally { await instance.terminate(); }
}
test('drawing worker finishes the starter and returns a frame', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const result = await execute(source.match(/const STARTER = `([\s\S]*?)`;/)[1]);
  assert.equal(result.error, undefined);
  assert.ok(result.frames > 0);
});
test('drawing worker rejects invalid and native source before rendering', async () => {
  const result = await execute('shell "pwd');
  assert.match(result.error, /native feature/); assert.equal(result.frames, 0);
});
test('drawing worker sends output and resumes after input', async () => {
  const result = await execute('print readword', 'hello');
  assert.equal(result.error, undefined); assert.equal(result.output, 'hello\n');
});

test('runtime errors include a repairable interpreter diagnostic', async () => {
  const result = await execute('make "distance "oops\nfd :distance');
  assert.match(result.error, /Expected number/);
  assert.equal(result.diagnostic.phase, 'execution');
  assert.equal(result.diagnostic.procedure, 'FD');
  assert.equal(result.diagnostic.line, 2);
  assert.equal(result.diagnostic.repairable, true);
});

test('worker Slow mode publishes source steps and multiple frames', async () => {
  const result = await execute('fd 16\nrt 10', '', {slow: true});
  assert.equal(result.error, undefined);
  assert.deepEqual(result.steps, [1, 2]);
  assert.ok(result.frames > 2);
});


for (const speed of ['slow', 'fast', 'instant']) {
  test(`${speed} enforces the same instruction budget even for empty loops`, async () => {
    const result = await execute('repeat 100000 []', '', {speed});
    assert.match(result.error, /instruction limit/);
    assert.equal(result.diagnostic.code, 'RESOURCE_LIMIT');
    assert.equal(result.diagnostic.repairable, false);
  });
}

for (const source of [
  'make "a array 1000000000',
  'make "a mdarray [10000 10000]',
  'make "chunk "x repeat 12 [make "chunk (word :chunk :chunk)] repeat 10 [type :chunk cleartext]',
  'repeat 1100 [cleartext]',
  'repeat 1100 [type "||]'
]) {
  test(`worker stops resource abuse without requesting AI repair: ${source}`, async () => {
    const result = await execute(source);
    assert.equal(result.diagnostic.code, 'RESOURCE_LIMIT');
    assert.equal(result.diagnostic.repairable, false);
    assert.ok(result.output.length <= 20000);
  });
}

test('turtle indices are bounded before sparse-array growth', async () => {
  const result = await execute('setturtle 1000000000');
  assert.equal(result.diagnostic.code, 'RESOURCE_LIMIT');
  assert.equal(result.diagnostic.repairable, false);
});
