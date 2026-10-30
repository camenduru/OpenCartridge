# AGENTS.md — building cartridges

How an agent turns a ComfyUI workflow into an OpenCartridge cartridge that the UI can install, run and use.

Read this before touching anything. It documents the contracts that already exist, the mistakes that were already
made (so you do not repeat them), and the order to do the work in.

---

## 1. What a cartridge actually is

Three artifacts, in two repositories:

| Artifact | Where | Purpose |
|---|---|---|
| **Worker image** | `Dockerfile` + `worker_runpod.py`, kept outside this repository → `camenduru/<id>` | Runs the model, answers the job API, uploads results |
| **Catalog entry** | `OpenCartridge/public/services/<id>.json` | What the UI shows: parameters, examples, result type |
| **Registry entry** | `OpenCartridge/public/service-workers.json` | Which URL/port/container the cartridge belongs to |

Cartridges are **data**, not code: the UI reads the catalog and renders it. A catalog written years ago must keep
working — see `docs/cartridge-schema.md`. Never remove a field, never repurpose one, always add.

A single worker can serve several cartridges (CorridorKey serves `corridorkey-matte` and `corridorkey-clip`); a
cartridge cannot span workers.

---

## 2. The contracts you must not break

### 2.1 Job API (RunPod serverless)

The worker is a plain RunPod handler served locally:

```python
if __name__ == "__main__":
    runpod.serverless.start({"handler": generate})
```

```bash
python worker_runpod.py --rp_serve_api --rp_api_port 8004 --rp_api_host 0.0.0.0 --rp_log_level INFO
```

```
POST /run          {"input": {…}}  -> {"id": "…", "status": "IN_QUEUE"}
POST /runsync      {"input": {…}}  -> {"status": "COMPLETED", "output": {"result": "<url>"}}
POST /status/{id}                  -> {"status": "COMPLETED", "output": {"result": "<url>"}}
GET  /                             -> 200 (liveness; runpod's serve API has **no** /health)
```

- `handler(job)` returns the output dict. **Raise on failure** — a returned `{"status": "FAILED"}` looks COMPLETED to
  the UI and the job silently succeeds with no result.
- `output.result` is the URL the canvas loads. Extra keys (`output.glb`, `output.preview`) are ignored by the UI but
  invaluable for debugging.
- Never require a new field in `input`. Everything new is optional; old workers ignore what they do not know.

### 2.2 Storage

Same env names as every other worker; the app supplies them through the registry's `${NAME}` expansion:

```
s3_access_key_id, s3_secret_access_key, s3_endpoint_url,
s3_region_name, s3_bucket_name, s3_bucket_folder
```

Upload with the right `ContentType` (`model/gltf-binary` for GLB, `video/mp4`, `image/png`, …) and return
`{s3_endpoint_url}/{bucket}/{key}`. Point `s3_endpoint_url` at `http://host.docker.internal:9000` — that is the MinIO
inside the OpenCartridge container, not `localhost`.

### 2.3 Result type

Declare it in the catalog (`returns`). Do not make the UI guess from the URL: a worker can legitimately return MP4 for
one parameter and WebM for another, and an unknown extension means the job completes and no layer appears.

---

## 3. Step by step

**Worked example — read these three files before writing your own:**

| File | What it demonstrates |
|---|---|
| `Cartridges/3x3-sprite-sheet/workflows/3x3-sprite-sheet.json` | the ComfyUI graph: two subgraphs (Qwen Image 2.1 sheet edit, MiniMax H3 image-to-video), with the node ids and widget values the worker mirrors |
| `Cartridges/3x3-sprite-sheet/Dockerfile` | the whole image recipe: Ubuntu + CUDA toolkit, pinned torch, ComfyUI cloned at build time, weights baked in, one `COPY` of the worker |
| `Cartridges/3x3-sprite-sheet/worker_runpod.py` | the handler: `def generate(input)` at the bottom of a ~450-line file — staging, model loads, both stages, S3 upload, `{"result": …}` |

They map one-to-one: a node in the JSON becomes a class call in the worker. `KSampler` (id 458) is
`KSampler.sample(...)`, `TextEncodeQwenImage21` (474) is `TextEncodeQwenImage21.execute(...)`, and so on. Open the JSON
beside the worker when you build a new one — Appendix C is a map of it.

Worth copying verbatim from it:

- `generate(input)`'s outer `try/except` that prints the traceback and re-raises (`runpod` turns that into a FAILED
  job; returning a FAILED dict would look COMPLETED).
- `stage_image()` — same function, URL or local path, returns `(path, is_temporary)` so `finally` can clean up.
- `save_png()` — tensor → 8-bit PNG, and the `s3.upload_file(..., ExtraArgs={'ContentType': …})` block beside it.
- `_log_vram("after conditioning")` — free VRAM printed around each stage; keep it while developing, it is how you
  find which load pushed the card over.
- `_opt_flag()` — tolerate `true`, `"true"`, `1` from the UI.
- Its `CMD` is bare `python worker_runpod.py`; the `--rp_serve_api --rp_api_port …` flags come from the registry's
  `command`. Either place works — keep the flags and the port in **one** place.

### 3.1 Start from the workflow

Put the ComfyUI workflow JSON in the worker's source folder, under `workflows/`, next to its `Dockerfile`. Read it as
data: list the nodes, their `widgets_values`
and the links. Identify:

- the input node (`LoadImage`, `LoadVideo`, …) and what it takes
- the sampler settings that matter (steps, cfg, sampler, scheduler, seed)
- the output nodes (`SaveImage`, `CreateVideo`, `SaveGLB`, `SaveGaussianSplat`, …)
- every custom node pack it needs

Open question to answer before coding: **does the UI support the result type?** Image, video, audio, 3D (GLB) and text
render as layers. A `.ply` splat or a `.zip` cannot be displayed — mesh it, encode it, or ship it as a download-only
cartridge and say so in the UI text.

### 3.2 Choose how to drive it

**Preferred: call the node classes in process**, the way the `3x3-sprite-sheet` and `idol` workers do. No ComfyUI
server, no UI→API conversion, no port juggling:

```python
import sys
sys.path.insert(0, "/content/ComfyUI")
import comfy.options
comfy.options.enable_args_parsing()          # after trimming sys.argv!
import nodes                                  # NODE_CLASS_MAPPINGS + stock node classes
import comfy.model_management
```

Old-style nodes are instantiated and return tuples:

```python
(unet,) = nodes.UNETLoader().load_unet("model.safetensors", "default")
(vae,) = nodes.VAELoader().load_vae("vae.safetensors")
(clip,) = nodes.CLIPVisionLoader().load_clip("clip_vision.safetensors")
(latent,) = nodes.KSampler().sample(model, seed, steps, cfg, "euler", "simple",
                                    positive, negative, latent, denoise=1.0)
```

