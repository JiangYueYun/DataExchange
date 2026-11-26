// src/tuning.mjs
import z from "@deepseek-ai/schemastery";
import { Service } from "@deepseek-ai/cordis";

// src/prompt.mjs
var LANGUAGE_SLOT = "{{language}}";
var DEFAULT_PROMPT = [
  "You are a compaction engine for this AI coding assistant. The conversation above is the material to condense into one checkpoint that lets another model resume the work without losing essential context.",
  "",
  LANGUAGE_SLOT,
  "",
  'Output exactly the Markdown structure below, in this order. Keep every section; write "(none)" only when a section is genuinely empty.',
  "",
  "## Primary Request and Intent",
  "- The user's original goal and how it evolved. Quote the user's own words verbatim wherever the exact wording carries the requirement (constraints, corrections, acceptance criteria).",
  "",
  "## Decisions and Rejected Options",
  "- Decision -> why it was taken -> which alternatives were rejected and why. Include decisions the user made.",
  "",
  "## Evidence and Findings",
  "- Findings with their evidence: file path and line, command run, measured number, error string, log line. Keep the number and the source; drop the narration of how the search was performed.",
  "",
  "## Files and Code",
  "- Exact absolute or repository-relative path: what it contains, what changed, and the exact snippet when the snippet is the point.",
  "",
  "## Errors and Fixes",
  "- Error text verbatim -> cause -> fix, plus anything the user said about it.",
  "",
  "## User Corrections and Preferences",
  "- Every correction, rejection, or stated preference, quoted verbatim. This section overrides your own summary judgement: a correction that is dropped will be repeated as a mistake.",
  "",
  "## Open Items and Unknowns",
  "- Explicitly requested work not yet done, questions still open, assumptions still unverified, and known failure modes of what was done.",
  "",
  "## Current State",
  "- What is true right now: what works, what was only attempted, what is unverified, what was rolled back.",
  "",
  "## Next Step",
  '- The single next action that follows from the most recent request, or "(none)".',
  "",
  "Rules:",
  "- Preserve exact file paths, commands, error strings, identifiers, numeric values, function signatures, and syntax fragments. Never paraphrase them.",
  "- Do not invent facts. If the conversation does not establish something, leave it out or mark it unknown.",
  "- If the material above already contains a <compacted-summary> block, it is a PRIOR checkpoint: merge it, do not restart from it. Every still-open item, constraint, correction, and unverified assumption in it must survive into the new checkpoint.",
  '- When newer material contradicts a prior checkpoint item, write the supersession explicitly: "old statement -> replaced by new statement (reason)". Never delete a superseded item silently, and never delete an item merely because it is old.',
  "- Length follows content, not brevity: keep every fact that a competent engineer would need to continue without re-reading the conversation. Do not compress by omitting evidence.",
  "- Do not mention this summarization request, the compaction process, or the fact that context was compacted.",
  "- Output only the checkpoint text. Do not call any tool and do not take any other action."
].join("\n");
var MINIMAL_PROMPT = [
  "Condense the conversation above into one checkpoint that lets another model continue the work.",
  "",
  LANGUAGE_SLOT,
  "",
  "Preserve the original request verbatim, every user correction, every open item, every exact path, command, number, and error string. Never delete an item because it is old; mark superseded items as superseded. Output only the checkpoint text."
].join("\n");

