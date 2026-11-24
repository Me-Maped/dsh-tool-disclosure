import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, access } from 'node:fs/promises';
import { importDsh, dshRequire, dshManifest } from '../scripts/dsh-runtime.mjs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import * as plugin from '../src/tool-disclosure.mjs';
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const { resolveConfig } = await importDsh('@deepseek-ai/cordis');
const { entryListSchema, applyEntryPatches } = await importDsh('@deepseek-ai/cordis-plugin-include');
const patch = dshRequire('js-yaml').load(await readFile(new URL('cordis.patch.yml', root), 'utf8'), { schema: entryListSchema });

test('bundle is one removable Host extension, not preset rewrites or MCP replacement', () => {
  assert.equal(manifest.name, '@local/dsh-tool-disclosure');
  assert.equal(manifest.engines.dsh, dshManifest.version);
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.scripts.install, undefined);
  assert.equal(manifest.scripts.postinstall, undefined);
  assert.equal(manifest.exports['.'], './src/tool-disclosure.mjs');
  assert.equal(patch.length, 1);
  assert.deepEqual(Object.keys(patch[0]), ['insert']);
  assert.equal(patch[0].insert.length, 1);
  const entry = patch[0].insert[0];
  assert.equal(entry.name, manifest.name);
  assert.equal(entry.id, 'local-tool-disclosure');
  const base = ['standard', 'ptc', 'minimal', 'cordis', 'codex-like'].map(id => ({ id: `preset-${id}`, name: '@deepseek-ai/dsh-agent-preset', config: { id, plugins: [] } }));
  base.push({ id: 'rea-mcp', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'rea' } });
  assert.deepEqual(applyEntryPatches(structuredClone(base), patch).slice(0, base.length), base);
  assert.deepEqual(resolveConfig(plugin, entry.config).bootstrapTools, plugin.DEFAULT_BOOTSTRAP);
});

test('discovery bounds validate and activation rejects unknown configuration fields', async () => {
  const config = resolveConfig(plugin, {});
  assert.equal(config.maxSearchResults, 8);
  assert.equal(config.descriptionChars, 240);
  for (const invalid of [{ maxSearchResults: 9 }, { descriptionChars: 241 }, { descriptionChars: 1 }]) {
    assert.throws(() => resolveConfig(plugin, invalid));
  }
  await assert.rejects(plugin.apply({}, resolveConfig(plugin, { mode: 'all' })), /Unknown tool-disclosure settings/);
  assert.deepEqual(resolveConfig(plugin, { bootstrapTools: ['read'] }).bootstrapTools, ['read']);
});

test('Host and CLI validation resolve the verified launching installation without managed shell variables', () => {
  const cli = resolve(dirname(dshRequire.resolve('@deepseek-ai/dsh/package.json')), dshManifest.bin.dsh);
  const environment = { ...process.env }; delete environment.DSH_INSTALL_DIR;
  const source = `process.argv[1] = ${JSON.stringify(cli)}; const m = await import(${JSON.stringify(new URL('../src/tool-disclosure.mjs', import.meta.url).href)}); console.log(m.SEARCH);`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', source], { env: environment, encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), 'tool_search');
});

test('optional read-only diagnostic provider reports bounded counts, not tool schemas', async t => {
  const { createFixture, disposeFiber } = await import('./disclosure-fixture.mjs');
  const f = await createFixture(); t.after(() => f.dispose());
  let registration;
  f.ctx.provide('cordisInspect', { register(provider) {
    registration = provider;
    return () => { registration = undefined; };
  } });
  f.register('read'); f.register('mcp__other__large');
  const a = await f.agent();
  const mount = await f.mount(plugin, resolveConfig(plugin, {}));
  // The optional dependency gets its own Cordis Fiber.
  await f.ctx.fiber.await();
  assert.equal(registration.manifest.id, 'ToolDisclosure');
  const result = await registration.query('measure', { limit: 1 });
  assert.equal(result.agents[0].sessionId, a.agent.id);
  assert.equal(result.agents[0].originalCount, 2);
  assert.equal(result.agents[0].visibleCount, 3);
  assert.equal(result.agents[0].failed, false);
  assert.equal(JSON.stringify(result).includes('parameters'), false);
  await assert.rejects(registration.query('measure', { limit: 33 }));
  await disposeFiber(mount);
  assert.equal(registration, undefined);
});

test('metadata, icon and all runtime modules are included in distribution', async () => {
  for (const file of ['src/tool-disclosure.mjs', 'scripts/dsh-runtime.mjs', 'cordis.patch.yml', 'icon.svg',
    'README.md', 'docs/DESIGN.md', 'docs/ACCEPTANCE.md', 'LICENSE']) await access(new URL(file, root));
  for (const lang of ['en', 'zh']) {
    const locale = JSON.parse(await readFile(new URL(`locale/${lang}.json`, root), 'utf8'));
    assert.ok(locale.meta.title);
    assert.ok(locale.meta.description.length > 40);
  }
  for (const folder of ['src', 'scripts', 'tests', 'locale', 'docs']) assert.ok(manifest.files.includes(folder));
  const icon = await readFile(new URL('icon.svg', root), 'utf8');
  assert.match(icon, /viewBox="0 0 36 36"/);
  assert.doesNotMatch(icon, /<(?:script|style|image|foreignObject|text)\b|\bon\w+=|href=/i);
  assert.ok(Buffer.byteLength(icon) < 262144);
});
