import assert from 'node:assert/strict';
import test from 'node:test';
import { createFixture, fixtureTool, valueOf, errorOf, resolveConfig, disposeFiber,
  scopeParentOf, PtcExecutor, projectToolSchema } from './disclosure-fixture.mjs';

// Initialize Cordis before Schemastery's CJS bridge to avoid Node 26 import/require races.
const disclosure = await import('../src/tool-disclosure.mjs');
const { SEARCH, ACTIVATE, RECEIPT, projection } = disclosure;
const config = { maxSearchResults: 8, descriptionChars: 240 };
async function setup(t, options = {}) {
  const f = await createFixture();
  t.after(() => f.dispose());
  f.register('read');
  f.register('bash');
  const tools = Array.from({ length: 12 }, (_, i) => f.register(`mcp__rea__probe_${String(i).padStart(2, '0')}`));
  const mount = await f.mount(disclosure, { ...config, ...options });
  return { f, tools, mount };
}
const activate = (f, a, names, options) => f.dispatch(a, [{ name: ACTIVATE, args: { names } }], options);
const search = (f, a, args) => f.dispatch(a, [{ name: SEARCH, args }]);
const active = (f, a) => f.checkpoint(a)[projection.key].val.active;

function appendCall(a, id, names, name = ACTIVATE) {
  return a.agent.session.append('tool/call', { turn: 1, step: 1, callId: id, name,
    arguments: JSON.stringify({ names }) });
}
function appendResult(a, id, names, { isError = false, error, sessionId = a.agent.id,
  protocol = RECEIPT, content, source } = {}) {
  return a.agent.session.append('tool/result', { turn: 1, step: 1,
    message: { id: `message-${id}-${a.agent.session.seq}`, role: 'tool', toolCallId: id,
      source: source ?? { kind: 'tool', callId: id }, isError: isError || !!error,
      content: content ?? [{ type: 'text', text: JSON.stringify({ protocol, sessionId,
        activated: names, availableFrom: 'next-step' }) }] }, ...(error ? { error } : {}) }, { surfaceOp: 'append' });
}

test('fixture uses actual installed DSH dispatch, normal call/result logs, and Session publication', async t => {
  const f = await createFixture(); t.after(() => f.dispose());
  const registration = f.register('business_probe');
  const a = await f.agent();
  assert.equal(f.ctx.agents.get(a.agent.id), a.agent);
  assert.equal(f.ctx.sessions.get(a.agent.id), a.agent.session);
  assert.equal(f.ctx.tools.get('business_probe', a.agent), registration.definition);
  const batch = await f.dispatch(a, [{ name: 'business_probe', args: { path: '/offline' } }]);
  assert.deepEqual(valueOf(batch), { name: 'business_probe', path: '/offline' });
  assert.deepEqual(batch.logged.map(e => e.type), ['tool/call', 'tool/result']);
  assert.equal(a.agent.session.deriveMessages()[0].role, 'tool');
  assert.equal(f.calls.length, 1);
});

test('real defineTool DSL requires explicit object additionalProperties; defaults are bounded', () => {
  assert.throws(() => fixtureTool('bad', [], { output: { schema: { type: 'object' }, render: () => [] } }),
    /additionalProperties must be explicitly true or false/);
  const resolved = resolveConfig(disclosure, {});
  assert.equal(resolved.maxSearchResults, 8);
  assert.equal(resolved.descriptionChars, 240);
  assert.deepEqual(resolved.bootstrapTools, disclosure.DEFAULT_BOOTSTRAP);
  assert.throws(() => resolveConfig(disclosure, { maxSearchResults: 9 }));
  assert.throws(() => resolveConfig(disclosure, { descriptionChars: 241 }));
});

