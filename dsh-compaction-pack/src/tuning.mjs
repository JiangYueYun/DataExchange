/**
 * Host half: the pack's single source of compaction tuning.
 *
 * Every field is `volatile()`, so the settings card (and the Loader's
 * volatile-update path) can change it while the process runs. The engine reads
 * {@link CompactionTuning.snapshot} on every decision, so an edited value takes
 * effect on the next step without a restart.
 */

import z from '@deepseek-ai/schemastery'
import { Service } from '@deepseek-ai/cordis'
import { DEFAULT_PROMPT } from './prompt.mjs'

/** Fallback values used before the Loader supplies a parsed config. */
export const DEFAULTS = Object.freeze({
  enabled: true,
  thresholdRatio: 0.35,
  headroomTokens: 65536,
  retainRatio: 0.3,
  retainTokens: undefined,
  maxSummaryTokens: 65536,
  compactionRetries: 1,
  maxOverflowRetries: 1,
  overflowRetainTokens: 0,
  summarizationProvider: '',
  summarizationModel: '',
  language: 'auto',
  prompt: DEFAULT_PROMPT,
  outputCapEnabled: true,
  outputCapDefault: 98304,
  outputCapByPreset: '{}',
  outputCapByWorkspace: '{}',
})

/** Public configuration schema; every field is live-editable. */
export const Config = z.object({
  enabled: z.boolean().default(true).volatile()
    .description('Enable automatic pressure compaction and overflow recovery.'),
  thresholdRatio: z.number().min(0.05).max(1).default(0.35).volatile()
    .description('Compact when measured pressure reaches this fraction of the context window.'),
  headroomTokens: z.number().step(1).min(0).default(65536).volatile()
    .description('Extra pressure margin reserved on top of the request output budget.'),
  retainRatio: z.number().min(0.05).max(1).default(0.3).volatile()
    .description('Verbatim recent tail as a fraction of the message budget; ignored when retainTokens is set.'),
  retainTokens: z.number().step(1).min(0).volatile()
    .description('Absolute verbatim tail budget; overrides retainRatio when set.'),
  maxSummaryTokens: z.number().step(1).min(256).default(65536).volatile()
    .description('Output cap for one checkpoint request.'),
  compactionRetries: z.number().step(1).min(0).max(10).default(1).volatile()
    .description('Extra compaction attempts inside one trigger when pressure stays above the threshold.'),
  maxOverflowRetries: z.number().step(1).min(0).max(10).default(1).volatile()
    .description('Retries after a provider-confirmed context overflow; 0 disables recovery.'),
  overflowRetainTokens: z.number().step(1).min(0).default(0).volatile()
    .description('Verbatim tail kept during overflow recovery; 0 compacts everything but the last node.'),
  summarizationProvider: z.string().default('').volatile()
    .description('Summary route provider; empty follows the answered model.'),
  summarizationModel: z.string().default('').volatile()
    .description('Summary route model; empty follows the answered model.'),
  language: z.union(['auto', 'zh', 'en']).default('auto').volatile()
    .description('Checkpoint language: follow the conversation, Chinese, or English.'),
  prompt: z.string().default(DEFAULT_PROMPT).volatile()
    .description('Checkpoint instruction. Empty falls back to a minimal instruction.'),
  outputCapEnabled: z.boolean().default(true).volatile()
    .description('Clamp the output reservation of every routed request, whatever the model.'),
  outputCapDefault: z.number().step(1).min(256).default(98304).volatile()
    .description('Reservation cap for models and sessions without an override.'),
  outputCapByPreset: z.string().default('{}').volatile()
    .description('JSON object mapping an agent preset id to a reservation cap.'),
  outputCapByWorkspace: z.string().default('{}').volatile()
    .description('JSON object mapping a working-directory prefix to a reservation cap.'),
})

/**
 * Read one configured value, unwrapping the volatile reference when present.
 * @param value - parsed config entry.
 * @returns the current plain value.
 */
function plain(value) {
  return value !== null && typeof value === 'object' && typeof value.get === 'function'
    ? value.get()
    : value
}

/** Live compaction tuning, readable by the preset-mounted engine. */
export default class CompactionTuning extends Service {
  static Config = Config

  /** Parsed config whose volatile entries are live references. Plain property: Cordis resolves services through a Proxy, and a JS private field would not survive `ctx.compactionTuning.snapshot()`. */

  /**
   * @param ctx - host context.
   * @param config - parsed plugin configuration.
   */
  constructor(ctx, config = {}) {
    super(ctx, 'compactionTuning')
    this.parsedConfig = config
    // One clamp for every routed model: the request header carries the value
    // that both the adapter sends as max_tokens and the compaction budget
    // reserves, so lowering it here raises every model's usable history.
    ctx.on('agent/request', async ({ agent }, next) => {
      const routed = await next()
      const cap = resolveCap(this.snapshot(), agent?.session?.header)
      if (cap === undefined) return routed
      const current = routed.maxTokens
      if (current !== undefined && current <= cap) return routed
      return { ...routed, maxTokens: cap }
    }, { prepend: true })
  }

  /**
   * Current tuning values, read fresh on every call.
   * @returns plain values with defaults applied.
   */
  snapshot() {
    const out = {}
    for (const key of Object.keys(DEFAULTS)) {
      const value = plain(this.parsedConfig[key])
      out[key] = value === undefined ? DEFAULTS[key] : value
    }
    return out
  }
}

/** Parse one JSON override map, ignoring anything malformed. */
function parseCapMap(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return {}
  try {
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed
  } catch {
    return {}
  }
}

/**
 * Resolve the output reservation cap for one request.
 * Order: agent preset override, longest matching workspace prefix, default.
 * @param tuning - tuning snapshot.
 * @param header - session header carrying `agentPreset` and `cwd`.
 * @returns the cap, or undefined to leave the routed value untouched.
 */
export function resolveCap(tuning, header) {
  if (tuning.outputCapEnabled !== true) return undefined
  const byPreset = parseCapMap(tuning.outputCapByPreset)
  const byWorkspace = parseCapMap(tuning.outputCapByWorkspace)
  const preset = header?.agentPreset
  if (typeof preset === 'string' && Number.isFinite(byPreset[preset])) return byPreset[preset]
  const cwd = typeof header?.cwd === 'string' ? header.cwd : ''
  let best
  for (const [prefix, value] of Object.entries(byWorkspace)) {
    if (!Number.isFinite(value) || prefix === '' || !cwd.startsWith(prefix)) continue
    if (best === undefined || prefix.length > best.length) best = { length: prefix.length, value }
  }
  if (best !== undefined) return best.value
  return Number.isFinite(tuning.outputCapDefault) ? tuning.outputCapDefault : undefined
}
