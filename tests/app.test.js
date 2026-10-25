const logoReply = source => '```logo\n' + source.trim() + '\n```';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { stoppedError, throwIfAborted, waitForResult } from '../src/cancellation.js';
import { normalizeModels, isLatestModel } from '../src/models.js';
import { MODEL } from '../src/puter.js';
import { OutputBudget } from '../src/logo/resources.js';
import { primitiveNames, validateLogo } from '../src/logo/runtime.js';
import { basePrompt, replaceCode, repairCode, RuntimeRepairBudget } from '../src/harness.js';

// Exercise the real app event handlers in a small DOM/editor adapter. No live
// browser, auth session, model request, or drawing is involved in these tests.
async function app(t, generate = async () => logoReply('fd 20'), options = {}) {
  class Element {
    constructor() { this.value = ''; this.textContent = ''; this.style = {setProperty:(key,value)=>{this.style[key]=value;}}; this.hidden = false; this.children = []; this.listeners = {}; this.classes = new Set(); this.classList = {toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name),add:name=>this.classes.add(name),remove:name=>this.classes.delete(name)}; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    emit(name, data = {}) { return this.listeners[name]?.({preventDefault() {}, ...data}); }
    setAttribute(name, value) { (this.attributes ||= {})[name] = value; } focus() {} remove() { this.removed = true; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) {this.children=nodes;}
    getBoundingClientRect() {return {top:0,height:660};}
    setPointerCapture() {}
    showModal() {this.open=true;}
    close() {this.open=false;}
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
  const workers = [], requests = [], windowEvents = {}, modelsUsed = [], saved = new Map(Object.entries(options.saved || {}));
  const catalog = normalizeModels([
    {id:MODEL,name:'GPT-6 Luna',cost:{currency:'usd-cents',tokens:1000000,input:10,output:50}},
    {id:'anthropic/claude-sonnet-5-5',name:'Claude Test',max_tokens:4000,cost:{currency:'usd-cents',tokens:1000000,input:500,output:2500}},
    {id:'sao10k/l3.3-70b-euryale-v2.3',name:'Euryale',cost:{currency:'usd-cents',tokens:1000000,input:85,output:85}}
  ]);
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
    primitiveNames, basePrompt, replaceCode, repairCode, RuntimeRepairBudget, OutputBudget, MODEL,
    loadModels:options.loadModels || (async()=>catalog),
    connectPuter:options.connectPuter || (()=>Promise.resolve()), generate:async (messages,model,maxTokens,signal)=>{requests.push(messages);modelsUsed.push({model,maxTokens});return generate(messages, signal);},
    providerError:error=>error.message,
    AbortController, stoppedError, throwIfAborted, waitForResult, isLatestModel, getRemainingAllowance:async()=>null, formatAllowance:()=>'',
    puter:{auth:{isSignedIn:()=>true}},
    requestAnimationFrame:fn=>fn(), ResizeObserver:class {observe(){}},
    localStorage:{getItem:key=>key==='logo.source.v1'?original:saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)},
    fetch:options.fetch || (async()=>({ok:true,text:async()=>'fd 25'})),
    document:{getElementById:get,querySelector:()=>new Element(),createElement:()=>new Element(),body:new Element()},
    window:{addEventListener:(name,fn)=>{windowEvents[name]=fn;}},
    CodeMirror:{defineMode(){},fromTextArea:node=>{source=node.value;return editor;}}
  });
  const main = (await readFile(new URL('../src/main.js', import.meta.url),'utf8'))
    .replace(/^import .*;\n/gm,'').replaceAll('import.meta.url',JSON.stringify(new URL('../src/main.js',import.meta.url).href));
  for (const path of ['workspace.js', 'model-picker.js']) {
    const module = await readFile(new URL('../src/' + path, import.meta.url), 'utf8');
    vm.runInContext(module.replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), context);
  }
  vm.runInContext(main,context);
  t.after(()=>windowEvents.pagehide?.());
  return {
    get,workers,requests,modelsUsed,saved,editor,source:()=>source,marked:()=>marked,scrolled:()=>scrolled,
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

test('/model opens a live searchable chooser without an AI request and applies selection', async t => {
  const state = await app(t);
  state.get('message').value='/model Claude';
  await state.get('composer').emit('submit');
  assert.equal(state.get('model-dialog').open, true);
  assert.equal(state.get('model-list').children.length, 1);
  const option=state.get('model-list').children[0];
  assert.equal(option.children[1].textContent, '$$$');
  option.emit('click');
  assert.equal(state.get('model-dialog').open, false);
  assert.match(state.get('chat-footnote').textContent, /^Claude Test ·/);
  assert.match(state.saved.get('logo.model.v1'), /anthropic\/claude-sonnet-5-5/);
  assert.equal(state.requests.length, 0);
  state.get('message').value='What is Logo?';
  await state.get('composer').emit('submit');
  assert.deepEqual(state.modelsUsed[0], {model:'anthropic/claude-sonnet-5-5',maxTokens:4000});
});

test('model picker search, unknown commands, and listing failures stay local', async t => {
  const state=await app(t, undefined, {loadModels:async()=>{throw Error('Catalog down');}});
  state.get('message').value='/m';state.get('message').emit('input');
  assert.equal(state.get('slash-commands').hidden, false);
  state.get('message').value='/unknown';await state.get('composer').emit('submit');
  assert.match(state.get('messages').children.at(-1).textContent, /Unknown command/);
  state.get('message').value='/model';await state.get('composer').emit('submit');
  assert.equal(state.get('model-dialog').open, true);
  assert.equal(state.get('model-retry').hidden, false);
  assert.equal(state.get('model-status').textContent, 'Catalog down');
  assert.equal(state.requests.length, 0);
});

test('divider supports pointer, keyboard, saved ratios, and collapsed code', async t => {
  const state=await app(t);
  const divider=state.get('panel-divider');
  divider.emit('pointerdown',{button:0,pointerId:1});
  divider.emit('pointermove',{pointerId:1,clientY:200});
  assert.ok(Number(state.saved.get('logo.panel-ratio.v1')) < 0.4);
  divider.emit('pointerup');
  const before=state.saved.get('logo.panel-ratio.v1');
  divider.emit('pointermove',{pointerId:1,clientY:500});
  assert.equal(state.saved.get('logo.panel-ratio.v1'), before);
  divider.emit('keydown',{key:'ArrowDown'});
  assert.ok(Number(state.saved.get('logo.panel-ratio.v1')) > Number(before));
  divider.emit('keydown',{key:'Home'});
  assert.equal(divider.attributes['aria-valuenow'], divider.attributes['aria-valuemin']);
  state.get('collapse').emit('click');
  assert.equal(state.get('panels').classes.has('code-collapsed'), true);
  assert.equal(divider.attributes['aria-hidden'], 'true');
});

test('menu opens About and examples; example replacement is validated and never executed', async t => {
  const state=await app(t);
  state.get('about-open').emit('click');assert.equal(state.get('about-dialog').open, true);
  state.get('examples-open').emit('click');assert.equal(state.get('examples-dialog').open, true);
  await state.get('example-mona-lisa').emit('click');
  assert.equal(state.source(), 'fd 25');
  assert.equal(state.get('examples-dialog').open, false);
  assert.equal(state.workers.filter(worker=>worker.url.includes('draw.worker')).length, 0);
  assert.equal(state.requests.length, 0);
});

test('loading an example preserves edits made during the fetch', async t => {
  let resolve;
  const state=await app(t, undefined, {fetch:()=>new Promise(done=>{resolve=done;})});
  const loading=state.get('example-mona-lisa').emit('click');
  state.edit('fd 99');
  resolve({ok:true,text:async()=>'fd 25'});
  await loading;
  assert.equal(state.source(), 'fd 99');
  assert.match(state.get('examples-status').textContent, /preserved/);
});


test('saved model and split preferences are restored on startup', async t => {
  const model={id:'future/model:free',name:'Future model',maxTokens:3000};
  const state=await app(t, undefined, {saved:{'logo.model.v1':JSON.stringify(model),'logo.panel-ratio.v1':'0.35'}});
  assert.match(state.get('chat-footnote').textContent, /^Future model ·/);
  assert.equal(state.get('panels').style['--code-size'], '0.35fr');
  state.get('message').value='Explain Logo';await state.get('composer').emit('submit');
  assert.deepEqual(state.modelsUsed[0], {model:model.id,maxTokens:3000});
});

test('validation repairs keep using the chosen model without a fallback', async t => {
  let attempts=0;
  const state=await app(t, async()=>++attempts===1?logoReply('fd [10]'):logoReply('fd 30'));
  state.get('message').value='/model Claude';await state.get('composer').emit('submit');
  state.get('model-list').children[0].emit('click');
  state.get('message').value='Draw a line';await state.get('composer').emit('submit');
  assert.equal(state.modelsUsed.length, 2);
  assert.ok(state.modelsUsed.every(model=>model.model==='anthropic/claude-sonnet-5-5'));
  assert.equal(state.source(), 'fd 30');
});

test('Send becomes Stop, cancels a reply, preserves a new draft, and accepts another request', async t => {
  let resolve, calls=0;
  const state=await app(t, ()=>++calls===1?new Promise(done=>{resolve=done;}):Promise.resolve(logoReply('fd 40')));
  const original=state.source();
  state.get('message').value='Draw something';
  const pending=state.get('composer').emit('submit');
  await settled(()=>state.requests.length===1);
  assert.equal(state.get('send').type,'button');
  assert.equal(state.get('send').attributes['aria-label'],'Stop response generation');
  assert.equal(state.get('send').querySelector('path').attributes.d,'M5 5h10v10H5z');
  state.get('message').value='New draft';
  state.get('send').emit('click');
  await pending;
  assert.equal(state.source(),original);
  assert.equal(state.get('message').value,'New draft');
  assert.equal(state.get('send').type,'submit');
  assert.equal(state.get('send').attributes['aria-label'],'Send message');
  resolve(logoReply('fd 99'));await new Promise(done=>setImmediate(done));
  assert.equal(state.source(),original);
  await state.get('composer').emit('submit');
  assert.equal(state.source(),'fd 40');
});

test('Stop while connecting prevents a later authentication result starting a generation', async t => {
  let connected;
  const state=await app(t, undefined, {connectPuter:()=>new Promise(resolve=>{connected=resolve;})});
  state.get('message').value='Draw';
  const pending=state.get('composer').emit('submit');
  state.get('send').emit('click');
  await pending;
  connected();await Promise.resolve();
  assert.equal(state.requests.length,0);
  assert.equal(state.get('send').type,'submit');
});

test('model tabs default to Latest, search within each list, and reopen on Latest', async t => {
  const state=await app(t);
  state.get('message').value='/model';await state.get('composer').emit('submit');
  assert.equal(state.get('model-list').children.length,2);
  assert.equal(state.get('models-latest-tab').attributes['aria-selected'],'true');
  state.get('model-search').value='Euryale';state.get('model-search').emit('input');
  assert.equal(state.get('model-list').children.length,0);
  state.get('models-all-tab').emit('click');
  assert.equal(state.get('model-list').children.length,1);
  assert.equal(state.get('models-all-tab').attributes['aria-selected'],'true');
  state.get('models-all-tab').emit('keydown',{key:'ArrowLeft'});
  assert.equal(state.get('model-list').children.length,0);
  state.get('model-dialog').close();
  state.get('message').value='/model';await state.get('composer').emit('submit');
  assert.equal(state.get('model-list').children.length,2);
  assert.equal(state.requests.length,0);
});

test('Stop cancels automatic runtime repair without applying its late result or restarting repair', async t => {
  let resolve;
  const state=await app(t, ()=>new Promise(done=>{resolve=done;}));
  const original=state.source();
  await state.get('run').emit('click');
  state.drawing().emit(failure);
  await settled(()=>state.requests.length===1);
  assert.equal(state.get('run').disabled,true);
  state.get('send').emit('click');
  await settled(()=>state.get('send').type==='submit');
  assert.equal(state.get('run').disabled,false);
  resolve(logoReply('fd 99'));
  await new Promise(done=>setImmediate(done));
  assert.equal(state.source(),original);
  assert.equal(state.requests.length,1);
});
