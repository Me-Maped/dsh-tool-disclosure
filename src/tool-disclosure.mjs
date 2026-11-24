/** Session-local tool disclosure across presets. DSH retains executors, activation and policy. */
import { importDsh } from '../scripts/dsh-runtime.mjs';
// Load Cordis first: its ESM dependencies must settle before schemastery's CJS require bridge.
await importDsh('@deepseek-ai/cordis');
const { default: z } = await importDsh('@deepseek-ai/schemastery');
const { z: stateZ } = await importDsh('zod');
const { scopeParentOf } = await importDsh('@deepseek-ai/dsh-scope');
const { defineTool } = await importDsh('@deepseek-ai/dsh-tools');

export const name = 'tool-disclosure';
export const inject = ['tools', 'agents', 'sessionProjections', 'systemPrompt'];
export const SEARCH = 'tool_search';
export const ACTIVATE = 'tool_activate';
export const RECEIPT = 'local-tool-disclosure/v1';
export const DEFAULT_BOOTSTRAP = [
  'bash', 'pwsh', 'read', 'read_image', 'glob', 'grep', 'working_directory', 'skill',
  'ask_user_question', 'exit_plan_mode', 'job_output', 'job_kill', 'job_list',
];
export const Config = z.object({
  bootstrapTools: z.array(z.string()).default(DEFAULT_BOOTSTRAP),
  maxSearchResults: z.natural().min(1).max(8).default(8),
  descriptionChars: z.natural().min(40).max(240).default(240),
});
const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => item === b[i]);
const validName = name => typeof name === 'string' && name.length > 0 && name.length <= 256
  && !['run_code', SEARCH, ACTIVATE].includes(name);

export function activationNames(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)
    || Object.keys(args).some(key => key !== 'names') || !Array.isArray(args.names)
    || args.names.length < 1 || args.names.length > 8 || !args.names.every(validName)) {
    throw new Error('names must contain 1–8 exact capability names (not run_code or discovery tools)');
  }
  return [...new Set(args.names)].sort();
}

/** Only this Session's paired, committed successful receipts count. Fork prefixes are not grants. */
export const projection = {
  key: 'localToolDisclosure', stateVersion: 1,
  stateSchema: stateZ.object({
    sessionId: stateZ.string(), floor: stateZ.number().int().nonnegative(),
    active: stateZ.array(stateZ.string()),
    pending: stateZ.array(stateZ.object({
      id: stateZ.string(), names: stateZ.array(stateZ.string()),
      channel: stateZ.enum(['native', 'ptc']), root: stateZ.string(), parent: stateZ.string(),
    })),
  }),
  init: (header, inheritedEventCount) => ({ sessionId: header.id, floor: inheritedEventCount, active: [], pending: [] }),
  apply(state, event) {
    if (event.seq < state.floor) return state;
    if (event.type === 'turn/end') return state.pending.length ? { ...state, pending: [] } : state;
    const nativeStart = event.type === 'tool/call';
    const ptcStart = event.type === 'tool/ptc-dispatch-start';
    if ((nativeStart || ptcStart) && event.data.name === ACTIVATE) {
      try {
        const names = activationNames(nativeStart ? JSON.parse(event.data.arguments) : event.data.arguments);
        const pending = nativeStart
          ? { id: event.data.callId, names, channel: 'native', root: '', parent: '' }
          : { id: event.data.subCallId, names, channel: 'ptc', root: event.data.rootCallId, parent: event.data.parentCallId };
        return { ...state, pending: [...state.pending.filter(p => p.id !== pending.id), pending] };
      } catch { return state; }
    }
    const nativeEnd = event.type === 'tool/result';
    if (!nativeEnd && event.type !== 'tool/ptc-dispatch') return state;
    const message = nativeEnd ? event.data.message : {
      toolCallId: event.data.subCallId, content: event.data.content, isError: event.data.isError,
    };
    const pending = state.pending.find(p => p.id === message.toolCallId
      && p.channel === (nativeEnd ? 'native' : 'ptc')
      && (nativeEnd || (p.root === event.data.rootCallId && p.parent === event.data.parentCallId && event.data.name === ACTIVATE)));
    if (!pending) return state;
    const next = { ...state, pending: state.pending.filter(p => p !== pending) };
    if (message.isError || event.data.error || (nativeEnd
      && (message.source?.kind !== 'tool' || message.source.callId !== message.toolCallId))) return next;
    if (message.content?.length !== 1 || message.content[0].type !== 'text') return next;
    try {
      const receipt = JSON.parse(message.content[0].text);
      if (receipt.protocol !== RECEIPT || receipt.sessionId !== state.sessionId
        || !Array.isArray(receipt.activated) || !same(receipt.activated, pending.names)) return next;
      return { ...next, active: [...new Set([...state.active, ...pending.names])].sort() };
    } catch { return next; }
  },
};

