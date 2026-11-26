#!/usr/bin/env node
/**
 * Post-install self-check: proves the two Host halves load against the DSH
 * install they will run with, and that the engine still overrides the shipped
 * backend hooks it depends on. Run it after regenerating the patch on a new
 * device, before restarting DSH.
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let failed = false

/** @param {string} label @param {() => void} check */
function check(label, check) {
  try {
    check()
    console.log(`ok   ${label}`)
  } catch (error) {
    failed = true
    console.error(`FAIL ${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const manifest = JSON.parse(readFileSync(join(packDir, 'package.json'), 'utf8'))
console.log(`pack ${manifest.name}@${manifest.version}`)

const tuning = await import(new URL('../lib/tuning.js', import.meta.url))
const engine = await import(new URL('../lib/engine.js', import.meta.url))
const base = await import('@deepseek-ai/dsh-compaction-basic')

check('tuning exposes a Config with volatile fields', () => {
  const schema = tuning.Config
  if (schema === undefined) throw new Error('no Config export')
  const json = JSON.stringify(schema.toJSON())
  if (!json.includes('"volatile":true')) throw new Error('Config has no volatile field')
  if (!json.includes('thresholdRatio')) throw new Error('Config has no thresholdRatio field')
})

check('engine extends the shipped backend', () => {
  const Engine = engine.default
  if (typeof Engine !== 'function') throw new Error('no default export class')
  const probe = Object.create(Engine.prototype)
  if (!(probe instanceof base.BasicCompactionEngine)) throw new Error('not a subclass')
})

check('engine overrides the policy and summary hooks', () => {
  const proto = engine.default.prototype
  if (proto.compactIfNeeded === base.BasicCompactionEngine.prototype.compactIfNeeded) {
    throw new Error('compactIfNeeded is inherited')
  }
  if (proto.summarize === base.BasicCompactionEngine.prototype.summarize) {
    throw new Error('summarize is inherited')
  }
  if (typeof proto.compactRegion !== 'function') {
    throw new Error('compactRegion missing; the shipped transaction was not inherited')
  }
})

check('engine injects the tuning service', () => {
  const inject = engine.default.inject ?? []
  if (!inject.includes('compactionTuning')) throw new Error(`inject is ${JSON.stringify(inject)}`)
})

check('output cap resolves preset > workspace > default', () => {
  const base = {
    outputCapEnabled: true,
    outputCapDefault: 98304,
    outputCapByPreset: '{"ptc":393216}',
    outputCapByWorkspace: '{"F:\\\\a":196608}',
  }
  const resolve = tuning.resolveCap
  if (typeof resolve !== 'function') throw new Error('resolveCap is not exported')
  if (resolve(base, { agentPreset: 'ptc' }) !== 393216) throw new Error('preset override ignored')
  if (resolve(base, { cwd: 'F:\\a\\b' }) !== 196608) throw new Error('workspace prefix ignored')
  if (resolve(base, {}) !== 98304) throw new Error('default cap ignored')
  if (resolve({ ...base, outputCapEnabled: false }, {}) !== undefined) throw new Error('disable switch ignored')
})

// Cordis resolves a service through a Proxy, so `ctx.compactionTuning.snapshot()`
// runs with the proxy as `this`. A JS private field there throws
// "Cannot read private member #x from an object whose class did not declare it".
check('tuning survives a proxied service access', () => {
  const Tuning = tuning.default
  const instance = Object.create(Tuning.prototype)
  instance.parsedConfig = { thresholdRatio: 0.45, prompt: 'x' }
  const proxied = new Proxy(instance, {})
  const snapshot = proxied.snapshot()
  if (snapshot.thresholdRatio !== 0.45) throw new Error('snapshot lost the parsed config')
})

check('bundles carry no private class fields', () => {
  for (const name of ['tuning.js', 'engine.js', 'index.js']) {
    const source = readFileSync(join(packDir, 'lib', name), 'utf8')
    if (/\bthis\.#[\w$]/u.test(source)) throw new Error(`${name} uses a private field`)
  }
})

check('patch declares the preset override and the root rows', () => {
  const patch = readFileSync(join(packDir, 'cordis.patch.yml'), 'utf8')
  for (const needle of ['preset-standard', 'compaction-pack/engine', 'compaction-tuning', 'compaction-pack-ui']) {
    if (!patch.includes(needle)) throw new Error(`cordis.patch.yml lacks ${needle}`)
  }
})

check('client half parses and registers its entrypoints', () => {
  const source = readFileSync(join(packDir, 'lib/client.js'), 'utf8')
  if (!source.includes("require('@deepseek-ai/dsh-client-ui-primitives')")) {
    throw new Error('client half does not bind the shared settings primitives')
  }
  if (!source.includes("ctx.slots.register")) throw new Error('client half registers no slot')
})

if (failed) {
  console.error('selfcheck: FAILED')
  process.exit(1)
}
console.log('selfcheck: ok')
