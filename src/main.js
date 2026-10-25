import { stoppedError, throwIfAborted, waitForResult } from './cancellation.js';
import { OutputBudget } from './logo/resources.js';
import { primitiveNames } from './logo/runtime.js';
import { basePrompt, replaceCode, repairCode, RuntimeRepairBudget } from './harness.js';
import { setupPanelDivider } from './workspace.js';
import { setupModelPicker } from './model-picker.js';
import { connectPuter, generate, providerError, getRemainingAllowance, formatAllowance, loadModels, MODEL } from './puter.js';

const $ = id => document.getElementById(id);
const STARTER = `; A little flower, ready to bloom.

clearscreen
setpencolor [40 52 30]
setpensize 1.5

to petal :size
  repeat 2 [
    repeat 60 [fd :size rt 1]
    rt 120
  ]
end

repeat 12 [
  petal 2.3
  rt 30
]

hideturtle`;
const names = primitiveNames();
const builtins = new Set(names.map(name => name.toLowerCase()));
CodeMirror.defineMode('logo', () => ({
  startState: () => ({ definition: false, bars: false }),
  token(stream, state) {
    if (state.bars) {
      while (!stream.eol()) { const c = stream.next(); if (c === '\\') stream.next(); else if (c === '|') { state.bars = false; break; } }
      return 'string';
    }
    if (stream.eatSpace()) return null;
    if (stream.peek() === ';') { stream.skipToEnd(); return 'comment'; }
    if (stream.eat('|')) { state.bars = true; return 'string'; }
    if (stream.eat('"')) {
      let bars = false;
      while (!stream.eol()) {
        const c = stream.peek();
        if (!bars && /[\s\[\](){}]/.test(c)) break;
        stream.next();
        if (c === '\\') stream.next();
        else if (c === '|') bars = !bars;
      }
      state.bars = bars;
      return 'string';
    }
    if (stream.match(/^:[^\s\[\](){}+*/=<>]*/)) return 'variable-2';
    if (stream.match(/^-?(?:\d*\.)?\d+(?:e[-+]?\d+)?/i)) return 'number';
    if (stream.match(/^[\[\](){}]/)) return 'bracket';
    if (stream.match(/^[+*/=<>^-]+/)) return 'operator';
    if (stream.match(/^[^\s\[\](){}+*/=<>]+/)) {
      const word = stream.current().toLowerCase();
      if (state.definition) { state.definition = false; return 'def'; }
      if (word === 'to' || word === '.macro') { state.definition = true; return 'keyword'; }
      if (['end', 'repeat', 'if', 'ifelse', 'output', 'op', 'stop', 'while', 'for', 'make', 'localmake', 'foreach'].includes(word)) return 'keyword';
      if (builtins.has(word)) return 'builtin';
      return null;
    }
    stream.next(); return null;
  }
}));
function stored(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
function save(key, value) { try { localStorage.setItem(key, value); } catch { /* Storage may be disabled. */ } }
$('code').value = stored('logo.source.v1', STARTER);
const editor = CodeMirror.fromTextArea($('code'), {
  mode: 'logo', lineNumbers: true, lineWrapping: true, indentUnit: 2, tabSize: 2,
  viewportMargin: 20,
  extraKeys: { Tab: cm => cm.replaceSelection('  ', 'end', '+input'), 'Cmd-Enter': run, 'Ctrl-Enter': run }
});
editor.getInputField().setAttribute('aria-label', 'Logo code');
editor.getWrapperElement().setAttribute('role', 'group');
editor.getWrapperElement().setAttribute('aria-label', 'Editable Logo code');
let revision = 0, drawingWorker = null, running = false, watchdog, chatting = false;
let chatController = null;
const history = [];
const runtimeRepairBudget = new RuntimeRepairBudget();
let pendingRunFailure = null, repairingRun = false, activeRun = null, activeLine = null;
const defaultModel = {id: MODEL, name: 'GPT-6 Luna', maxTokens: 12000};
let selectedModel = defaultModel;
try {
  const saved = JSON.parse(stored('logo.model.v1', 'null'));
  if (saved && typeof saved.id === 'string' && saved.id.length > 0 && saved.id.length <= 512) {
    selectedModel = {id:saved.id, name:typeof saved.name === 'string' ? saved.name.slice(0, 200) : saved.id,
      maxTokens:Number.isSafeInteger(saved.maxTokens) && saved.maxTokens > 0 ? saved.maxTokens : 12000};
  }
} catch { /* Ignore an invalid saved preference. */ }
let allowanceText = 'Your own Puter account. Your own AI allowance.';
function renderAccountStatus(text = allowanceText) {
  allowanceText = text;
  $('chat-footnote').textContent = `${selectedModel.name} · ${text.replace(/^Puter · /, '')}`;
}
function modelGenerator(signal) {
  const model = selectedModel;
  return messages => generate(messages, model.id, model.maxTokens, signal);
}
renderAccountStatus();

const savedSpeed = stored('logo.speed.v1', stored('logo.slow.v1', 'false') === 'true' ? '0' : '2');
$('speed').value = ['0', '1', '2'].includes(savedSpeed) ? savedSpeed : '2';
const drawingSpeed = () => ['slow', 'fast', 'instant'][Number($('speed').value)];
const isAnimated = () => drawingSpeed() !== 'instant';
function describeSpeed() { $('speed').setAttribute('aria-valuetext', ['Slow', 'Fast', 'Instant'][Number($('speed').value)]); }
describeSpeed();
function clearExecutionLine() {
  if (activeLine !== null) editor.removeLineClass(activeLine, 'background', 'logo-current-line');
  activeLine = null;
}
function showExecutionLine(line, snapshot) {
  if (revision !== snapshot.revision || !Number.isInteger(line) || line < 1 || line > editor.lineCount()) return;
  clearExecutionLine();
  activeLine = line - 1;
  editor.addLineClass(activeLine, 'background', 'logo-current-line');
  editor.scrollIntoView({line: activeLine, ch: 0}, 70);
}
$('speed').addEventListener('input', () => {
  save('logo.speed.v1', $('speed').value);
  describeSpeed();
  if (isAnimated()) setCollapsed(false); else clearExecutionLine();
  drawingWorker?.postMessage({type: 'speed', speed: drawingSpeed()});
});
const readEditor = () => ({ source: editor.getValue(), revision });
function commitSource(source, origin = 'ai') {
  editor.operation(() => editor.replaceRange(source, { line: 0, ch: 0 }, editor.posFromIndex(editor.getValue().length), origin));
}
setupPanelDivider({panels:$('panels'), divider:$('panel-divider'), editor, stored, save});
const modelPicker = setupModelPicker({
  latestTab:$('models-latest-tab'), allTab:$('models-all-tab'),
  dialog:$('model-dialog'), search:$('model-search'), list:$('model-list'), status:$('model-status'), retry:$('model-retry'),
  loadModels, currentModel:() => selectedModel,
  selectModel:model => {
    selectedModel = model;
    save('logo.model.v1', JSON.stringify({id:model.id, name:model.name, maxTokens:model.maxTokens}));
    renderAccountStatus();
    updateRepairLink();
  }
});
for (const name of ['model', 'about', 'examples']) {
  document.querySelector(`[data-close="${name}-dialog"]`).addEventListener('click', () => $(`${name}-dialog`).close());
}
$('about-open').addEventListener('click', () => $('about-dialog').showModal());
$('examples-open').addEventListener('click', () => $('examples-dialog').showModal());
const examples = [
  {button:'example-mona-lisa', name:'Mona Lisa', file:'mona-lisa.logo'},
  {button:'example-pelican-sol', name:'Pelican on a bicycle (Sol 6.1)', file:'pelican-bicycle-sol-6.1.logo'},
  {button:'example-pelican-luna', name:'Pelican on a bicycle (Luna 6)', file:'pelican-bicycle-luna-6.logo'},
  {button:'example-enterprise', name:'USS Enterprise NCC-1701', file:'enterprise.logo'}
];
async function loadExample(example) {
  const snapshot = readEditor();
  for (const item of examples) $(item.button).disabled = true;
  $('examples-status').textContent = `Loading ${example.name}…`;
  try {
    const response = await fetch(`./examples/${example.file}`);
    if (!response.ok) throw new Error('Could not load the example. Try again.');
    const source = await response.text();
    await validateInWorker(source);
    if (revision !== snapshot.revision) throw new Error('You edited the code while the example was loading. Your changes are preserved. Choose the example again to replace them.');
    commitSource(source, 'example');
    setCollapsed(false);
    $('examples-dialog').close();
    status(`${example.name} loaded. Press Run to draw it.`);
    $('examples-status').textContent = '';
  } catch (error) {
    $('examples-status').textContent = error.message;
  } finally {
    for (const item of examples) $(item.button).disabled = false;
  }
}
for (const example of examples) {
  $(example.button).addEventListener('click', () => loadExample(example));
}
$('command-model').addEventListener('click', () => {
  if (chatting) return;
  $('message').value = ''; resizeComposer(); updateCommands();
  void modelPicker.open();
});

function setChatBusy(value, isRuntimeRepair = false) {
  chatting = value;
  if (value && $('model-dialog').open) $('model-dialog').close();
  repairingRun = value && isRuntimeRepair;
  if (value) chatController = new AbortController();
  else chatController = null;
  $('send').disabled = false;
  $('send').type = value ? 'button' : 'submit';
  $('send').setAttribute('aria-label', value ? 'Stop response generation' : 'Send message');
  $('send').title = value ? 'Stop response generation' : 'Send message';
  const icon = $('send').querySelector('path');
  icon.setAttribute('d', value ? 'M5 5h10v10H5z' : 'M10 15V5m-4 4 4-4 4 4');
  icon.setAttribute('fill', value ? 'currentColor' : 'none');
  icon.setAttribute('stroke', value ? 'none' : 'currentColor');
  $('run').disabled = repairingRun;
  $('repair-fix').disabled = value;
  document.body.classList.toggle('is-busy', value);
  if (!value) $('chat-status').textContent = '';
}
$('send').addEventListener('click', event => {
  if (!chatting) return;
  event.preventDefault();
  dismissRunRepair();
  chatController.abort(stoppedError());
});
function dismissRunRepair() {
  pendingRunFailure = null;
  $('repair-fix').hidden = true;
}
function updateRepairLink() {
  $('repair-fix').title = `Fix code using ${selectedModel.name}`;
  $('repair-fix').setAttribute('aria-label', `Fix code using ${selectedModel.name}`);
}
function offerRunRepair(snapshot, diagnostic) {
  if (revision !== snapshot.revision || editor.getValue() !== snapshot.source) {
    bubble('The program failed, but you have edited the code since Run. Your changes are safe. Run the current code to check it.');
    return;
  }
  if (!runtimeRepairBudget.remaining) {
    bubble('Repair stopped after three attempts. Your code is preserved; describe the problem in chat to continue.', 'assistant error');
    return;
  }
  pendingRunFailure = { snapshot, diagnostic };
  updateRepairLink();
  $('repair-fix').hidden = false;
  $('repair-fix').disabled = chatting;
}
async function repairAfterConsent() {
  if (!pendingRunFailure || chatting || running) return;
  const { snapshot, diagnostic } = pendingRunFailure;
  dismissRunRepair();
  if (revision !== snapshot.revision || editor.getValue() !== snapshot.source) return;
  if (!runtimeRepairBudget.remaining) {
    bubble('Repair stopped after three attempts. Your code is preserved; describe the problem in chat to continue.', 'assistant error');
    return;
  }
  setChatBusy(true, true);
  const signal = chatController.signal;
  const generateRepair = modelGenerator(signal);
  bubble(`The interpreter reported “${diagnostic.message}”${diagnostic.procedure ? ` in ${diagnostic.procedure}` : ''}. Repairing the code…`);
  try {
    // Approval is a user gesture, so authentication can open here if needed.
    await waitForResult(connectPuter(), signal);
    throwIfAborted(signal);
    const result = await repairCode({
      diagnostic, failedSnapshot: snapshot, history, prompt: basePrompt(names),
      readEditor, commit: source => commitSource(source, 'ai-repair'),
      signal, generate:generateRepair, validate:source => validateInWorker(source, signal),
      maxAttempts: runtimeRepairBudget.remaining,
      onAttempt: () => runtimeRepairBudget.use(),
      onStatus: message => { $('chat-status').textContent = message; }
    });
    history.push(
      { role: 'user', content: `Repair the interpreter error: ${JSON.stringify(diagnostic)}` },
      { role: 'assistant', content: result.response }
    );
    if (history.length > 12) history.splice(0, history.length - 12);
    status('Code repaired. Press Run to try it.');
    if (result.reply) bubble(result.reply);
    bubble('The code is repaired and validated. Press Run to try it.');
  } catch (error) {
    if (error.name === 'AbortError') bubble(error.message);
    else bubble(['validation', 'conflict', 'repair_limit'].includes(error.code) ? error.message : providerError(error), 'assistant error');
  } finally {
    setChatBusy(false);
    void refreshAllowance();
  }
}
$('repair-fix').addEventListener('click', repairAfterConsent);
dismissRunRepair();
let allowanceRequest = 0;
async function refreshAllowance() {
  const request = ++allowanceRequest;
  try {
    const allowance = await getRemainingAllowance();
    if (request !== allowanceRequest) return;
    if (allowance) {
      renderAccountStatus(formatAllowance(allowance));
      $('chat-footnote').title = 'Remaining allowance for your whole Puter account, shared across apps. Updated after each chat request.';
    } else if (globalThis.puter?.auth?.isSignedIn?.()) {
      renderAccountStatus('Puter · allowance unavailable');
      $('chat-footnote').title = 'Puter did not return a remaining allowance. You can still use chat.';
    } else {
      renderAccountStatus('Your own Puter account. Your own AI allowance.');
      $('chat-footnote').title = '';
    }
  } catch {
    if (request !== allowanceRequest) return;
    renderAccountStatus('Puter · allowance unavailable');
    $('chat-footnote').title = 'Could not read your remaining allowance. You can still use chat.';
  }
}
// Read a remembered session without interrupting the page with authentication.
if (globalThis.puter?.auth) void refreshAllowance();
else document.querySelector('script[src="https://js.puter.com/v2/"]')?.addEventListener('load', () => { void refreshAllowance(); }, { once: true });
window.addEventListener('focus', () => { void refreshAllowance(); });
editor.on('change', (_, change) => {
  clearExecutionLine();
  revision++; save('logo.source.v1', editor.getValue());
  dismissRunRepair();
  if (change.origin !== 'ai-repair') {
    runtimeRepairBudget.reset();
  }
});
function setCollapsed(collapsed) {
  $('code-panel').classList.toggle('collapsed', collapsed);
  $('panels').classList.toggle('code-collapsed', collapsed);
  $('panel-divider').setAttribute('aria-hidden', String(collapsed));
  $('editor-body').hidden = collapsed;
  $('collapse').setAttribute('aria-expanded', String(!collapsed));
  $('collapse').setAttribute('aria-label', collapsed ? 'Expand code' : 'Collapse code');
  save('logo.collapsed.v1', String(collapsed));
  if (!collapsed) requestAnimationFrame(() => editor.refresh());
}
setCollapsed(stored('logo.collapsed.v1', 'false') === 'true');
$('collapse').addEventListener('click', () => setCollapsed(!$('editor-body').hidden));
new ResizeObserver(() => editor.refresh()).observe($('code-panel'));

function validateInWorker(source, signal = null) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./logo/validate.worker.js', import.meta.url), { type: 'module' });
    const finish = (message, code) => {
      clearTimeout(timeout);
      worker.terminate();
      signal?.removeEventListener('abort', cancel);
      if (message) {
        const error = new Error(message);
        error.code = code;
        reject(error);
      } else resolve();
    };
    const cancel = () => finish('Stopped. Your code is preserved.', 'cancelled');
    signal?.addEventListener('abort', cancel, {once:true});
    const timeout = setTimeout(() => finish('Logo validation took too long.'), 4000);
    worker.onmessage = ({ data }) => finish(data.valid ? null : data.error, data.code);
    worker.onerror = () => finish('The Logo validator could not start. Refresh the page and try again.');
    worker.postMessage({ source });
  });
}

