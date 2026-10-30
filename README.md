# ⚡ OpenCartridge

<img width="1920" height="1080" alt="Screenshot 2026-10-30 082115" src="https://github.com/user-attachments/assets/150de80d-2081-4a09-b4aa-e07d74120ddb" />

<img width="1920" height="1080" alt="Screenshot 2026-10-30 015836" src="https://github.com/user-attachments/assets/c87b4638-f353-4c56-8479-9179b7879e7d" />

<img width="1920" height="1080" alt="Screenshot 2026-10-30 015922" src="https://github.com/user-attachments/assets/b2452992-e913-4edf-acc6-569c92c4394d" />

<img width="1920" height="1080" alt="Screenshot 2026-10-30 020113" src="https://github.com/user-attachments/assets/679aa7cd-4ad4-419c-b62c-16d587f68bfe" />

<img width="1920" height="1080" alt="Screenshot 2026-10-30 065139" src="https://github.com/user-attachments/assets/978b98fe-f490-4be5-901e-aea732dedfb2" />

**OpenCartridge** is a local-first AI game asset suite: a canvas for composing images, sprite sheets, animation, audio and 3D, driven by ComfyUI workers running on your own GPU. Built on [camenduru's TostUI](https://github.com/camenduru/TostUI).

## ✨ What's inside

- 🎨 **Canvas** — layers, transforms, undo/redo, export (PNG, MP4, WebM, GLB)
- 💾 **Cartridges** — worker models packaged as one-click cartridges, installed and run from the UI
- 🧊 **3D** — GLB preview and orbiting viewer
- 🎵 **Audio** — waveform overlay and generation cartridges
- 🗄️ **MinIO inside** — the container ships its own object storage; nothing else to install
- 🏠 **100% local** — no cloud account, no credits

## 🚀 Run

```bash
docker run -d --name opencartridge --restart unless-stopped \
  -p 3000:3000 -p 9000:9000 -p 9001:9001 \
  -v opencartridge-data:/content/data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  camenduru/opencartridge
```

Open **http://localhost:3000**. That is the whole setup — no worker containers to start by hand.

From source instead: `pnpm install && pnpm dev` → http://localhost:3010.

- MinIO API `:9000` (public bucket `tost`), console `:9001` (`tost` / `tosttost`)
- `-v /var/run/docker.sock` lets the UI manage worker containers. It grants Docker API access, i.e. root on the
  host; remove the mount if you would rather do that yourself, and the cartridge list still works.

## 💾 Cartridges

Open **💾 Cartridges**, pick a cartridge and press **Download & run** — the app pulls the worker image, creates its
container, points it at the built-in MinIO and starts it. No `docker run`, no env vars, no ports to wire up.

| State | Dot | What you can do |
|---|---|---|
| running | 🟢 | **Stop**, **Delete** |
| stopped / downloaded | 🟡 | **Start**, **Delete** |
| not installed | 🔴 | **Download & run** (progress shown on the card) |

A cartridge whose worker is not running is hidden from the left panel until you start it. The container spec (image,
ports, command, env) comes from `public/service-workers.json` and is never taken from the browser.

Requires an NVIDIA GPU (~24 GB VRAM is enough for the current workers). The first run of a worker downloads its image
— a few GB — and the first job loads its models.

## 🧩 Adding a cartridge

Add one entry to `public/service-workers.json`:

```json
{
  "id": "my-worker",
  "name": "My Worker",
  "catalog": "services/my-worker.json",
  "apiUrl": "http://host.docker.internal:8010",
  "uploadUrl": "http://localhost:9000",
  "workerUploadUrl": "http://host.docker.internal:9000",
  "container": {
    "name": "my-worker",
    "image": "camenduru/my-worker:latest",
    "port": 8010,
    "gpus": true
  }
}
```

`catalog` points at the cartridge JSON (bundled in `public/services/` or an absolute path). With `container`, the
UI can install and control it; without it, the cartridge is listed but run manually. Format, versioning and the
compatibility promise (old cartridges keep working in new UIs) are in [docs/cartridge-schema.md](./docs/cartridge-schema.md);
`npm test` runs the frozen-catalog suite.

## 🔄 Updating

**Global Configuration → Update Cartridges** pulls the latest source, rebuilds and restarts the server. For a durable
update, rebuild the image with `--build-arg CACHEBUST=$(date +%s)` (see `docker/Dockerfile`).

## 🙏 Credits

- [TostUI](https://github.com/camenduru/TostUI) by [camenduru](https://x.com/camenduru) — application code, cartridge protocol and worker dockers
- [ComfyUI](https://github.com/comfy-org/comfyui) — the backend inside most workers
- [CorridorKey 2.0](https://github.com/camenduru/CorridorKey2.0) — matting by Zachary Harris with Corridor Digital
- [Idol](https://github.com/Nynxz/ComfyUI-Idol) — one image to 3D gaussian splat, by Speridlabs

## 📄 License

MIT — see [LICENSE](./LICENSE) (© camenduru).
