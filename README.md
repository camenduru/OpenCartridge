# ⚡ OpenCartridge

https://github.com/user-attachments/assets/4c323c93-db7b-40b9-a6d3-7b48e577aef1

<img width="1920" height="1080" alt="Screenshot 2026-10-30 082115" src="https://github.com/user-attachments/assets/150de80d-2081-4a09-b4aa-e07d74120ddb" />

<img width="1920" height="1080" alt="Screenshot 2026-10-30 015836" src="https://github.com/user-attachments/assets/c87b4638-f353-4c56-8479-9179b7879e7d" />

<img width="1920" height="1080" alt="Screenshot 2026-10-30 015922" src="https://github.com/user-attachments/assets/b2452992-e913-4edf-acc6-569c92c4394d" />

<img width="1920" height="1080" alt="Screenshot 2026-10-30 020113" src="https://github.com/user-attachments/assets/679aa7cd-4ad4-419c-b62c-16d587f68bfe" />

<img width="1920" height="1080" alt="Screenshot 2026-10-30 065139" src="https://github.com/user-attachments/assets/978b98fe-f490-4be5-901e-aea732dedfb2" />

**OpenCartridge** is a local-first AI game asset suite: a canvas for composing images, sprite sheets, animation, audio and 3D, driven by ComfyUI workers running on your own GPU. Built on [camenduru's TostUI](https://github.com/camenduru/TostUI).

## ✨ What's inside

- 🎨 **Canvas** — layers, transforms, undo/redo, export (PNG, MP4, WebM, GLB)
- 💾 **Cartridges** — worker models packaged as one-click cartridges, installed and run from the UI
- 🐳 **Docker cartridges** — download and run with one click; start, stop and delete the container from the same card
- 🧊 **3D** — GLB preview and orbiting viewer
- 🎵 **Audio** — waveform overlay and generation cartridges
- 🗄️ **MinIO inside** — the container ships its own object storage; nothing else to install
- 🔄 **Self-updating UI** — the Global Configuration panel pulls the latest source, rebuilds and restarts the app from inside itself
- 🏠 **100% local** — no cloud account, no credits

## 🚀 Run

**1. Install Docker** — download [Docker Desktop (Windows AMD64)](https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe) and run it. Wait until the whale icon says Docker is running.

**2. Start OpenCartridge**

```powershell
docker run -d --name opencartridge --restart unless-stopped -p 3000:3000 -p 9000:9000 -p 9001:9001 -v opencartridge-data:/content/data -v /var/run/docker.sock:/var/run/docker.sock camenduru/opencartridge
```

Open **http://localhost:3000**. That is the whole setup — no worker containers to start by hand.

`-v opencartridge-data:/content/data` is the MinIO storage: generated renders and uploaded inputs live there, so they
survive recreating the container. `docker volume rm opencartridge-data` clears them.

## 💾 Cartridges

Open **💾 Cartridges**, pick a cartridge and press **Download & run** — the app pulls the worker image, creates its
container, points it at the built-in MinIO and starts it. No `docker run`, no env vars, no ports to wire up.

**Available**

- **3x3 Sprite Sheet** *(image)* — build a 3x3 turnaround sprite sheet (eight isometric facings, empty center box, transparent background) from one character reference
- **3x3 Sprite Sheet Animation** *(video)* — animate an existing 3x3 sprite sheet: all eight figures walk in place, in their own cell, as one loopable clip with audio
- **Loop Hero Style** *(image)* — turn a character reference into a Loop Hero pixel-art render: dithered dark-fantasy palette, crisp pixel edges, colors matched back to the reference
- **CorridorKey Image** *(image)* — pull a clean alpha matte out of a still frame with CorridorKey 2.0: native-resolution keying, no green screen, no rotoscoping
- **CorridorKey Video** *(video)* — key a whole clip: drop a video layer and CorridorKey 2.0 returns the animated matte or a transparent cutout at native resolution
- **Idol 3D** *(3d)* — one image in, a 3D model out: Idol predicts the whole object, including the sides the photo never showed, and the cartridge meshes it into a GLB

| State | Dot | What you can do |
|---|---|---|
| running | 🟢 | **Stop**, **Delete** |
| stopped / downloaded | 🟡 | **Start**, **Delete** |
| not installed | 🔴 | **Download & run** (progress shown on the card) |

A cartridge whose worker is not running is hidden from the left panel until you start it. The container spec (image,
ports, command, env) comes from `public/service-workers.json` and is never taken from the browser.

Requires an NVIDIA GPU (~24 GB VRAM is enough for the current workers). The first run of a worker downloads its image
— a few GB — and the first job loads its models.

## ❤️ Credits

- [TostUI](https://github.com/camenduru/TostUI) by [camenduru](https://x.com/camenduru) — application code, cartridge protocol and worker dockers
- [ComfyUI](https://github.com/comfy-org/comfyui) — the backend inside most workers
- [MinIO](https://github.com/minio/minio) — the S3-compatible object storage that ships inside the container
- [CorridorKey 2.0](https://github.com/camenduru/CorridorKey2.0) — matting by Zachary Harris with Corridor Digital
- [Idol](https://github.com/speridlabs/idol-sdk) — one image to 3D gaussian splat, by Speridlabs
- [ComfyUI-Idol](https://github.com/Nynxz/ComfyUI-Idol) — the ComfyUI node pack and converted weights the worker runs

## 📄 License

MIT — see [LICENSE](./LICENSE) (© camenduru).
