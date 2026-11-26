/**
 * Checkpoint instruction for the compaction pack.
 *
 * The stock backend asks for a "terse" eight-section English checkpoint, which
 * collapses a large span into a few kilobytes and drops the evidence chain.
 * This instruction keeps the same section skeleton but requires verbatim
 * anchors, explicit supersession instead of deletion, and a length budget that
 * scales with the span instead of "be concise".
 */

/** Placeholder replaced with the conversation language rule at call time. */
const LANGUAGE_SLOT = '{{language}}'

/**
 * Default checkpoint instruction. Editable from the settings card; an empty
 * value falls back to {@link MINIMAL_PROMPT}.
 */
export const DEFAULT_PROMPT = [
  'You are a compaction engine for this AI coding assistant. The conversation above is the material to condense into one checkpoint that lets another model resume the work without losing essential context.',
  '',
  LANGUAGE_SLOT,
  '',
  'Output exactly the Markdown structure below, in this order. Keep every section; write "(none)" only when a section is genuinely empty.',
  '',
  '## Primary Request and Intent',
  "- The user's original goal and how it evolved. Quote the user's own words verbatim wherever the exact wording carries the requirement (constraints, corrections, acceptance criteria).",
  '',
  '## Decisions and Rejected Options',
  '- Decision -> why it was taken -> which alternatives were rejected and why. Include decisions the user made.',
  '',
  '## Evidence and Findings',
  '- Findings with their evidence: file path and line, command run, measured number, error string, log line. Keep the number and the source; drop the narration of how the search was performed.',
  '',
  '## Files and Code',
  '- Exact absolute or repository-relative path: what it contains, what changed, and the exact snippet when the snippet is the point.',
  '',
  '## Errors and Fixes',
  '- Error text verbatim -> cause -> fix, plus anything the user said about it.',
  '',
  '## User Corrections and Preferences',
  "- Every correction, rejection, or stated preference, quoted verbatim. This section overrides your own summary judgement: a correction that is dropped will be repeated as a mistake.",
  '',
  '## Open Items and Unknowns',
  '- Explicitly requested work not yet done, questions still open, assumptions still unverified, and known failure modes of what was done.',
  '',
  '## Current State',
  '- What is true right now: what works, what was only attempted, what is unverified, what was rolled back.',
  '',
  '## Next Step',
  '- The single next action that follows from the most recent request, or "(none)".',
  '',
  'Rules:',
  '- Preserve exact file paths, commands, error strings, identifiers, numeric values, function signatures, and syntax fragments. Never paraphrase them.',
  '- Do not invent facts. If the conversation does not establish something, leave it out or mark it unknown.',
  '- If the material above already contains a <compacted-summary> block, it is a PRIOR checkpoint: merge it, do not restart from it. Every still-open item, constraint, correction, and unverified assumption in it must survive into the new checkpoint.',
  '- When newer material contradicts a prior checkpoint item, write the supersession explicitly: "old statement -> replaced by new statement (reason)". Never delete a superseded item silently, and never delete an item merely because it is old.',
  '- Length follows content, not brevity: keep every fact that a competent engineer would need to continue without re-reading the conversation. Do not compress by omitting evidence.',
  '- Do not mention this summarization request, the compaction process, or the fact that context was compacted.',
  '- Output only the checkpoint text. Do not call any tool and do not take any other action.',
].join('\n')

/** Fallback used when the configured prompt is empty. */
export const MINIMAL_PROMPT = [
  'Condense the conversation above into one checkpoint that lets another model continue the work.',
  '',
  LANGUAGE_SLOT,
  '',
  'Preserve the original request verbatim, every user correction, every open item, every exact path, command, number, and error string. Never delete an item because it is old; mark superseded items as superseded. Output only the checkpoint text.',
].join('\n')

/**
 * Resolve the language rule for one compaction call.
 * @param preference - `auto`, `zh`, or `en`.
 * @returns the sentence substituted for {@link LANGUAGE_SLOT}.
 */
function languageRule(preference) {
  if (preference === 'zh') return 'Write the checkpoint in Chinese (简体中文). Keep code, paths, commands, and error strings verbatim.'
  if (preference === 'en') return 'Write the checkpoint in English. Keep code, paths, commands, and error strings verbatim.'
  return 'Write the checkpoint in the language the user writes in. Keep code, paths, commands, and error strings verbatim.'
}

/**
 * Build the final instruction message for one compaction call.
 * @param prompt - configured template, possibly empty.
 * @param language - configured language preference.
 * @returns the instruction text.
 */
export function buildInstruction(prompt, language) {
  const template = typeof prompt === 'string' && prompt.trim().length > 0 ? prompt : MINIMAL_PROMPT
  return template.replaceAll(LANGUAGE_SLOT, languageRule(language))
}