New-style (`comfy_api.latest.IO`) nodes are classmethods that return `IO.NodeOutput`; use **keyword arguments** and
take `.args`:

```python
(output,) = SomeNode.execute(image=image, strength=0.5).args
```

Beware: some custom packs ship an entrypoint (`comfy_entrypoint`) and must be imported as a package, not by file path.
A directory name with a hyphen is fine for `importlib.import_module("ComfyUI-Idol")` as long as its parent is on
`sys.path`.

**Avoid: run the ComfyUI server and POST to `/prompt`.** It looks easier and is not — `/prompt` takes the *API*
format, not the UI workflow, so you must hand-convert every node/link, and dynamic widgets (DynamicCombo) have
surprising serialisation. Only do it if the pack genuinely needs the server.

### 3.3 Stage the input

The UI hands you a URL (`input_image`, `input_video`, …). Download it yourself with a browser User-Agent — some CDNs
403 the default `Python-urllib/3.x`:

```python
request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
urllib.request.urlopen(request, timeout=120)
```

If you use `LoadImage` instead of reading the file with PIL, the file must live under `ComfyUI/input` — the node
refuses paths outside it.

### 3.4 VRAM discipline

- Call `comfy.model_management.unload_all_models()` between stages that do not need each other (the 3x3 worker drops
  the 15 GB text encoder and the VAEs before sampling so the UNet gets the whole card).
- `comfy.model_management.EXTRA_RESERVED_VRAM = 6 * 1024**3` makes ComfyUI offload instead of pinning everything.
- Prompt strings that produce 1024×1024 sheets at 20 GB of weights will OOM a 3090 without one of the above.
- On an uncaught exception, unload models before re-raising so the next job starts clean.

### 3.5 Progress reporting (optional, and a trap)

`runpod.serverless.progress_update()` POSTs to `RUNPOD_WEBHOOK_POST_OUTPUT`, which **does not exist locally** — the SDK
then posts to the literal string `JOB_DONE_URL` and logs `Failed to return job results.` once per update. Guard it:

```python
if not os.environ.get("RUNPOD_WEBHOOK_POST_OUTPUT"):
    return
```

### 3.6 Return

```python
return {"result": url, "outputs": {"image": url}, "status": "DONE"}
```

`result` must be the artifact that matches the cartridge category. If one job can produce several artifacts, return
both in `outputs` and put the primary one in `result`.

---

## 4. Dockerfile

Copy the shape of the `idol` image (ComfyUI from source) or the `corridorkey` image (own runtime). The parts that matter:

```dockerfile
FROM python:3.12-slim-bookworm

# torch first, from the CUDA index: ComfyUI's requirements list an unpinned torch
RUN pip install torch==2.9.1 torchvision==0.24.1 --index-url https://download.pytorch.org/whl/cu128

RUN git clone --depth 1 https://github.com/comfyanonymous/ComfyUI /content/ComfyUI \
    && cd /content/ComfyUI && pip install -r requirements.txt && pip install runpod boto3

# custom nodes: clone, do not vendor
RUN git clone --depth 1 https://github.com/<owner>/<pack> /content/ComfyUI/custom_nodes/<pack>

# weights: huggingface_hub, not curl/aria2 (see the gotcha below)
COPY fetch_models.py /content/fetch_models.py
RUN python /content/fetch_models.py /content/ComfyUI/models

# catch a broken install at build time, not on the first job
RUN python -c "import sys; sys.argv=['check','--cpu']; sys.path.insert(0,'/content/ComfyUI'); \
    import comfy.options; comfy.options.enable_args_parsing(); \
    import comfy_extras.nodes_gaussian_splat; print('ok')"

COPY worker_runpod.py /content/worker_runpod.py
EXPOSE 8004
HEALTHCHECK CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8004/', timeout=4)" || exit 1
CMD ["python", "/content/worker_runpod.py", "--rp_serve_api", "--rp_api_port", "8004", "--rp_api_host", "0.0.0.0"]
```

Rules:

- **Pin torch** and install it *before* `requirements.txt`, or pip resolves a CUDA 13 wheel that needs a newer driver.
- **No GPU during build** — anything that touches CUDA at import needs `--cpu` (see the import check above).
- **Download weights with `huggingface_hub`** (`hf_hub_download(..., local_dir=...)`): it retries and resumes. `aria2`
  failed on the HF CDN, `curl --retry` does not retry SSL connect errors.
- **Never bake secrets.** No credentials, no tokens; env comes from the registry at run time.
- Image size is fine — a 13 GB image is normal here. Pulls are resumable and the app shows progress.

---

## 5. Catalog entry

`OpenCartridge/public/services/<id>.json` — a bare array (v1) or `{schema: "cartridge/2", cartridges: […]}`:

```json
[
  {
    "home": true,
    "id": "my-cartridge",
    "name": "My Cartridge",
    "description": "One line the card shows.",
    "category": "image",
    "icon": "Image",
    "inputTypes": ["image"],
    "workerId": "",
    "cost": "0",
    "processingTime": "60",
    "delay": "12000",
    "overview": "Longer text shown in the details view.",
    "divisible": 32,
    "inputs":  [{ "name": "input_image", "accepts": ["image/*"], "bind": "primary", "required": true }],
    "returns": { "type": "image/png", "ext": "png", "layer": "image" },
    "examples": { "input": ["https://…/in.jpg"], "output": ["https://…/out.png"] },
    "parameters": [
      { "name": "job_id",      "type": "string", "ui": false },
      { "name": "input_image", "type": "file",   "ui": false, "required": true },
      { "name": "prompt",      "type": "string", "ui": true,  "defaultValue": "" },
      { "name": "steps",       "type": "slider", "ui": true,  "defaultValue": 25, "min": 1, "max": 60, "step": 1 },
      { "name": "seed",        "type": "number", "ui": false, "defaultValue": 42 }
    ]
  }
]
```

- `ui: false` + `type: "file"` is how a selected layer is uploaded — that parameter name is what the worker receives.
- `icon`: `Box`, `Image`, `Video`, `Camera`, `AudioWaveform`, `Grid3X3`, `MessageSquare`, `Mic`, `RefreshCw`, `Zap`.
- `examples` must be **public URLs**. Do not commit a 28 MB GLB into the repo to have an example — host it.
- Declare `returns` whenever the extension could be ambiguous.
- Keep the UI small: 3–4 controls. Everything else `ui: false` with a sensible default.

The format is versioned and additive; read `docs/cartridge-schema.md` before inventing a field.

---

## 6. Registry entry

`OpenCartridge/public/service-workers.json`:

Ports are assigned by hand and must not collide: `8000` 3x3-sprite-sheet, `8001` loop-hero-style, `8002`
corridorkey, `8003` idol. **Next free port is 8004.**

