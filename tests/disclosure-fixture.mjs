/** Offline integration fixture: installed DSH registries, scopes, native executor and durable Session log.
 * No profile, storage backend, network, subprocess, dependency installation or model is used.
 * Agents use the real AgentRegistry lifecycle with an inert driver. Business tool bodies
 * and the explicitly documented in-process PTC source-evaluation boundary are fixtures.
 */
import assert from 'node:assert/strict';
import { importDsh } from '../scripts/dsh-runtime.mjs';

export const { Context, resolveConfig } = await importDsh('@deepseek-ai/cordis');
export const { createScope, bindScopeParent, scopeParentOf, scopeTarget } = await importDsh('@deepseek-ai/dsh-scope');
export const { ToolsService, defineTool, projectToolSchema } = await importDsh('@deepseek-ai/dsh-tools');
export const { Session, SessionStore, SessionLogOffset } = await importDsh('@deepseek-ai/dsh-session');
const { SystemPrompt } = await importDsh('@deepseek-ai/dsh-system-prompt');
const { SessionProjectionRegistry } = await importDsh('@deepseek-ai/dsh-session-projection');
const { AgentRegistry, agentEvents } = await importDsh('@deepseek-ai/dsh-agent');
const { NativeToolExecutor } = await importDsh('@deepseek-ai/dsh-tool-executor-native');
export const { PtcExecutor } = await importDsh('@deepseek-ai/dsh-tool-executor-ptc');
const { PtcRuntime } = await importDsh('@deepseek-ai/dsh-ptc-runtime');
const { LocalFileSystem } = await importDsh('@deepseek-ai/dsh-fs-local');
const { WorkingDirectoryService } = await importDsh('@deepseek-ai/dsh-working-directory');

/** Explicit test runtime: JSON instructions invoke actual executor-owned bindings.
 * Only source evaluation is substituted; PTC transport, nested pipeline, validation,
 * correlation, output projection, cancellation and durable logs are installed DSH.
 * Never evaluates JavaScript or launches a process.
 */
class OfflineBindingRuntime extends PtcRuntime {
  language = 'typescript';
  isolation = 'test-in-process';
  capturedBindings = [];
  resolve(request) { return { ...request, cwd: request.cwd ?? process.cwd(), timeoutMs: 60000 }; }
  async run(spec) {
    const functions = spec.bindings.find(binding => binding.global === 'tools').functions;
    this.capturedBindings.push(Object.keys(functions));
    const values = [];
    for (const instruction of JSON.parse(spec.program)) {
      try {
        if (!Object.hasOwn(functions, instruction.name)) throw new Error(`Unavailable binding: ${instruction.name}`);
        values.push({ ok: true, value: await functions[instruction.name](instruction.args) });
      } catch (error) { values.push({ ok: false, error: error.message }); }
    }
    return { logs: [], value: values };
  }
}

export async function settle(fiber) {
  await fiber.await();
  assert.equal(fiber.error, undefined);
  return fiber;
}
export async function disposeFiber(fiber) {
  await fiber.dispose();
  while (fiber.inertia) await fiber.inertia;
}

/** Register a normal, full-schema tool; dispatch records exactly when its body runs. */
export function fixtureTool(name, calls, overrides = {}) {
  return defineTool({
    name,
    description: `Fixture ${name} reverse engineering catalog. ${'Long description '.repeat(30)}`,
    parameters: {
      path: { type: 'string', required: true, description: 'Exact local artifact path.' },
      mode: { type: 'string', enum: ['summary', 'complete'], description: 'Report mode.' },
      options: { type: 'object', additionalProperties: false, properties: {
        depth: { type: 'integer', required: true },
      } },
    },
    output: { schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      calls.push({ name, args: structuredClone(args), agentId: exec.agent?.id });
      return { name, path: args.path };
    },
    ...overrides,
  });
}