// src/tuning.mjs
var DEFAULTS = Object.freeze({
  enabled: true,
  thresholdRatio: 0.35,
  headroomTokens: 65536,
  retainRatio: 0.3,
  retainTokens: void 0,
  maxSummaryTokens: 65536,
  compactionRetries: 1,
  maxOverflowRetries: 1,
  overflowRetainTokens: 0,
  summarizationProvider: "",
  summarizationModel: "",
  language: "auto",
  prompt: DEFAULT_PROMPT,
  outputCapEnabled: true,
  outputCapDefault: 98304,
  outputCapByPreset: "{}",
  outputCapByWorkspace: "{}"
});
var Config = z.object({
  enabled: z.boolean().default(true).volatile().description("Enable automatic pressure compaction and overflow recovery."),
  thresholdRatio: z.number().min(0.05).max(1).default(0.35).volatile().description("Compact when measured pressure reaches this fraction of the context window."),
  headroomTokens: z.number().step(1).min(0).default(65536).volatile().description("Extra pressure margin reserved on top of the request output budget."),
  retainRatio: z.number().min(0.05).max(1).default(0.3).volatile().description("Verbatim recent tail as a fraction of the message budget; ignored when retainTokens is set."),
  retainTokens: z.number().step(1).min(0).volatile().description("Absolute verbatim tail budget; overrides retainRatio when set."),
  maxSummaryTokens: z.number().step(1).min(256).default(65536).volatile().description("Output cap for one checkpoint request."),
  compactionRetries: z.number().step(1).min(0).max(10).default(1).volatile().description("Extra compaction attempts inside one trigger when pressure stays above the threshold."),
  maxOverflowRetries: z.number().step(1).min(0).max(10).default(1).volatile().description("Retries after a provider-confirmed context overflow; 0 disables recovery."),
  overflowRetainTokens: z.number().step(1).min(0).default(0).volatile().description("Verbatim tail kept during overflow recovery; 0 compacts everything but the last node."),
  summarizationProvider: z.string().default("").volatile().description("Summary route provider; empty follows the answered model."),
  summarizationModel: z.string().default("").volatile().description("Summary route model; empty follows the answered model."),
  language: z.union(["auto", "zh", "en"]).default("auto").volatile().description("Checkpoint language: follow the conversation, Chinese, or English."),
  prompt: z.string().default(DEFAULT_PROMPT).volatile().description("Checkpoint instruction. Empty falls back to a minimal instruction."),
  outputCapEnabled: z.boolean().default(true).volatile().description("Clamp the output reservation of every routed request, whatever the model."),
  outputCapDefault: z.number().step(1).min(256).default(98304).volatile().description("Reservation cap for models and sessions without an override."),
  outputCapByPreset: z.string().default("{}").volatile().description("JSON object mapping an agent preset id to a reservation cap."),
  outputCapByWorkspace: z.string().default("{}").volatile().description("JSON object mapping a working-directory prefix to a reservation cap.")
});
function plain(value) {
  return value !== null && typeof value === "object" && typeof value.get === "function" ? value.get() : value;
}
var CompactionTuning = class extends Service {
  static Config = Config;
  /** Parsed config whose volatile entries are live references. Plain property: Cordis resolves services through a Proxy, and a JS private field would not survive `ctx.compactionTuning.snapshot()`. */
  /**
   * @param ctx - host context.
   * @param config - parsed plugin configuration.
   */
  constructor(ctx, config = {}) {
    super(ctx, "compactionTuning");
    this.parsedConfig = config;
    ctx.on("agent/request", async ({ agent }, next) => {
      const routed = await next();
      const cap = resolveCap(this.snapshot(), agent?.session?.header);
      if (cap === void 0) return routed;
      const current = routed.maxTokens;
      if (current !== void 0 && current <= cap) return routed;
      return { ...routed, maxTokens: cap };
    }, { prepend: true });
  }
  /**
   * Current tuning values, read fresh on every call.
   * @returns plain values with defaults applied.
   */
  snapshot() {
    const out = {};
    for (const key of Object.keys(DEFAULTS)) {
      const value = plain(this.parsedConfig[key]);
      out[key] = value === void 0 ? DEFAULTS[key] : value;
    }
    return out;
  }
};
function parseCapMap(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}
function resolveCap(tuning, header) {
  if (tuning.outputCapEnabled !== true) return void 0;
  const byPreset = parseCapMap(tuning.outputCapByPreset);
  const byWorkspace = parseCapMap(tuning.outputCapByWorkspace);
  const preset = header?.agentPreset;
  if (typeof preset === "string" && Number.isFinite(byPreset[preset])) return byPreset[preset];
  const cwd = typeof header?.cwd === "string" ? header.cwd : "";
  let best;
  for (const [prefix, value] of Object.entries(byWorkspace)) {
    if (!Number.isFinite(value) || prefix === "" || !cwd.startsWith(prefix)) continue;
    if (best === void 0 || prefix.length > best.length) best = { length: prefix.length, value };
  }
  if (best !== void 0) return best.value;
  return Number.isFinite(tuning.outputCapDefault) ? tuning.outputCapDefault : void 0;
}
export {
  Config,
  DEFAULTS,
  CompactionTuning as default,
  resolveCap
};
