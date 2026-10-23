// Shared by the model prompt and static call validation. These signatures
// describe this engine's Berkeley-compatible API, not Python turtle or NetLogo.
export const DIALECT_CALLS = [
  { names: ['setpos'], syntax: 'SETPOS [x y]', inputs: ['point'], example: 'setpos [-380 -240]', note: 'One coordinate-list input. Never SETPOS x y. For computed coordinates use SETXY or SETPOS (list :x :y).' },
  { names: ['setxy'], syntax: 'SETXY x y', inputs: ['number', 'number'], example: 'setxy -380 -240', note: 'Two numeric inputs; use this for coordinates held in variables.' },
  { names: ['setx'], syntax: 'SETX x', inputs: ['number'], example: 'setx -200' },
  { names: ['sety'], syntax: 'SETY y', inputs: ['number'], example: 'sety 120' },
  { names: ['towards'], syntax: 'TOWARDS [x y]', inputs: ['point'], example: 'setheading towards [0 0]' },
  { names: ['forward', 'fd'], syntax: 'FORWARD distance (alias FD)', inputs: ['number'], example: 'fd 100' },
  { names: ['back', 'bk'], syntax: 'BACK distance (alias BK)', inputs: ['number'], example: 'bk 20' },
  { names: ['right', 'rt'], syntax: 'RIGHT degrees (alias RT)', inputs: ['number'], example: 'rt 90' },
  { names: ['left', 'lt'], syntax: 'LEFT degrees (alias LT)', inputs: ['number'], example: 'lt 90' },
  { names: ['setheading', 'seth'], syntax: 'SETHEADING degrees (alias SETH)', inputs: ['number'], example: 'setheading 90', note: '0 is north/up, 90 east/right, 180 south/down, 270 west/left. RT increases heading.' },
  { names: ['arc'], syntax: 'ARC angle radius', inputs: ['number', 'number'], example: 'arc 100 14', note: 'ANGLE FIRST, radius second: this example sweeps 100 degrees with radius 14. ARC is centered at the turtle and leaves its position and heading unchanged; it is not a forward-moving arc.' },
  { names: ['filled'], syntax: 'FILLED color [instructions]', inputs: ['color', 'instructions'], example: 'filled [73 24 10] [repeat 4 [fd 100 rt 90]]', note: 'Always TWO inputs: fill color, then the instruction list. Never FILLED [instructions] alone. Inside a procedure, use FILLED :color [instructions] or FILLED PENCOLOR [instructions]. Move to the start point with pen up before beginning a filled path.' },
  { names: ['setpencolor', 'setpc', 'setcolor'], syntax: 'SETPENCOLOR color (alias SETPC)', inputs: ['color'], example: 'setpencolor [20 40 80]', note: 'Color is one RGB list [red green blue] with 0..100 components, a palette number, or a quoted color word. Use one alias, not duplicate calls.' },
  { names: ['setbackground', 'setbg', 'setscreencolor', 'setsc'], syntax: 'SETBACKGROUND color (alias SETBG)', inputs: ['color'], example: 'setbackground [100 100 100]' },
  { names: ['setpensize', 'setwidth', 'setpw'], syntax: 'SETPENSIZE width (or [width height])', inputs: ['penSize'], example: 'setpensize 2' },
  { names: ['setscrunch'], syntax: 'SETSCRUNCH xscale yscale', inputs: ['number', 'number'], example: 'setscrunch 1 1' },
  { names: ['setlabelheight'], syntax: 'SETLABELHEIGHT height', inputs: ['number'], example: 'setlabelheight 18' },
  { names: ['repeat'], syntax: 'REPEAT count [instructions]', inputs: ['number', 'instructions'], example: 'repeat 4 [fd 100 rt 90]' },
  { names: ['forever'], syntax: 'FOREVER [instructions]', inputs: ['instructions'], example: 'forever [fd 1 rt 1]', note: 'Prefer bounded REPEAT; the host stops long-running programs.' },
  { names: ['if'], syntax: 'IF condition [instructions]', inputs: ['boolean', 'instructions'], example: 'if :n = 0 [stop]' },
  { names: ['ifelse'], syntax: 'IFELSE condition [if-true] [if-false]', inputs: ['boolean', 'instructions', 'instructions'], example: 'ifelse :n > 0 [fd 10] [bk 10]' },
  { names: ['wait'], syntax: 'WAIT ticks', inputs: ['number'], example: 'wait 60', note: '60 ticks is one second.' }
];

function numeric(value) {
  return (typeof value === 'number' && Number.isFinite(value)) ||
    (typeof value === 'string' && /^-?([0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)$/.test(value));
}
const accepts = {
  number: numeric,
  point: value => Array.isArray(value) && value.length === 2 && value.every(numeric),
  color: value => numeric(value) || typeof value === 'string' || Array.isArray(value) && value.length === 3 && value.every(numeric),
  penSize: value => numeric(value) || Array.isArray(value) && value.length === 2 && value.every(numeric),
  instructions: value => Array.isArray(value) || typeof value === 'string',
  boolean: value => typeof value === 'string' && ['true', 'false'].includes(value.toLowerCase()) || Array.isArray(value)
};

export function validateLiteralCall(procedure, name, args) {
  const contract = procedure.logoContract;
  if (!contract) return;
  contract.inputs.forEach((type, index) => {
    const arg = args[index];
    // Inspect compiler metadata only: never evaluate argument thunks.
    if (!arg || !Object.hasOwn(arg, 'literal') || accepts[type](arg.literal)) return;
    const hint = name === 'SETPOS' ? ' Use SETXY x y for two numeric inputs.' : '';
    throw new Error(`${name}: input ${index + 1} must be ${type === 'point' ? 'a two-number [x y] list' : type}. Syntax: ${contract.syntax}. Example: ${contract.example}.${hint}`);
  });
}

export function dialectPromptGuide() {
  return 'Interpreter-specific call signatures (follow these exactly):\n' + DIALECT_CALLS.map(call =>
    `- ${call.syntax}. Example: ${call.example}.${call.note ? ' ' + call.note : ''}`
  ).join('\n');
}
