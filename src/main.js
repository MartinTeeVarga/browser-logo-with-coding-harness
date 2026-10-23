import { primitiveNames } from './logo/runtime.js';
import { basePrompt, replaceCode, repairCode, RuntimeRepairBudget } from './harness.js';
import { connectPuter, generate, providerError, getRemainingAllowance, formatAllowance } from './puter.js';

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
const history = [];
const runtimeRepairBudget = new RuntimeRepairBudget();
let pendingRunFailure = null, repairingRun = false, activeRun = null, activeLine = null;
$('slow-mode').checked = stored('logo.slow.v1', 'false') === 'true';
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
$('slow-mode').addEventListener('change', () => {
  const enabled = $('slow-mode').checked;
  save('logo.slow.v1', String(enabled));
  if (enabled) setCollapsed(false); else clearExecutionLine();
  drawingWorker?.postMessage({type: 'slow', enabled});
});
const readEditor = () => ({ source: editor.getValue(), revision });
function commitSource(source, origin = 'ai') {
  editor.operation(() => editor.replaceRange(source, { line: 0, ch: 0 }, editor.posFromIndex(editor.getValue().length), origin));
}
function setChatBusy(value, isRuntimeRepair = false) {
  chatting = value;
  repairingRun = value && isRuntimeRepair;
  $('send').disabled = value;
  $('run').disabled = repairingRun;
  document.body.classList.toggle('is-busy', value);
  if (!value) $('chat-status').textContent = '';
}
function queueRunRepair(snapshot, diagnostic) {
  if (revision !== snapshot.revision || editor.getValue() !== snapshot.source) {
    bubble('The program failed, but you have edited the code since Run. Your changes are safe. Run the current code to check it.');
    return;
  }
  pendingRunFailure = { snapshot, diagnostic };
  void repairPendingRun();
}
async function repairPendingRun() {
  if (!pendingRunFailure || chatting || running) return;
  const { snapshot, diagnostic } = pendingRunFailure;
  pendingRunFailure = null;
  if (revision !== snapshot.revision || editor.getValue() !== snapshot.source) return;
  if (!runtimeRepairBudget.remaining) {
    bubble('Automatic repair stopped after three attempts. Your code is preserved; describe the problem in chat to continue.', 'assistant error');
    return;
  }
  // A worker callback is not a user gesture: never open a login popup here.
  if (!globalThis.puter?.auth?.isSignedIn?.()) {
    bubble('The program failed. Send a message in chat to connect Puter and repair the code.', 'assistant error');
    return;
  }
  setChatBusy(true, true);
  bubble(`The interpreter reported “${diagnostic.message}”${diagnostic.procedure ? ` in ${diagnostic.procedure}` : ''}. Repairing the code…`);
  try {
    const result = await repairCode({
      diagnostic, failedSnapshot: snapshot, history, prompt: basePrompt(names),
      readEditor, commit: source => commitSource(source, 'ai-repair'),
      generate, validate: validateInWorker,
      maxAttempts: runtimeRepairBudget.remaining,
      onAttempt: () => runtimeRepairBudget.use(),
      onStatus: message => { $('chat-status').textContent = message; }
    });
    history.push(
      { role: 'user', content: `Repair the interpreter error: ${JSON.stringify(diagnostic)}` },
      { role: 'assistant', content: result.source }
    );
    if (history.length > 12) history.splice(0, history.length - 12);
    status('Code repaired. Press Run to try it.');
    bubble('The code is repaired and validated. Press Run to try it.');
  } catch (error) {
    bubble(['validation', 'conflict', 'repair_limit'].includes(error.code) ? error.message : providerError(error), 'assistant error');
  } finally {
    setChatBusy(false);
    void refreshAllowance();
    void repairPendingRun();
  }
}
let allowanceRequest = 0;
async function refreshAllowance() {
  const request = ++allowanceRequest;
  try {
    const allowance = await getRemainingAllowance();
    if (request !== allowanceRequest) return;
    if (allowance) {
      $('chat-footnote').textContent = formatAllowance(allowance);
      $('chat-footnote').title = 'Remaining allowance for your whole Puter account, shared across apps. Updated after each chat request.';
    } else if (globalThis.puter?.auth?.isSignedIn?.()) {
      $('chat-footnote').textContent = 'Puter · allowance unavailable';
      $('chat-footnote').title = 'Puter did not return a remaining allowance. You can still use chat.';
    } else {
      $('chat-footnote').textContent = 'Your own Puter account. Your own AI allowance.';
      $('chat-footnote').title = '';
    }
  } catch {
    if (request !== allowanceRequest) return;
    $('chat-footnote').textContent = 'Puter · allowance unavailable';
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
  if (change.origin !== 'ai-repair') {
    runtimeRepairBudget.reset(); pendingRunFailure = null;
  }
});
function setCollapsed(collapsed) {
  $('code-panel').classList.toggle('collapsed', collapsed);
  $('editor-body').hidden = collapsed;
  $('collapse').setAttribute('aria-expanded', String(!collapsed));
  $('collapse').setAttribute('aria-label', collapsed ? 'Expand code' : 'Collapse code');
  save('logo.collapsed.v1', String(collapsed));
  if (!collapsed) requestAnimationFrame(() => editor.refresh());
}
setCollapsed(stored('logo.collapsed.v1', 'false') === 'true');
$('collapse').addEventListener('click', () => setCollapsed(!$('editor-body').hidden));
new ResizeObserver(() => editor.refresh()).observe($('code-panel'));

