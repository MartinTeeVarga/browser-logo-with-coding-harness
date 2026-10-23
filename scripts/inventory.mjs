import { writeFile } from 'node:fs/promises';
import { primitiveNames } from '../src/logo/runtime.js';
const names = primitiveNames().sort();
await writeFile('docs/primitives.json', JSON.stringify(names, null, 2) + '\n');
console.log(`${names.length} registered primitive names (aliases included).`);
