const logoReply = source => '```logo\n' + source.trim() + '\n```';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { OutputBudget } from '../src/logo/resources.js';
import { primitiveNames, validateLogo } from '../src/logo/runtime.js';
import { basePrompt, replaceCode, repairCode, RuntimeRepairBudget } from '../src/harness.js';

// Exercise the real app event handlers in a small DOM/editor adapter. No live
// browser, auth session, model request, or drawing is involved in these tests.
async function app(t, generate = async () => logoReply('fd 20')) {
  class Element {
    constructor() { this.value = ''; this.textContent = ''; this.style = {}; this.hidden = false; this.children = []; this.listeners = {}; this.classes = new Set(); this.classList = {toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name),add:name=>this.classes.add(name),remove:name=>this.classes.delete(name)}; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    emit(name, data = {}) { return this.listeners[name]?.({preventDefault() {}, ...data}); }
    setAttribute(name, value) { (this.attributes ||= {})[name] = value; } focus() {} remove() { this.removed = true; }
    append(node) { this.children.push(node); }
    querySelector(selector) { return (this.selected ||= {})[selector] ||= new Element(); }
  }
  const nodes = new Map();
  const get = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  let source = '', change, marked = null, scrolled = null;
  const editor = {
    getValue:()=>source, getInputField:()=>get('code-input'), getWrapperElement:()=>get('code-wrapper'),
    on:(event, fn)=>{if(event==='change')change=fn;}, refresh(){}, operation:fn=>fn(),
    lineCount:()=>source.split('\n').length, posFromIndex:()=>({line:0,ch:source.length}),
    replaceRange:(text,from,to,origin)=>{source=text;change(editor,{origin});},
    addLineClass:line=>{marked=line;},removeLineClass:()=>{marked=null;},scrollIntoView:pos=>{scrolled=pos.line;}
  };
  const workers = [], requests = [], windowEvents = {};
  class Worker {
    constructor(url) { this.url = String(url); this.messages = []; workers.push(this); }
    postMessage(data) {
      this.messages.push(data);
      if (this.url.includes('validate.worker')) queueMicrotask(() => {
        try { validateLogo(data.source); this.emit({valid:true}); }
        catch(error) { this.emit({valid:false,error:error.message}); }
      });
    }
    emit(data) { this.onmessage?.({data}); }
    terminate() { this.terminated=true; }
  }
  const original = 'make "distance "oops\nfd :distance';
  const context = vm.createContext({
    console, URL, Worker, setTimeout, clearTimeout, queueMicrotask, OffscreenCanvas:class {},
    primitiveNames, basePrompt, replaceCode, repairCode, RuntimeRepairBudget, OutputBudget,
    connectPuter:()=>Promise.resolve(), generate:async messages=>{requests.push(messages);return generate(messages);},
    providerError:error=>error.message, getRemainingAllowance:async()=>null, formatAllowance:()=>'',
    puter:{auth:{isSignedIn:()=>true}},
    requestAnimationFrame:fn=>fn(), ResizeObserver:class {observe(){}},
    localStorage:{getItem:key=>key==='logo.source.v1'?original:null,setItem(){}},
    document:{getElementById:get,querySelector:()=>new Element(),createElement:()=>new Element(),body:new Element()},
    window:{addEventListener:(name,fn)=>{windowEvents[name]=fn;}},
    CodeMirror:{defineMode(){},fromTextArea:node=>{source=node.value;return editor;}}
  });
  const main = (await readFile(new URL('../src/main.js', import.meta.url),'utf8'))
    .replace(/^import .*;\n/gm,'').replaceAll('import.meta.url',JSON.stringify(new URL('../src/main.js',import.meta.url).href));
  vm.runInContext(main,context);
  t.after(()=>windowEvents.pagehide?.());
  return {
    get,workers,requests,editor,source:()=>source,marked:()=>marked,scrolled:()=>scrolled,
    edit:text=>{source=text;change(editor,{origin:'+input'});},
    drawing:()=>workers.filter(w=>w.url.includes('draw.worker')).at(-1)
  };
}
async function settled(predicate) {
  for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setImmediate(resolve));}
  assert.fail('App event did not settle');
}
const failure = {type:'error',message:'Expected number',procedure:'FD',phase:'execution',line:2,code:4,repairable:true};

