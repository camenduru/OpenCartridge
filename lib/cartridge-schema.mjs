/**
 * Cartridge schema — the compatibility layer between cartridge catalogs and the UI.
 *
 * The promise this module exists to keep: a cartridge written years ago keeps
 * working in a newer UI.
 *
 *  - Reading is a superset operation. Unknown keys are preserved, unknown
 *    parameter types fall back to a JSON editor, unknown categories still list,
 *    and a catalog that declares nothing (every catalog written before v2) is
 *    normalised with defaults.
 *  - Nothing is ever removed or repurposed. `returns` is added *beside* the old
 *    "guess the layer kind from the URL suffix" behaviour, `inputs` beside the
 *    old magic parameter names (`input_image`, `input_video`, ...). A cartridge
 *    that declares neither takes the old path.
 *  - New vocabulary is additive: see `PARAM_CONTROLS`, `LAYER_KINDS`,
 *    `CAPABILITIES`.
 *
 * Plain ESM JS so both the Next app and `node --test` can import it unchanged.
 */

/** Newest schema this build understands. Older catalogs are normalised up. */
export const SCHEMA_VERSION = 2

/** Layer kinds the canvas can render. */
export const LAYER_KINDS = ['image', 'video', 'audio', '3d', 'text']

/** Widgets the cartridge panel renders natively; anything else uses the fallback. */
export const PARAM_CONTROLS = ['text', 'textarea', 'number', 'boolean', 'select', 'slider', 'file', 'json']

/**
 * What this build can do. A cartridge may declare `requires.capabilities`; a
 * capability it asks for that is missing here is reported, never fatal — the
 * cartridge still lists and still runs, it just renders with fallbacks.
 */
export const CAPABILITIES = [
  'layer.image', 'layer.video', 'layer.audio', 'layer.3d', 'layer.text',
  'param.text', 'param.textarea', 'param.number', 'param.boolean', 'param.select',
  'param.slider', 'param.file', 'param.json',
  'result.declared', 'result.suffix',
]

const EXTENSION_KIND = {
  // images
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image',
  avif: 'image', bmp: 'image', tif: 'image', tiff: 'image', exr: 'image',
  // video
  mp4: 'video', webm: 'video', mov: 'video', avi: 'video', mkv: 'video', m4v: 'video',
  // audio
  mp3: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio', m4a: 'audio', aac: 'audio',
  // 3d
  glb: '3d', gltf: '3d', obj: '3d', fbx: '3d', stl: '3d', ply: '3d', spz: '3d', ksplat: '3d',
  // text
  txt: 'text', md: 'text', json: 'text',
}

const MIME_EXTENSION = {
  'model/gltf-binary': 'glb',
  'model/gltf+json': 'gltf',
  'video/webm': 'webm',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

/** Legacy binding: the parameter names the UI has sniffed for since v1. */
const MAGIC_INPUTS = ['input_video', 'input_image', 'input_image1', 'input_audio', 'start_image']

const LONG_TEXT = /prompt|instruction|text|lyric|caption|description/

// --------------------------------------------------------------------------- #
// primitives
// --------------------------------------------------------------------------- #

/** `"cartridge/2"`, `2`, `"2"` → 2. Anything unreadable → 1. */
/** @param {unknown} value @returns {number} */
export function schemaVersionOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  const match = String(value ?? '').match(/(\d+)/)
  return match ? Number(match[1]) : 1
}

/**
 * Extension of a URL that may be a proxy (`/api/image-proxy?url=…`).
 * Returns lowercase, without the dot, or '' when there is none.
 */
/** @param {unknown} url @returns {string} */
export function extensionOf(url) {
  if (typeof url !== 'string' || !url) return ''
  let candidate = url.split('#')[0]
  try {
    candidate = decodeURIComponent(candidate)
  } catch {
    /* malformed escapes: fall through with the raw string */
  }
  const match = candidate.match(/\.([a-z0-9]{1,8})(?:[?&]|$)/i)
  return match ? match[1].toLowerCase() : ''
}

/** Layer kind a URL's extension implies, or null. */
/** @param {unknown} url @returns {string|null} */
export function kindFromUrl(url) {
  return EXTENSION_KIND[extensionOf(url)] ?? null
}

/**
 * Extension to save a result under.
 *
 * The MIME type of the bytes that actually arrived wins — a cartridge can
 * declare one extension and still return another (CorridorKey returns MP4 for
 * `alpha` and WebM for `cutout`) — then the declared `returns.ext`, then the URL.
 */
/** @param {any} service @param {unknown} url @param {string} [mime] @returns {string} */
export function extensionFor(service, url, mime = '') {
  if (MIME_EXTENSION[mime]) return MIME_EXTENSION[mime]
  const declared = service?.returns?.ext
  if (typeof declared === 'string' && declared) return declared.replace(/^\./, '')
  return extensionOf(url) || 'bin'
}

/**
 * Layer kind a job result should become.
 *
 * `returns` wins; a cartridge that declares nothing keeps the v1 behaviour of
 * reading the extension. `fallback` covers a worker that returned an extension
 * this build does not know.
 */
