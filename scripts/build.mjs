import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist');
for (const path of ['src', 'public', 'examples']) {
  await cp(path, `dist/${path}`, { recursive: true });
}
for (const path of ['LICENSE', 'THIRD_PARTY.md']) {
  await cp(path, `dist/${path}`);
}
// A tiny deterministic bundle keeps development dependency-free and lets the
// interpreter also work when the built index.html is opened directly from disk.
const read = path => readFile(path, 'utf8');
const moduleBody = source => source.replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const resources = moduleBody(await read('src/logo/resources.js'));
const runtime = resources + '\n' + await read('src/logo/vendor/logo.js') + '\n' + moduleBody(await read('src/logo/dialect.js')) + '\n' + moduleBody(await read('src/logo/runtime.js'));
const validationWorker = runtime + '\n' + moduleBody(await read('src/logo/validate.worker.js'));
const drawingWorker = runtime + '\n' + moduleBody(await read('src/logo/output.js')) + '\n' + await read('src/logo/vendor/turtle.js') + '\n' + moduleBody(await read('src/logo/slow.js')) + '\n' + moduleBody(await read('src/logo/draw.worker.js'));
const workers = `const validationWorkerURL = URL.createObjectURL(new Blob([${JSON.stringify(validationWorker)}], { type: 'text/javascript' }));\nconst drawingWorkerURL = URL.createObjectURL(new Blob([${JSON.stringify(drawingWorker)}], { type: 'text/javascript' }));\n`;
let main = moduleBody(await read('src/main.js'))
  .replace("new URL('./logo/validate.worker.js', import.meta.url)", 'validationWorkerURL')
  .replace("new URL('./logo/draw.worker.js', import.meta.url)", 'drawingWorkerURL');
const bundle = `(() => {\n'use strict';\n${runtime}\n${moduleBody(await read('src/cancellation.js'))}\n${moduleBody(await read('src/harness.js'))}\n${moduleBody(await read('src/models.js'))}\n${moduleBody(await read('src/puter.js'))}\n${moduleBody(await read('src/workspace.js'))}\n${moduleBody(await read('src/model-picker.js'))}\n${workers}\n${main}\n})();\n`;
await writeFile('dist/app.js', bundle);
await writeFile('dist/index.html', (await read('index.html')).replace('<script type="module" src="./src/main.js"></script>', '<script defer src="./app.js"></script>'));
console.log('Built static site in dist/ — no server runtime required.');