```json
{
  "id": "my-worker",
  "name": "My Worker",
  "catalog": "services/my-cartridge.json",
  "apiUrl": "http://host.docker.internal:8004",
  "uploadUrl": "http://localhost:9000",
  "workerUploadUrl": "http://host.docker.internal:9000",
  "container": {
    "name": "my-worker",
    "image": "camenduru/my-worker:latest",
    "port": 8004,
    "hostPort": 8004,
    "gpus": true,
    "command": ["python", "/content/worker_runpod.py", "--rp_serve_api", "--rp_api_port", "8004",
                "--rp_api_host", "0.0.0.0", "--rp_log_level", "INFO"],
    "env": {
      "s3_access_key_id": "${s3_access_key_id}",
      "s3_secret_access_key": "${s3_secret_access_key}",
      "s3_endpoint_url": "http://host.docker.internal:9000",
      "s3_region_name": "us-east-1",
      "s3_bucket_name": "tost",
      "s3_bucket_folder": "output"
    }
  }
}
```

- `id` is the join key: `/api/ai-services` stamps it on every cartridge as `workerId`.
- `port` = inside the container, `hostPort` = published. They may differ (loop-hero-style is 8000 → 8001).
- `ulimits` mirrors `docker run --ulimit name=value` (soft and hard both set), e.g. `{"memlock": 67108864}`.
- `extraHosts` mirrors `docker run --add-host`. The app adds `host.docker.internal:host-gateway` to every worker it
  creates on its own, so `s3_endpoint_url=http://host.docker.internal:9000` resolves inside the worker on Linux too;
  the field only exists to add more names.
- `${NAME}` is expanded from OpenCartridge's own environment; everything else is literal.
- Without `container` the cartridge still lists, but cannot be installed/started/deleted from the UI.
- The browser never supplies any of this — `lib/docker.mjs` only acts on the registry spec.

---

## 7. Verify, in this order

```bash
# 1. image builds, and the container comes up healthy
cd <worker source> && docker build -t camenduru/my-worker .
docker run -d --name my-worker --gpus all -p 8004:8004 -e s3_access_key_id=tost … camenduru/my-worker
docker ps --filter name=my-worker        # (healthy)

# 2. the handler answers (from the HOST: 127.0.0.1. host.docker.internal only
#    means something inside a container)
curl -s localhost:8004/run -H 'Content-Type: application/json' \
  -d '{"input":{"input_image":"http://localhost:9000/tost/in.jpg"}}'
curl -s -X POST localhost:8004/status/<id>     # COMPLETED + output.result

# 3. the artifact is real, not just a URL
curl -sI <output.result>                        # 200 + the right Content-Type

# 4. through the app, exactly as the browser does it
curl -s localhost:3000/api/ai-services          # the cartridge is listed, with workerId
curl -s localhost:3000/api/workers              # state=running, reachable=true
# POST /api/run {serviceId, localApiUrl, payload:{input:{…}}} -> /api/status/<id> -> /api/image-proxy?url=…

# 5. UI
#    - card shows the right state dot and Download & run / Start
#    - Examples tab renders input and output
#    - a job produces a layer of the right kind (image / video / 3d / audio)
```

Then run the suite:

```bash
cd OpenCartridge && npm test        # frozen catalogs + shipped catalogs must parse
```

When a new catalog ships, **add** a frozen copy under `tests/fixtures/cartridges/v1/`. Never edit an existing fixture.

---

## 8. Gotchas already paid for

| Symptom | Cause |
|---|---|
| `Model in folder 'x' with filename 'x/y' not found` | ComfyUI loaders take a name **relative to** their folder: `"birefnet.safetensors"`, not `"background_removal/birefnet.safetensors"` |
| `Failed to return job results. \| JOB_DONE_URL&isStream=false` | `progress_update()` without `RUNPOD_WEBHOOK_POST_OUTPUT` — harmless but noisy; guard it |
| Build fails importing ComfyUI: *Found no NVIDIA driver* | `comfy.model_management` probes CUDA at import — pass `--cpu` in the build check |
| `curl: (35) SSL_ERROR_SYSCALL` on the HF CDN | use `huggingface_hub`, not curl/aria2 |
| Browser refuses a downloaded `.mp4` that is really WebM | the worker returned VP9 for a parameter whose declared ext is mp4 — declare `returns` and trust the MIME type |
| A `.webp` example renders as a URL string | the examples viewer whitelists extensions — it now accepts webp/gif/avif like the rest |
| New file in `public/` 404s until restart | Next resolves `public/` at server start |
| Job completes, no layer appears | result extension unknown to the UI and no `returns.layer` declared |
| Cartridge dot sits on amber **Starting…** forever | app container cannot resolve `host.docker.internal` (Linux `docker run` without `--add-host=host.docker.internal:host-gateway`); the container is up and healthy, the app just cannot see it — `lib/worker-url.mjs` falls back to the bridge gateway, the README carries the flag |
| 3×3 sheet lanes drift between frames | the sheet prompt and video prompt must describe the *same* grid; keep the walk prompt's per-cell lines intact |

---

## 9. Checklist

- [ ] workflow JSON kept with the worker source, under `workflows/`
- [ ] `worker_runpod.py` drives node classes in process, raises on failure, returns `output.result`
- [ ] input downloaded with a browser UA; weights loaded once and cached between jobs
- [ ] VRAM unloaded between stages; OOM fails the job, not the worker
- [ ] Dockerfile pins torch, installs runpod, checks imports with `--cpu`, exposes one port
- [ ] catalogue entry: minimal UI params, `inputs`, `returns`, public example URLs
- [ ] registry entry: correct port/hostPort, `${ENV}` s3 block, `container` spec
- [ ] port not already taken (next free: 8004)
- [ ] built, ran, `/run` → `/status` → artifact fetched
- [ ] through the app: `/api/ai-services`, `/api/workers`, `/api/run`, layer appears
- [ ] `npm test` green; fixture added if a catalog was added
- [ ] registry entry and port map updated (id → image → port → cartridges)

---

## Appendix A — `Dockerfile` (the `3x3-sprite-sheet` image, verbatim)

The source of truth is the file itself; this is the copy an agent can read without the worker sources:

