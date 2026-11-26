#!/usr/bin/env node
/**
 * Anchor survey over one compacted span of a real session.
 *
 * Counts the material a deterministic anchor block could carry — user messages
 * verbatim, file paths named in tool calls, shell commands, error strings — so
 * the value of a mechanical appendix can be compared with what the model-written
 * checkpoint actually kept.
 *
 *   node tools/anchor-survey.mjs <session.v4.jsonl.zstd> <startSeq> <endSeq>
 */

import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const [file, startArg, endArg] = process.argv.slice(2)
if (file === undefined || startArg === undefined || endArg === undefined) {
  console.error('usage: node tools/anchor-survey.mjs <session.v4.jsonl.zstd> <startSeq> <endSeq>')
  process.exit(1)
}
const start = Number(startArg)
const end = Number(endArg)

const events = zstdDecompressSync(readFileSync(file)).toString('utf8')
  .split('\n')
  .filter(Boolean)
  .map(line => JSON.parse(line))
  .filter(event => event.seq >= start && event.seq <= end)

const text = blocks => (blocks ?? []).map(block => block.text ?? '').join(' ')

const users = events.filter(event => event.type === 'user/message')
const toolCalls = events.filter(event => event.type === 'tool/call')
const toolResults = events.filter(event => event.type === 'tool/result')
const errors = toolResults.filter(event => event.data.error !== undefined)

const userText = users.map(event => text(event.data.content)).join('\n')
const userChars = userText.length

const pathPattern = /(?:[A-Za-z]:\\|\/mnt\/[a-z]\/)[^\s"',)]+/g
const relativePattern = /\b(?:packages|apps|docs|scripts|snapshots|native|vendor)\\[^\s"',)]+/g
const paths = new Set()
const commands = []
for (const call of toolCalls) {
  const args = call.data.arguments ?? ''
  for (const match of args.match(pathPattern) ?? []) paths.add(match.replace(/\\+$/, ''))
  for (const match of args.match(relativePattern) ?? []) paths.add(match.replace(/\\+$/, ''))
  if (call.data.name === 'pwsh' || call.data.name === 'bash') {
    const command = /"command"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(args)?.[1]
    if (command !== undefined) commands.push(command.slice(0, 120))
  }
}

const errorText = errors.map(event => text(event.data.message?.content)).join('\n')

/** Rough token estimate for a block of text (same 4-chars heuristic as the meter). */
const tokens = value => Math.ceil(value.length / 4)

const recentUsers = users.slice(-15).map(event => text(event.data.content))
const recentUserTokens = tokens(recentUsers.join('\n'))
const pathTokens = tokens([...paths].join('\n'))
const pricedAnchorTokens = recentUserTokens + pathTokens + tokens(errorText)

console.log(JSON.stringify({
  spanEvents: events.length,
  userMessages: users.length,
  userVerbatimTokens: tokens(userText),
  toolCalls: toolCalls.length,
  shellCalls: commands.length,
  distinctPaths: paths.size,
  errors: errors.length,
  errorTokens: tokens(errorText),
  pricedAnchor: {
    recentUserMessages: recentUsers.length,
    recentUserTokens,
    pathTokens,
    errorTokens: tokens(errorText),
    totalTokens: pricedAnchorTokens,
  },
  note: 'priced anchor = last 15 user messages verbatim + deduplicated paths + error strings',
}, null, 2))