test('global plugin hides inherited tools for two isolated Agents across Standard and another preset', async t => {
  const { f } = await setup(t);
  const standard = f.preset('standard'), other = f.preset('codex-like');
  f.register('standard_own_tool', { owner: standard.ctx });
  f.register('other_own_tool', { owner: other.ctx });
  const a = await f.agent({ preset: standard }), b = await f.agent({ preset: other });
  for (const agent of [a, b]) assert.deepEqual(f.names(agent), [ACTIVATE, SEARCH, 'bash', 'read'].sort());
  assert.ok(f.ctx.tools.schemas().some(d => d.name === 'mcp__rea__probe_00'), 'Host registry is not mutated');
  assert.ok(f.ctx.tools.schemas(standard.key).some(d => d.name === 'standard_own_tool'), 'Standing preset remains unmasked');
  assert.equal(valueOf(await activate(f, a, ['mcp__rea__probe_00'])).protocol, RECEIPT);
  assert.ok(f.names(a).includes('mcp__rea__probe_00'));
  assert.ok(!f.names(b).includes('mcp__rea__probe_00'));
  assert.equal(f.calls.length, 0, 'Activation must not run business tools');
  assert.equal(valueOf(await search(f, a, { query: 'standard_own_tool' })).total, 1);
  assert.equal(valueOf(await search(f, b, { query: 'standard_own_tool' })).total, 0);
  errorOf(await activate(f, b, ['standard_own_tool']));
  valueOf(await activate(f, a, ['standard_own_tool']));
  assert.ok(f.names(a).includes('standard_own_tool'));
  assert.ok(!f.names(a).includes('other_own_tool'));
});

test('Agent-own tools stay own and same-preset child is not scope-descended from parent Agent', async t => {
  const { f } = await setup(t);
  const preset = f.preset('same');
  const parent = await f.agent({ preset });
  f.register('agent_private', { owner: parent.agent.ctx });
  valueOf(await activate(f, parent, ['mcp__rea__probe_00']));
  const child = await f.agent({ preset, parentAgent: parent.agent });
  assert.equal(scopeParentOf(child.agent), preset.key);
  assert.notEqual(scopeParentOf(child.agent), parent.agent);
  assert.ok(f.names(parent).includes('agent_private'), 'Own registrations exempt inherited restriction');
  assert.ok(!f.names(child).includes('agent_private'));
  assert.ok(!f.names(child).includes('mcp__rea__probe_00'));
  valueOf(await activate(f, child, ['mcp__rea__probe_01']));
  assert.ok(!f.names(parent).includes('mcp__rea__probe_01'));
});

test('search uses limit 8, 240-character summaries, pagination, literal matching, and never schemas', async t => {
  const { f } = await setup(t); const a = await f.agent();
  const result = valueOf(await search(f, a, { query: 'mcp__rea__probe' }));
  assert.equal(result.tools.length, 8); assert.equal(result.total, 12); assert.equal(result.nextOffset, 8);
  for (const tool of result.tools) {
    assert.deepEqual(Object.keys(tool).sort(), ['activated', 'description', 'name']);
    assert.equal(tool.description.length, 240); assert.equal(tool.activated, false);
    assert.equal('parameters' in tool || 'schema' in tool, false);
  }
  const page = valueOf(await search(f, a, { query: 'mcp__rea__probe', offset: 8 }));
  assert.equal(page.tools.length, 4); assert.equal(page.nextOffset, null);
  assert.equal(valueOf(await search(f, a, { query: 'PROBE_02' })).tools[0].name, 'mcp__rea__probe_02');
  assert.equal(valueOf(await search(f, a, { query: 'probe.*' })).total, 0);
  for (const args of [{ query: '', limit: 9 }, { query: '', offset: -1 }, { query: '', limit: 0 },
    { query: '', offset: 1.5 }, { query: 'x'.repeat(257) }, { query: '', unexpected: true }]) errorOf(await search(f, a, args));
});