function validateInWorker(source) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./logo/validate.worker.js', import.meta.url), { type: 'module' });
    const finish = error => { clearTimeout(timeout); worker.terminate(); error ? reject(new Error(error)) : resolve(); };
    const timeout = setTimeout(() => finish('Logo validation took too long.'), 4000);
    worker.onmessage = ({ data }) => finish(data.valid ? null : data.error);
    worker.onerror = () => finish('The Logo validator could not start. Refresh the page and try again.');
    worker.postMessage({ source });
  });
}

function status(message, error = false) {
  $('run-status').textContent = message;
  $('run-status').classList.toggle('error', error);
}
function finishRun(message, error = false) {
  clearTimeout(watchdog);
  drawingWorker?.terminate(); drawingWorker = null; running = false;
  activeRun = null;
  $('run').querySelector('span').textContent = 'Run';
  $('run').setAttribute('aria-label', 'Run Logo code');
  $('program-input').hidden = true;
  status(message, error);
}
function armWatchdog(snapshot) {
  clearTimeout(watchdog);
  watchdog = setTimeout(() => {
    const message = 'Stopped after 15 seconds. Try a smaller drawing or fewer repetitions.';
    finishRun(message, true);
    queueRunRepair(snapshot, { message, phase: 'execution', procedure: null });
  }, 15000);
}
async function run() {
  if (running) { pendingRunFailure = null; finishRun('Stopped.'); return; }
  if (repairingRun) return;
  if (!globalThis.OffscreenCanvas) { status('This browser needs OffscreenCanvas support. Try a recent browser.', true); return; }
  const snapshot = readEditor();
  const source = snapshot.source;
  activeRun = snapshot;
  clearExecutionLine();
  if ($('slow-mode').checked) setCollapsed(false);
  running = true;
  $('run').querySelector('span').textContent = 'Stop';
  $('run').setAttribute('aria-label', 'Stop running Logo code');
  status('Drawing…');
  $('output').textContent = ''; $('output').hidden = true;
  drawingWorker = new Worker(new URL('./logo/draw.worker.js', import.meta.url), { type: 'module' });
  const worker = drawingWorker;
  armWatchdog(snapshot);
  worker.onmessage = ({ data }) => {
    if (worker !== drawingWorker) { data.drawing?.close(); data.cursor?.close(); return; }
    if (data.type === 'frame') {
      $('canvas-empty').hidden = true;
      for (const [id, bitmap] of [['canvas', data.drawing], ['turtle', data.cursor]]) {
        const context = $(id).getContext('2d');
        context.clearRect(0, 0, 1000, 1000); context.drawImage(bitmap, 0, 0); bitmap.close();
      }
    } else if (data.type === 'step') {
      if ($('slow-mode').checked) {
        showExecutionLine(data.line, snapshot);
        armWatchdog(snapshot);
      }
    } else if (data.type === 'output') {
      $('output').hidden = false; $('output').textContent += data.value; $('output').scrollTop = $('output').scrollHeight;
    } else if (data.type === 'clear-output') {
      $('output').textContent = ''; $('output').hidden = true;
    } else if (data.type === 'input') {
      clearTimeout(watchdog); status('Waiting for input…');
      $('program-prompt').textContent = data.prompt || 'Input';
      $('program-input').hidden = false; $('program-answer').focus();
    } else if (data.type === 'done') {
      runtimeRepairBudget.reset(); pendingRunFailure = null; finishRun('');
    } else if (data.type === 'error') {
      finishRun(data.procedure ? `${data.procedure}: ${data.message}` : data.message, true);
      if (data.repairable) queueRunRepair(snapshot, { message: data.message, procedure: data.procedure, code: data.code, phase: data.phase, line: data.line });
    }
  };
  worker.onerror = () => finishRun('The drawing worker could not start. Refresh the page and try again.', true);
  worker.postMessage({ type: 'run', source, slow: $('slow-mode').checked });
}
$('run').addEventListener('click', run);
$('program-input').addEventListener('submit', event => {
  event.preventDefault();
  drawingWorker?.postMessage({ type: 'input', value: $('program-answer').value });
  $('program-answer').value = ''; $('program-input').hidden = true;
  if (running && activeRun) { status('Drawing…'); armWatchdog(activeRun); }
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
$('message').addEventListener('input', resizeComposer);
$('message').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault(); $('composer').requestSubmit();
  }
});
$('composer').addEventListener('submit', async event => {
  event.preventDefault();
  const request = $('message').value.trim();
  if (!request || chatting) return;
  setChatBusy(true);
  bubble(request, 'user');
  $('message').value = ''; resizeComposer();
  try {
    $('chat-status').textContent = 'Connecting to your Puter account…';
    // Do not await anything before this popup-triggering call.
    const connected = connectPuter();
    await connected;
    $('connection-dot').classList.add('connected');
    $('connection-dot').title = 'Using your Puter account';
    $('connection-dot').setAttribute('aria-label', 'Puter connected');
    $('chat-footnote').textContent = 'Connected to Puter · using your AI allowance';
    void refreshAllowance();
    const result = await replaceCode({
      request, history, prompt: basePrompt(names),
      readEditor, commit: commitSource,
      generate, validate: validateInWorker,
      onStatus: message => { $('chat-status').textContent = message; }
    });
    history.push({ role: 'user', content: request }, { role: 'assistant', content: result.source });
    if (history.length > 12) history.splice(0, history.length - 12);
    bubble('The code is ready. Press Run to see it.');
  } catch (error) {
    bubble(error.code === 'validation' || error.code === 'conflict' ? error.message : providerError(error), 'assistant error');
    // Keep failed requests handy; the next Enter retries explicitly.
    if (!$('message').value) { $('message').value = request; resizeComposer(); }
  } finally {
    setChatBusy(false); $('message').focus();
    // Includes validation repairs and failed requests that may have consumed
    // model usage. Usage failures never turn a successful edit into an error.
    void refreshAllowance();
    void repairPendingRun();
  }
});

// Rendering starts only through Run. Restoring a source draft never executes it.
window.addEventListener('pagehide', () => { drawingWorker?.terminate(); clearTimeout(watchdog); });
