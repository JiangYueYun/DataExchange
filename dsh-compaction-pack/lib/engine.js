// src/engine.mjs
import { SessionSeq } from "@deepseek-ai/dsh-session";
import { toolPairingBalancedBefore } from "@deepseek-ai/dsh-compaction";
import { BasicCompactionEngine } from "@deepseek-ai/dsh-compaction-basic";
import { BlockAssembler, LlmError } from "@deepseek-ai/dsh-llm";

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
function languageRule(preference) {
  if (preference === "zh") return "Write the checkpoint in Chinese (\u7B80\u4F53\u4E2D\u6587). Keep code, paths, commands, and error strings verbatim.";
  if (preference === "en") return "Write the checkpoint in English. Keep code, paths, commands, and error strings verbatim.";
  return "Write the checkpoint in the language the user writes in. Keep code, paths, commands, and error strings verbatim.";
}
function buildInstruction(prompt, language) {
  const template = typeof prompt === "string" && prompt.trim().length > 0 ? prompt : MINIMAL_PROMPT;
  return template.replaceAll(LANGUAGE_SLOT, languageRule(language));
}

// src/engine.mjs
function completeRoute(route) {
  if (route === void 0 || route === null) return void 0;
  const provider = route.provider;
  const model = route.model;
  if (typeof provider !== "string" || provider.length === 0) return void 0;
  if (typeof model !== "string" || model.length === 0) return void 0;
  return { provider, model };
}
function latestAnsweredRoute(session) {
  for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
    const event = session.eventAt(SessionSeq(seq));
    if (event === void 0 || event.type !== "assistant/message") continue;
    return completeRoute(event.data.message.source);
  }
  return void 0;
}
function resolveSpec(tuning, contextWindow, reservedCompletionTokens) {
  const target = `context window ${contextWindow} / reserved ${reservedCompletionTokens}`;
  if (!Number.isInteger(contextWindow) || contextWindow <= 0) {
    throw new Error(`compaction-pack: ${target} is not a positive context window`);
  }
  const messageBudget = contextWindow - reservedCompletionTokens;
  const pressureBudget = messageBudget - tuning.headroomTokens;
  if (pressureBudget <= 0) {
    throw new Error(
      `compaction-pack: ${target} leaves no pressure budget after the ${tuning.headroomTokens}-token headroom; lower headroomTokens or raise the request output budget`
    );
  }
  const thresholdTokens = Math.floor(Math.min(contextWindow * tuning.thresholdRatio, pressureBudget));
  const retainTokens = tuning.retainTokens === void 0 ? Math.floor(messageBudget * tuning.retainRatio) : tuning.retainTokens;
  if (retainTokens >= thresholdTokens) {
    throw new Error(
      `compaction-pack: ${target} retain ${retainTokens} must stay below threshold ${thresholdTokens}`
    );
  }
  return { thresholdTokens, retainTokens };
}
function systemHead(session, headSeq) {
  const head = session.eventAt(headSeq);
  return head !== void 0 && head.type === "system/message" ? head : void 0;
}
function selectCompactableRange(session, measurement, retainTokens) {
  const pricedNodes = measurement.nodes;
  if (pricedNodes.length === 0) return null;
  const surfaceNodes = session.surface.nodes;
  if (surfaceNodes.length !== pricedNodes.length || surfaceNodes.some((seq, index) => seq !== pricedNodes[index]?.seq)) {
    throw new Error("compaction-pack: token-meter surface does not match the current session surface");
  }
  const firstIdx = systemHead(session, surfaceNodes[0]) === void 0 ? 0 : 1;
  let accumulated = 0;
  let keepFromIdx = pricedNodes.length;
  for (let index = pricedNodes.length - 1; index >= 0; index -= 1) {
    accumulated += pricedNodes[index].tokens;
    keepFromIdx = index;
    if (accumulated >= retainTokens) break;
  }
  if (keepFromIdx <= firstIdx) return null;
  while (keepFromIdx > firstIdx) {
    if (toolPairingBalancedBefore(session, surfaceNodes[keepFromIdx])) break;
    keepFromIdx -= 1;
  }
  if (keepFromIdx <= firstIdx) return null;
  return { start: surfaceNodes[firstIdx], end: surfaceNodes[keepFromIdx - 1] };
}
function basicConfig(tuning) {
  return {
    thresholdRatio: tuning.thresholdRatio,
    headroomTokens: tuning.headroomTokens,
    ...tuning.retainTokens === void 0 ? { retainRatio: tuning.retainRatio } : { retainTokens: tuning.retainTokens },
    maxTokens: tuning.maxSummaryTokens,
    compactionRetries: tuning.compactionRetries,
    maxOverflowRetries: tuning.maxOverflowRetries,
    summarizationProvider: tuning.summarizationProvider,
    summarizationModel: tuning.summarizationModel,
    auto: true
  };
}
var CompactionPackEngine = class extends BasicCompactionEngine {
  static inject = [...BasicCompactionEngine.inject, "compactionTuning"];
  /**
   * @param ctx - preset-scope context.
   * @param config - row config, unused; policy comes from the tuning service.
   */
  constructor(ctx, config = {}) {
    super(ctx, basicConfig(ctx.compactionTuning.snapshot()));
  }
  /** Live tuning snapshot. */
  get tuning() {
    return this.ctx.compactionTuning.snapshot();
  }
  /**
   * Compact when the tuned pressure threshold is crossed, or recover once from
   * a provider-confirmed overflow using the configured verbatim tail.
   * @param agent - agent whose session is compacted.
   * @param trigger - pressure or context-overflow.
   * @param signal - turn cancellation.
   * @returns the last successful result, or null when nothing ran.
   */
  async compactIfNeeded(agent, trigger, signal) {
    const tuning = this.tuning;
    if (!tuning.enabled) return null;
    const header = agent.session.requestHeader();
    if (header === void 0) return null;
    const target = completeRoute(header.config);
    if (target === void 0) return null;
    const info = await this.ctx.llm.resolveModelInfo(target.provider, target.model, signal);
    const contextWindow = info.context?.contextWindow;
    if (contextWindow === void 0) {
      throw new Error(
        `compaction-pack: no context capacity for ${target.provider}/${target.model}; declare contextWindow on that adapter model`
      );
    }
    const spec = resolveSpec(
      tuning,
      contextWindow,
      header.config.maxTokens ?? info.defaultMaxTokens ?? 0
    );
    const pruner = this.ctx.get("toolResultPruner");
    if (trigger === "context-overflow") {
      pruner?.pruneSession(agent.session);
      const measurement2 = this.ctx.tokenMeter.measure(agent.session);
      const range = selectCompactableRange(agent.session, measurement2, tuning.overflowRetainTokens);
      if (range === null) return null;
      return this.compactRegion(range.start, range.end, agent, signal);
    }
    let measurement = this.ctx.tokenMeter.measure(agent.session);
    if (measurement.totalTokens < spec.thresholdTokens) return null;
    if (pruner !== void 0) {
      pruner.pruneSession(agent.session);
      measurement = this.ctx.tokenMeter.measure(agent.session);
    }
    if (measurement.totalTokens < spec.thresholdTokens) return null;
    let result = null;
    for (let attempt = 0; attempt <= tuning.compactionRetries; attempt += 1) {
      const range = selectCompactableRange(agent.session, measurement, spec.retainTokens);
      if (range === null) {
        if (result === null) return null;
        throw new Error(
          `compaction-pack: no safe range below threshold ${spec.thresholdTokens} (measured ${measurement.totalTokens})`
        );
      }
      result = await this.compactRegion(range.start, range.end, agent, signal);
      measurement = this.ctx.tokenMeter.measure(agent.session);
      if (measurement.totalTokens < spec.thresholdTokens) return result;
    }
    throw new Error(
      `compaction-pack: still above threshold after ${tuning.compactionRetries + 1} attempts (measured ${measurement.totalTokens} >= ${spec.thresholdTokens})`
    );
  }
  /**
   * Summarize the replayed prefix with the configured checkpoint instruction.
   * @param input - replayed system prompt, tools, and shadowed messages.
   * @param agent - agent supplying the fallback route and tool history.
   * @param signal - optional cancellation.
   * @returns the text-only summary and its exact call envelope.
   */
  async summarize(input, agent, signal) {
    const tuning = this.tuning;
    const configured = tuning.summarizationProvider.length > 0 && tuning.summarizationModel.length > 0 ? { provider: tuning.summarizationProvider, model: tuning.summarizationModel } : void 0;
    const route = configured ?? latestAnsweredRoute(agent.session) ?? completeRoute(agent.session.requestHeader()?.config) ?? completeRoute(agent.options);
    if (route === void 0) {
      throw new Error(
        "compaction-pack: no provider/model available for summarization; route one request first or set the summarization route in the settings card"
      );
    }
    const messages = [
      ...input.messages,
      {
        role: "user",
        content: [{ type: "text", text: buildInstruction(tuning.prompt, tuning.language) }]
      }
    ];
    const options = {
      provider: route.provider,
      model: route.model,
      messages,
      toolHistory: agent.session.toolHistory(),
      ...input.tools === void 0 ? {} : { tools: [...input.tools] },
      maxTokens: tuning.maxSummaryTokens,
      sessionId: agent.session.id,
      purpose: "compaction",
      ...signal === void 0 ? {} : { signal }
    };
    const assembler = new BlockAssembler();
    for await (const chunk of this.ctx.llm.stream(options)) assembler.push(chunk);
    const finish = assembler.finish;
    if (finish.kind === "error" || finish.kind === "aborted") {
      throw LlmError.fromFailure(finish.failure);
    }
    if (finish.kind === "max-tokens") {
      const error = new Error("summarization truncated at the token cap (incomplete checkpoint)");
      error.code = "MAX_TOKENS";
      throw error;
    }
    const rawOutput = assembler.blocks();
    const summary = rawOutput.filter((block) => block.type === "text");
    if (!summary.some((block) => block.text.trim().length > 0)) {
      throw new Error("compaction-pack: summarization produced no text summary content");
    }
    return {
      summary,
      rawOutput,
      llmStreamCall: true,
      provider: options.provider,
      model: options.model,
      maxTokens: options.maxTokens,
      ...assembler.usage === void 0 ? {} : { usage: assembler.usage }
    };
  }
};
export {
  CompactionPackEngine as default
};