test('activation is next-step only; old resolved set cannot call new tool in same batch; original schema preserved', async t => {
  const { f, tools } = await setup(t); const a = await f.agent();
  const old = await f.resolve(a); t.after(() => old.dispose());
  const name = tools[0].definition.name;
  const batch = await f.dispatch(a, [{ name: ACTIVATE, args: { names: [name] } },
    { name, args: { path: '/must-not-run' } }], { toolSet: old });
  valueOf(batch); assert.equal(errorOf(batch, 1).info.code, 'UNKNOWN_TOOL');
  assert.equal(f.calls.length, 0);
  assert.ok(!f.names(a, old).includes(name));
  const next = await f.resolve(a); t.after(() => next.dispose());
  assert.deepEqual(f.schemas(a, next).find(tool => tool.name === name), projectToolSchema(tools[0].definition, false));
  const schema = f.schemas(a, next).find(tool => tool.name === name);
  assert.equal(schema.description, tools[0].definition.description);
  assert.ok(schema.description.length > 240);
  assert.deepEqual(schema.parameters, tools[0].definition.parameters);
  valueOf(await f.dispatch(a, [{ name, args: { path: '/actually-run', mode: 'summary', options: { depth: 2 } } }], { toolSet: next, step: 2 }));
  assert.equal(f.calls.length, 1);
  errorOf(await f.dispatch(a, [{ name, args: { mode: 'summary' } }], { toolSet: next, step: 3 }));
  assert.equal(f.calls.length, 1, 'Original required arguments enforced by actual dispatcher');
});

test('invalid activation arrays are atomic; no partial grants or business effects', async t => {
  const { f } = await setup(t); const a = await f.agent();
  const invalid = [[], ['mcp__rea__probe_00', 'missing'], ['mcp__rea__probe_00', 'run_code'],
    ['mcp__rea__probe_00', ACTIVATE], ['mcp__rea__probe_00', SEARCH], Array(9).fill('mcp__rea__probe_00'),
    ['mcp__rea__probe_00', 1], ['mcp__rea__probe_00', ''], ['mcp__rea__probe_00', 'mcp__rea__*']];
  for (const names of invalid) {
    errorOf(await activate(f, a, names));
    assert.deepEqual(active(f, a), []);
    assert.ok(!f.names(a).includes('mcp__rea__probe_00'));
  }
  errorOf(await f.dispatch(a, [{ name: ACTIVATE, args: { names: ['mcp__rea__probe_00'], extra: true } }]));
  assert.equal(f.calls.length, 0);
  const valid = valueOf(await activate(f, a, ['mcp__rea__probe_02', 'mcp__rea__probe_00', 'mcp__rea__probe_02']));
  assert.deepEqual(valid.activated, ['mcp__rea__probe_00', 'mcp__rea__probe_02']);
});

test('failed or caller-cancelled real execution results never activate', async t => {
  const { f } = await setup(t); const a = await f.agent();
  const off = a.agent.ctx.tools.guard(exec => exec.name === ACTIVATE ? { reason: 'test denial' } : undefined);
  errorOf(await activate(f, a, ['mcp__rea__probe_00'])); off();
  assert.deepEqual(active(f, a), []);
  const cancel = new AbortController();
  const offCancel = a.agent.ctx.on('tools/execute', async (exec, next) => {
    const result = await next();
    if (exec.name === ACTIVATE) cancel.abort(new Error('fixture canceled after body'));
    return result;
  });
  const batch = await activate(f, a, ['mcp__rea__probe_00'], { signal: cancel.signal });
  assert.match(errorOf(batch).info.code, /ABORTED/); offCancel();
  assert.deepEqual(active(f, a), []);
  assert.ok(!f.names(a).includes('mcp__rea__probe_00'));
  assert.equal(f.calls.length, 0);
});

test('successful unlogged dispatch is not an activation; only normal committed result grants', async t => {
  const { f } = await setup(t); const a = await f.agent(); const set = await f.resolve(a);
  try {
    const batch = await f.ctx.tools.execute({ agent: a.agent, signal: new AbortController().signal, toolSet: set,
      calls: [{ type: 'tool-call', id: 'unlogged', name: ACTIVATE, arguments: JSON.stringify({ names: ['mcp__rea__probe_00'] }) }] });
    valueOf(batch); assert.deepEqual(active(f, a), []);
    assert.ok(!f.names(a).includes('mcp__rea__probe_00'));
  } finally { set.dispose(); }
  valueOf(await activate(f, a, ['mcp__rea__probe_00']));
  assert.deepEqual(active(f, a), ['mcp__rea__probe_00']);
});

