import './vendor/logo.js';
import { DIALECT_CALLS, validateLiteralCall } from './dialect.js';

export const NATIVE_FEATURES = new Set(`shell setprefix prefix openread openwrite openappend openupdate close allopen closeall erasefile erf dribble nodribble setread setwrite reader writer setreadpos setwritepos readpos writepos eofp eof? filep file? save savel load silentload cslsload savepict loadpict epspict edit ed edall edps edns edpls edn edpl editfile edf seteditor setlibloc libloc sethelploc setcslsloc settemploc sethelp help setpenpattern penpattern keyp key? setcursor cursor setmargins textscreen ts fullscreen fs splitscreen ss refresh norefresh screenmode nodes gc .setsegmentsize`.split(' '));

export function createInterpreter(turtle = {}, stream = { write() {}, clear() {}, read() { throw new Error('Input is available only after Run.'); } }) {
  const outputStream = new Proxy(stream, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (key === 'write') return (...parts) => value.apply(target, parts.map(decodeLogoText));
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, key, value) { return Reflect.set(target, key, value, target); }
  });
  const logo = new globalThis.LogoInterpreter(turtle, outputStream);
  for (const contract of DIALECT_CALLS) {
    for (const name of contract.names) {
      const routine = logo.routines.get(name);
      if (routine) routine.logoContract = contract;
    }
  }
  logo.validateCall = validateLiteralCall;
  for (const name of NATIVE_FEATURES) {
    const unavailable = () => { throw new Error(`${name.toUpperCase()} is a native feature and is unavailable in this browser.`); };
    unavailable.minimum = unavailable.default = unavailable.maximum = 0;
    unavailable.primitive = true;
    unavailable.unsupported = true;
    logo.routines.set(name, unavailable);
  }
  // Internal upstream test helpers are not part of the language surface.
  for (const name of ['.promise', '.verify_bound_ignore', '.verify_bound_identity', 'numberwang']) logo.routines.delete(name);
  return logo;
}

export function decodeLogoText(word) {
  return String(word).replace(/[\uE000-\uE0FF]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xE000));
}

export function primitiveNames() {
  return createInterpreter().routines.keys().filter(name => !NATIVE_FEATURES.has(name));
}

export function validateLogo(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('Return a nonempty Logo program.');
  if (source.length > 100000) throw new Error('The Logo program exceeds 100,000 characters.');
  if (/^\s*```/m.test(source)) throw new Error('Return raw Logo source without Markdown fences.');
  createInterpreter().validate(source);
  return source;
}