/** @param {any} service @param {unknown} url @param {string|null} [fallback] @returns {string|null} */
export function resultKind(service, url, fallback = null) {
  const declared = service?.returns?.layer
  if (typeof declared === 'string' && LAYER_KINDS.includes(declared)) return declared
  return kindFromUrl(url) ?? fallback
}

// --------------------------------------------------------------------------- #
// parameters
// --------------------------------------------------------------------------- #

function defaultFor(param) {
  if (param.defaultValue !== undefined) return param.defaultValue
  switch (param.type) {
    case 'boolean': return false
    case 'number':
    case 'slider': return param.min ?? 0
    default: return ''
  }
}

/**
 * Which control renders a parameter.
 *
 * Known types map to themselves (`string` becomes a text area for prompts), an
 * explicit `fallback` is honoured, and anything unrecognised becomes `json`
 * rather than being dropped — a cartridge may ship a widget this build has
 * never heard of and still be usable.
 */
/** @param {any} param @returns {string} */
export function paramControl(param) {
  const type = String(param?.type ?? '').toLowerCase()
  const name = String(param?.name ?? '')

  const resolve = (candidate) => {
    const value = String(candidate ?? '').toLowerCase()
    if (value === 'string') return LONG_TEXT.test(name) ? 'textarea' : 'text'
    if (value === 'number' || value === 'boolean' || value === 'select' ||
        value === 'slider' || value === 'file') return value
    if (value === 'text' || value === 'textarea' || value === 'json') return value
    return null
  }

  const direct = resolve(type)
  if (direct) return direct

  for (const candidate of [param?.fallback, param?.fallbackType, ...(param?.fallbacks ?? [])]) {
    const resolved = resolve(candidate)
    if (resolved) return resolved
  }
  return 'json'
}

/** Normalised parameter: unknown keys kept, defaults filled. */
/** @param {any} raw @returns {any} */
export function normalizeParameter(raw) {
  const param = { ...(raw ?? {}) }
  if (!param.name) param.name = ''
  if (!param.type) param.type = 'string'
  if (param.required === undefined) param.required = false
  if (param.ui === undefined) param.ui = false
  if (param.defaultValue === undefined) param.defaultValue = defaultFor(param)
  if (param.label === undefined) param.label = ''
  return param
}

// --------------------------------------------------------------------------- #
// inputs
// --------------------------------------------------------------------------- #

/**
 * The parameter a selected layer binds to, if any.
 *
 * `inputs` (v2) is authoritative when present; otherwise the v1 magic names.
 * `layerType` (image/video/audio/…) narrows the choice when a cartridge takes
 * more than one kind of input.
 */
/** @param {any} service @param {string|null} [layerType] @returns {any|null} */
export function primaryInput(service, layerType = null) {
  const parameters = Array.isArray(service?.parameters) ? service.parameters : []
  const declared = Array.isArray(service?.inputs) ? service.inputs : []
  const accepts = (entry) => {
    if (!layerType || !Array.isArray(entry.accepts) || entry.accepts.length === 0) return false
    return entry.accepts.some((mime) => String(mime) === layerType || String(mime).startsWith(`${layerType}/`))
  }

  if (declared.length > 0) {
    // Layer type first (a cartridge can take an image or a clip), then the
    // entry marked primary, then whatever is first.
    const match = (layerType && declared.find(accepts)) ?? declared.find((e) => e.bind !== 'secondary') ?? declared[0]
    const param = parameters.find((p) => p.name === match?.name)
    if (param) return param
    // declared an input whose parameter the build cannot see: fall through
  }

  if (layerType) {
    const direct = parameters.find((p) => p.name === `input_${layerType}`)
    if (direct) return direct
  }
  for (const name of MAGIC_INPUTS) {
    const param = parameters.find((p) => p.name === name)
    if (param) return param
  }
  return null
}

function normalizeInputs(service) {
  if (Array.isArray(service?.inputs) && service.inputs.length > 0) {
    return service.inputs.map((entry, index) => ({
      bind: index === 0 ? 'primary' : 'secondary',
      required: false,
      accepts: [],
      ...(entry ?? {}),
    }))
  }
  const derived = []
  const parameters = Array.isArray(service?.parameters) ? service.parameters : []
  for (const param of parameters) {
    if (param.type !== 'file' || param.ui === true) continue
    const kind = String(param.name).replace(/^input_/, '').replace(/^start_/, '').replace(/\d+$/, '')
    derived.push({
      name: param.name,
      accepts: LAYER_KINDS.includes(kind) ? [`${kind}/*`] : [],
      bind: derived.length === 0 ? 'primary' : 'secondary',
      required: Boolean(param.required),
      derived: true,
    })
  }
  return derived
}

// --------------------------------------------------------------------------- #
// services
// --------------------------------------------------------------------------- #