test('projection requires matching call/result, exact receipt and own session; turn end drops pending', async t => {
  const { f } = await setup(t); const a = await f.agent(); const names = ['mcp__rea__probe_00'];
  appendResult(a, 'orphan', names); assert.deepEqual(active(f, a), []);
  for (const [index, options] of [{ sessionId: 'another' }, { protocol: 'foreign' }, { isError: true },
    { error: { name: 'Error', code: 'FAILED' } }, { content: [{ type: 'text', text: '{}' }] },
    { content: [{ type: 'text', text: 'not json' }] },
    { content: [{ type: 'text', text: '{}' }, { type: 'text', text: '{}' }] }].entries()) {
    appendCall(a, `invalid-${index}`, names); appendResult(a, `invalid-${index}`, names, options);
    assert.deepEqual(active(f, a), []);
  }
  appendCall(a, 'mismatch', names); appendResult(a, 'mismatch', ['mcp__rea__probe_01']);
  assert.deepEqual(active(f, a), []);
  appendCall(a, 'expired', names); a.agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
  appendResult(a, 'expired', names); assert.deepEqual(active(f, a), []);
  appendCall(a, 'valid', names); appendResult(a, 'valid', names);
  assert.deepEqual(active(f, a), names);
});

test('fork inheritedCount ignores inherited activation even when forged receipt names child session', async t => {
  const { f } = await setup(t); const parent = await f.agent({ id: 'fork-parent' });
  valueOf(await activate(f, parent, ['mcp__rea__probe_00']));
  const seed = structuredClone(parent.agent.session.snapshotEvents());
  seed.find(e => e.type === 'tool/result').data.message.content[0].text = JSON.stringify({
    protocol: RECEIPT, sessionId: 'fork-child', activated: ['mcp__rea__probe_00'], availableFrom: 'next-step' });
  const child = await f.agent({ id: 'fork-child', seed, inheritedEventCount: seed.length, parentAgent: parent.agent });
  assert.deepEqual(active(f, child), []); assert.ok(!f.names(child).includes('mcp__rea__probe_00'));
  valueOf(await activate(f, child, ['mcp__rea__probe_01']));
  assert.deepEqual(active(f, child), ['mcp__rea__probe_01']);
});

test('resume folds own log and restores checkpoint with no business replay', async t => {
  const { f } = await setup(t); const a = await f.agent({ id: 'resume-session' });
  valueOf(await activate(f, a, ['mcp__rea__probe_00']));
  valueOf(await f.dispatch(a, [{ name: 'mcp__rea__probe_00', args: { path: '/once' } }]));
  const session = a.agent.session, seed = session.snapshotEvents(), checkpoint = f.checkpoint(a);
  const restored = f.ctx.sessionProjections.restore(checkpoint, seed, 0, session.header, 0);
  assert.deepEqual(restored.checkpoint[projection.key].val.active, ['mcp__rea__probe_00']);
  await a.dispose();
  const resumed = await f.agent({ id: session.id, seed, header: session.header, source: 'resume' });
  assert.ok(f.names(resumed).includes('mcp__rea__probe_00'));
  assert.equal(f.calls.length, 1, 'Resume and projection fold must never replay business execution');
  assert.deepEqual(active(f, resumed), ['mcp__rea__probe_00']);
  const next = await f.resolve(resumed); next.dispose();
  assert.equal(f.calls.length, 1);
});