export function searchCatalog(definitions, active, args, config) {
  if (!args || typeof args !== 'object' || Array.isArray(args)
    || Object.keys(args).some(key => !['query', 'offset', 'limit'].includes(key))
    || typeof args.query !== 'string' || args.query.length > 256) throw new Error('query must be a string of at most 256 characters');
  const offset = args.offset ?? 0, limit = args.limit ?? config.maxSearchResults;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit)
    || limit < 1 || limit > config.maxSearchResults) throw new Error(`offset must be nonnegative; limit must be 1–${config.maxSearchResults}`);
  const query = args.query.toLowerCase().trim();
  const terms = query.split(/\s+/).filter(Boolean);
  const matches = definitions.filter(tool => validName(tool.name)).filter(tool => {
    const text = `${tool.name} ${tool.description}`.toLowerCase();
    return terms.every(term => text.includes(term));
  }).sort((a, b) => {
    const rank = tool => tool.name.toLowerCase() === query ? 0 : tool.name.toLowerCase().includes(query) ? 1 : 2;
    return rank(a) - rank(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  });
  const end = offset + limit;
  return {
    tools: matches.slice(offset, end).map(tool => ({
      name: tool.name,
      description: String(tool.description ?? '').replace(/\s+/g, ' ').slice(0, config.descriptionChars),
      activated: active.includes(tool.name),
    })), total: matches.length, nextOffset: end < matches.length ? end : null,
  };
}

