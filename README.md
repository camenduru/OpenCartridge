# ⚡ OpenCartridges

**OpenCartridges** is an open-source, **local-first** AI creative suite UI — a canvas-first workspace for generating and editing **images, videos, 3D and audio** entirely through your own locally running AI cartridges. It is built on top of [camenduru's TostUI](https://github.com/camenduru/TostUI) and restyled with the visual language of [higgsfield.ai](https://higgsfield.ai): near-black surfaces, white type, a lime `#d1fe17` accent, and editorial serif headlines.

![OpenCartridges](public/logo.svg)

## ✨ What's inside

- 🎨 **Canvas editor** — layered image / text / video / audio / 3D(GLB) composition with undo-redo, transform, blend and export
- 🧠 **AI services panel** — drag any service onto the canvas; parameters are rendered automatically from the service schema
- 🖼️ **Image & video generation, editing, upscaling** via TostEngine / TostUI docker templates (see table below)
- 🧊 **3D viewer** — GLB preview powered by `@google/model-viewer`
- 🎵 **Audio** — waveform overlay and song generation services
- 🏠 **100% local** — jobs run against your local API server (`http://localhost:8000`), uploads go to your local MinIO (`http://localhost:9000`). No cloud account, no wallet, no credits.
- 🌗 **Dark-first theme** inspired by higgsfield.ai (light mode included)

## 🚀 Quick start

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000

### Configuration

OpenCartridges talks only to your local services. Every worker is registered in the global registry **`public/service-workers.json`**, which maps each cartridge catalog to its ports. `/api/ai-services` merges all registered catalogs and the cartridges panel shows every cartridge; each job (and its input uploads) is routed to the worker its cartridge belongs to.

```json
[
  { "id": "3x3-sprite-sheet", "name": "3x3 Sprite Sheet", "catalog": "services/3x3-sprite-sheet.json", "apiUrl": "http://127.0.0.1:8000", "uploadUrl": "http://localhost:9000" },
  { "id": "loop-hero-style",  "name": "Loop Hero Style",  "catalog": "services/loop-hero-style.json",  "apiUrl": "http://127.0.0.1:8001", "uploadUrl": "http://localhost:9000" }
]
```

- `catalog` — path relative to `public/`, **or** an absolute filesystem path to a `services.json` in another project (e.g. `C:\\…\\tostui-loop-hero-style\\ui\\services.json`)
- `apiUrl` — the worker's `/run` / `/runsync` / `/status/{id}` API
- `uploadUrl` — the MinIO server that input layers are uploaded to

To add a worker: drop its `services.json` somewhere reachable, add one entry to the registry, restart OpenCartridges. Bundled catalogs currently ship for [tostui-3x3-sprite-sheet](../tostui-3x3-sprite-sheet) (sheet generation + animation) and [tostui-loop-hero-style](../tostui-loop-hero-style) (Loop Hero pixel-art style).

The **Global Configuration** panel (Layers sidebar) holds the default API/upload URLs, used by any service that does not declare its own.

| Variable | Purpose |
| --- | --- |
| `OPENHIGGS_SERVICES_URL` / `TOST_AI_SERVICES_URL` | Optional extra remote JSON catalog, merged with the registry |
| `NEXT_PUBLIC_OPENHIGGS_LOCAL_API_SERVICES` / `NEXT_PUBLIC_TOST_UI_LOCAL_API_SERVICES` | Comma-separated service IDs to show; unset = show all |

OpenCartridges-specific variables take precedence; the original TostUI variables keep working so existing docker templates need no changes.

## 🍞 Base templates (TostUI / TostEngine)

OpenCartridges uses the same local docker templates as TostUI — run any of them and connect at `http://localhost:8000`:

| Template | Notes |
| --- | --- |
| `camenduru/tostui-trellis2` | Trellis 2 — image to 3D (min 24GB VRAM) |
| `camenduru/tostui-flux-2-dev` | Flux.2 [dev] 8bit (min 24GB VRAM) |
| `camenduru/tostui-z-image-turbo` | Z-Image-Turbo with LoRA (min 24GB VRAM) |
| `camenduru/tostui-z-image-turbo-4bit` | Z-Image-Turbo 4bit (min 6GB VRAM) |
| `camenduru/tostui-qwen-image-edit-2511` | Qwen Image Edit 2511 8bit (min 24GB VRAM) |
| `camenduru/tostui-wan2-2-i2v-8bit` | Wan 2.2 image to video 8bit (min 24GB VRAM) |
| `camenduru/tostui-songgeneration` | Song generation base-new (min 14GB VRAM) |
| `camenduru/tostui-seedvr2` | SeedVR2 upscaler (min 24GB VRAM) |

Example:

```bash
docker run --gpus all -p 3000:3000 --name openhiggs camenduru/tostui-z-image-turbo-4bit
```

See the [TostUI README](https://github.com/camenduru/TostUI) for the full template list and RunPod/serverless deployments. All services were tested with an RTX 3090, RTX 4090, and RTX 5090.

## 🙏 Credits

- [TostUI](https://github.com/camenduru/TostUI) by [camenduru](https://x.com/camenduru) — application code, service protocol and docker templates (MIT)
- [higgsfield.ai](https://higgsfield.ai) — design inspiration
- [shadcn/ui](https://ui.shadcn.com) + Radix UI — component primitives

## 📄 License

MIT — see [LICENSE](./LICENSE) (© camenduru). OpenCartridges restyling and branding are provided under the same license.