test('MCP additions stay hidden; deletion and same-name re-registration use live catalog and new schema', async t => {
  const { f } = await setup(t); const a = await f.agent();
  const added = f.register('mcp__rea__late');
  assert.ok(!f.names(a).includes('mcp__rea__late'));
  assert.equal(valueOf(await search(f, a, { query: 'mcp__rea__late' })).total, 1);
  valueOf(await activate(f, a, ['mcp__rea__late']));
  added.dispose();
  assert.ok(!f.names(a).includes('mcp__rea__late'));
  assert.equal(valueOf(await search(f, a, { query: 'mcp__rea__late' })).total, 0);
  errorOf(await f.dispatch(a, [{ name: 'mcp__rea__late', args: { path: '/removed' } }]));
  const replacement = f.register('mcp__rea__late', { description: 'Replacement full schema',
    parameters: { replacement: { type: 'boolean', required: true } },
    execute: async args => ({ replacement: args.replacement }) });
  assert.ok(f.names(a).includes('mcp__rea__late'), 'Session activation names restore current same-name registrations');
  const next = await f.resolve(a);
  try {
    assert.deepEqual(f.schemas(a, next).find(d => d.name === 'mcp__rea__late'), projectToolSchema(replacement.definition, false));
    assert.deepEqual(valueOf(await f.dispatch(a, [{ name: 'mcp__rea__late', args: { replacement: true } }], { toolSet: next })), { replacement: true });
  } finally { next.dispose(); }
  assert.equal(f.calls.length, 0);
});

test('blank Agent rebind to another preset retains per-Agent discovery and searches new unmasked parent catalog', async t => {
  const { f } = await setup(t); const first = f.preset('standard'), second = f.preset('minimal');
  f.register('old_preset_tool', { owner: first.ctx });
  f.register('new_preset_tool', { owner: second.ctx });
  const a = await f.agent({ preset: first });
  assert.equal(a.agent.session.seq, 0, 'Blank Agent has no model or tool history');
  a.rebind(second);
  // A normal composition registry change triggers refresh for already-created Agents.
  const trigger = f.register('composition_changed', { owner: second.ctx });
  assert.equal(valueOf(await search(f, a, { query: 'old_preset_tool' })).total, 0);
  assert.equal(valueOf(await search(f, a, { query: 'new_preset_tool' })).total, 1);
  assert.ok(!f.names(a).includes('new_preset_tool'));
  valueOf(await activate(f, a, ['new_preset_tool']));
  assert.ok(f.names(a).includes('new_preset_tool')); trigger.dispose();
});

test('unloading plugin removes both live Agent owners, restrictions and discovery; disposed Agent is not resurrected', async t => {
  const { f, mount } = await setup(t); const a = await f.agent(), b = await f.agent();
  await a.dispose();
  f.register('after_agent_dispose');
  assert.equal(f.ctx.agents.get(a.agent.id), undefined);
  await disposeFiber(mount);
  assert.ok(f.names(b).includes('mcp__rea__probe_00'), 'Unload releases live Agent mask');
  assert.ok(!f.names(b).includes(SEARCH)); assert.ok(!f.names(b).includes(ACTIVATE));
  f.register('after_unload');
  const c = await f.agent();
  assert.ok(f.names(c).includes('mcp__rea__probe_00'));
  assert.ok(!f.names(c).includes(SEARCH));
});

test('custom bootstrap is honored without mutating Host registry or other framework restrictions', async t => {
  const { f } = await setup(t, { bootstrapTools: ['mcp__rea__probe_00'] }); const a = await f.agent();
  assert.deepEqual(f.names(a), [ACTIVATE, SEARCH, 'mcp__rea__probe_00'].sort());
  const deny = a.agent.ctx.tools.restrict({ deny: ['mcp__rea__probe_01'] });
  valueOf(await activate(f, a, ['mcp__rea__probe_01']));
  assert.ok(!f.names(a).includes('mcp__rea__probe_01'), 'Disclosure intersects rather than overrides another owner mask');
  deny(); assert.ok(f.names(a).includes('mcp__rea__probe_01'));
});

