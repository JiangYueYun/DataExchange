/**
 * Preset half: the compaction backend mounted inside an agent preset.
 *
 * Subclasses the shipped backend so the log-recorded transaction, the token
 * meter pricing, the lock protocol, and the projection stay upstream code.
 * Three behaviours are replaced:
 *
 * - `compactIfNeeded` reads its pressure policy from the live tuning service
 *   instead of a constructor-frozen config, so edits apply on the next step.
 * - `summarize` sends the pack's checkpoint instruction instead of the shipped
 *   frozen one, and honours the configured summary route and output cap.
 * - Range selection is the same tail-budget walk, with the overflow path
 *   keeping a configurable verbatim tail instead of always compacting
 *   everything but the last surface node.
 */

import { SessionSeq } from '@deepseek-ai/dsh-session'
import { toolPairingBalancedBefore } from '@deepseek-ai/dsh-compaction'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import { BlockAssembler, LlmError } from '@deepseek-ai/dsh-llm'
import { buildInstruction } from './prompt.mjs'

/** Provider/model pair of one summarization request. */
function completeRoute(route) {
  if (route === undefined || route === null) return undefined
  const provider = route.provider
  const model = route.model
  if (typeof provider !== 'string' || provider.length === 0) return undefined
  if (typeof model !== 'string' || model.length === 0) return undefined
  return { provider, model }
}

/**
 * Route recorded on the latest assistant message, so a summary follows the
 * model that actually accepted this history.
 * @param session - session to scan backwards.
 * @returns the recorded route, when one exists.
 */
function latestAnsweredRoute(session) {
  for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
    const event = session.eventAt(SessionSeq(seq))
    if (event === undefined || event.type !== 'assistant/message') continue
    return completeRoute(event.data.message.source)
  }
  return undefined
}

/**
 * Scale the tuning policy into concrete token budgets for one routed model.
 * @param tuning - live tuning snapshot.
 * @param contextWindow - routed model capacity.
 * @param reservedCompletionTokens - output tokens the request reserves.
 * @returns threshold and retention budgets.
 */
function resolveSpec(tuning, contextWindow, reservedCompletionTokens) {
  const target = `context window ${contextWindow} / reserved ${reservedCompletionTokens}`
  if (!Number.isInteger(contextWindow) || contextWindow <= 0) {
    throw new Error(`compaction-pack: ${target} is not a positive context window`)
  }
  const messageBudget = contextWindow - reservedCompletionTokens
  const pressureBudget = messageBudget - tuning.headroomTokens
  if (pressureBudget <= 0) {
    throw new Error(
      `compaction-pack: ${target} leaves no pressure budget after the ${tuning.headroomTokens}-token headroom; `
      + 'lower headroomTokens or raise the request output budget',
    )
  }
  const thresholdTokens = Math.floor(Math.min(contextWindow * tuning.thresholdRatio, pressureBudget))
  const retainTokens = tuning.retainTokens === undefined
    ? Math.floor(messageBudget * tuning.retainRatio)
    : tuning.retainTokens
  if (retainTokens >= thresholdTokens) {
    throw new Error(
      `compaction-pack: ${target} retain ${retainTokens} must stay below threshold ${thresholdTokens}`,
    )
  }
  return { thresholdTokens, retainTokens }
}

/** Surface head event, used to keep the system prompt outside every range. */
function systemHead(session, headSeq) {
  const head = session.eventAt(headSeq)
  return head !== undefined && head.type === 'system/message' ? head : undefined
}

/**
 * Select the oldest balanced span that keeps the configured verbatim tail.
 * @param session - session whose current surface is compacted.
 * @param measurement - meter measurement of that surface.
 * @param retainTokens - verbatim tail budget.
 * @returns inclusive positional seq range, or null when nothing is safe to compact.
 */
function selectCompactableRange(session, measurement, retainTokens) {
  const pricedNodes = measurement.nodes
  if (pricedNodes.length === 0) return null
  const surfaceNodes = session.surface.nodes
  if (surfaceNodes.length !== pricedNodes.length
    || surfaceNodes.some((seq, index) => seq !== pricedNodes[index]?.seq)) {
    throw new Error('compaction-pack: token-meter surface does not match the current session surface')
  }
  const firstIdx = systemHead(session, surfaceNodes[0]) === undefined ? 0 : 1

  let accumulated = 0
  let keepFromIdx = pricedNodes.length
  for (let index = pricedNodes.length - 1; index >= 0; index -= 1) {
    accumulated += pricedNodes[index].tokens
    keepFromIdx = index
    if (accumulated >= retainTokens) break
  }
  if (keepFromIdx <= firstIdx) return null

  while (keepFromIdx > firstIdx) {
    if (toolPairingBalancedBefore(session, surfaceNodes[keepFromIdx])) break
    keepFromIdx -= 1
  }
  if (keepFromIdx <= firstIdx) return null
  return { start: surfaceNodes[firstIdx], end: surfaceNodes[keepFromIdx - 1] }
}

/** Map tuning onto the shipped backend's constructor config. */
function basicConfig(tuning) {
  return {
    thresholdRatio: tuning.thresholdRatio,
    headroomTokens: tuning.headroomTokens,
    ...(tuning.retainTokens === undefined
      ? { retainRatio: tuning.retainRatio }
      : { retainTokens: tuning.retainTokens }),
    maxTokens: tuning.maxSummaryTokens,
    compactionRetries: tuning.compactionRetries,
    maxOverflowRetries: tuning.maxOverflowRetries,
    summarizationProvider: tuning.summarizationProvider,
    summarizationModel: tuning.summarizationModel,
    auto: true,
  }
}

