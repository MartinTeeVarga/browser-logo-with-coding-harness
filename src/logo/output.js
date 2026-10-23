import { OutputBudget } from './resources.js';

// Keep stream accounting separate from delivery. Small writes share a message;
// clearing flushes earlier text first, preserving Logo's output order.
export function createProgramOutput(send) {
  const budget = new OutputBudget();
  let pending = '';
  let timer = null;

  function flush() {
    clearTimeout(timer);
    timer = null;
    if (!pending) return;
    send({type: 'output', value: pending});
    pending = '';
  }

  return {
    write(...parts) {
      const value = parts.join('');
      budget.accept(value);
      pending += value;
      if (pending.length >= 2048) flush();
      else if (timer === null) timer = setTimeout(flush, 16);
    },
    clear() {
      budget.accept();
      flush();
      send({type: 'clear-output'});
    },
    flush,
    dispose() { clearTimeout(timer); timer = null; }
  };
}
