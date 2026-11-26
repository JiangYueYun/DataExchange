#!/usr/bin/env node
/**
 * Client-half smoke test: load lib/client.js with stubbed browser globals and a
 * minimal ctx, then run apply(). Catches wiring mistakes (missing action
 * fields, hook name typos, slot registration shape) without a browser.
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const packDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(packDir, 'lib/client.js'), 'utf8')

let exported
const sandbox = {
  window: { __ModuleLoader__: { load: ({ factory }) => { exported = factory(requireStub) } } },
  console,
  Symbol,
  Object,
  Array,
  JSON,
  String,
  Number,
  Boolean,
  Error,
  undefined,
}

function fieldSpec(field) {
  return { field, format: () => '', parse: () => ({ kind: 'set', value: '' }) }
}

class FormModelStub {
  constructor(scope, specs) {
    this.scope = scope
    this.specs = specs
    this.actionsCalled = false
  }

  shell() {
    return { available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false }
  }

  field(name) {
    return { text: '', overridden: false, invalid: false }
  }

  bind(projection) {
    this.project = projection
    return { getSnapshot: () => projection(), subscribe: () => () => {} }
  }

  actions() {
    this.actionsCalled = true
    return { edit: () => {}, resetField: () => {}, save: () => {}, discard: () => {} }
  }

  dispose() {}
}

function requireStub(id) {
  if (id === 'react') return { createElement: (...args) => ({ args }), Fragment: {} }
  if (id === '@deepseek-ai/dsh-client-ui-primitives') {
    return {
      SettingsForm: () => null,
      SettingsFormModel: FormModelStub,
      settingsNumberField: fieldSpec,
      settingsTextField: fieldSpec,
    }
  }
  if (id === '@deepseek-ai/dsh-client-ui-primitives/settings-form') {
    return FormModelStub
  }
  throw new Error(`client smoke: unexpected require("${id}")`)
}

vm.runInNewContext(source, sandbox, { filename: 'lib/client.js' })

let registered
const registrations = []
const ctx = {
  effect: (run) => {
    const disposer = run()
    return () => { if (typeof disposer === 'function') disposer() }
  },
  locale: {
    register: () => () => {},
    bind: () => (key) => key,
  },
  configForms: {
    get: () => ({}),
    whileServed: (_namespaces, run) => run(),
  },
  slots: {
    inject: (_name, run) => run(),
    register: (declaration, component) => {
      registered = { declaration, component }
      registrations.push(declaration.id)
      return { dispose() {} }
    },
  },
}

exported.apply(ctx)

const problems = []
if (typeof exported.apply !== 'function') problems.push('no apply export')
if (!Array.isArray(exported.inject) || !exported.inject.includes('configForms')) problems.push('inject face wrong')
if (registered === undefined) problems.push('no slot registration')
else {
  if (registered.declaration.name !== 'plugins.item') problems.push('wrong slot')
  if (typeof registered.declaration.label() !== 'string') problems.push('label is not a string')
  const face = registered.declaration.inject()
  if (typeof face.edit !== 'function' || typeof face.save !== 'function') problems.push('form actions missing')
  if (face.hooks === undefined || typeof face.hooks.compactionPackCard !== 'object') problems.push('hook missing')
  const component = registered.component
  const tree = component({
    view: 'summary',
    t: (key) => key,
    ...face,
    useCompactionPackCard: (select) => select({ ...new FormModelStub().shell() }),
  })
  if (tree === undefined) problems.push('summary render produced nothing')
}

if (problems.length > 0) {
  console.error(`client smoke: FAILED - ${problems.join('; ')}`)
  process.exit(1)
}
console.log(`client smoke: ok (${registrations.join(', ')})`)