```dockerfile
FROM ubuntu:22.04

WORKDIR /content

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=True
ENV PYTHONDONTWRITEBYTECODE=True
ENV PATH="/home/camenduru/.local/bin:/usr/local/cuda/bin:${PATH}"

RUN apt update -y && apt install -y software-properties-common build-essential \
    libegl1 libgl1 libglib2.0-0 zlib1g-dev libncurses5-dev libgdbm-dev libnss3-dev libssl-dev libreadline-dev libffi-dev cmake && \
    add-apt-repository -y ppa:git-core/ppa && apt update -y && \
    apt install -y python-is-python3 python3-pip sudo nano aria2 curl wget git git-lfs unzip unrar ffmpeg xvfb && \
    aria2c --console-log-level=error -c -x 16 -s 16 -k 1M https://developer.download.nvidia.com/compute/cuda/12.9.1/local_installers/cuda_12.9.1_575.57.08_linux.run -d /content -o cuda_12.9.1_575.57.08_linux.run && sh cuda_12.9.1_575.57.08_linux.run --silent --toolkit && \
    echo "/usr/local/cuda/lib64" >> /etc/ld.so.conf && ldconfig && \
    adduser --disabled-password --gecos '' camenduru && \
    adduser camenduru sudo && \
    echo '%sudo ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers && \
    chown -R camenduru:camenduru /content && \
    chmod -R 777 /content && \
    chown -R camenduru:camenduru /home && \
    chmod -R 777 /home && \
    rm -f /content/cuda_12.9.1_575.57.08_linux.run

USER camenduru

# 3x3_sprite_sheet.json uses only core + new-API nodes (Qwen Image 2.1 edit,
# MiniMax H3 image-to-video), so no custom node packs are needed.
# Torch trio is pinned: unpinned, pip now resolves torch from PyPI (CUDA 13 wheels,
# which need a 580+ driver) while torchaudio resolves from cu129 -> mismatched stack.
# cu129 keeps CUDA 12 minor-version compatibility; xformers 0.0.33.post2 pins torch 2.9.1.
RUN pip install --no-cache-dir torch==2.9.1+cu129 torchvision==0.24.1+cu129 torchaudio==2.9.1+cu129 --extra-index-url https://download.pytorch.org/whl/cu129 && \
    pip install --no-cache-dir xformers==0.0.33.post2 --extra-index-url https://download.pytorch.org/whl/cu129 && \
    git clone --depth 1 --branch master https://github.com/comfyanonymous/ComfyUI /content/ComfyUI && cd /content/ComfyUI && pip install -r requirements.txt && \
    pip install --no-cache-dir pillow numpy opencv-python imageio imageio-ffmpeg ffmpeg-python moviepy timm scikit-image matplotlib diffusers accelerate peft einops color-matcher runpod boto3 requests && \
    aria2c --console-log-level=error -c -x 16 -s 16 -k 1M https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/diffusion_models/qwen_image_2.1_int8_convrot.safetensors -d /content/ComfyUI/models/diffusion_models -o qwen_image_2.1_int8_convrot.safetensors && \
    aria2c --console-log-level=error -c -x 16 -s 16 -k 1M https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors -d /content/ComfyUI/models/diffusion_models -o minimax_h3_fl2va_pruned_int8_convrot.safetensors && \
    aria2c --console-log-level=error -c -x 16 -s 16 -k 1M https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/text_encoders/qwen3vl_8b_int8_convrot.safetensors -d /content/ComfyUI/models/text_encoders -o qwen3vl_8b_int8_convrot.safetensors && \
    aria2c --console-log-level=error -c -x 16 -s 16 -k 1M https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors -d /content/ComfyUI/models/text_encoders -o qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors && \
    aria2c --console-log-level=error -c -x 16 -s 16 -k 1M https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/vae/qwen_image_2.1_vae_bf16.safetensors -d /content/ComfyUI/models/vae -o qwen_image_2.1_vae_bf16.safetensors && \
    aria2c --console-log-level=error -c -x 16 -s 16 -k 1M https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_video_vae_fp16.safetensors -d /content/ComfyUI/models/vae -o minimax_h3_video_vae_fp16.safetensors && \
    aria2c --console-log-level=error -c -x 16 -s 16 -k 1M https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_audio_vae_fp32.safetensors -d /content/ComfyUI/models/vae -o minimax_h3_audio_vae_fp32.safetensors && \
    aria2c --console-log-level=error -c -x 16 -s 16 -k 1M https://huggingface.co/Kijai/MiniMax-H3_comfy/resolve/main/loras/minimax_h3_taomate_3step_lora_avg_rank_19_bf16.safetensors -d /content/ComfyUI/models/loras -o minimax_h3_taomate_3step_lora_avg_rank_19_bf16.safetensors

COPY ./worker_runpod.py /content/ComfyUI/worker_runpod.py
WORKDIR /content/ComfyUI
CMD python worker_runpod.py
```

Notes that are easy to miss in it:

- `ubuntu:22.04` + the CUDA 12.9 toolkit installer, then torch pinned to `2.9.1+cu129`;
- ComfyUI cloned into `/content/ComfyUI`, models downloaded into `models/` at build time;
- `COPY ./worker_runpod.py` and a bare `CMD python worker_runpod.py` — the serve flags and port come from the
  registry `command`, so they are not duplicated here.

---

## Appendix B — `worker_runpod.py` (the `3x3-sprite-sheet` handler, verbatim)

A complete ComfyUI worker: two stages, prompt constants, staging, VRAM logging, S3 upload and the RunPod
entrypoint. Everything a new ComfyUI cartridge needs is in this file:

