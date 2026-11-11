# ⚡ OpenCartridge

https://github.com/user-attachments/assets/4c323c93-db7b-40b9-a6d3-7b48e577aef1

<img width="1920" height="1080" alt="Screenshot 2026-10-30 082115" src="https://github.com/user-attachments/assets/150de80d-2081-4a09-b4aa-e07d74120ddb" />

<img width="1920" height="1080" alt="Screenshot 2026-10-30 015836" src="https://github.com/user-attachments/assets/c87b4638-f353-4c56-8479-9179b7879e7d" />

<img width="1920" height="1080" alt="Screenshot 2026-10-30 015922" src="https://github.com/user-attachments/assets/b2452992-e913-4edf-acc6-569c92c4394d" />

<img width="1920" height="1080" alt="Screenshot 2026-10-30 020113" src="https://github.com/user-attachments/assets/679aa7cd-4ad4-419c-b62c-16d587f68bfe" />

<img width="1920" height="1080" alt="Screenshot 2026-10-30 065139" src="https://github.com/user-attachments/assets/978b98fe-f490-4be5-901e-aea732dedfb2" />

https://github.com/user-attachments/assets/cdb600ba-3016-4f1a-b988-53442ed19566

**OpenCartridge** is a local-first AI game asset suite: a canvas for composing images, sprite sheets, animation, audio and 3D, driven by ComfyUI workers running on your own GPU. Built on [camenduru's TostUI](https://github.com/camenduru/TostUI).

## ✨ What's inside

- 🎨 **Canvas** — layers, transforms, undo/redo, export (PNG, MP4, WebM, GLB)
- 💾 **Cartridges** — worker models packaged as one-click cartridges, installed and run from the UI
- 🐳 **Docker cartridges** — download and run with one click; start, stop and delete the container from the same card
- 🧊 **3D** — GLB preview and orbiting viewer; thumbnails, examples and the floating viewer open front-first, so generated models never greet you with their back
- 🎵 **Audio** — waveform overlay and generation cartridges
- 🗄️ **MinIO inside** — the container ships its own object storage; nothing else to install
- 🔄 **Self-updating UI** — the Global Configuration panel pulls the latest source, rebuilds and restarts the app from inside itself
- 🏠 **100% local** — no cloud account, no credits

## 🚀 Run

**1. Install Docker** — download [Docker Desktop (Windows AMD64)](https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe) and run it. Wait until the whale icon says Docker is running.

**2. Start OpenCartridge**

**Linux / macOS**

```bash
docker run -d --name opencartridge --restart unless-stopped --add-host=host.docker.internal:host-gateway -p 3000:3000 -p 9000:9000 -p 9001:9001 -v opencartridge-data:/content/data -v /var/run/docker.sock:/var/run/docker.sock camenduru/opencartridge
```

**Docker Desktop for Windows** — note the doubled leading slash on the socket

```powershell
docker run -d --name opencartridge --restart unless-stopped --add-host=host.docker.internal:host-gateway -p 3000:3000 -p 9000:9000 -p 9001:9001 -v opencartridge-data:/content/data -v //var/run/docker.sock:/var/run/docker.sock camenduru/opencartridge
```

Open **http://localhost:3000**. That is the whole setup — no worker containers to start by hand.

`--add-host=host.docker.internal:host-gateway` is **not optional on Linux**. Workers are addressed as
`host.docker.internal:<port>` in `public/service-workers.json`, a name Docker Desktop for Windows/macOS creates for
you but plain Linux Docker does not. Without it the app can still pull, create and start worker containers, but can
never reach them: every cartridge sits on **Starting…** forever and every job fails with
`Failed to connect to local API server`.

`-v opencartridge-data:/content/data` is the MinIO storage: generated renders and uploaded inputs live there, so they
survive recreating the container. `docker volume rm opencartridge-data` clears them.

The Docker socket mount gives the app its container controls (pulling, starting and deleting workers).

Reaching it from another machine on your network works as-is: `http://<host-ip>:3000`. The browser only ever talks to
the app's own origin — worker calls, uploads and result files are all proxied server-side — so no `localhost` or
`host.docker.internal` address ever has to mean anything to the client. Note that MinIO on `:9000` is published too and
its bucket is public read/write, and the app itself has no authentication: keep `3000` and `9000` on a trusted network.

## 💾 Cartridges

Open **💾 Cartridges**, pick a cartridge and press **Download & run** — the app pulls the worker image, creates its
container, points it at the built-in MinIO and starts it. No `docker run`, no env vars, no ports to wire up.

**Available**

- **3x3 Sprite Sheet** *(image)* — build a 3x3 turnaround sprite sheet (eight isometric facings, empty center box, transparent background) from one character reference
- **3x3 Sprite Sheet Animation** *(video)* — animate an existing 3x3 sprite sheet: all eight figures walk in place, in their own cell, as one loopable clip with audio
- **MiniMax H3 Image Edit** *(image)* — edit a reference image with MiniMax H3 Image; the default prompt rewrites it as a 3x3 turnaround sprite sheet
- **Loop Hero Style** *(image)* — turn a character reference into a Loop Hero pixel-art render: dithered dark-fantasy palette, crisp pixel edges, colors matched back to the reference
- **CorridorKey Image** *(image)* — pull a clean alpha matte out of a still frame with CorridorKey 2.0: native-resolution keying, no green screen, no rotoscoping
- **CorridorKey Video** *(video)* — key a whole clip: drop a video layer and CorridorKey 2.0 returns the animated matte or a transparent cutout at native resolution
- **Idol 3D** *(3d)* — one image in, a 3D model out: Idol predicts the whole object, including the sides the photo never showed, and the cartridge meshes it into a GLB
- **SUPRA-Tex** *(3d)* — one photo in, a textured 3D model out: reconstructs the object's geometry from a single view and super-aligns a full PBR material onto it, returning a GLB
- **SkinTokens Rig** *(3d)* — one mesh in, a rigged mesh out: TokenRig predicts a skeleton and per-vertex skin weights and returns the rigged GLB, ready to pose in Blender, Unity or three.js
- **UniMate Motion** *(3d)* — one rigged mesh plus a text prompt in, an animated mesh out: UniMate predicts articulated motion for any skeleton and bakes it onto your rig as a GLB animation
- **GLB to VRM** *(3d)* — one rigged humanoid GLB in, a VRM avatar out: automatic humanoid bone mapping, Blender bridge, MToon textures and optional spring bones
- **VRMExMR** *(3d)* — one video in, a VRM Animation out: ExMR reconstructs the body, hand and foot motion of the person in the clip and bakes it into a `.vrma` that plays on any VRM avatar, with the BVH returned alongside
- **UniForge3D** *(3d)* — one or more unposed views in, a complete textured asset out: select any number of image layers on the canvas and it reconstructs the sides it sees and generates the ones it does not in one shared anchor-guided space, returning a GLB with a baked PBR material
- **Kimodo** *(3d)* — a text prompt in, a VRM Animation out: describe the motion and Kimodo generates a `.vrma` that plays on any VRM avatar, with the same motion written as a SOMA77 BVH alongside
- **YuE2 Text to Music** *(audio)* — generate a complete song — vocals and instruments — from a style description and lyrics, with an optional editable ABC melody plan
- **Breeze TTS Plain** *(audio)* — text in, one voice take out: the model reads your line in its default voice, bilingual EN/ZH with inline vocal events
- **Breeze TTS Design** *(audio)* — invent a voice from a written description and have it speak your line
- **Breeze TTS Clone** *(audio)* — select an audio clip plus its exact transcript; Breeze TTS 2 speaks your line in that voice
- **Breeze TTS Direct** *(audio)* — keep a reference speaker's identity while steering emotion, pace and delivery with an instruction

| State | Dot | What you can do |
|---|---|---|
| running, answering | 🟢 | **Stop**, **Delete** |
| running, unreachable | 🟡 **Starting…** | check the `--add-host` flag above; **Stop** |
| stopped / downloaded | 🟡 | **Start**, **Delete** |
| not installed | 🔴 | **Download & run** (progress shown on the card) |

A cartridge whose worker is not running is hidden from the left panel until you start it. The container spec (image,
ports, command, env) comes from `public/service-workers.json` and is never taken from the browser.

Requires an NVIDIA GPU (~24 GB VRAM is enough for the current workers). The first run of a worker downloads its image
— a few GB — and the first job loads its models.

## ❤️ Credits

**Platform**

- [TostUI](https://github.com/camenduru/TostUI) by [camenduru](https://x.com/camenduru) — application code, cartridge protocol and worker dockers
- [ComfyUI](https://github.com/comfy-org/comfyui) — the backend inside most workers
- [MinIO](https://github.com/minio/minio) — the S3-compatible object storage that ships inside the container
- [RunPod](https://github.com/runpod/runpod-python) — the local serverless job API every worker answers
- [Blender](https://www.blender.org/) — headless mesh work for the GLB to VRM and UniMate workers

**Model cartridges** — in the order they appear above

- **3x3 Sprite Sheet / Animation** — the sheet edit runs [Qwen Image 2.1](https://huggingface.co/Comfy-Org/Qwen-Image-2.1) by the Qwen team; the walk cycle runs [MiniMax H3](https://huggingface.co/Comfy-Org/MiniMax-H3) by MiniMax, with the 3-step turbo LoRA by [Kijai](https://huggingface.co/Kijai/MiniMax-H3_comfy)
- **MiniMax H3 Image Edit** — [MiniMax H3 Image](https://huggingface.co/Comfy-Org/MiniMax-H3-Image) by MiniMax, using the 32B Qwen3-VL text encoder from [MiniMax H3](https://huggingface.co/Comfy-Org/MiniMax-H3)
- **Loop Hero Style** — [Krea 2 Turbo](https://huggingface.co/Comfy-Org/Krea-2) by Krea, with the [Loop Hero style LoRA](https://civitai.com/models/1349874/loop-hero-game-styles) from the Civitai community
- **CorridorKey Image / Video** — [CorridorKey 2.0](https://github.com/camenduru/CorridorKey2.0) matting by Zachary Harris with Corridor Digital, built on [C-RADIO](https://github.com/NVlabs/RADIO) (NVIDIA), [MoGe](https://github.com/microsoft/MoGe) (Microsoft) and [RVM](https://github.com/google-deepmind/representations4d) (Google DeepMind)
- **Idol 3D** — [Idol](https://huggingface.co/speridlabs/idol) by [Speridlabs](https://speridlabs.com/research/idol) on the [TripoSplat](https://github.com/VAST-AI-Research/TripoSplat) architecture, with the [ComfyUI-Idol](https://github.com/Nynxz/ComfyUI-Idol) node pack and converted weights
- **SUPRA-Tex** — [SUPRA-Tex](https://huggingface.co/spaces/UniLat3D/Supra-Tex) by UniLat3D, on [Pixal3D](https://huggingface.co/TencentARC/Pixal3D) (Tencent ARC), [TRELLIS.2](https://huggingface.co/microsoft/TRELLIS.2-4B) and [MoGe-2](https://huggingface.co/Ruicheng/moge-2-vitl-normal) (Microsoft), [DINOv3](https://huggingface.co/camenduru/dinov3-vitl16-pretrain-lvd1689m) (Meta) and [Qwen-Image 2.1](https://huggingface.co/Qwen/Qwen-Image-2.1)
- **SkinTokens Rig** — [TokenRig / SkinTokens](https://zjp-shadow.github.io/works/SkinTokens/) by the SkinTokens authors: one token sequence for the skeleton and the skinning weights
- **UniMate Motion** — [UniMate](https://linzhanmou.com/unimate/) by the UniMate team: text-to-animation for arbitrary skeletons (MIT code, CC BY-NC 4.0 checkpoints)
- **GLB to VRM** — [GLB2VRM](https://github.com/camenduru/GLB2VRM) and the VRMify conversion chain (GPL-3.0), against the [VRM](https://vrm.dev/) spec
- **VRMExMR** — [VRMExMR](https://github.com/camenduru/VRMExMR) and ExMR motion reconstruction; SMPL-X, MANO, SAM 3D Body, Sapiens2 and YOLO each carry their own licence — see that repository's `THIRD_PARTY_NOTICES.md`
- **UniForge3D** — [UniForge3D](https://github.com/xibushu/UniForge3D) by Wenjue Chen, Wenyue Chen and co-authors (Peking University, Math Magic, HKUST), on [TRELLIS.2](https://github.com/microsoft/TRELLIS.2) and [VGGT](https://github.com/facebookresearch/vggt)
- **Kimodo** — [Kimodo](https://github.com/nv-tlabs/kimodo) by NVIDIA, a text-driven motion diffusion model on the SOMA skeleton; the `.vrma` is written by Kimodo's own VRMA exporter and the BVH by the cartridge's SOMA77 writer
- **YuE2 Text to Music** — [YuE](https://github.com/multimodal-art-projection/YuE) by the Multimodal Art Projection team, weights packaged by [Comfy-Org](https://huggingface.co/Comfy-Org/YuE2)
- **Breeze TTS Plain / Design / Clone / Direct** — [Breeze TTS 2](https://huggingface.co/BreezeBlue/Breeze-TTS-2) by [BreezeBlue](https://github.com/breezeblue-ai/breeze-tts); the worker form of [TostAI-Voice-Studio](https://github.com/camenduru/TostAI-Voice-Studio). Research / non-commercial use only
- **MOSS Sound Effect** — [MOSS-SoundEffect v2.0](https://huggingface.co/OpenMOSS-Team/MOSS-SoundEffect-v2.0) by the OpenMOSS team, on [MOSS-TTS](https://github.com/OpenMOSS/MOSS-TTS); the worker form of [TostAI-Sound-Effect-Studio](https://github.com/camenduru/TostAI-Sound-Effect-Studio)

Each model keeps its own licence. Several cartridges are non-commercial (CorridorKey, Breeze TTS, UniMate, VRMExMR
and its dependencies) — check the linked model card before using their output commercially.

## 📄 License

MIT — see [LICENSE](./LICENSE) (© camenduru).