function normalizeReturns(raw) {
  if (!raw || typeof raw !== 'object') return undefined
  const type = typeof raw.type === 'string' ? raw.type : ''
  const out = { ...raw }
  if (!out.layer) {
    if (out.kind && LAYER_KINDS.includes(out.kind)) out.layer = out.kind
    else if (type.startsWith('image/')) out.layer = 'image'
    else if (type.startsWith('video/')) out.layer = 'video'
    else if (type.startsWith('audio/')) out.layer = 'audio'
    else if (type === 'model/gltf-binary' || type === 'model/gltf+json') out.layer = '3d'
  }
  if (!out.ext && MIME_EXTENSION[type]) out.ext = MIME_EXTENSION[type]
  return out
}

/**
 * The cartridges to show in the panel.
 *
 * Only a *confirmed* down state hides a cartridge: stopped, ready (image but no
 * container) or missing (no image). `unknown` — Docker not mounted, or a probe
 * that timed out because the machine was busy rendering — must never hide
 * anything, otherwise the whole panel empties while a job runs.
 *
 * @param {any[]} services
 * @param {Record<string, {state?: string}|null>} [workerStates]
 * @returns {any[]}
 */
export function visibleCartridges(services, workerStates) {
  const states = workerStates || {}
  const CONFIRMED_DOWN = new Set(['stopped', 'ready', 'missing'])
  return (Array.isArray(services) ? services : []).filter((service) => {
    const worker = states[service?.workerId]
    return !worker || !CONFIRMED_DOWN.has(worker.state)
  })
}

/** Capabilities a cartridge asks for that this build does not provide. */
/** @param {any} service @returns {string[]} */
export function missingCapabilities(service) {
  const wanted = service?.requires?.capabilities
  if (!Array.isArray(wanted)) return []
  return wanted.filter((capability) => !CAPABILITIES.includes(String(capability)))
}

/**
 * A cartridge from any catalog version, ready for the UI.
 *
 * Every unknown field survives (`{...raw}` first), so a newer catalog read by
 * an older UI is preserved rather than silently stripped.
 */
/** @param {any} raw @param {string[]} [warnings] @returns {any} */
export function normalizeService(raw, warnings = []) {
  const service = { ...(raw ?? {}) }

  if (!service.id) {
    const slug = String(service.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    service.id = slug || `cartridge-${warnings.length}`
    warnings.push(`cartridge without an id, derived "${service.id}"`)
  }
  if (!service.name) service.name = service.id
  if (!service.category) {
    const kinds = Array.isArray(service.inputTypes) ? service.inputTypes : []
    service.category = kinds[0] ?? service.returns?.layer ?? 'image'
  }
  if (!Array.isArray(service.inputTypes)) service.inputTypes = []
  if (!Array.isArray(service.parameters)) service.parameters = []
  service.parameters = service.parameters.map(normalizeParameter)

  service.returns = normalizeReturns(service.returns)
  service.inputs = normalizeInputs(service)
  service.schema = schemaVersionOf(service.schema ?? SCHEMA_VERSION)

  const unsupported = missingCapabilities(service)
  if (unsupported.length > 0) {
    service.missingCapabilities = unsupported
    warnings.push(`${service.id} requires capabilities this build lacks: ${unsupported.join(', ')}`)
  }
  return service
}

/**
 * A catalog file from any version: a bare array (v1, and what every catalog in
 * the wild looks like today), `{cartridges: [...]}`, `{services: [...]}` or
 * `{schema: "cartridge/2", cartridges: [...]}`.
 */
/** @param {unknown} data @returns {{schema: number, cartridges: any[], warnings: string[]}} */
export function normalizeCatalog(data) {
  const warnings = []
  let version = 1
  let list = []

  if (Array.isArray(data)) {
    list = data
  } else if (data && typeof data === 'object') {
    version = schemaVersionOf(data.schema ?? data.schemaVersion ?? 1)
    const candidate = data.cartridges ?? data.services ?? data.items
    if (Array.isArray(candidate)) list = candidate
    else warnings.push('catalog object has no cartridges array')
  } else if (data !== null && data !== undefined) {
    warnings.push('catalog is neither an array nor an object')
  }

  const cartridges = list
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => normalizeService(entry, warnings))

  const seen = new Set()
  for (const cartridge of cartridges) {
    if (seen.has(cartridge.id)) warnings.push(`duplicate cartridge id "${cartridge.id}"`)
    seen.add(cartridge.id)
  }

  return { schema: version, cartridges, warnings }
}

/** Parse catalog text; malformed JSON yields no cartridges and a warning. */
/** @param {unknown} text @returns {{schema: number, cartridges: any[], warnings: string[]}} */
export function parseCatalog(text) {
  try {
    // A BOM is a real thing to receive: catalogs are often written by Windows
    // editors and shells, and JSON.parse rejects it.
    const cleaned = String(text ?? '').replace(/^\uFEFF/, '')
    return normalizeCatalog(JSON.parse(cleaned))
  } catch (error) {
    return { schema: 1, cartridges: [], warnings: [`invalid JSON: ${error?.message ?? error}`] }
  }
}