```python
"""
worker_runpod.py – 3x3 sprite sheet RunPod serverless worker
============================================================
Headless port of ComfyUI/user/default/workflows/3x3_sprite_sheet.json
(the two subgraphs are expanded and driven with plain node calls):

  Stage 1 (Sheet)  Qwen Image 2.1 edit  -> 3x3 turnaround sprite sheet (PNG)
  Stage 2 (Walk)   MiniMax H3 fl2va I2V -> same sheet walking, looped (MP4 + audio)

Stage 1 is optional. With generate_sheet=false the worker skips Qwen entirely and
treats input_image as an existing 3x3 sheet, so the two TostUI services split cleanly:

  "3x3 Sprite Sheet"            generate_sheet=true,  enable_video=false -> PNG only
  "3x3 Sprite Sheet Animation"  generate_sheet=false, enable_video=true  -> MP4 only
  (both true = full pipeline, one job; both false = error)

Expected input:
{
  "input": {
    "job_id": "abc123",
    "input_image": "https://.../character.png",  # character reference (image_1)
    "seed": 0,                                   # 0 = randomize
    "generate_sheet": true,                      # false = input_image IS the 3x3 sheet
    "enable_video": true,                        # false = sheet only, stage 2 skipped
    "prompt_sheet": "...",                       # defaults to the 3x3 turnaround prompt
    "prompt_video": "...",                       # defaults to the 8-way walk prompt
    "sheet_key_width": 2048,                     # sheet PNG size
    "sheet_key_height": 2048,
    "video_key_width": 1024,                     # walk MP4 size (independent of the sheet)
    "video_key_height": 1024,
    "duration": 5.0, "fps": 24,
    ...sampler / model overrides, see defaults below...
  }
}
Returns {"job_id": ..., "result": "<url>", "sheet": "<png url>",
         "video": "<mp4 url> | null", "status": "DONE"}.

"result" is the artifact the caller asked for, and is what TostUI renders as the layer
of a job (it reads output.result only, and types that layer by the service category):
  enable_video=false -> the sheet PNG  (TostUI service "3x3-sprite-sheet",           image)
  enable_video=true  -> the walk MP4   (TostUI service "3x3-sprite-sheet-animation", video)
Both URLs are reported separately in "sheet" and "video" (either may be null).

On failure this handler raises: runpod then reports the job as FAILED with an "error"
string, which is the only failure shape TostUI understands (returning a dict with
status FAILED would surface as a COMPLETED job).

sheet_key_width/height size the PNG, video_key_width/height size the MP4. Both must be
multiples of 32; the video defaults smaller (1024) because the H3 stage is the
expensive one.
"""

import os, shutil, requests, random, time, uuid, boto3, runpod
from pathlib import Path
from urllib.parse import urlsplit
from datetime import datetime

import torch
from PIL import Image
import folder_paths

# --- prompts exactly as saved in 3x3_sprite_sheet.json (subgraph 787 / 790) ---
SHEET_PROMPT = """Static sheet and walk video, both rewritten as one square image: a 3×3 grid of equal boxes, center box empty, each figure isolated in its own cell.
Turnaround
One polished square game-asset sheet. A clearly organized 3×3 grid of nine equal boxes, thin even gutters, center box empty. Transparent background. No floor, no tiles, no shadows, no labels, no text.
Each outer box holds one identical copy of the subject, same scale, same line weight, centered in the cell, feet above the bottom edge, no overlap into the gutter. Camera is a fixed top-down isometric angle, about 35 degrees above the horizon, the same camera in every box. Bodies upright. Flat even lighting.

Top-left box: back-left three-quarter, 135 degrees. Mostly back and left shoulder, crown visible, a sliver of cheek, face almost hidden.
Top-center box: pure back, 180 degrees. Full rear of the head and torso, no face, shoulders square away.
Top-right box: back-right three-quarter, 225 degrees. Mirror of the top-left.
Middle-left box: isometric left side, 90 degrees. Only the left side shown, one eye, nose and mouth in silhouette. Raised-camera side view, not a flat profile.
Center box: empty. Transparent, no figure, no mark.
Middle-right box: isometric right side, 270 degrees. Mirror of the middle-left.
Bottom-left box: front-left three-quarter, 45 degrees. Left side more open, face still readable, gaze along the facing.
Bottom-center box: pure front, 0 degrees. Face fully toward the camera, both shoulders equal, chest square, crown slightly visible.
Bottom-right box: front-right three-quarter, 315 degrees. Mirror of the bottom-left.

All eight share one design, one palette, one outline weight. Feet point along each facing. No ground plane, no contact shadows, no arrows, no captions."""
VIDEO_PROMPT = """Image-to-video of that same 3×3 sheet. Keep the same character in every filled box: same design, same scale, same palette, same outlines. Do not redesign them. Do not move them into another box. Center box stays empty.

Camera locked, top-down isometric, about 35 degrees, no zoom, no pan, no cut. Transparent background. No floor, no tiles, no ground shadows. Grid boxes and gutters stay fixed.

Animate all eight at once. Each walks in place inside their own box, along their own facing, then loops. One steady cycle: contact, passing, contact. Two clear steps, feet plant and push, no sliding, no dash. Arms swing opposite the legs. They stay inside their box the whole time. Loop matches at start and end.

Top-left: walks toward the upper left, loose parts trail down-right.
Top-center: walks away from the camera, full back view, no face.
Top-right: walks toward the upper right, loose parts trail down-left.
Middle-left: walks screen-left, loose parts trail to the right.
Center: empty for the whole clip.
Middle-right: walks screen-right, loose parts trail to the left.
Bottom-left: walks toward the lower left, face readable, loose parts trail up-right.
Bottom-center: walks toward the camera, face readable.
Bottom-right: walks toward the lower right, face readable, loose parts trail up-left.

Even flat light, no motion blur, no extra limbs. Each direction keeps its own forward for the whole loop."""


def download_file(url, save_dir, file_name, overwrite=True):
    os.makedirs(save_dir, exist_ok=True)
    file_suffix = os.path.splitext(urlsplit(url).path)[1]
    file_name_with_suffix = file_name + file_suffix
    file_path = os.path.join(save_dir, file_name_with_suffix)
    if os.path.exists(file_path) and not overwrite:
        return file_path
    response = requests.get(url)
    response.raise_for_status()
    with open(file_path, 'wb') as file:
        file.write(response.content)
    return file_path


def stage_image(src, save_dir, file_name):
    """Stage an image under the ComfyUI input dir (LoadImage rejects paths outside it).

    URL -> download; local path -> copy in, unless it already lives there.
    Returns (path, is_temporary) so the caller knows what to clean up.
    """
    os.makedirs(save_dir, exist_ok=True)
    if isinstance(src, str) and src.startswith(('http://', 'https://')):
        return download_file(url=src, save_dir=save_dir, file_name=file_name), True
    if isinstance(src, str) and os.path.exists(src):
        src_path = os.path.abspath(src)
        if os.path.dirname(src_path) == os.path.abspath(save_dir):
            return src_path, False
        dst = os.path.join(save_dir, file_name + os.path.splitext(src_path)[1])
        shutil.copyfile(src_path, dst)
        return dst, True
    raise ValueError(f"input image is neither a reachable URL nor a local path: {src}")


def _opt_flag(v, default=True):
    if v is None:
        return default
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    if isinstance(v, str):
        return v.strip().lower() in ("1", "true", "yes", "y", "on")
    return bool(v)


def save_png(image, path):
    """Decoded IMAGE tensor -> 8-bit sRGB PNG (matches SaveImageAdvanced settings)."""
    arr = image[0].detach().float().cpu().clamp(0, 1)
    arr = (arr * 255.0).round().to(torch.uint8).numpy()
    Image.fromarray(arr, mode="RGBA" if arr.shape[-1] == 4 else "RGB").save(path, format="PNG")
    return path


import comfy
import comfy.model_management as comfy_mm
from nodes import NODE_CLASS_MAPPINGS
import nodes as nodes_module


def _log_vram(tag):
    """Print device/VRAM state so a slow or OOM run can be diagnosed from the log."""
    try:
        free = comfy.model_management.get_free_memory() / 2**30
        total = comfy.model_management.get_total_memory() / 2**30
        print(f"[vram] {tag}: {free:.1f} GiB free of {total:.1f} GiB", flush=True)
    except Exception as err:
        print(f"[vram] {tag}: unavailable ({err})", flush=True)

from comfy_execution.utils import get_executing_context
if get_executing_context() is None:
    from types import SimpleNamespace
    import comfy_execution.utils
    comfy_execution.utils.get_executing_context = lambda: SimpleNamespace(node_id="notebook_manual_run")

import asyncio
from server import PromptServer

# Headless stub: core nodes don't register routes, but keep parity with
# TostUpscale3 worker so future custom nodes don't break headless import.
class _NoopRoutes:
    def _decorator(self, *args, **kwargs):
        def wrap(fn):
            return fn
        return wrap
    def __getattr__(self, name):
        return self._decorator

class _DummyPromptServer:
    routes = _NoopRoutes()
    def send_sync(self, *args, **kwargs):
        pass
    def add_on_prompt_handler(self, *args, **kwargs):
        pass
    def __getattr__(self, name):
        return lambda *args, **kwargs: None

if getattr(PromptServer, 'instance', None) is None:
    PromptServer.instance = _DummyPromptServer()

# Core new-API nodes (TextEncodeQwenImage21, MiniMaxH3ImageToVideo,
# ResolutionSelector, CreateVideo, ...) live in comfy_extras/ and only
# register here. This workflow needs no custom node packs.
asyncio.run(nodes_module.init_builtin_extra_nodes())

# --- old-API (instantiated) ---
UNETLoader = NODE_CLASS_MAPPINGS["UNETLoader"]()
CLIPLoader = NODE_CLASS_MAPPINGS["CLIPLoader"]()
VAELoader = NODE_CLASS_MAPPINGS["VAELoader"]()
LoraLoaderModelOnly = NODE_CLASS_MAPPINGS["LoraLoaderModelOnly"]()
KSampler = NODE_CLASS_MAPPINGS["KSampler"]()
VAEDecode = NODE_CLASS_MAPPINGS["VAEDecode"]()
EmptyLatentImage = NODE_CLASS_MAPPINGS["EmptyLatentImage"]()
LoadImage = NODE_CLASS_MAPPINGS["LoadImage"]()

# --- new-API (classmethod .execute) ---
TextEncodeQwenImage21 = NODE_CLASS_MAPPINGS["TextEncodeQwenImage21"]
QwenImage21Cache = NODE_CLASS_MAPPINGS["QwenImage21Cache"]
MiniMaxH3ImageToVideo = NODE_CLASS_MAPPINGS["MiniMaxH3ImageToVideo"]
BasicScheduler = NODE_CLASS_MAPPINGS["BasicScheduler"]
BasicGuider = NODE_CLASS_MAPPINGS["BasicGuider"]
KSamplerSelect = NODE_CLASS_MAPPINGS["KSamplerSelect"]
RandomNoise = NODE_CLASS_MAPPINGS["RandomNoise"]
SamplerCustomAdvanced = NODE_CLASS_MAPPINGS["SamplerCustomAdvanced"]
VAEDecodeAudio = NODE_CLASS_MAPPINGS["VAEDecodeAudio"]
CreateVideo = NODE_CLASS_MAPPINGS["CreateVideo"]

from comfy_extras.nodes_logic import SwitchNode as ComfySwitchNode
from comfy_extras.nodes_math import MathExpressionNode as ComfyMathExpression


def _probe_pinned_memory():
    """Turn off ComfyUI host-memory pinning when the container forbids page locking.

    The video stage reserves VRAM, so part of the UNet is offloaded to host RAM and
    ComfyUI pins those buffers with cudaHostRegister for faster transfers. Containers
    usually cap RLIMIT_MEMLOCK (64 MB is the common default), so every multi-GB pin
    fails and ComfyUI logs "Pin error." once per weight while the transfer falls back
    to pageable memory anyway. Check the limit up front and disable pinning outright
    instead of flooding the log; a small probe covers the cases where the limit looks
    generous but locking is still refused.
    """
    try:
        import resource
        soft, _ = resource.getrlimit(resource.RLIMIT_MEMLOCK)
    except Exception:
        soft = None
    if soft is not None and soft != resource.RLIM_INFINITY and soft < 2 * 1024 ** 3:
        comfy_mm.MAX_PINNED_MEMORY = 0
        limit = f"{soft / 2**20:.0f} MB" if soft >= 2**20 else f"{soft / 1024:.0f} KB"
        print(f"[vram] memlock limit is {limit}, too small to pin offloaded weights; "
              f"running unpinned", flush=True)
        return False
    try:
        probe = torch.empty(64 * 1024 * 1024, dtype=torch.uint8)
        if torch.cuda.cudart().cudaHostRegister(probe.data_ptr(), probe.numel(), 1) == 0:
            torch.cuda.cudart().cudaHostUnregister(probe.data_ptr())
            return True
    except Exception as err:
        print(f"[vram] pinning probe failed ({err})", flush=True)
    comfy_mm.MAX_PINNED_MEMORY = 0
    print("[vram] host memory pinning denied; offload runs unpinned", flush=True)
    return False


_probe_pinned_memory()

with torch.inference_mode():
    # Qwen Image 2.1 Edit (stage 1)
    unet_qwen = UNETLoader.load_unet("qwen_image_2.1_int8_convrot.safetensors", "default")[0]
    clip_qwen = CLIPLoader.load_clip("qwen3vl_8b_int8_convrot.safetensors", type="qwen_image")[0]
    vae_qwen = VAELoader.load_vae("qwen_image_2.1_vae_bf16.safetensors")[0]
    # MiniMax H3 fl2va image-to-video (stage 2)
    unet_h3 = UNETLoader.load_unet("minimax_h3_fl2va_pruned_int8_convrot.safetensors", "default")[0]
    clip_h3 = CLIPLoader.load_clip("qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", type="minimax")[0]
    vae_h3_video = VAELoader.load_vae("minimax_h3_video_vae_fp16.safetensors")[0]
    vae_h3_audio = VAELoader.load_vae("minimax_h3_audio_vae_fp32.safetensors")[0]


@torch.inference_mode()
def generate(input):
    tmp_dir = "/content/ComfyUI/output"
    staged = []
    try:
        os.makedirs(tmp_dir, exist_ok=True)
        unique_id = uuid.uuid4().hex[:6]
        current_time = datetime.now().strftime("%Y-%m-%d-%H-%M-%S")
        s3_access_key_id = os.getenv('s3_access_key_id')
        s3_secret_access_key = os.getenv('s3_secret_access_key')
        s3_endpoint_url = os.getenv('s3_endpoint_url')
        s3_region_name = os.getenv('s3_region_name')
        s3_bucket_name = os.getenv('s3_bucket_name')
        s3_bucket_folder = os.getenv('s3_bucket_folder')
        s3 = boto3.client('s3', aws_access_key_id=s3_access_key_id, aws_secret_access_key=s3_secret_access_key,
                          endpoint_url=s3_endpoint_url, region_name=s3_region_name)

        # TostUI always sends {"input": {...}} with a job_id; tolerate a bare payload.
        values = input.get("input", input) if isinstance(input, dict) else {}
        job_id = values.get('job_id') or uuid.uuid4().hex

        # --- reference image(s) -> TextEncodeQwenImage21 images.image_1..N ---
        srcs = values.get('input_images') or values.get('input_image')
        if isinstance(srcs, str):
            srcs = [srcs]
        if not srcs:
            raise ValueError("provide 'input_image' (single URL) or 'input_images' (list of URLs)")
        images = {}
        for i, src in enumerate(srcs[:16]):
            p, is_temp = stage_image(src, save_dir=folder_paths.get_input_directory(),
                                     file_name=f'input_image_{unique_id}_{i}')
            if is_temp:
                staged.append(p)
            images[f"image_{i + 1}"] = LoadImage.load_image(p)[0]

        # ============ workflow defaults (from 3x3_sprite_sheet.json) ============
        # --- stage 1: Qwen Image 2.1 edit -> 3x3 sheet (subgraph 787) ---
        prompt_sheet = values.get('prompt_sheet', SHEET_PROMPT)
        negative_sheet = values.get('negative_sheet', "")
        sheet_key_width = int(values.get('sheet_key_width', 2048))
        sheet_key_height = int(values.get('sheet_key_height', 2048))
        sheet_steps = values.get('sheet_steps', 25)
        sheet_cfg = values.get('sheet_cfg', 1.0)
        sheet_sampler = values.get('sheet_sampler', 'euler')          # subgraph input 'scheduler'
        sheet_scheduler = values.get('sheet_scheduler', 'simple')     # subgraph input 'scheduler_1'
        sheet_resolution = values.get('sheet_resolution', 0)          # 0 = keep reference size
        use_empty_latent = _opt_flag(values.get('use_empty_latent', True), True)  # ComfySwitchNode 468
        cache_device = values.get('cache_device', 'auto')             # QwenImage21Cache
        cache_dtype = values.get('cache_dtype', 'default')
        # --- stage 1 toggle: false = the input image already IS the 3x3 sheet ---
        generate_sheet = _opt_flag(values.get('generate_sheet', True), True)
        # --- stage 2: MiniMax H3 image-to-video (subgraph 790) ---
        enable_video = _opt_flag(values.get('enable_video', True), True)  # false = sheet only
        prompt_video = values.get('prompt_video', VIDEO_PROMPT)
        video_key_width = int(values.get('video_key_width', 1024))
        video_key_height = int(values.get('video_key_height', 1024))
        duration = values.get('duration', 5.0)                        # seconds -> 17k+5 frame grid
        video_length = values.get('video_length')                     # optional explicit frame count
        fps = values.get('fps', 24)
        bit_depth = values.get('bit_depth', 8)
        video_sampler = values.get('video_sampler', 'res_multistep')
        turbo_mode = _opt_flag(values.get('turbo_mode', True), True)  # ComfySwitchNode 574/575
        turbo_lora = values.get('turbo_lora', 'minimax_h3_taomate_3step_lora_avg_rank_19_bf16.safetensors')
        turbo_strength = values.get('turbo_strength', 1.0)
        turbo_steps = values.get('turbo_steps', 3)                    # PrimitiveInt 577 (on_true)
        full_steps = values.get('full_steps', 20)                     # PrimitiveInt 576 (on_false)
        seed = values.get('seed', 0)

        if not seed:
            random.seed(int(time.time()))
            seed = random.randint(0, 18446744073709551615)
        seed = int(seed)

        # ============ 1. 3x3 turnaround sheet (Qwen Image 2.1 edit) ============
        sheet_path = None
        if generate_sheet:
            model_sheet = QwenImage21Cache.execute(unet_qwen, cache_device, cache_dtype)[0]
            positive_sheet, negative_sheet_cond, latent_from_ref = TextEncodeQwenImage21.execute(
                clip_qwen, prompt_sheet, negative_sheet, vae_qwen, sheet_resolution, images=images)
            # ComfySwitchNode 468: true -> EmptyLatent at width/height, false -> latent from the reference
            latent_sheet = EmptyLatentImage.generate(width=sheet_key_width, height=sheet_key_height, batch_size=1)[0] \
                if use_empty_latent else latent_from_ref
            latent_sheet = KSampler.sample(model_sheet, seed, int(sheet_steps), float(sheet_cfg),
                                           sheet_sampler, sheet_scheduler,
                                           positive_sheet, negative_sheet_cond, latent_sheet, denoise=1.0)[0]
            comfy.model_management.unload_all_models()
            image_sheet = VAEDecode.decode(vae_qwen, latent_sheet)[0].detach()
            sheet_path = save_png(image_sheet, f"{tmp_dir}/3x3_sprite_sheet-{current_time}-{seed}-{unique_id}.png")
            comfy.model_management.unload_all_models()
        else:
            # The caller supplies an existing 3x3 sheet: animate it directly, no Qwen pass.
            image_sheet = next(iter(images.values()))
            comfy.model_management.unload_all_models()  # drop the unused Qwen stack

        # ============ 2. walk cycle over the sheet (MiniMax H3 fl2va) ============
        video_path = None
        if enable_video:
            # The H3 UNet is ~20 GB of the 23.5 GB a 3090 offers, so a full load leaves no
            # room for activations at 1024x122 and the sampler OOMs inside int8_linear.
            # Reserving headroom makes ComfyUI offload part of the weights instead; a few
            # extra streamed layers are cheap next to a failed job.
            comfy.model_management.EXTRA_RESERVED_VRAM = int(float(values.get('reserve_vram', 6)) * 1024 ** 3)
            # duration -> length grid: max(5, round(a*24)) snapped up to 17k+5 frames
            if video_length is None:
                length = ComfyMathExpression.execute(
                    "max(5, round(a * 24)) + (5 - (max(5, round(a * 24)) % 17)) % 17",
                    values={"a": float(duration)})[1]
                length = int(length)
            else:
                length = int(video_length)
            steps_video = int(turbo_steps) if bool(turbo_mode) else int(full_steps)
            # ComfySwitchNode 574: turbo -> LoRA-patched model, otherwise the bare UNET
            model_video = LoraLoaderModelOnly.load_lora_model_only(
                unet_h3, turbo_lora, strength_model=float(turbo_strength))[0] if bool(turbo_mode) else unet_h3
            positive_video, latent_video = MiniMaxH3ImageToVideo.execute(
                clip_h3, vae_h3_video, prompt_video, video_key_width, video_key_height, length,
                first_frame=image_sheet, last_frame=None)
            # Conditioning is baked by now: drop the 15 GB text encoder and the VAEs so the
            # 15 GB UNet is the only thing on the card. Leaving them resident makes ComfyUI
            # stream UNet weights instead of loading them, which on a 24 GB card shows up as
            # an endless "Pin error." storm and a run that never seems to progress.
            comfy.model_management.unload_all_models()
            comfy.model_management.soft_empty_cache()
            _log_vram("after conditioning")
            guider_video = BasicGuider.execute(model_video, positive_video)[0]
            sampler_video = KSamplerSelect.execute(video_sampler)[0]
            noise_video = RandomNoise.execute(seed)[0]
            sigmas_video = BasicScheduler.execute(model_video, "simple", steps_video, 1.0)[0]
            latent_video = SamplerCustomAdvanced.execute(noise_video, guider_video, sampler_video,
                                                         sigmas_video, latent_video)[0]
            comfy.model_management.unload_all_models()
            frames_video = VAEDecode.decode(vae_h3_video, latent_video)[0].detach()
            audio_video = VAEDecodeAudio.execute(vae_h3_audio, latent_video)[0]
            comfy.model_management.unload_all_models()
            video = CreateVideo.execute(frames_video, float(fps), audio_video, int(bit_depth), "sRGB", "none")[0]
            video_path = f"{tmp_dir}/3x3_sprite_sheet_walk-{current_time}-{seed}-{unique_id}.mp4"
            video.save_to(video_path)
            comfy.model_management.unload_all_models()

        # ============ 3. upload the artifact(s) ============
        sheet_url = None
        if sheet_path:
            sheet_key = f"{s3_bucket_folder}/3x3_sprite_sheet-{current_time}-{seed}-{unique_id}.png"
            s3.upload_file(sheet_path, s3_bucket_name, sheet_key, ExtraArgs={'ContentType': 'image/png'})
            sheet_url = f"{s3_endpoint_url}/{s3_bucket_name}/{sheet_key}"
        video_url = None
        if video_path:
            video_key = f"{s3_bucket_folder}/3x3_sprite_sheet_walk-{current_time}-{seed}-{unique_id}.mp4"
            s3.upload_file(video_path, s3_bucket_name, video_key, ExtraArgs={'ContentType': 'video/mp4'})
            video_url = f"{s3_endpoint_url}/{s3_bucket_name}/{video_key}"
        if not (sheet_url or video_url):
            raise ValueError("nothing to return: set generate_sheet and/or enable_video")
        # TostUI reads output.result and types the layer by the service category, so
        # hand back the artifact that matches: the walk MP4 when it exists, else the PNG.
        return {"job_id": job_id,
                "result": video_url or sheet_url,
                "sheet": sheet_url,
                "video": video_url,
                "status": "DONE"}
    except Exception as e:
        import traceback
        traceback.print_exc()
        # Raise so runpod marks the job FAILED with an "error" string, the only failure
        # shape TostUI reacts to (a returned FAILED dict would look COMPLETED to it).
        raise RuntimeError(str(e)) from e
    finally:
        for p in staged:
            if os.path.exists(p):
                os.remove(p)
        directory_path = Path(tmp_dir)
        if directory_path.exists():
            shutil.rmtree(directory_path)
            print(f"Directory {directory_path} has been removed successfully.")
        else:
            print(f"Directory {directory_path} does not exist.")


if __name__ == "__main__":
    runpod.serverless.start({"handler": generate})
```