function status(message, error = false) {
  $('run-message').textContent = message;
  $('run-status').hidden = !message;
  $('run-status').classList.toggle('error', error);
}
function finishRun(message, error = false) {
  clearTimeout(watchdog);
  drawingWorker?.terminate(); drawingWorker = null; running = false;
  activeRun = null;
  $('run').querySelector('span').textContent = 'Run';
  $('run').querySelector('path').setAttribute('d', 'M2 1.5 11 7l-9 5.5z');
  $('run').setAttribute('aria-label', 'Run Logo code');
  $('program-input').hidden = true;
  status(message, error);
}
function armWatchdog() {
  clearTimeout(watchdog);
  watchdog = setTimeout(() => {
    const message = 'Stopped after 15 seconds. Try a smaller drawing or fewer repetitions.';
    finishRun(message, true);
  }, 15000);
}
async function run() {
  dismissRunRepair();
  if (running) { finishRun('Stopped.'); return; }
  if (repairingRun) return;
  if (!globalThis.OffscreenCanvas) { status('This browser needs OffscreenCanvas support. Try a recent browser.', true); return; }
  const snapshot = readEditor();
  const source = snapshot.source;
  activeRun = snapshot;
  clearExecutionLine();
  if (isAnimated()) setCollapsed(false);
  running = true;
  $('run').querySelector('span').textContent = 'Stop';
  $('run').querySelector('path').setAttribute('d', 'M2 2h10v10H2z');
  $('run').setAttribute('aria-label', 'Stop running Logo code');
  status('Drawing…');
  $('output').textContent = ''; $('output').hidden = true;
  drawingWorker = new Worker(new URL('./logo/draw.worker.js', import.meta.url), { type: 'module' });
  const worker = drawingWorker;
  const outputBudget = new OutputBudget();
  armWatchdog();
  worker.onmessage = ({ data }) => {
    if (worker !== drawingWorker) { data.drawing?.close(); data.cursor?.close(); return; }
    if (data.type === 'frame') {
      $('canvas-empty').hidden = true;
      for (const [id, bitmap] of [['canvas', data.drawing], ['turtle', data.cursor]]) {
        const context = $(id).getContext('2d');
        context.clearRect(0, 0, 1000, 1000); context.drawImage(bitmap, 0, 0); bitmap.close();
      }
    } else if (data.type === 'step') {
      if (isAnimated()) {
        showExecutionLine(data.line, snapshot);
        armWatchdog();
      }
    } else if (data.type === 'output' || data.type === 'clear-output') {
      try {
        outputBudget.accept(data.type === 'output' ? data.value : '');
      } catch (error) {
        finishRun(error.message, true);
        return;
      }
      if (data.type === 'clear-output') {
        $('output').textContent = '';
        $('output').hidden = true;
      } else {
        $('output').hidden = false;
        $('output').textContent += data.value;
        $('output').scrollTop = $('output').scrollHeight;
      }
    } else if (data.type === 'input') {
      clearTimeout(watchdog); status('Waiting for input…');
      $('program-prompt').textContent = data.prompt || 'Input';
      $('program-input').hidden = false; $('program-answer').focus();
    } else if (data.type === 'done') {
      runtimeRepairBudget.reset(); finishRun('');
    } else if (data.type === 'error') {
      finishRun(data.procedure ? `${data.procedure}: ${data.message}` : data.message, true);
      if (data.repairable && data.code !== 'RESOURCE_LIMIT') offerRunRepair(snapshot, { message: data.message, procedure: data.procedure, code: data.code, phase: data.phase, line: data.line });
    }
  };
  worker.onerror = () => finishRun('The drawing worker could not start. Refresh the page and try again.', true);
  worker.postMessage({ type: 'run', source, speed: drawingSpeed() });
}
$('run').addEventListener('click', run);
$('program-input').addEventListener('submit', event => {
  event.preventDefault();
  drawingWorker?.postMessage({ type: 'input', value: $('program-answer').value });
  $('program-answer').value = ''; $('program-input').hidden = true;
  if (running && activeRun) { status('Drawing…'); armWatchdog(); }
});
$('paper').addEventListener('pointermove', event => {
  if (!drawingWorker) return;
  const rect = $('paper').getBoundingClientRect();
  drawingWorker.postMessage({ type: 'pointer', x: (event.clientX - rect.left) / rect.width * 1000 - 500, y: 500 - (event.clientY - rect.top) / rect.height * 1000, buttons: event.buttons });
});