test('non-MCP write/web_fetch/subagent are also deferred while all registered core bootstrap remains visible', async t => {
  const f = await createFixture(); t.after(() => f.dispose());
  for (const name of disclosure.DEFAULT_BOOTSTRAP) f.register(name);
  for (const name of ['write', 'web_fetch', 'subagent', 'mcp__other__action']) f.register(name);
  await f.mount(disclosure, config);
  const a = await f.agent();
  assert.deepEqual(f.names(a), [...disclosure.DEFAULT_BOOTSTRAP, SEARCH, ACTIVATE].sort());
  for (const name of ['write', 'web_fetch', 'subagent', 'mcp__other__action']) {
    assert.equal(valueOf(await search(f, a, { query: name })).tools[0].name, name);
    assert.ok(!f.names(a).includes(name));
  }
  valueOf(await activate(f, a, ['write', 'web_fetch', 'subagent']));
  for (const name of ['write', 'web_fetch', 'subagent']) {
    valueOf(await f.dispatch(a, [{ name, args: { path: '/offline-fixture' } }]));
  }
  assert.equal(f.calls.length, 3);
});

test('activation does not bypass conditional availability; each next resolve reevaluates installed conditions', async t => {
  const { f } = await setup(t); let enabled = false, conditionCalls = 0;
  f.register('conditional_tool', { when: () => { conditionCalls++; return enabled; } });
  const a = await f.agent();
  valueOf(await activate(f, a, ['conditional_tool']));
  const hidden = await f.resolve(a);
  try {
    assert.ok(!f.names(a, hidden).includes('conditional_tool'));
    errorOf(await f.dispatch(a, [{ name: 'conditional_tool', args: { path: '/must-not-run' } }], { toolSet: hidden }));
  } finally { hidden.dispose(); }
  assert.equal(f.calls.length, 0);
  enabled = true;
  const admitted = await f.resolve(a);
  try {
    assert.ok(f.names(a, admitted).includes('conditional_tool'));
    valueOf(await f.dispatch(a, [{ name: 'conditional_tool', args: { path: '/runs-once' } }], { toolSet: admitted }));
  } finally { admitted.dispose(); }
  assert.ok(conditionCalls >= 2); assert.equal(f.calls.length, 1);
});

test('mounting Host plugin attaches existing Agents and unload releases both plugin-owned and Agent-owned effects', async t => {
  const f = await createFixture(); t.after(() => f.dispose());
  f.register('read'); f.register('lazy');
  const a = await f.agent(), b = await f.agent();
  assert.ok(f.names(a).includes('lazy'));
  const mount = await f.mount(disclosure, config);
  assert.ok(!f.names(a).includes('lazy')); assert.ok(!f.names(b).includes('lazy'));
  valueOf(await activate(f, a, ['lazy']));
  await b.dispose();
  await disposeFiber(mount);
  assert.ok(f.names(a).includes('lazy')); assert.ok(!f.names(a).includes(SEARCH));
  const remount = await f.mount(disclosure, config);
  assert.ok(f.names(a).includes(SEARCH)); assert.ok(f.names(a).includes('lazy'), 'Own prior receipt is restored on remount');
  await disposeFiber(remount);
  assert.ok(!f.names(a).includes(SEARCH));
});

