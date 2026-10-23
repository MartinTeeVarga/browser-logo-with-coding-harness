// Slow execution changes presentation and pacing; primitive calls still go
// through the interpreter and use the same language semantics.
export function createSlowExecution({ turtle, enabled, speed = () => 'slow', wait, frame, step }) {
  const numeric = value => (typeof value === 'number' || typeof value === 'string' && /^-?([0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)$/.test(value)) && Number.isFinite(Number(value)) ? Number(value) : null;
  const forward = new Set(['FORWARD', 'FD', 'BACK', 'BK']);
  const turns = new Set(['RIGHT', 'RT', 'LEFT', 'LT']);
  const positions = new Set(['SETPOS', 'SETXY', 'SETX', 'SETY']);
  const appearance = new Set(['SETPENCOLOR', 'SETPC', 'SETCOLOR', 'SETBACKGROUND', 'SETBG', 'SETSC', 'SETSCREENCOLOR', 'PENDOWN', 'PD', 'PENUP', 'PU', 'SETPENSIZE', 'SETWIDTH', 'SETPW', 'SHOWTURTLE', 'ST', 'HIDETURTLE', 'HT', 'SETSHAPE']);
  const delay = ms => wait(ms / (speed() === 'fast' ? 10 : 1));
  async function tick() { await frame(); await delay(20); }
  return {
    async onInstruction(info) {
      if (!enabled()) return;
      step(info);
      await delay(90);
    },
    async primitiveExecutor(name, args, invoke) {
      if (!enabled()) return invoke();
      const number = numeric(args[0]);
      if ((forward.has(name) || turns.has(name)) && number !== null) {
        const pieces = Math.min(120, Math.max(1, Math.ceil(Math.abs(number) / (forward.has(name) ? 8 : 5))));
        let consumed = 0;
        for (let i = 0; i < pieces; ++i) {
          const amount = !enabled() || i === pieces - 1 ? number - consumed : number / pieces;
          await invoke([amount]); consumed += amount;
          if (enabled()) await tick();
          else break;
        }
        return;
      }
      if (positions.has(name)) {
        const start = turtle.position.slice();
        const input = name === 'SETPOS' ? args[0] : name === 'SETXY' ? args : name === 'SETX' ? [args[0], start[1]] : [start[0], args[0]];
        if (!Array.isArray(input) || input.length !== 2) return invoke();
        const end = input.map(numeric);
        if (end.some(value => value === null)) return invoke();
        // Leave out-of-bounds wrapping/fence paths to the original operation.
        if (Math.abs(end[0]) > turtle.width / 2 || Math.abs(end[1]) > turtle.height / 2) return invoke();
        const pieces = Math.min(120, Math.max(1, Math.ceil(Math.hypot(end[0] - start[0], end[1] - start[1]) / 8)));
        for (let i = 1; i <= pieces; ++i) {
          if (!enabled()) { await invoke(); break; }
          const fraction = i / pieces;
          const point = start.map((value, axis) => value + (end[axis] - value) * fraction);
          await invoke(name === 'SETPOS' ? [point] : name === 'SETXY' ? point : [point[name === 'SETX' ? 0 : 1]]);
          await tick();
        }
        return;
      }
      if (['SETHEADING', 'SETH'].includes(name) && number !== null) {
        const start = turtle.heading, difference = ((number - start) % 360 + 540) % 360 - 180;
        const pieces = Math.max(1, Math.ceil(Math.abs(difference) / 5));
        for (let i = 1; i <= pieces; ++i) {
          await invoke([!enabled() || i === pieces ? number : start + difference * i / pieces]);
          if (enabled()) await tick(); else break;
        }
        return;
      }
      const result = await invoke();
      if (appearance.has(name) && enabled()) await tick();
      return result;
    }
  };
}