test('a Run error automatically repairs the editor without starting another Run', async t => {
  const state = await app(t);
  await state.get('run').emit('click');
  state.drawing().emit(failure);
  await settled(()=>state.source()==='fd 20'&&!state.get('send').disabled);
  assert.equal(state.requests.length,1);
  assert.match(state.requests[0].at(-1).content,/Expected number/);
  assert.equal(state.workers.filter(w=>w.url.includes('draw.worker')).length,1);
  assert.match(state.get('run-status').textContent,/Press Run/);
});

test('an error from an older Run never overwrites user edits', async t => {
  const state = await app(t);
  await state.get('run').emit('click');
  state.edit('fd 77');
  state.drawing().emit(failure);
  assert.equal(state.source(),'fd 77'); assert.equal(state.requests.length,0);
});

test('speed slider sends its state, highlights the active line, and autoscrolls', async t => {
  const state = await app(t);
  state.get('speed').value='0';
  state.get('speed').emit('input');
  await state.get('run').emit('click');
  assert.equal(state.drawing().messages[0].speed,'slow');
  assert.equal(state.get('run').querySelector('path').attributes.d, 'M2 2h10v10H2z');
  state.get('speed').value='1';state.get('speed').emit('input');
  assert.equal(state.drawing().messages.at(-1).speed,'fast');
  state.drawing().emit({type:'step',line:2});
  assert.equal(state.marked(),1); assert.equal(state.scrolled(),1);
  state.get('speed').value='2';state.get('speed').emit('input');
  assert.equal(state.marked(),null);
  assert.equal(state.drawing().messages.at(-1).speed,'instant');
  await state.get('run').emit('click'); // Stop never starts an AI repair.
  assert.equal(state.get('run').querySelector('path').attributes.d, 'M2 1.5 11 7l-9 5.5z');
  assert.equal(state.requests.length,0);
});

test('chat discussion displays prose and retains conversation without editor or execution changes', async t => {
  const reply = 'REPEAT repeats a Logo instruction list. Try changing the repeat count.';
  const state = await app(t, async () => reply);
  const original = state.source();
  state.get('message').value='What does REPEAT do?';
  await state.get('composer').emit('submit');
  assert.equal(state.source(), original);
  assert.equal(state.workers.length, 0);
  assert.equal(state.get('messages').children.at(-1).textContent, reply);
  state.get('message').value='And FD?';
  await state.get('composer').emit('submit');
  assert.ok(state.requests[1].some(m=>m.role==='assistant'&&m.content===reply));
});

test('chat with a Logo block shows the explanation and updates only the code', async t => {
  const response = 'This draws a line.\n\n' + logoReply('fd 30');
  const state = await app(t, async () => response);
  state.get('message').value='Draw a line';
  await state.get('composer').emit('submit');
  assert.equal(state.source(), 'fd 30');
  assert.equal(state.workers.filter(w=>w.url.includes('draw.worker')).length, 0);
  assert.equal(state.get('messages').children.at(-2).textContent, 'This draws a line.');
  assert.match(state.get('messages').children.at(-1).textContent, /Press Run/);
});

test('page enforces cumulative output across clears before touching the DOM', async t => {
  const state = await app(t);
  await state.get('run').emit('click');
  const worker = state.drawing();
  worker.emit({type:'output',value:'x'.repeat(16000)});
  worker.emit({type:'clear-output'});
  worker.emit({type:'output',value:'x'.repeat(16000)});
  assert.equal(state.get('output').textContent, '');
  assert.equal(worker.terminated, true);
  assert.match(state.get('run-status').textContent, /output exceeded/);
  assert.equal(state.requests.length, 0);
});

test('page stops clear-message floods and creates a fresh budget for the next Run', async t => {
  const state = await app(t);
  await state.get('run').emit('click');
  const worker = state.drawing();
  for (let i = 0; i < 1001; i++) worker.emit({type:'clear-output'});
  assert.equal(worker.terminated, true);
  assert.match(state.get('run-status').textContent, /message limit/);
  await state.get('run').emit('click');
  state.drawing().emit({type:'output',value:'hello'});
  assert.equal(state.get('output').textContent, 'hello');
  assert.equal(state.requests.length, 0);
});

test('resource failures never trigger AI repair even if a worker marks them repairable', async t => {
  const state = await app(t);
  await state.get('run').emit('click');
  state.drawing().emit({...failure,code:'RESOURCE_LIMIT',message:'Allocation limit reached.'});
  assert.equal(state.requests.length, 0);
  assert.match(state.get('run-status').textContent, /Allocation/);
});