test('real PtcExecutor presents only run_code, exposes discovery SDK and logs nested activation before next program', async t => {
  const { f, tools } = await setup(t);
  const preset = f.preset('ptc');
  const { runtime } = await f.enablePtc(preset);
  const a = await f.agent({ preset });
  const name = tools[0].definition.name;
  const old = await f.resolve(a);
  try {
    const assembly = await f.ctx.systemPrompt.assemble({ scope: a.agent, toolSet: old });
    assert.deepEqual(assembly.tools.map(tool => tool.name), ['run_code']);
    const sdk = assembly.sections.find(section => section.name === 'tools:sdk').text;
    assert.ok(sdk.includes(SEARCH)); assert.ok(sdk.includes(ACTIVATE)); assert.ok(!sdk.includes(name));
    assert.equal(errorOf(await f.dispatch(a, [{ name: SEARCH, args: { query: '' } }], { toolSet: old })).info.code, 'UNKNOWN_TOOL',
      'PTC direct capability calls must retain their existing rejection');
    const code = JSON.stringify([{ name: SEARCH, args: { query: name } },
      { name: ACTIVATE, args: { names: [name] } }, { name, args: { path: '/same-program-not-admitted' } }]);
    const batch = await f.dispatch(a, [{ name: 'run_code', args: { code, description: 'Exercise offline discovery through native PTC bindings' } }], { toolSet: old });
    const result = valueOf(batch).result;
    assert.equal(result[0].ok, true); assert.equal(result[0].value.tools[0].name, name);
    assert.equal(result[1].ok, true); assert.equal(result[1].value.protocol, RECEIPT);
    assert.equal(result[2].ok, false, 'Current program bindings cannot gain newly activated capability');
    const starts = batch.logged.filter(event => event.type === 'tool/ptc-dispatch-start');
    const ends = batch.logged.filter(event => event.type === 'tool/ptc-dispatch');
    assert.equal(starts.length, 2); assert.equal(ends.length, 2);
    const start = starts.find(event => event.data.name === ACTIVATE), end = ends.find(event => event.data.name === ACTIVATE);
    assert.equal(end.data.subCallId, start.data.subCallId);
    assert.equal(end.data.rootCallId, batch.blocks[0].id); assert.equal(end.data.isError, false);
    assert.deepEqual(active(f, a), [name]); assert.equal(f.calls.length, 0);
  } finally { old.dispose(); }
  const next = await f.resolve(a);
  try {
    const assembly = await f.ctx.systemPrompt.assemble({ scope: a.agent, toolSet: next });
    assert.ok(assembly.sections.find(section => section.name === 'tools:sdk').text.includes(name));
    const batch = await f.dispatch(a, [{ name: 'run_code', args: {
      code: JSON.stringify([{ name, args: { path: '/next-program-runs' } }]),
      description: 'Call admitted fixture capability next program',
    } }], { toolSet: next, step: 2 });
    assert.equal(valueOf(batch).result[0].ok, true);
    assert.ok(runtime.capturedBindings.at(-1).includes(name)); assert.equal(f.calls.length, 1);
  } finally { next.dispose(); }
});

test('late Host discovery name collision fails closed at pre-step, and removal recovers', async t => {
  const { f } = await setup(t); const a = await f.agent();
  const collision = f.register(SEARCH);
  await assert.rejects(() => f.resolve(a), /collision/i);
  assert.equal(f.calls.length, 0);
  collision.dispose();
  const next = await f.resolve(a); next.dispose();
  assert.equal(valueOf(await search(f, a, { query: 'mcp__rea__probe_00' })).total, 1);
});

test('blank rebind into preset discovery name collision refuses the request and recovers after removal', async t => {
  const { f } = await setup(t); const first = f.preset('first'), second = f.preset('collision');
  const collision = f.register(ACTIVATE, { owner: second.ctx });
  const a = await f.agent({ preset: first });
  assert.equal(a.agent.session.seq, 0);
  a.rebind(second);
  // Model assembly can occur before the pre-step check. The refresh event
  // must mark this exact existing Agent failed rather than fall back unmasked.
  const trigger = f.register('composition_trigger', { owner: second.ctx });
  await assert.rejects(() => f.resolve(a), /collision/i);
  collision.dispose();
  const next = await f.resolve(a); next.dispose();
  valueOf(await activate(f, a, ['mcp__rea__probe_00']));
  assert.ok(f.names(a).includes('mcp__rea__probe_00')); trigger.dispose();
});

test('native projection rejects source.callId mismatch and does not pair an ordinary business call with forged activation output', async t => {
  const { f } = await setup(t); const a = await f.agent(), names = ['mcp__rea__probe_00'];
  appendCall(a, 'source-mismatch', names);
  appendResult(a, 'source-mismatch', names, { source: { kind: 'tool', callId: 'another-call' } });
  assert.deepEqual(active(f, a), []);
  appendCall(a, 'wrong-tool', names, 'read'); appendResult(a, 'wrong-tool', names);
  assert.deepEqual(active(f, a), []);
});