export async function apply(ctx, config) {
  const unknown = Object.keys(config).filter(key => !['bootstrapTools', 'maxSearchResults', 'descriptionChars'].includes(key));
  if (unknown.length) throw new Error(`Unknown tool-disclosure settings: ${unknown.join(', ')}`);
  const handle = await ctx.sessionProjections.register(projection);
  const bootstrap = new Set(config.bootstrapTools);
  const states = new Map(), owners = new Map(), retired = new WeakSet();
  let refreshing = false, closing = false;
  // The Agent's parent is its standing preset, not another Agent; never borrow another preset's tools.
  const catalog = agent => ctx.tools.definitions(scopeParentOf(agent));

  function refresh(state) {
    try {
      const active = handle.stateOf(state.agent.session).active;
      const inherited = catalog(state.agent);
      if (inherited.some(tool => [SEARCH, ACTIVATE].includes(tool.name))) throw new Error('Tool disclosure name collision');
      const allow = inherited.filter(tool => bootstrap.has(tool.name) || active.includes(tool.name)).map(tool => tool.name).sort();
      if (!state.error && same(allow, state.allow)) { state.activeRef = active; return; }
      const previous = state.mask;
      const next = state.agent.ctx.tools.restrict({ allow });
      state.mask = next; state.allow = allow; state.activeRef = active; state.error = undefined;
      previous?.(); // New restriction intersects the old until its removal; no temporary unmasking.
    } catch (error) { state.error = error; throw error; }
  }

  function searchDefinition() {
    return defineTool({
      name: SEARCH,
      description: 'Find on-demand tools by exact name or literal English keywords. Empty query lists a page. Returns short untrusted summaries, not schemas. Search only when existing tools are insufficient.',
      parameters: {
        query: { type: 'string', required: true },
        offset: { type: 'integer', description: 'Zero-based result offset; default 0.' },
        limit: { type: 'integer', description: `Results per page, 1–${config.maxSearchResults}; default ${config.maxSearchResults}.` },
      },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const state = states.get(exec.agent);
        if (!state || state.error) throw new Error('Tool disclosure is not initialized or its registry update failed');
        const active = [...bootstrap, ...handle.stateOf(exec.agent.session).active];
        return searchCatalog(catalog(exec.agent), active, args, config);
      },
    });
  }
  function activateDefinition() {
    return defineTool({
      name: ACTIVATE,
      description: 'Expose selected tools from the next model step. Does not execute them, grant permissions, or bypass skill/availability conditions. Use exact names from tool_search; call selected tools in a later response.',
      parameters: { names: { type: 'array', required: true, items: { type: 'string' }, description: '1–8 exact capability names; no patterns or run_code.' } },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      async execute(args, exec) {
        const state = states.get(exec.agent);
        if (!state || state.error) throw new Error('Tool disclosure is not initialized or its registry update failed');
        const names = activationNames(args);
        const available = new Set(catalog(exec.agent).map(tool => tool.name));
        const missing = names.filter(name => !available.has(name));
        if (missing.length) throw new Error(`Unavailable tools in this preset: ${missing.join(', ')}`);
        // No state mutation here: rejected/cancelled/unlogged results are not activation receipts.
        return { protocol: RECEIPT, sessionId: exec.agent.id, activated: names, availableFrom: 'next-step' };
      },
    });
  }
  function ensureAgent(agent) {
    if (states.has(agent) || retired.has(agent) || !agent.ctx || !agent.session) return;
    const state = { agent, allow: undefined, mask: undefined, error: undefined, setupFailed: false };
    const dispose = agent.ctx.effect(() => {
      states.set(agent, state);
      const cleanup = [];
      const release = () => {
        retired.add(agent); states.delete(agent); owners.delete(agent);
        for (const off of cleanup.reverse()) off();
        state.mask?.();
      };
      // Install the fail-closed check before any fallible registration or mask operation.
      cleanup.push(agent.ctx.on('agent/pre-step', (_payload, next) => {
        if (state.error) throw new Error(`Tool disclosure failed: ${state.error.message}`);
        return next();
      }));
      try {
        if (catalog(agent).some(tool => [SEARCH, ACTIVATE].includes(tool.name))) throw new Error('Tool disclosure name collision');
        cleanup.push(agent.ctx.tools.register(searchDefinition()));
        cleanup.push(agent.ctx.tools.register(activateDefinition()));
        cleanup.push(agent.ctx.systemPrompt.section({
          name: 'local-tool-disclosure', order: 5100,
          text: 'Additional tools are available on demand: use tool_search, then tool_activate with up to 8 exact names. Their schemas appear next step; do not activate and call a new tool in the same response. In PTC use the discovery SDK bindings through run_code. Activation does not execute tools, authorize changes or bypass existing skill/availability conditions. Use available core tools directly for simple tasks.',
        }));
        cleanup.push(agent.ctx.on('session/event', (session, event) => {
          if (session === agent.session && ['tool/result', 'tool/ptc-dispatch'].includes(event.type)
            && handle.stateOf(session).active !== state.activeRef) refreshAll();
        }));
      } catch (error) { state.error = error; state.setupFailed = true; }
      return release;
    }, 'local-tool-disclosure.agent');
    owners.set(agent, dispose);
  }
  function refreshAll() {
    if (refreshing || closing) return;
    refreshing = true;
    try {
      // Also covers selecting another preset on an already-created blank Agent.
      for (const agent of ctx.agents.list()) ensureAgent(agent);
      for (const state of states.values()) {
        if (state.setupFailed) continue;
        try { refresh(state); } catch { /* pre-step blocks the request; event observers cannot authorize a fallback */ }
      }
    } finally { refreshing = false; }
  }
  ctx.on('tools/change', refreshAll);
  ctx.on('agent/created', ({ agent }) => {
    ensureAgent(agent); refreshAll();
    if (states.get(agent)?.error) throw states.get(agent).error;
  });
  ctx.effect(() => () => { closing = true; for (const dispose of [...owners.values()]) dispose(); });
  refreshAll();
  // Optional, read-only diagnostics: counts and character budgets, never full catalogs or schemas.
  ctx.inject(['cordisInspect'], scope => {
    scope.effect(() => scope.cordisInspect.register({
      manifest: {
        id: 'ToolDisclosure', description: 'Read-only tool-disclosure footprints for live Agents; estimates are not billing.',
        methods: [{ name: 'measure', description: 'Page original versus visible registered-tool counts and serialized character budgets.',
          inputSchema: { type: 'object', properties: { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 32 } }, additionalProperties: false },
          outputSchema: { type: 'object' } }],
      },
      async query(method, input = {}) {
        if (method !== 'measure') throw new Error('Unknown ToolDisclosure method');
        const offset = input?.offset ?? 0, limit = input?.limit ?? 8;
        if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 32) throw new Error('Invalid diagnostic page');
        const rows = [...states.values()].sort((a, b) => a.agent.id < b.agent.id ? -1 : a.agent.id > b.agent.id ? 1 : 0);
        return {
          total: rows.length, nextOffset: offset + limit < rows.length ? offset + limit : null,
          note: 'Registered visibility before original per-step conditions; characters and /4 estimates are not provider billing.',
          agents: rows.slice(offset, offset + limit).map(state => {
            const original = catalog(state.agent).map(({ name, description, parameters }) => ({ name, description, parameters }));
            const visible = ctx.tools.schemas(state.agent);
            const originalChars = JSON.stringify(original).length, visibleChars = JSON.stringify(visible).length;
            return { sessionId: state.agent.id, originalCount: original.length, visibleCount: visible.length,
              originalChars, visibleChars, originalEstimate: Math.ceil(originalChars / 4) + 4,
              visibleEstimate: Math.ceil(visibleChars / 4) + 4,
              selectedCount: handle.stateOf(state.agent.session).active.length, failed: Boolean(state.error) };
          }),
        };
      },
    }), 'local-tool-disclosure.inspect');
  });
}
