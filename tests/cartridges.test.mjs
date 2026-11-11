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
  declaredInputEntry,
  extensionFor,
  extensionOf,
  isMeshInput,
  isMeshLayer,
  kindFromUrl,
  missingCapabilities,
  multiImageSlots,
  normalizeCatalog,
  normalizeService,
  paramControl,
  parseCatalog,
  primaryInput,
  projectService,
  fixedOutputSize,
  resultKind,
  resultLayerSize,
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
      // Parameter-only cartridges run from their fields alone — no layer is
      // selected or uploaded, so they derive no file parameter. yue2 ships
      // that way (inputTypes: []), and so do the Breeze plain/design cards;
      // inputTypes entries are layer kinds, so an empty array is the
      // "no layer input" marker, not ["text"].
      if (!(cartridge.parameters || []).some((p) => p.type === 'file')) continue
      const kinds = (cartridge.parameters || []).filter((p) => p.type === 'file').length
      assert.ok(kinds > 0, `${cartridge.id}: no file parameter derived from a v1 catalog`)
      const primary = primaryInput(cartridge)
      assert.ok(primary, `${cartridge.id}: no primary input derived`)
    }
  }
})

test('a multi-select card takes one to N selected layers, one per slot', async () => {
  const card = {
    parameters: [
      { name: 'input_image', type: 'file', ui: false },
      { name: 'input_image2', type: 'file', ui: false },
      { name: 'input_image10', type: 'file', ui: false },
      { name: 'input_image3', type: 'file', ui: false },
      { name: 'seed', type: 'number', ui: true },
      // a visible field is not an upload slot
      { name: 'input_image4', type: 'file', ui: true },
    ],
  }
  // numeric order, not declaration order
  assert.deepEqual(multiImageSlots(card), ['input_image', 'input_image2', 'input_image3', 'input_image10'])

  // a lone `input_image` is the ordinary single-layer card
  assert.deepEqual(multiImageSlots({ parameters: [card.parameters[0]] }), [])
  // fixed-count cards keep their own rules
  assert.deepEqual(multiImageSlots({
    parameters: [
      { name: 'input_image1', type: 'file', ui: false },
      { name: 'input_image2', type: 'file', ui: false },
    ],
  }), [])
  assert.deepEqual(multiImageSlots(null), [])

  // the shipped UniForge3D card reads one to eight selected layers
  const text = await fs.readFile(path.join(shipped, 'uniforge3d.json'), 'utf8')
  const [uniforge] = parseCatalog(text).cartridges
  assert.deepEqual(multiImageSlots(uniforge), [
    'input_image', 'input_image2', 'input_image3', 'input_image4',
    'input_image5', 'input_image6', 'input_image7', 'input_image8',
  ])
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

test('a declared mesh slot is read from the input entry, not the parameter', async () => {
  const text = await fs.readFile(path.join(shipped, 'skintokens.json'), 'utf8')
  const [skintokens] = parseCatalog(text).cartridges
  assert.ok(skintokens, 'the skintokens catalog did not parse')

  const entry = declaredInputEntry(skintokens, 'glb')
  assert.equal(entry?.name, 'input_mesh', 'the mesh slot must be the primary input')
  assert.equal(isMeshInput(entry), true, 'glb / model+gltf-binary must read as a mesh slot')

  // The regression this guards. `primaryInput` returns the PARAMETER, which has
  // no `accepts`; asking *it* whether the slot takes a mesh silently answers
  // "no", which skipped the mesh branch and dispatched a job carrying no
  // input_mesh at all — the worker then failed with "input_mesh is required".
  const parameter = primaryInput(skintokens, 'glb')
  assert.equal(parameter?.name, 'input_mesh')
  assert.equal(parameter?.accepts, undefined, 'parameters must not carry accepts')
  assert.equal(isMeshInput(parameter), false, 'a parameter is not a mesh slot — read the entry')

  // An image on a mesh-only cartridge still resolves to the mesh slot, so the
  // UI can refuse it rather than uploading a PNG into a GLB slot.
  const asImage = declaredInputEntry(skintokens, 'image')
  assert.equal(asImage?.name, 'input_mesh')
  assert.equal(isMeshInput(asImage), true)
})

test('a v1 catalog derived from file parameters is not a mesh slot', () => {
  const legacy = normalizeService({ ...minimal, parameters: [{ name: 'input_image', type: 'file' }] })
  const entry = declaredInputEntry(legacy, 'image')
  assert.equal(entry?.name, 'input_image')
  assert.equal(isMeshInput(entry), false)
})

test('the dispatched service keeps its declared inputs', async () => {
  const text = await fs.readFile(path.join(shipped, 'skintokens.json'), 'utf8')
  const [catalog] = parseCatalog(text).cartridges
  const dispatched = projectService(catalog)

  // The bug this guards: the canvas used to rebuild each service from a
  // hand-picked field list, and `inputs` was not on it. With `inputs` gone the
  // declared slot vanished, `primaryInput` fell back to the v1 magic names,
  // `input_mesh` is not one of them, and the job went out with no file at all.
  assert.ok(Array.isArray(dispatched.inputs), 'projection dropped `inputs`')
  assert.equal(dispatched.inputs.length, 1)
  assert.equal(declaredInputEntry(dispatched, 'glb')?.name, 'input_mesh')
  assert.equal(isMeshInput(declaredInputEntry(dispatched, 'glb')), true)
  assert.equal(primaryInput(dispatched, 'glb')?.name, 'input_mesh')

  // Flattened defaults still land on the object the panel edits.
  assert.equal(dispatched.input_mesh, '', 'parameter default must be flattened')
  assert.equal(dispatched.use_transfer, true)
})

test('a 3D result layer counts as a mesh layer even though it is stored as an image', () => {
  // Dropped GLB.
  assert.equal(isMeshLayer({ type: 'glb', glbUrl: 'blob:http://localhost/1' }), true)
  // 3D result: an image thumbnail that carries the mesh URL.
  assert.equal(isMeshLayer({ type: 'image', isGlbThumbnail: true, glbUrl: '/api/image-proxy?url=x.glb' }), true)
  // A plain image is not a mesh.
  assert.equal(isMeshLayer({ type: 'image', image: {} }), false)
  assert.equal(isMeshLayer({ type: 'video', videoUrl: 'x.mp4' }), false)
  assert.equal(isMeshLayer(null), false)
  assert.equal(isMeshLayer(undefined), false)
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

test('an unknown state never hides a cartridge — a busy machine must not empty the panel', () => {
  const services = [{ id: 'a', workerId: 'w1' }, { id: 'b', workerId: 'w2' }]
  const unknown = { w1: { state: 'unknown' }, w2: { state: 'unknown' } }
  assert.deepEqual(visibleCartridges(services, unknown).map((s) => s.id), ['a', 'b'])

  // docker probe failed entirely: no states at all
  assert.equal(visibleCartridges(services, {}).length, 2)
})

test('without Docker state nothing is hidden', () => {
  const services = [{ id: 'a', workerId: 'w1' }, { id: 'b', workerId: 'w2' }]
  assert.equal(visibleCartridges(services, {}).length, 2)
  assert.equal(visibleCartridges(services, undefined).length, 2)
  assert.deepEqual(visibleCartridges(undefined, {}), [])
})

// --------------------------------------------------------------------------- #
// result layer size
// --------------------------------------------------------------------------- #

async function minimaxService() {
  const [catalog] = JSON.parse(await fs.readFile(path.join(shipped, 'minimax-h3-image-edit.json'), 'utf8'))
  return projectService(catalog)
}

test('a fixed 2048x2048 selection lands as a 2048x2048 layer, not the input size', async () => {
  const service = await minimaxService()
  // "Max Dimension" capped the reference layer at 1024; the worker still
  // returns exactly the selected square.
  const input = { width: 1024, height: 1024 }
  const result = { width: 2048, height: 2048 }

  assert.deepEqual(fixedOutputSize({ ...service, size: '2048x2048' }), result)
  assert.deepEqual(resultLayerSize({ ...service, size: '2048x2048' }, result, input), result)

  // The selection is authoritative even if the worker's PNG disagrees: the
  // layer (and therefore the export) is exactly what the user picked. Without
  // this, disabling the fixed-size rule still passed by falling through to the
  // real result pixels.
  assert.deepEqual(resultLayerSize({ ...service, size: '2048x2048' }, { width: 1024, height: 1024 }, input), result)
})

test('1024x1024 is honoured too, and a bigger input does not win', async () => {
  const service = await minimaxService()
  const result = { width: 1024, height: 1024 }
  assert.deepEqual(resultLayerSize({ ...service, size: '1024x1024' }, result, { width: 2048, height: 2048 }), result)
  assert.deepEqual(resultLayerSize({ ...service, size: '1024x1024' }, { width: 2048, height: 2048 }, { width: 2048, height: 2048 }), result)
})

test("Input Image uses the worker's real dimensions", async () => {
  const service = await minimaxService()
  const result = { width: 1536, height: 2048 }
  assert.equal(fixedOutputSize({ ...service, size: 'Input Image' }), null)
  assert.deepEqual(resultLayerSize({ ...service, size: 'Input Image' }, result, { width: 1024, height: 1024 }), result)
})

test('cartridges without a size control keep the old input-layer rule', () => {
  const service = { parameters: [{ name: 'prompt' }] }
  const input = { width: 1024, height: 1024 }
  const result = { width: 2048, height: 2048 }
  assert.equal(fixedOutputSize(service), null)
  assert.deepEqual(resultLayerSize(service, result, input), input)
  assert.deepEqual(resultLayerSize(service, result, null), result)
  // A stray size field must not change anything unless the parameter is declared.
  assert.deepEqual(resultLayerSize({ ...service, size: '2048x2048' }, result, input), input)
})

test('custom_size / upscale_size legacy opt-out still uses the real pixels', () => {
  const result = { width: 2048, height: 2048 }
  const input = { width: 1024, height: 1024 }
  assert.deepEqual(resultLayerSize({ custom_size: true }, result, input), result)
  assert.deepEqual(resultLayerSize({ upscale_size: true }, result, input), result)
})

test('the canvas result branches are wired to the shared size rule', async () => {
  const source = await fs.readFile(path.join(root, 'components', 'canvas-editor.tsx'), 'utf8')

  const imageStart = source.indexOf('// Handle image result (existing logic)')
  assert.notEqual(imageStart, -1, 'image result branch marker is missing')
  const imageEnd = source.indexOf('img.onerror = () => {', imageStart)
  assert.notEqual(imageEnd, -1, 'image result branch has no end marker')
  const image = source.slice(imageStart, imageEnd)

  for (const statement of [
    'const resultSize = resultLayerSize(',
    'service,',
    '{ width: img.width, height: img.height },',
    'inputLayer ? { width: inputLayer.width, height: inputLayer.height } : null',
    'const targetWidth = resultSize.width',
    'const targetHeight = resultSize.height',
    'width: targetWidth,',
    'height: targetHeight,',
  ]) {
    assert.ok(image.includes(statement), `image result branch is missing: ${statement}`)
  }
  assert.ok(!image.includes('targetWidth = inputLayer ? inputLayer.width : img.width'),
    'the input-layer sizing rule came back')

  // Not `video.onloadeddata`: the paste/drop handlers use that too. Anchor on
  // the result handler's own marker so the window cannot silently be a
  // different function.
  const videoStart = source.indexOf('// Handle video result - fetch and create blob URL for seekability')
  assert.notEqual(videoStart, -1, 'video result branch marker is missing')
  const videoEnd = source.indexOf('const newLayer: Layer = {', videoStart)
  assert.notEqual(videoEnd, -1, 'video result branch has no end marker')
  const video = source.slice(videoStart, videoEnd)
  for (const statement of [
    'const resultSize = resultLayerSize(',
    '{ width: video.videoWidth, height: video.videoHeight },',
    'const targetWidth = resultSize.width',
    'const targetHeight = resultSize.height',
  ]) {
    assert.ok(video.includes(statement), `video result branch is missing: ${statement}`)
  }
  assert.ok(!video.includes('targetWidth = inputLayer ? inputLayer.width : video.videoWidth'),
    'the input-layer sizing rule came back in the video branch')

  assert.match(source, /^  resultLayerSize,$/m, 'resultLayerSize is not imported')
})