function bubble(text, type = 'assistant') {
  $('welcome')?.remove();
  const node = document.createElement('p'); node.className = `bubble ${type}`; node.textContent = text;
  $('messages').append(node); $('messages').scrollTop = $('messages').scrollHeight;
}
function resizeComposer() {
  $('message').style.height = 'auto';
  $('message').style.height = Math.min($('message').scrollHeight, 120) + 'px';
}
function updateCommands() {
  const value = $('message').value.trim().toLowerCase();
  $('slash-commands').hidden = !value.startsWith('/') || !'/model'.startsWith(value);
}
$('message').addEventListener('input', () => {resizeComposer(); updateCommands();});
$('message').addEventListener('keydown', event => {
  if (event.key === 'Escape') $('slash-commands').hidden = true;
  if (event.key === 'Tab' && !$('slash-commands').hidden) {
    event.preventDefault(); $('message').value = '/model'; updateCommands();
    return;
  }
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (!chatting) $('composer').requestSubmit();
  }
});
$('composer').addEventListener('submit', async event => {
  event.preventDefault();
  const request = $('message').value.trim();
  if (!request || chatting) return;
  if (request.startsWith('/')) {
    $('message').value = ''; resizeComposer(); updateCommands();
    const [command, ...query] = request.split(/\s+/);
    if (command.toLowerCase() === '/model') await modelPicker.open(query.join(' '));
    else bubble('Unknown command. Use /model to choose a model.', 'assistant error');
    return;
  }
  $('slash-commands').hidden = true;
  setChatBusy(true);
  const signal = chatController.signal;
  bubble(request, 'user');
  $('message').value = ''; resizeComposer();
  try {
    $('chat-status').textContent = 'Connecting to your Puter account…';
    // Do not await anything before this popup-triggering call.
    const connected = connectPuter();
    await waitForResult(connected, signal);
    throwIfAborted(signal);
    $('connection-dot').classList.add('connected');
    $('connection-dot').title = 'Using your Puter account';
    $('connection-dot').setAttribute('aria-label', 'Puter connected');
    renderAccountStatus('Connected to Puter · using your AI allowance');
    void refreshAllowance();
    const result = await replaceCode({
      request, history, prompt: basePrompt(names),
      readEditor, commit: commitSource,
      signal, generate:modelGenerator(signal), validate:source => validateInWorker(source, signal),
      onStatus: message => { $('chat-status').textContent = message; }
    });
    history.push({ role: 'user', content: request }, { role: 'assistant', content: result.response });
    if (history.length > 12) history.splice(0, history.length - 12);
    if (result.reply) bubble(result.reply);
    if (result.source !== null) bubble('The code is ready. Press Run to see it.');
  } catch (error) {
    if (error.name === 'AbortError') bubble(error.message);
    else bubble(error.code === 'validation' || error.code === 'conflict' ? error.message : providerError(error), 'assistant error');
    // Keep failed requests handy; the next Enter retries explicitly.
    if (error.name !== 'AbortError' && !$('message').value) { $('message').value = request; resizeComposer(); }
  } finally {
    setChatBusy(false); $('message').focus();
    // Includes validation repairs and failed requests that may have consumed
    // model usage. Usage failures never turn a successful edit into an error.
    void refreshAllowance();
  }
});

// Rendering starts only through Run. Restoring a source draft never executes it.
window.addEventListener('pagehide', () => { chatController?.abort(stoppedError()); drawingWorker?.terminate(); clearTimeout(watchdog); });