/** Compaction backend reading its policy and checkpoint prompt from the tuning service. */
export default class CompactionPackEngine extends BasicCompactionEngine {
  static inject = [...BasicCompactionEngine.inject, 'compactionTuning']

  /**
   * @param ctx - preset-scope context.
   * @param config - row config, unused; policy comes from the tuning service.
   */
  constructor(ctx, config = {}) {
    super(ctx, basicConfig(ctx.compactionTuning.snapshot()))
  }

  /** Live tuning snapshot. */
  get tuning() {
    return this.ctx.compactionTuning.snapshot()
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
    const tuning = this.tuning
    if (!tuning.enabled) return null
    const header = agent.session.requestHeader()
    if (header === undefined) return null
    const target = completeRoute(header.config)
    if (target === undefined) return null
    const info = await this.ctx.llm.resolveModelInfo(target.provider, target.model, signal)
    const contextWindow = info.context?.contextWindow
    if (contextWindow === undefined) {
      throw new Error(
        `compaction-pack: no context capacity for ${target.provider}/${target.model}; `
        + 'declare contextWindow on that adapter model',
      )
    }
    const spec = resolveSpec(
      tuning,
      contextWindow,
      header.config.maxTokens ?? info.defaultMaxTokens ?? 0,
    )

    const pruner = this.ctx.get('toolResultPruner')
    if (trigger === 'context-overflow') {
      pruner?.pruneSession(agent.session)
      const measurement = this.ctx.tokenMeter.measure(agent.session)
      const range = selectCompactableRange(agent.session, measurement, tuning.overflowRetainTokens)
      if (range === null) return null
      return this.compactRegion(range.start, range.end, agent, signal)
    }

    let measurement = this.ctx.tokenMeter.measure(agent.session)
    if (measurement.totalTokens < spec.thresholdTokens) return null
    if (pruner !== undefined) {
      pruner.pruneSession(agent.session)
      measurement = this.ctx.tokenMeter.measure(agent.session)
    }
    if (measurement.totalTokens < spec.thresholdTokens) return null

    let result = null
    for (let attempt = 0; attempt <= tuning.compactionRetries; attempt += 1) {
      const range = selectCompactableRange(agent.session, measurement, spec.retainTokens)
      if (range === null) {
        if (result === null) return null
        throw new Error(
          `compaction-pack: no safe range below threshold ${spec.thresholdTokens} `
          + `(measured ${measurement.totalTokens})`,
        )
      }
      result = await this.compactRegion(range.start, range.end, agent, signal)
      measurement = this.ctx.tokenMeter.measure(agent.session)
      if (measurement.totalTokens < spec.thresholdTokens) return result
    }
    throw new Error(
      `compaction-pack: still above threshold after ${tuning.compactionRetries + 1} attempts `
      + `(measured ${measurement.totalTokens} >= ${spec.thresholdTokens})`,
    )
  }

  /**
   * Summarize the replayed prefix with the configured checkpoint instruction.
   * @param input - replayed system prompt, tools, and shadowed messages.
   * @param agent - agent supplying the fallback route and tool history.
   * @param signal - optional cancellation.
   * @returns the text-only summary and its exact call envelope.
   */
  async summarize(input, agent, signal) {
    const tuning = this.tuning
    const configured = tuning.summarizationProvider.length > 0
      && tuning.summarizationModel.length > 0
      ? { provider: tuning.summarizationProvider, model: tuning.summarizationModel }
      : undefined
    const route = configured
      ?? latestAnsweredRoute(agent.session)
      ?? completeRoute(agent.session.requestHeader()?.config)
      ?? completeRoute(agent.options)
    if (route === undefined) {
      throw new Error(
        'compaction-pack: no provider/model available for summarization; '
        + 'route one request first or set the summarization route in the settings card',
      )
    }

    const messages = [
      ...input.messages,
      {
        role: 'user',
        content: [{ type: 'text', text: buildInstruction(tuning.prompt, tuning.language) }],
      },
    ]
    const options = {
      provider: route.provider,
      model: route.model,
      messages,
      toolHistory: agent.session.toolHistory(),
      ...(input.tools === undefined ? {} : { tools: [...input.tools] }),
      maxTokens: tuning.maxSummaryTokens,
      sessionId: agent.session.id,
      purpose: 'compaction',
      ...(signal === undefined ? {} : { signal }),
    }

    const assembler = new BlockAssembler()
    for await (const chunk of this.ctx.llm.stream(options)) assembler.push(chunk)
    const finish = assembler.finish
    if (finish.kind === 'error' || finish.kind === 'aborted') {
      throw LlmError.fromFailure(finish.failure)
    }
    if (finish.kind === 'max-tokens') {
      const error = new Error('summarization truncated at the token cap (incomplete checkpoint)')
      error.code = 'MAX_TOKENS'
      throw error
    }

    const rawOutput = assembler.blocks()
    const summary = rawOutput.filter(block => block.type === 'text')
    if (!summary.some(block => block.text.trim().length > 0)) {
      throw new Error('compaction-pack: summarization produced no text summary content')
    }
    return {
      summary,
      rawOutput,
      llmStreamCall: true,
      provider: options.provider,
      model: options.model,
      maxTokens: options.maxTokens,
      ...(assembler.usage === undefined ? {} : { usage: assembler.usage }),
    }
  }
}