---

## Appendix C — `workflows/3x3-sprite-sheet.json` node map

The workflow is ~100 KB of links, and the real graph lives in two **subgraphs**; the top level only holds the
subgraph instances and the save/preview nodes. This is the map to read while writing the worker — every node,
with its first widget values. A node here is a class call in `worker_runpod.py`.

**Top level**

| id | class | title | widgets |
|---|---|---|---|
| 787 | `1044a913-a21e-4db2-9bf0-8d3ddd2ee661` |  | 0, Static sheet and walk video, both rewritten as one square … |
| 788 | `SaveImageAdvanced` |  | Qwen_image_2.1, png, 8-bit, … |
| 789 | `SaveVideo` |  | video/MiniMax_H3, auto, auto, … |
| 790 | `76239da1-5fb7-43fb-a7d9-5b26e5d0554c` |  | Image-to-video of that same 3×3 sheet. Keep the same characte… |
| 791 | `ResolutionSelector` |  | 1:1 (Square), 1, 32 |
| 799 | `SeedNode` |  | 565824149517284, randomize |
| 803 | `LoadImage` |  | NO8DABPreview_B_temp_lmuug_00001_.png, image |

**Subgraph `1044a913` — Image Edit (Qwen Image 2.1) (9 nodes)**

| id | class | title | widgets |
|---|---|---|---|
| 451 | `UNETLoader` |  | qwen_image_2.1_int8_convrot.safetensors, default |
| 453 | `CLIPLoader` |  | qwen3vl_8b_int8_convrot.safetensors, qwen_image, default |
| 454 | `VAELoader` |  | qwen_image_2.1_vae_bf16.safetensors |
| 456 | `EmptyLatentImage` |  | 1024, 1024, 1 |
| 457 | `VAEDecode` |  |  |
| 458 | `KSampler` |  | 0, randomize, 25, … |
| 468 | `ComfySwitchNode` |  | False |
| 469 | `QwenImage21Cache` |  | auto, default |
| 474 | `TextEncodeQwenImage21` |  | , , 1024 |