export async function createFixture() {
  const ctx = new Context();
  const services = [];
  for (const [plugin, config] of [[SystemPrompt, { includeHarnessIdentity: false }],
    [ToolsService, {}], [SessionStore, {}], [SessionProjectionRegistry, {}], [AgentRegistry, {}]]) {
    services.push(await settle(ctx.plugin(plugin, config)));
  }
  ctx.tools.setExecutor(new NativeToolExecutor(ctx));
  let owner;
  await settle(ctx.plugin({ name: 'offline-disclosure-fixture',
    inject: ['tools', 'systemPrompt', 'sessions', 'sessionProjections', 'agents'],
    apply(context) { owner = context; },
  }));
  const calls = [];
  const published = [];
  const warnings = [];
  ctx.on('session/event', (session, event) => published.push({ session, event }));
  ctx.on('internal/warning', warning => warnings.push(warning));
  let nextId = 0;
  const presets = new Map();
  const agents = new Set();

  const fixture = {
    ctx, calls, published, warnings, services,
    async mount(plugin, config = {}, owner = ctx) {
      return settle(owner.plugin(plugin, config));
    },
    preset(name) {
      if (!presets.has(name)) {
        const key = { preset: name };
        presets.set(name, { key, ...createScope(owner, key) });
      }
      return presets.get(name);
    },
    register(name, { owner = ctx, when, ...overrides } = {}) {
      const definition = fixtureTool(name, calls, overrides);
      return { definition, dispose: owner.tools.register(definition, when ? { when } : {}) };
    },
    /** parentAgent is causal metadata only; scope ancestry belongs to the selected preset. */
    async agent({ id = `fixture-${++nextId}`, preset = fixture.preset('standard'), parentAgent,
      seed, inheritedEventCount = 0, header, source = 'startup', beforeAnnounce } = {}) {
      const agent = { id, parentAgent, options: {}, status: 'idle',
        cancel() {}, whenIdle: async () => {}, inject() { throw new Error('No model driver in offline fixture'); } };
      const binding = bindScopeParent(agent, preset.key);
      const scope = createScope(owner, agent);
      agent.ctx = scope.ctx;
      const sessionOptions = { ...(seed ? { seed } : {}),
        inheritedEventCount: SessionLogOffset(inheritedEventCount),
        meta: { ...(header ?? {}), agentPreset: preset.key.preset,
          ...(inheritedEventCount > 0 ? { isSeeded: true } : {}),
          ...(parentAgent ? { parentSession: parentAgent.id, origin: 'subagent' } : {}) } };
      agent.session = agent.ctx.sessions.create(id, sessionOptions);
      assert.ok(agent.session instanceof Session, 'Must use installed DSH Session');
      const detach = ctx.agents.enter(agent);
      const events = agentEvents(ctx, agent);
      const handle = { agent, scope, binding, events,
        rebind(nextPreset) { binding.rebind(nextPreset.key); },
        async dispose() { detach(); await scope.dispose(); agents.delete(handle); } };
      agents.add(handle);
      try {
        await beforeAnnounce?.(handle);
        await ctx.agents.announce(agent, source);
      } catch (error) { await handle.dispose(); throw error; }
      return handle;
    },
    async resolve(handle, signal = new AbortController().signal) {
      const toolSet = await ctx.tools.resolve({ agent: handle.agent,
        modelSelection: { provider: 'offline', model: 'none' }, signal });
      try {
        const assembly = await ctx.systemPrompt.assemble({ scope: handle.agent, agent: handle.agent, toolSet, signal });
        await handle.events.waterfall('agent/pre-step', { assembly, toolSet, signal }, async () => undefined);
        return toolSet;
      } catch (error) { toolSet.dispose(); throw error; }
    },
    names(handle, toolSet) { return ctx.tools.schemas(handle.agent, toolSet).map(tool => tool.name).sort(); },
    schemas(handle, toolSet) { return ctx.tools.schemas(handle.agent, toolSet); },
    /** ToolSet is captured once per response, retained until every call settles. */
    async dispatch(handle, entries, { toolSet, signal = new AbortController().signal,
      turn = 1, step = 1 } = {}) {
      const ownSet = toolSet === undefined;
      const admitted = toolSet ?? await fixture.resolve(handle, signal);
      const blocks = entries.map(entry => ({ type: 'tool-call', id: entry.id ?? `call-${++nextId}`,
        name: entry.name, arguments: typeof entry.args === 'string' ? entry.args : JSON.stringify(entry.args ?? {}) }));
      const before = handle.agent.session.seq;
      try {
        const batch = await ctx.tools.execute({ agent: handle.agent, calls: blocks,
          toolSet: admitted, signal, log: { turn, step } });
        const logged = handle.agent.session.snapshotEvents(before);
        for (const block of blocks) {
          const call = logged.find(event => event.type === 'tool/call' && event.data.callId === block.id);
          const result = logged.find(event => event.type === 'tool/result' && event.data.message.toolCallId === block.id);
          assert.ok(call, `Real executor must log call ${block.id}`);
          assert.ok(result, `Real executor must log result ${block.id}`);
          assert.deepEqual(result.sourceEventSeqs, [call.seq]);
          assert.equal(result.data.message.source.kind, 'tool');
          assert.equal(result.data.message.source.callId, block.id);
          assert.ok(published.some(item => item.session === handle.agent.session && item.event === result),
            'SessionStore must publish the exact committed result to projection subscribers');
        }
        return { ...batch, blocks, logged };
      } finally { if (ownSet) admitted.dispose(); }
    },
    async enablePtc(preset) {
      // Real directory service performs only resolve/stat on process.cwd().
      await settle(ctx.plugin(LocalFileSystem, {}));
      await settle(ctx.plugin(WorkingDirectoryService, {}));
      await settle(ctx.plugin(OfflineBindingRuntime, {}));
      const executor = new PtcExecutor(ctx);
      preset.ctx.tools.setExecutor(executor);
      return { executor, runtime: ctx.ptcRuntime };
    },
    checkpoint(handle) { return ctx.sessionProjections.checkpoint(handle.agent.session); },
    async dispose() {
      for (const handle of [...agents]) await handle.dispose();
      for (const preset of presets.values()) await preset.dispose();
      await disposeFiber(ctx.fiber);
    },
  };
  return fixture;
}

export function valueOf(batch, index = 0) {
  const result = batch.results[index].result;
  assert.equal(result.isError, false, JSON.stringify(result));
  return result.value;
}
export function errorOf(batch, index = 0) {
  const result = batch.results[index].result;
  assert.equal(result.isError, true, JSON.stringify(result));
  return result.error;
}
