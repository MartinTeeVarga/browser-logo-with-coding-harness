import { createInterpreter, validateLogo } from './runtime.js';
import './vendor/turtle.js';
import { createProgramOutput } from './output.js';
import { createSlowExecution } from './slow.js';

// Workers have no animation-frame API on some browsers.
globalThis.requestAnimationFrame ||= callback => setTimeout(callback, 32);
let canvas, turtleCanvas, turtle, logo, pendingInput, painting = false;
let lastPointer = { x: 0, y: 0, buttons: 0 };
let speed = 'instant';
const animated = () => speed !== 'instant';
function setSpeed(value) {
  speed = ['slow', 'fast', 'instant'].includes(value) ? value : 'instant';
  if (turtle) turtle.showExecutionCursor = animated();
}

async function paint() {
  if (!canvas || painting) return;
  painting = true;
  try {
    turtle?.render();
    const [drawing, cursor] = await Promise.all([createImageBitmap(canvas), createImageBitmap(turtleCanvas)]);
    self.postMessage({ type: 'frame', drawing, cursor }, [drawing, cursor]);
  } finally { painting = false; }
}

self.onmessage = async ({ data }) => {
  if (data.type === 'input') { pendingInput?.(data.value); pendingInput = null; return; }
  if (data.type === 'pointer') { lastPointer = data; return; }
  if (data.type === 'speed') { setSpeed(data.speed); return; }
  if (data.type !== 'run') return;
  let timer, output;
  let phase = 'validation';
  try {
    setSpeed(data.speed ?? (data.slow ? 'slow' : 'instant'));
    validateLogo(data.source);
    phase = 'setup';
    canvas = new OffscreenCanvas(1000, 1000);
    turtleCanvas = new OffscreenCanvas(1000, 1000);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    // Browser-independent flood fill, operating on worker-owned pixels.
    context.floodFill = (x, y, color = context.fillStyle) => {
      x = Math.round(x); y = Math.round(y);
      const { width: w, height: h } = canvas;
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const image = context.getImageData(0, 0, w, h), pixels = image.data;
      const sample = new OffscreenCanvas(1, 1).getContext('2d');
      sample.fillStyle = color; sample.fillRect(0, 0, 1, 1);
      const replacement = sample.getImageData(0, 0, 1, 1).data;
      const start = (y * w + x) * 4, target = pixels.slice(start, start + 4);
      if (target.every((v, i) => v === replacement[i])) return;
      const stack = [y * w + x];
      while (stack.length) {
        const point = stack.pop(), p = point * 4;
        if (!target.every((v, i) => pixels[p + i] === v)) continue;
        pixels.set(replacement, p);
        if (point % w > 0) stack.push(point - 1);
        if (point % w < w - 1) stack.push(point + 1);
        if (point >= w) stack.push(point - w);
        if (point < w * (h - 1)) stack.push(point + w);
      }
      context.putImageData(image, 0, 0);
    };
    turtle = new self.CanvasTurtle(context, turtleCanvas.getContext('2d'), 1000, 1000);
    turtle.showExecutionCursor = animated();
    turtle.color = '#667d50';
    turtle.penwidth = 1.6;
    turtle.clear();
    Object.defineProperties(turtle, {
      mousepos: { get: () => [lastPointer.x, lastPointer.y] },
      clickpos: { get: () => [lastPointer.x, lastPointer.y] },
      button: { get: () => lastPointer.buttons }
    });
    output = createProgramOutput(message => self.postMessage(message));
    const stream = {
      write: output.write,
      clear: output.clear,
      read(prompt = '') {
        output.flush();
        self.postMessage({ type: 'input', prompt });
        return new Promise(resolve => { pendingInput = resolve; });
      },
      font: 'monospace', color: '#333a30', size: 13
    };
    logo = createInterpreter(turtle, stream);
    const pacing = createSlowExecution({
      turtle, enabled: animated, speed: () => speed, frame: paint,
      wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
      step: info => self.postMessage({type: 'step', ...info})
    });
    logo.onInstruction = pacing.onInstruction;
    logo.primitiveExecutor = pacing.primitiveExecutor;
    timer = setInterval(paint, 50);
    phase = 'execution';
    await logo.run(data.source);
    output.flush();
    phase = 'rendering';
    turtle.showExecutionCursor = false;
    await new Promise(resolve => setTimeout(resolve, 40));
    while (painting) await new Promise(resolve => setTimeout(resolve, 5));
    clearInterval(timer);
    await paint();
    self.postMessage({ type: 'done' });
  } catch (error) {
    clearInterval(timer);
    output?.flush();
    self.postMessage({
      type: 'error', message: error.message || String(error), phase,
      repairable: error.code !== 'RESOURCE_LIMIT' && (phase === 'validation' || phase === 'execution'),
      procedure: error.proc || null,
      code: error.code ?? null,
      line: typeof error.line === 'number' && error.line > 0 ? error.line : logo?.currentLine || null
    });
  } finally {
    output?.dispose();
  }
};
