# Cartridge schema

A cartridge is a JSON description of one worker endpoint: what it takes, what it
returns, and which knobs it exposes. OpenCartridge renders it, binds a layer to
it and dispatches a job.

**The promise: a cartridge written years ago keeps working in a newer UI.**
`lib/cartridge-schema.mjs` is what enforces it, and `tests/cartridges.test.mjs`
is what proves it on every change.

## Rules

1. **Reading is a superset operation.** Unknown keys are preserved, unknown
   parameter types fall back, unknown categories still list.
2. **Add, never remove or repurpose.** A field's meaning never changes. New
   meaning → new field.
3. **The job protocol is the real contract.** `POST /run {"input": …}` →
   `POST /status/{id}` → `{"status": "COMPLETED", "output": {"result": "<url>"}}`.
   A cartridge may be presented with fields its worker has never seen; a worker
   may ignore every field it does not know.
4. **Defaults fill gaps.** A catalog that declares nothing gets v1 behaviour, not
   an error.

## Envelope

Every shape below loads; you do not have to migrate a catalog.

```json
[ { "id": "…", "name": "…" } ]                       // v1: a bare array
{ "cartridges": [ … ] }                              // same, wrapped
{ "services": [ … ] }                                // legacy alias
{ "schema": "cartridge/2", "cartridges": [ … ] }     // versioned
```

`schema` is `2` (or `"cartridge/2"`); anything unreadable is treated as `1`.
A UTF-8 BOM is accepted.

## Cartridge

| Field | Meaning |
|---|---|
| `id` | stable key for jobs, history, routing. Derived from `name` when absent. |
| `name`, `description`, `overview` | display text |
| `category` | `image`, `video`, `audio`, `3d`, `text` — drives the catalogue grouping and the last-resort result type |
| `icon` | `Box`, `Image`, `Video`, `Camera`, `AudioWaveform`, `Grid3X3`, `MessageSquare`, `Mic`, `RefreshCw`, `Zap` |
| `parameters` | the knobs (below) |
| `inputs` | which parameter a selected layer binds to (v2, optional) |
| `returns` | what the job produces (v2, optional) |
| `requires` | capabilities the cartridge would like (v2, optional, advisory) |
| `examples` | `{ "input": [url], "output": [url] }` |
| `cost`, `processingTime`, `delay`, `divisible`, `home`, `workerId`, `inputTypes` | unchanged from v1 |

### Parameters

```json
{ "name": "steps", "type": "slider", "label": "Steps",
  "defaultValue": 50, "min": 20, "max": 60, "step": 1,
  "ui": true, "required": false }
```

`ui: false` means the parameter is not shown in the panel (it is still sent, and
file parameters with `ui: false` are the ones a selected layer is uploaded into).

| `type` | control |
|---|---|
| `string` | text input; a text area when the name looks like prose (`prompt`, `instruction`, `text`, `lyric`, `caption`, `description`) |
| `number` | number input |
| `boolean` | switch |
| `select` | dropdown from `options` |
| `slider` | slider from `min`/`max`/`step` |
| `file` | URL input with "set selected layer" |
| anything else | **JSON editor** — never dropped |

A cartridge may steer the fallback itself:

```json
{ "name": "curve", "type": "bezier", "fallback": "string" }
```

`fallback`, `fallbackType` or a `fallbacks` array are tried in order, then
`json`. The editor keeps the raw text while it is being typed and commits the
parsed value as soon as it is valid JSON; invalid text is passed through as a
string.

### Inputs (v2)

```json
"inputs": [{ "name": "input_video", "accepts": ["video/*"], "bind": "primary", "required": true }]
```

Binding order: an input whose `accepts` matches the selected layer's kind, then
the entry with `bind: "primary"`, then the first. Catalogs without `inputs` keep
the v1 magic names (`input_video`, `input_image`, `input_image1`, `start_image`,
`input_audio`), and the UI also derives `inputs` from `ui: false` file
parameters so old cartridges resolve the same way.

### Returns (v2)

```json
"returns": { "type": "model/gltf-binary", "ext": "glb", "layer": "3d" }
```

Layer kind resolution: `returns.layer` → URL extension → the cartridge's
`category`.

Download extension resolution: the MIME type of the bytes that arrived → 
`returns.ext` → URL extension → `bin`. The MIME type wins because a cartridge can
legitimately return more than one container from one endpoint (CorridorKey's
`output=alpha` is MP4, `output=cutout` is a transparent WebM).

### Capabilities

```json
"requires": { "capabilities": ["layer.3d", "param.file"] }
```

Advisory. Missing capabilities are reported (`missingCapabilities`) and logged,
never fatal — the cartridge still lists, still dispatches, and renders with the
fallbacks above. Current vocabulary: `layer.*`, `param.*`, `result.declared`,
`result.suffix`.

## Deprecation ledger

| Field | Status |
|---|---|
| bare array catalog | **supported forever** |
| `inputTypes` | supported; `inputs` supersedes it for binding |
| magic input names | supported; used whenever `inputs` is absent |
| URL-suffix result typing | supported; used whenever `returns` is absent |
| `type: "string"` for prose | supported; still renders the text area |
| `fg`, `checker` output values | parse anywhere; simply not offered by any shipped catalog |

Nothing in this table may be removed.

## Testing

```
npm test
```

`tests/fixtures/cartridges/v1/` holds frozen copies of every catalog that has
shipped. They are **never edited** — a new fixture is added when a new catalog
ships. The suite asserts that each frozen catalog still parses without warnings,
that every one of its parameters still produces a real control, and that it
still resolves a result kind and a primary input the old way. `public/services/`
is checked too, so a broken catalog cannot ship.