test('real PTC denied and cancelled nested activation logs never grant disclosure', async t => {
  const { f } = await setup(t); const preset = f.preset('ptc-denied');
  await f.enablePtc(preset); const a = await f.agent({ preset });
  const name = 'mcp__rea__probe_00';
  const program = JSON.stringify([{ name: ACTIVATE, args: { names: [name] } }]);
  const deny = a.agent.ctx.tools.guard(exec => exec.name === ACTIVATE ? { reason: 'fixture PTC policy denied' } : undefined);
  const denied = await f.dispatch(a, [{ name: 'run_code', args: { code: program, description: 'Exercise denied nested activation with real PTC' } }]);
  assert.equal(valueOf(denied).result[0].ok, false);
  assert.equal(denied.logged.find(event => event.type === 'tool/ptc-dispatch').data.isError, true);
  assert.deepEqual(active(f, a), []); deny();
  const control = new AbortController();
  const cancel = a.agent.ctx.on('tools/execute', async (exec, next) => {
    const result = await next(); if (exec.name === ACTIVATE) control.abort(new Error('cancel nested activation')); return result;
  });
  await f.dispatch(a, [{ name: 'run_code', args: { code: program, description: 'Exercise cancelled nested activation with real PTC' } }], { signal: control.signal });
  cancel(); assert.deepEqual(active(f, a), []);
  assert.equal(f.calls.length, 0);
});

test('PTC projection requires matching nested root, parent and subcall plus exact successful receipt', async t => {
  const { f } = await setup(t); const a = await f.agent(), names = ['mcp__rea__probe_00'];
  const content = [{ type: 'text', text: JSON.stringify({ protocol: RECEIPT,
    sessionId: a.agent.id, activated: names, availableFrom: 'next-step' }) }];
  const start = { rootCallId: 'root', parentCallId: 'parent', subCallId: 'subcall',
    name: ACTIVATE, arguments: { names } };
  const result = { ...start, isError: false, content };
  a.agent.session.append('tool/ptc-dispatch', result); assert.deepEqual(active(f, a), []);
  for (const [index, mismatch] of [{ rootCallId: 'foreign-root' }, { parentCallId: 'foreign-parent' },
    { subCallId: 'foreign-subcall' }, { name: 'read' }, { isError: true }].entries()) {
    const subCallId = `subcall-${index}`;
    a.agent.session.append('tool/ptc-dispatch-start', { ...start, subCallId });
    a.agent.session.append('tool/ptc-dispatch', { ...result, subCallId, ...mismatch });
    assert.deepEqual(active(f, a), []);
  }
  a.agent.session.append('tool/ptc-dispatch-start', start);
  a.agent.session.append('tool/ptc-dispatch', result);
  assert.deepEqual(active(f, a), names);
});

test('PTC successful nested receipt resumes without program or business replay; fork prefix is not inherited activation', async t => {
  const { f } = await setup(t); const preset = f.preset('ptc-restore');
  const { runtime } = await f.enablePtc(preset); const a = await f.agent({ id: 'ptc-resume', preset });
  const name = 'mcp__rea__probe_00';
  valueOf(await f.dispatch(a, [{ name: 'run_code', args: {
    code: JSON.stringify([{ name: ACTIVATE, args: { names: [name] } }]),
    description: 'Record nested disclosure receipt before session resume',
  } }]));
  const seed = a.agent.session.snapshotEvents(), header = a.agent.session.header;
  assert.equal(runtime.capturedBindings.length, 1); assert.equal(f.calls.length, 0);
  await a.dispose();
  const resumed = await f.agent({ id: header.id, preset, seed, header, source: 'resume' });
  assert.deepEqual(active(f, resumed), [name]);
  const next = await f.resolve(resumed); next.dispose();
  assert.equal(runtime.capturedBindings.length, 1, 'Restore must not rerun source evaluation');
  assert.equal(f.calls.length, 0, 'Restore must not run business tools');
  const child = await f.agent({ id: 'ptc-fork', preset, seed,
    inheritedEventCount: seed.length, parentAgent: resumed.agent });
  assert.deepEqual(active(f, child), []);
  assert.ok(!f.names(child).includes(name));
});