**Subgraph `76239da1` — Image to Video (MiniMax H3) (21 nodes)**

| id | class | title | widgets |
|---|---|---|---|
| 559 | `VAELoader` |  | minimax_h3_video_vae_fp16.safetensors |
| 560 | `VAELoader` |  | minimax_h3_audio_vae_fp32.safetensors |
| 561 | `VAEDecodeAudio` |  |  |
| 562 | `VAEDecode` |  |  |
| 563 | `KSamplerSelect` |  | res_multistep |
| 564 | `BasicScheduler` |  | simple, 4, 1 |
| 565 | `SamplerCustomAdvanced` |  |  |
| 566 | `BasicGuider` |  |  |
| 567 | `UNETLoader` |  | minimax_h3_fl2va_pruned_int8_convrot.safetensors, default |
| 13 | `CLIPLoader` |  | qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors, minimax, default |
| 568 | `RandomNoise` |  | 1, fixed |
| 569 | `CreateVideo` |  | 24, 8, sRGB, … |
| 570 | `MiniMaxH3ImageToVideo` |  | Vaporwave title sequence look: pink and blue gradient palette… |
| 571 | `ComfyMathExpression` |  | max(5, round(a * 24)) + (5 - (max(5, round(a * 24)) % 17)) % 17 |
| 572 | `PrimitiveFloat` | Float (duration) | 2 |
| 573 | `LoraLoaderModelOnly` |  | minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors, 1 |
| 574 | `ComfySwitchNode` | If/Else Switch (Model) | False |
| 575 | `ComfySwitchNode` | If/Else Switch (Steps) | False |
| 576 | `PrimitiveInt` |  | 20, fixed |
| 577 | `PrimitiveInt` |  | 6, fixed |
| 578 | `PrimitiveBoolean` | Boolean (Enable Lightning LoRA) | False |

Reading it: `KSampler` is id **458** (the sheet stage) and `SamplerCustomAdvanced` is **565** (the video stage).
`ComfySwitchNode` 468 chooses the stage-1 latent, 574 chooses turbo vs full sampling for stage 2. `CreateVideo`
(569) plus `SaveVideo` (789) produce the MP4 the worker uploads. The worker never writes the PNG through
`SaveImageAdvanced` (788) — it decodes the latent itself and saves it with `save_png()`.
