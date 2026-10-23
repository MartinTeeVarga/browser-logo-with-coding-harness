import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

test('static build has local assets and self-contained workers at any base path', async () => {
  execFileSync(process.execPath, ['scripts/build.mjs']);
  const html = await readFile('dist/index.html', 'utf8');
  for (const match of html.matchAll(/(?:src|href)="(\.[^"]+)"/g)) await readFile(resolve('dist', match[1]));
  assert.match(html, /<script defer src="\.\/app.js">/);
  const bundle = await readFile('dist/app.js', 'utf8');
  assert.doesNotMatch(bundle, /import\.meta|^import /m);
  assert.match(bundle, /validationWorkerURL/);
  assert.match(bundle, /drawingWorkerURL/);
  execFileSync(process.execPath, ['--check', 'dist/app.js']);
});

test('page includes manual Run and simple accessible code/chat controls', async () => {
  const html = await readFile('index.html', 'utf8');
  assert.match(html, /id="run"/);
  assert.match(html, /id="code-title">code</);
  assert.match(html, /id="chat-title">chat</);
  assert.match(html, /aria-controls="editor-body"/);
  assert.doesNotMatch(html, /<nav\b/);
});
