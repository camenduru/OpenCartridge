/**
 * Cartridge compatibility suite.
 *
 * The promise: a cartridge written years ago still loads and still dispatches in
 * a newer UI. These tests are what makes that a guarantee instead of a hope.
 *
 *   node --test tests/
 *
 * Two kinds of check:
 *   - the frozen catalogs in fixtures/cartridges/v1 are never edited, and must
 *     keep normalising with every parameter still renderable;
 *   - the catalogs actually shipped in public/services must parse too, with the
 *     vocabulary they declare.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CAPABILITIES,
  LAYER_KINDS,
  PARAM_CONTROLS,
  extensionFor,
  extensionOf,
  kindFromUrl,
  missingCapabilities,
  normalizeCatalog,
  normalizeService,
  paramControl,
  parseCatalog,
  primaryInput,
  resultKind,
  schemaVersionOf,
  visibleCartridges,
} from '../lib/cartridge-schema.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const fixtures = path.join(here, 'fixtures', 'cartridges', 'v1')
const shipped = path.join(root, 'public', 'services')

async function jsonFiles(dir) {
  const names = (await fs.readdir(dir)).filter((name) => name.endsWith('.json')).sort()
  return Promise.all(names.map(async (name) => ({ name, text: await fs.readFile(path.join(dir, name), 'utf8') })))
}

// --------------------------------------------------------------------------- #
// frozen catalogs
// --------------------------------------------------------------------------- #

test('frozen v1 catalogs still load with every parameter renderable', async () => {
  const files = await jsonFiles(fixtures)
  assert.ok(files.length >= 4, `expected the frozen catalogs, found ${files.length}`)

  for (const file of files) {
    const { cartridges, warnings } = parseCatalog(file.text)
    assert.ok(cartridges.length > 0, `${file.name} produced no cartridges (${warnings.join('; ')})`)
    assert.deepEqual(warnings, [], `${file.name} warned: ${warnings.join('; ')}`)

    const ids = new Set()
    for (const cartridge of cartridges) {
      assert.ok(cartridge.id, `${file.name}: cartridge without an id`)
      assert.ok(!ids.has(cartridge.id), `${file.name}: duplicate id ${cartridge.id}`)
      ids.add(cartridge.id)

      assert.ok(cartridge.name, `${cartridge.id}: no name`)
      assert.ok(cartridge.category, `${cartridge.id}: no category`)
      assert.ok(Array.isArray(cartridge.parameters), `${cartridge.id}: parameters is not an array`)

      for (const param of cartridge.parameters) {
        assert.ok(param.name, `${cartridge.id}: a parameter has no name`)
        const control = paramControl(param)
        assert.ok(PARAM_CONTROLS.includes(control), `${cartridge.id}.${param.name}: unknown control ${control}`)
        // v1 catalogs only used the original six types; anything else would be a
        // silent behaviour change in what the panel renders.
        assert.notEqual(control, 'json', `${cartridge.id}.${param.name}: v1 type "${param.type}" fell back to JSON`)
      }
    }
  }
})

test('frozen v1 catalogs dispatched the old way, without declaring anything', async () => {
  const files = await jsonFiles(fixtures)
  for (const file of files) {
    for (const cartridge of parseCatalog(file.text).cartridges) {
      // v1 never declared result types: the URL suffix must still decide.
      assert.equal(cartridge.returns, undefined, `${cartridge.id}: fixture grew a returns block`)
      const kinds = (cartridge.parameters || []).filter((p) => p.type === 'file').length
      assert.ok(kinds > 0, `${cartridge.id}: no file parameter derived from a v1 catalog`)
      const primary = primaryInput(cartridge)
      assert.ok(primary, `${cartridge.id}: no primary input derived`)
    }
  }
})

// --------------------------------------------------------------------------- #
// shipped catalogs
// --------------------------------------------------------------------------- #

test('shipped catalogs parse, and declared vocabulary is valid', async () => {
  const files = await jsonFiles(shipped)
  assert.ok(files.length > 0)

  for (const file of files) {
    const { cartridges, warnings } = parseCatalog(file.text)
    assert.ok(cartridges.length > 0, `${file.name} produced no cartridges`)
    assert.deepEqual(warnings, [], `${file.name} warned: ${warnings.join('; ')}`)

    for (const cartridge of cartridges) {
      if (cartridge.returns) {
        assert.ok(LAYER_KINDS.includes(cartridge.returns.layer), `${cartridge.id}: returns.layer "${cartridge.returns.layer}" is not a layer kind`)
      }
      for (const input of cartridge.inputs) {
        assert.ok(input.name, `${cartridge.id}: an input has no name`)
        assert.ok(['primary', 'secondary'].includes(input.bind), `${cartridge.id}: input bind "${input.bind}"`)
      }
      assert.deepEqual(missingCapabilities(cartridge), [], `${cartridge.id}: asks for capabilities this build lacks`)
    }
  }
})

// --------------------------------------------------------------------------- #
// catalog shapes
// --------------------------------------------------------------------------- #

const minimal = { id: 'demo', name: 'Demo', category: 'image', inputTypes: ['image'], parameters: [] }

test('every catalog shape ever shipped is accepted', () => {
  const bare = normalizeCatalog([minimal])
  assert.equal(bare.cartridges.length, 1)
  assert.equal(bare.schema, 1)

  const wrapped = normalizeCatalog({ cartridges: [minimal] })
  assert.equal(wrapped.cartridges.length, 1)

  const versioned = normalizeCatalog({ schema: 'cartridge/2', cartridges: [minimal] })
  assert.equal(versioned.schema, 2)

  const services = normalizeCatalog({ services: [minimal] })
  assert.equal(services.cartridges.length, 1)

  assert.deepEqual(normalizeCatalog(null).cartridges, [])
  assert.equal(normalizeCatalog({ nonsense: true }).warnings.length, 1)
})

test('a malformed catalog yields warnings instead of throwing', () => {
  const parsed = parseCatalog('{ not json')
  assert.deepEqual(parsed.cartridges, [])
  assert.equal(parsed.warnings.length, 1)
})

test('a catalog with a byte-order mark still parses', () => {
  const withBom = '\uFEFF' + JSON.stringify([minimal])
  assert.equal(parseCatalog(withBom).cartridges.length, 1)
})

test('unknown fields survive normalisation', () => {
  const service = normalizeService({ ...minimal, futureField: { keep: 'me' }, parameters: [{ name: 'x', type: 'string' }] })
  assert.deepEqual(service.futureField, { keep: 'me' })
  assert.equal(service.schema, 2)
})

test('schema versions are read from numbers and strings', () => {
  assert.equal(schemaVersionOf(2), 2)
  assert.equal(schemaVersionOf('cartridge/3'), 3)
  assert.equal(schemaVersionOf('v1'), 1)
  assert.equal(schemaVersionOf(undefined), 1)
})

// --------------------------------------------------------------------------- #
// parameters
// --------------------------------------------------------------------------- #

test('unknown parameter types fall back instead of disappearing', () => {
  assert.equal(paramControl({ name: 'curve', type: 'bezier' }), 'json')
  assert.equal(paramControl({ name: 'curve', type: 'bezier', fallback: 'string' }), 'text')
  assert.equal(paramControl({ name: 'matrix', type: 'matrix', fallbackType: 'json' }), 'json')
  assert.equal(paramControl({ name: 'steps', type: 'number' }), 'number')
  assert.equal(paramControl({ name: 'prompt', type: 'string' }), 'textarea')
  assert.equal(paramControl({ name: 'title', type: 'string' }), 'text')
  assert.equal(paramControl({ name: 'mystery', type: 'string', ui: true }), 'text')
})

// --------------------------------------------------------------------------- #
// results
// --------------------------------------------------------------------------- #

test('proxy URLs still expose their extension', () => {
  const proxied = '/api/image-proxy?url=' + encodeURIComponent('http://minio:9000/tost/output/idol-abc.glb')
  assert.equal(extensionOf(proxied), 'glb')
  assert.equal(kindFromUrl(proxied), '3d')
  assert.equal(extensionOf('http://x/y.webm?v=2'), 'webm')
  assert.equal(kindFromUrl('blob:http://localhost/1234'), null)
})

test('declared returns win over the URL, category is the last resort', () => {
  const declared = { returns: { layer: '3d', ext: 'glb' } }
  assert.equal(resultKind(declared, 'http://x/y.png'), '3d')
  assert.equal(resultKind(undefined, 'http://x/y.webm'), 'video')
  assert.equal(resultKind(undefined, 'http://x/no-extension', 'video'), 'video')
  assert.equal(resultKind(undefined, 'http://x/no-extension'), null)
})

test('extension follows the bytes, then the declaration, then the URL', () => {
  const service = { returns: { ext: 'mp4' } }
  assert.equal(extensionFor(service, 'http://x/y.webm', 'video/webm'), 'webm') // bytes win
  assert.equal(extensionFor(service, 'http://x/y', 'application/octet-stream'), 'mp4')
  assert.equal(extensionFor(undefined, 'http://x/y.glb'), 'glb')
  assert.equal(extensionFor(undefined, 'blob:http://localhost/1'), 'bin')
})

// --------------------------------------------------------------------------- #
// inputs
// --------------------------------------------------------------------------- #

test('declared inputs bind, magic names still work for v1', () => {
  const declared = normalizeService({
    ...minimal,
    inputs: [{ name: 'source', accepts: ['video/*'], bind: 'primary' }],
    parameters: [{ name: 'source', type: 'file' }, { name: 'input_video', type: 'file' }],
  })
  assert.equal(primaryInput(declared, 'video')?.name, 'source')

  const legacy = normalizeService({
    ...minimal,
    parameters: [{ name: 'input_image', type: 'file' }, { name: 'input_video', type: 'file' }],
  })
  assert.equal(primaryInput(legacy, 'video')?.name, 'input_video')
  assert.equal(primaryInput(legacy, 'image')?.name, 'input_image')
})

test('capabilities are advisory: missing ones are reported, not fatal', () => {
  const service = normalizeService({ ...minimal, requires: { capabilities: ['param.bezier', 'layer.3d'] } })
  assert.deepEqual(service.missingCapabilities, ['param.bezier'])
  assert.ok(CAPABILITIES.includes('layer.3d'))
})

// --------------------------------------------------------------------------- #
// panel visibility
// --------------------------------------------------------------------------- #

test('cartridges whose worker is down are hidden from the panel', () => {
  const running = { id: 'a', workerId: 'w1' }
  const stopped = { id: 'b', workerId: 'w2' }
  const uninstalled = { id: 'c', workerId: 'w3' }
  const unknownWorker = { id: 'd', workerId: 'w4' }
  const states = {
    w1: { state: 'running' },
    w2: { state: 'stopped' },
    w3: { state: 'missing' },
  }
  const shown = visibleCartridges([running, stopped, uninstalled, unknownWorker], states)
  assert.deepEqual(shown.map((s) => s.id), ['a', 'd'])
})

test('without Docker state nothing is hidden', () => {
  const services = [{ id: 'a', workerId: 'w1' }, { id: 'b', workerId: 'w2' }]
  assert.equal(visibleCartridges(services, {}).length, 2)
  assert.equal(visibleCartridges(services, undefined).length, 2)
  assert.deepEqual(visibleCartridges(undefined, {}), [])
})
