# ⚡ OpenCartridge

<img width="1920" height="1080" alt="Screenshot 2026-10-30 015836" src="https://github.com/user-attachments/assets/c87b4638-f353-4c56-8479-9179b7879e7d" />

<img width="1920" height="1080" alt="Screenshot 2026-10-30 015922" src="https://github.com/user-attachments/assets/b2452992-e913-4edf-acc6-569c92c4394d" />

<img width="1920" height="1080" alt="Screenshot 2026-10-30 020113" src="https://github.com/user-attachments/assets/679aa7cd-4ad4-419c-b62c-16d587f68bfe" />

<img width="1920" height="1080" alt="Screenshot 2026-10-30 065139" src="https://github.com/user-attachments/assets/978b98fe-f490-4be5-901e-aea732dedfb2" />

**OpenCartridge** is an open-source, **local-first AI game asset creative suite** — a canvas-first workspace for generating and editing **game assets** (images, sprite sheets, animation, 3D, audio) entirely through your own locally running ComfyUI workers. It is built on top of [camenduru's TostUI](https://github.com/camenduru/TostUI) and restyled with the visual language of [higgsfield.ai](https://higgsfield.ai): near-black surfaces, white type, a lime `#d1fe17` accent, and editorial serif headlines.

![OpenCartridge](public/logo.svg)

## ✨ What's inside

- 🎨 **Canvas editor** — layered image / text / video / audio / 3D(GLB) composition with undo-redo, transform, blend and export
- 🧩 **Cartridges panel** — every worker's cartridges render automatically from its catalog; drag them onto the canvas
- 🖼️ **Image & video generation, editing, upscaling** via local worker dockers
- 🧊 **3D viewer** — GLB preview powered by `@google/model-viewer`
- 🎵 **Audio** — waveform overlay and song generation cartridges
- 🗄️ **MinIO inside** — the container ships its own MinIO storage and creates the public `tost` and `test` buckets on startup
- 🔄 **Self-update** — the Global Configuration panel has an Update button that pulls the latest source from GitHub, rebuilds and restarts
- 🏠 **100% local** — no cloud account, no credits
- 🌗 **Dark-first theme** inspired by higgsfield.ai (light mode included)

## 🚀 Quick start (from source)

```bash
pnpm install
pnpm dev
```

Open http://localhost:3010 — then add your workers as cartridges (see 🧩 Adding cartridges).

## ▶️ Run with Docker (recommended)

The `camenduru/opencartridge` image is self-contained: the UI **and** its own MinIO storage. On startup it creates the public `tost` and `test` buckets automatically (credentials `tost` / `tosttost`), so the worker containers need no separate storage server.

```bash
docker build -t camenduru/opencartridge docker/

docker run -d --name opencartridge --restart unless-stopped \
  -p 3000:3000 -p 9000:9000 -p 9001:9001 \
  -v opencartridge-data:/content/data \
  camenduru/opencartridge
```

- UI: http://localhost:3000
- MinIO S3 API: http://localhost:9000 (bucket `tost`, anonymous read/write)
- MinIO console: http://localhost:9001 (login `tost` / `tosttost`)

## 💾 Cartridges

The backend of most cartridges is [ComfyUI](https://github.com/comfy-org/comfyui) — the worker dockers run ComfyUI graphs headlessly behind a small job API (`/run`, `/runsync`, `/status/{id}`). CorridorKey 2.0 is the exception: it serves that same API from its own PyTorch runtime (`worker_runpod.py` in [CorridorKey2.0](https://github.com/nikopueringer/CorridorKey2.0)). Start each worker pointed at the MinIO inside the OpenCartridge container (`s3_endpoint_url=http://host.docker.internal:9000`):

```bash
# 3x3 Sprite Sheet — sheet generation (Qwen Image 2.1 Edit) + walk-cycle animation (MiniMax H3)
docker run -d --name 3x3-sprite-sheet --gpus all -p 8000:8000 \
  --ulimit memlock=67108864:67108864 \
  -e s3_access_key_id=tost -e s3_secret_access_key=tosttost \
  -e s3_endpoint_url=http://host.docker.internal:9000 \
  -e s3_region_name=us-east-1 -e s3_bucket_name=tost -e s3_bucket_folder=output \
  camenduru/3x3-sprite-sheet \
  python worker_runpod.py --rp_serve_api --rp_api_port 8000 --rp_api_host 0.0.0.0 --rp_log_level DEBUG --rp_debugger

# Loop Hero Style — Loop Hero pixel-art stylization (Krea 2 Turbo)
docker run -d --name loop-hero-style --gpus all -p 8001:8000 \
  -e s3_access_key_id=tost -e s3_secret_access_key=tosttost \
  -e s3_endpoint_url=http://host.docker.internal:9000 \
  -e s3_region_name=us-east-1 -e s3_bucket_name=tost -e s3_bucket_folder=output \
  camenduru/loop-hero-style \
  python worker_runpod.py --rp_serve_api --rp_api_port 8000 --rp_api_host 0.0.0.0 --rp_log_level DEBUG --rp_debugger

# CorridorKey 2.0 — native-resolution matting / keying (C-RADIOv4 + MoGe-2 + RVM)
docker run -d --name corridorkey --gpus all -p 8002:8002 \
  -e s3_access_key_id=tost -e s3_secret_access_key=tosttost \
  -e s3_endpoint_url=http://host.docker.internal:9000 \
  -e s3_region_name=us-east-1 -e s3_bucket_name=tost -e s3_bucket_folder=output \
  camenduru/corridorkey \
  python worker_runpod.py --port 8002 --host 0.0.0.0

# Idol 3D — one image to a 3D model (Idol, TripoSplat architecture, meshed to GLB)
docker run -d --name idol --gpus all -p 8003:8003 \
  -e s3_access_key_id=tost -e s3_secret_access_key=tosttost \
  -e s3_endpoint_url=http://host.docker.internal:9000 \
  -e s3_region_name=us-east-1 -e s3_bucket_name=tost -e s3_bucket_folder=output \
  camenduru/idol \
  python worker_runpod.py --rp_serve_api --rp_api_port 8003 --rp_api_host 0.0.0.0 --rp_log_level INFO
```

Requires an NVIDIA GPU with ~24 GB VRAM (tested on RTX 3090). The ComfyUI-based workers load their models at startup (~35 s) before the API answers. CorridorKey needs far less — 4 GB for footage up to 1440p, 6 GB for 4K — but it loads its ~4.8 GB of weights per job, so the first key takes ~30 s. Idol 3D imports ComfyUI on its first job and keeps the loaded weights warm afterwards; a 50-step image takes ~60 s and returns a ~28 MB GLB at the default mesh resolution.

## 🧩 Adding cartridges

Every worker is registered in the global registry **`public/service-workers.json`**, which maps each cartridge catalog to its ports. `/api/ai-services` merges all registered catalogs and the cartridges panel shows every cartridge; each job (and its input uploads) is routed to the worker its cartridge belongs to.

```json
[
  { "id": "3x3-sprite-sheet", "name": "3x3 Sprite Sheet", "catalog": "services/3x3-sprite-sheet.json", "apiUrl": "http://127.0.0.1:8000", "uploadUrl": "http://localhost:9000", "workerUploadUrl": "http://host.docker.internal:9000" },
  { "id": "loop-hero-style",  "name": "Loop Hero Style",  "catalog": "services/loop-hero-style.json",  "apiUrl": "http://127.0.0.1:8001", "uploadUrl": "http://localhost:9000", "workerUploadUrl": "http://host.docker.internal:9000" },
  { "id": "corridorkey",      "name": "CorridorKey 2.0",  "catalog": "services/corridorkey.json",      "apiUrl": "http://127.0.0.1:8002", "uploadUrl": "http://localhost:9000", "workerUploadUrl": "http://host.docker.internal:9000" }
]
```

- `catalog` — path relative to `public/`, **or** an absolute filesystem path to a `services.json` in another project
- `apiUrl` — the worker's `/run` / `/runsync` / `/status/{id}` API
- `uploadUrl` — the MinIO server the browser uploads inputs to
- `workerUploadUrl` — the same MinIO as seen from inside the worker container (used for the object link handed to the worker)

To add a worker: drop its `services.json` somewhere reachable, add one entry to the registry, restart OpenCartridge. Bundled catalogs currently ship for [tostui-3x3-sprite-sheet](../tostui-3x3-sprite-sheet) (sheet generation + animation), [tostui-loop-hero-style](../tostui-loop-hero-style) (Loop Hero pixel-art style), [CorridorKey2.0](../CorridorKey2.0) (native-resolution matting: **CorridorKey Image** keys a still, **CorridorKey Video** keys a whole clip) and [ComfyUI-Idol](../ComfyUI-Idol) (**Idol 3D** turns one reference image into a GLB, meshed from the gaussian splat it predicts).

## 🔄 Updating

The Global Configuration panel has an **Update Cartridges** button (POST `/api/update`): it pulls the latest source from this GitHub repository, rebuilds and restarts the server — no image rebuild needed for UI changes. For a durable update, rebuild the image with `--build-arg CACHEBUST=$(date +%s)` (see the notes in `docker/Dockerfile`).

## 🙏 Credits

- [TostUI](https://github.com/camenduru/TostUI) by [camenduru](https://x.com/camenduru) — application code, cartridge protocol and worker dockers (MIT)
- [ComfyUI](https://github.com/comfy-org/comfyui) — the backend running inside most workers
- [CorridorKey 2.0](https://github.com/camenduru/CorridorKey2.0) — native-resolution matting model by Zachary Harris with Corridor Digital, served through its own worker API
- [higgsfield.ai](https://higgsfield.ai) — design inspiration
- [shadcn/ui](https://ui.shadcn.com) + Radix UI — component primitives

## 📄 License

MIT — see [LICENSE](./LICENSE) (© camenduru). OpenCartridge restyling and branding are provided under the same license.
