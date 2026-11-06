"use client"

import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import {
  VRMLoaderPlugin,
  VRMUtils,
  VRMHumanBoneParentMap,
  type VRM,
} from "@pixiv/three-vrm"
import {
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
  type VRMAnimation,
} from "@pixiv/three-vrm-animation"
import { Pause, Play, Upload, Download } from "lucide-react"
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react"

function isVrmaUrl(url: string) {
  return /\.vrma(\?|#|$)/i.test(url)
}

/**
 * A .vrma carries bone rotations and a hips height, never bone offsets or a
 * node hierarchy — the cartridge writes one flat node per humanoid bone — so a
 * bone-only preview needs a rig to hang the motion on. This is the canonical
 * VRM humanoid T-pose in metres: the animation drives it exactly as it drives
 * an avatar, because VRMA rotations are already in the normalized humanoid
 * space.
 */
const RIG_TPOSE: Record<string, [number, number, number]> = {
  hips: [0, 0.9, 0],
  spine: [0, 1.0, 0],
  chest: [0, 1.13, 0],
  upperChest: [0, 1.26, 0],
  neck: [0, 1.4, 0],
  head: [0, 1.5, 0],
  leftShoulder: [0.05, 1.38, 0],
  leftUpperArm: [0.17, 1.38, 0],
  leftLowerArm: [0.44, 1.38, 0],
  leftHand: [0.7, 1.38, 0],
  leftThumbMetacarpal: [0.72, 1.375, 0.045],
  leftThumbProximal: [0.75, 1.37, 0.055],
  leftThumbDistal: [0.775, 1.368, 0.06],
  leftIndexProximal: [0.75, 1.385, 0.02],
  leftIndexIntermediate: [0.79, 1.385, 0.02],
  leftIndexDistal: [0.82, 1.385, 0.02],
  leftMiddleProximal: [0.755, 1.39, 0],
  leftMiddleIntermediate: [0.8, 1.39, 0],
  leftMiddleDistal: [0.83, 1.39, 0],
  leftRingProximal: [0.75, 1.385, -0.02],
  leftRingIntermediate: [0.79, 1.385, -0.02],
  leftRingDistal: [0.82, 1.385, -0.02],
  leftLittleProximal: [0.74, 1.38, -0.04],
  leftLittleIntermediate: [0.77, 1.38, -0.04],
  leftLittleDistal: [0.79, 1.38, -0.04],
  leftUpperLeg: [0.09, 0.88, 0],
  leftLowerLeg: [0.09, 0.46, 0],
  leftFoot: [0.09, 0.07, 0],
  leftToes: [0.09, 0.03, 0.12],
}

const RIG_COLOR = 0x4bf0b6
const HIPS_HEIGHT = RIG_TPOSE.hips[1]

for (const [name, [x, y, z]] of Object.entries(RIG_TPOSE)) {
  if (!name.startsWith("left")) continue
  RIG_TPOSE[`right${name.slice(4)}`] = [-x, y, z]
}

/** Bones are named after the VRM humanoid, so track names resolve directly. */
function buildHumanoidRig() {
  const rig = new THREE.Group()
  const bones: Record<string, THREE.Bone> = {}
  for (const name of Object.keys(RIG_TPOSE)) {
    const bone = new THREE.Bone()
    bone.name = name
    bones[name] = bone
  }

  const parents = VRMHumanBoneParentMap as Record<string, string | undefined>
  for (const [name, bone] of Object.entries(bones)) {
    const parentName = parents[name]
    const position = RIG_TPOSE[name]
    const parentPosition = parentName ? RIG_TPOSE[parentName] : undefined
    if (parentName && parentPosition && bones[parentName]) {
      // Parent-relative offset: the rig stores positions, never rotations, so
      // the rest pose is the T-pose the animation expects.
      bone.position.set(
        position[0] - parentPosition[0],
        position[1] - parentPosition[1],
        position[2] - parentPosition[2]
      )
      bones[parentName].add(bone)
    } else {
      bone.position.set(position[0], position[1], position[2])
      rig.add(bone)
    }
  }

  return { rig, bones }
}

/** The same retarget three-vrm applies to an avatar, onto the canonical rig. */
function createRigClip(animation: VRMAnimation) {
  const tracks: THREE.KeyframeTrack[] = []

  for (const [name, track] of animation.humanoidTracks.rotation) {
    if (!RIG_TPOSE[name]) continue
    tracks.push(
      new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, track.times, track.values)
    )
  }

  // The hips translation is absolute in the clip's own metres; scale it to the
  // rig's hips height the way createVRMAnimationClip does for an avatar.
  const restHips = animation.restHipsPosition.y
  const scale = restHips > 1e-3 ? HIPS_HEIGHT / restHips : 1
  for (const [name, track] of animation.humanoidTracks.translation) {
    if (!RIG_TPOSE[name]) continue
    const values = new Float32Array(track.values.length)
    for (let i = 0; i < values.length; i += 1) values[i] = track.values[i] * scale
    tracks.push(new THREE.VectorKeyframeTrack(`${name}.position`, track.times, values))
  }

  return new THREE.AnimationClip("vrma", animation.duration, tracks)
}

export interface VRMViewerHandle {
  /** PNG data URL of the current frame (null before the renderer exists). */
  capture: () => string | null
}

interface VRMViewerProps {
  url: string
  style?: CSSProperties
  /** Optional VRMA URL to load on top of the avatar. */
  vrmaUrl?: string
}

/**
 * VRM viewer with MToon materials, spring bones and VRMA playback.
 *
 * model-viewer can display the base glTF of a VRM, but it ignores the VRM
 * extensions: materials fall back to PBR, spring bones do not move and a VRMA
 * cannot drive the humanoid. This viewer uses three-vrm, so the avatar looks
 * the way it will in a VRM application.
 */
export const VRMViewer = forwardRef<VRMViewerHandle, VRMViewerProps>(function VRMViewer(
  { url, style, vrmaUrl },
  ref
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const vrmRef = useRef<VRM | null>(null)
  const mixerRef = useRef<THREE.AnimationMixer | null>(null)
  const actionRef = useRef<THREE.AnimationAction | null>(null)
  const loadVrmaRef = useRef<((source: string | File) => Promise<void>) | null>(null)
  const frameRef = useRef<(() => void) | null>(null)
  const skeletonRef = useRef<THREE.Group | null>(null)

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [message, setMessage] = useState("")
  const [hasAnimation, setHasAnimation] = useState(false)
  const [paused, setPaused] = useState(true)
  const [vrmaName, setVrmaName] = useState("")
  const [vrmaSource, setVrmaSource] = useState<string | File | null>(null)

  useImperativeHandle(ref, () => ({
    capture: () => {
      try {
        return rendererRef.current?.domElement.toDataURL("image/png") ?? null
      } catch {
        return null
      }
    },
  }))

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let disposed = false
    let frame = 0
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 2000)

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.domElement.style.display = "block"
    host.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08

    // MToon is lit, so both a key light and an ambient fill are required.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.2))
    const key = new THREE.DirectionalLight(0xffffff, 2.4)
    key.position.set(1.5, 3, 2)
    scene.add(key)

    const resize = () => {
      const width = host.clientWidth || 1
      const height = host.clientHeight || 1
      // updateStyle must stay on: with updateStyle=false the canvas keeps its
      // drawing-buffer size as its CSS size. On a HiDPI/4K display (DPR 1.5+
      // from setPixelRatio) that makes the canvas larger than its host, so the
      // viewer shows a cropped top-left corner of the frame.
      renderer.setSize(width, height)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      // Re-frame: the panel can be created at one size and laid out at another
      // (wide 4K layouts, resized viewer windows), and a camera fitted to the
      // wrong aspect crops the avatar.
      frameRef.current?.()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(host)

    const clock = new THREE.Clock()
    const animate = () => {
      if (disposed) return
      frame = requestAnimationFrame(animate)
      const delta = clock.getDelta()
      vrmRef.current?.update(delta)
      mixerRef.current?.update(delta)
      // SkeletonHelper recomputes its line geometry in updateMatrixWorld, which
      // the renderer runs after the mixer has posed the bones — no manual tick.
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser))

    const loadVrma = async (source: string | File) => {
      if (!vrmRef.current) return
      let target: string
      let revoke: string | null = null
      if (source instanceof File) {
        revoke = URL.createObjectURL(source)
        target = revoke
      } else {
        target = source
      }
      try {
        setMessage("Loading animation…")
        const gltf = await loader.loadAsync(target)
        const animations = gltf.userData.vrmAnimations
        if (!animations || animations.length === 0) {
          throw new Error("no VRM animation in this file")
        }
        const clip = createVRMAnimationClip(animations[0], vrmRef.current)
        const mixer = new THREE.AnimationMixer(vrmRef.current.scene)
        mixer.stopAllAction()
        const action = mixer.clipAction(clip)
        action.reset().play()
        mixerRef.current = mixer
        actionRef.current = action
        setHasAnimation(true)
        setPaused(false)
        setMessage("")
        setVrmaSource(source)
        setVrmaName(
          source instanceof File
            ? source.name
            : source.split('/').pop()?.split(/[?#]/)[0] || "animation.vrma"
        )
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not load the animation")
      } finally {
        if (revoke) URL.revokeObjectURL(revoke)
      }
    }
    const clearSkeleton = () => {
      const rig = skeletonRef.current
      if (!rig) return
      scene.remove(rig)
      rig.traverse((object) => {
        const mesh = object as THREE.Mesh
        mesh.geometry?.dispose?.()
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose?.())
        else material?.dispose?.()
      })
      skeletonRef.current = null
      mixerRef.current?.stopAllAction()
      mixerRef.current = null
      actionRef.current = null
    }

    /** A .vrma has no mesh, so it is drawn the way the BVH viewer draws motion. */
    const loadSkeleton = async (source: string | File) => {
      let target: string
      let revoke: string | null = null
      if (source instanceof File) {
        revoke = URL.createObjectURL(source)
        target = revoke
      } else {
        target = source
      }
      try {
        setStatus("loading")
        setMessage("Loading animation…")
        const gltf = await loader.loadAsync(target)
        if (disposed) return
        const animation = (gltf.userData.vrmAnimations as VRMAnimation[] | undefined)?.[0]
        if (!animation) throw new Error("This file is not a VRM animation")

        clearSkeleton()

        const { rig, bones } = buildHumanoidRig()
        const helper = new THREE.SkeletonHelper(rig)
        const lineMaterial = helper.material as THREE.LineBasicMaterial
        lineMaterial.color = new THREE.Color(RIG_COLOR)
        lineMaterial.depthTest = false
        lineMaterial.depthWrite = false
        lineMaterial.transparent = true
        helper.renderOrder = 999
        rig.add(helper)

        const clip = createRigClip(animation)
        const mixer = new THREE.AnimationMixer(rig)
        const action = mixer.clipAction(clip)
        action.reset().play()
        mixer.update(0)
        rig.updateMatrixWorld(true)

        const box = new THREE.Box3()
        const point = new THREE.Vector3()
        for (const bone of Object.values(bones)) box.expandByPoint(bone.getWorldPosition(point))
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        if (size.lengthSq() < 1e-6) size.set(1, 1, 1)

        // 1 cm joints on a 1.7 m figure — the dots the BVH viewer draws.
        const jointGeometry = new THREE.SphereGeometry(Math.max(size.y, 0.1) * 0.006, 10, 8)
        const jointMaterial = new THREE.MeshBasicMaterial({
          color: RIG_COLOR,
          depthTest: false,
          depthWrite: false,
          transparent: true,
        })
        for (const bone of Object.values(bones)) {
          const joint = new THREE.Mesh(jointGeometry, jointMaterial)
          joint.renderOrder = 1000
          joint.frustumCulled = false
          bone.add(joint)
        }

        scene.add(rig)
        skeletonRef.current = rig
        mixerRef.current = mixer
        actionRef.current = action

        frameRef.current = () => {
          const vFov = (camera.fov * Math.PI) / 180
          const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect)
          const distance =
            Math.max(
              (size.y / 2) / Math.tan(vFov / 2),
              (size.x / 2) / Math.tan(hFov / 2)
            ) * 1.3
          camera.position.set(center.x, center.y, center.z + distance)
          camera.lookAt(center)
          camera.near = Math.max(distance / 1000, 0.001)
          camera.far = distance * 100
          camera.updateProjectionMatrix()
          controls.target.copy(center)
          controls.update()
        }
        frameRef.current()

        setHasAnimation(true)
        setPaused(false)
        setStatus("ready")
        setMessage("")
        setVrmaSource(source)
        setVrmaName(
          source instanceof File
            ? source.name
            : source.split("/").pop()?.split(/[?#]/)[0] || "animation.vrma"
        )
      } catch (error) {
        if (disposed) return
        setStatus("error")
        setMessage(error instanceof Error ? error.message : "Could not load the animation")
      } finally {
        if (revoke) URL.revokeObjectURL(revoke)
      }
    }

    loadVrmaRef.current = isVrmaUrl(url) ? loadSkeleton : loadVrma

    const loadVrm = async () => {
      try {
        setStatus("loading")
        const gltf = await loader.loadAsync(url)
        if (disposed) return
        const vrm = gltf.userData.vrm as VRM | undefined
        if (!vrm) throw new Error("This file is not a VRM avatar")

        // VRM 0.x faces the opposite way; match it to VRM 1.0.
        if (vrm.meta?.metaVersion === "0") VRMUtils.rotateVRM0(vrm)
        vrm.scene.traverse((object) => {
          object.frustumCulled = false
        })
        scene.add(vrm.scene)
        vrmRef.current = vrm

        vrm.scene.updateMatrixWorld(true)
        const box = new THREE.Box3().setFromObject(vrm.scene)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())

        // Fit the avatar to both axes of the viewport, like model-viewer does
        // for the GLB previews. This runs again on every resize so a panel
        // laid out for a 4K window cannot keep a distance fitted to a narrow
        // initial column.
        // VRM0 and VRM1 exporters do not always agree on the front axis, so
        // derive it from the avatar itself: the feet-to-toes direction is the
        // way the character faces. Fall back to right-hand rule, then +Z.
        const world = (node: THREE.Object3D | null) =>
          node ? node.getWorldPosition(new THREE.Vector3()) : null
        const humanoid = vrm.humanoid
        const leftFoot = world(humanoid?.getRawBoneNode("leftFoot") ?? null)
        const rightFoot = world(humanoid?.getRawBoneNode("rightFoot") ?? null)
        const leftToes = world(humanoid?.getRawBoneNode("leftToes") ?? null)
        const rightToes = world(humanoid?.getRawBoneNode("rightToes") ?? null)

        let forward = new THREE.Vector3(0, 0, 1)
        if (leftFoot && rightFoot && leftToes && rightToes) {
          forward = leftToes
            .clone()
            .add(rightToes)
            .multiplyScalar(0.5)
            .sub(leftFoot.clone().add(rightFoot).multiplyScalar(0.5))
        } else if (leftFoot && rightFoot) {
          const right = rightFoot.clone().sub(leftFoot)
          forward = right.cross(new THREE.Vector3(0, 1, 0))
        }
        forward.y = 0
        if (forward.lengthSq() < 1e-6) forward.set(0, 0, 1)
        forward.normalize()

        const frame = () => {
          const vFov = (camera.fov * Math.PI) / 180
          const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect)
          const distance =
            Math.max(
              (size.y / 2) / Math.tan(vFov / 2),
              (size.x / 2) / Math.tan(hFov / 2)
            ) * 1.15
          camera.position.copy(center).addScaledVector(forward, distance)
          camera.position.y = center.y + size.y * 0.05
          camera.near = Math.max(distance / 1000, 0.001)
          camera.far = distance * 100
          camera.updateProjectionMatrix()
          controls.target.copy(center)
          controls.update()
        }
        frameRef.current = frame
        frame()

        setStatus("ready")
        if (vrmaUrl) void loadVrma(vrmaUrl)
      } catch (error) {
        if (disposed) return
        setStatus("error")
        setMessage(error instanceof Error ? error.message : "Could not load the VRM")
      }
    }
    if (isVrmaUrl(url)) void loadSkeleton(url)
    else void loadVrm()

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      controls.dispose()
      mixerRef.current?.stopAllAction()
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh
        mesh.geometry?.dispose()
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const material of materials) {
          if (!material) continue
          for (const value of Object.values(material)) {
            if (value && (value as THREE.Texture).isTexture) (value as THREE.Texture).dispose()
          }
          material.dispose()
        }
      })
      renderer.dispose()
      renderer.domElement.remove()
      rendererRef.current = null
      vrmRef.current = null
      skeletonRef.current = null
      mixerRef.current = null
      actionRef.current = null
      frameRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  useEffect(() => {
    if (vrmaUrl) void loadVrmaRef.current?.(vrmaUrl)
  }, [vrmaUrl])

  const toggle = () => {
    const action = actionRef.current
    if (!action) return
    action.paused = !action.paused
    setPaused(action.paused)
  }

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) void loadVrmaRef.current?.(file)
    event.target.value = ""
  }

  // Download the animation under its own .vrma container, whether it came from
  // a URL or the user's disk. The avatar itself is downloaded by the canvas
  // layer export (as .vrm); this button is only ever the animation.
  const downloadVrma = async () => {
    if (!vrmaSource) return
    const name = (vrmaName || "animation.vrma").replace(/\.(glb|gltf)$/i, ".vrma")
    const download = (href: string, revoke: boolean) => {
      const a = document.createElement("a")
      a.href = href
      a.download = name.endsWith(".vrma") ? name : `${name}.vrma`
      a.click()
      if (revoke) setTimeout(() => URL.revokeObjectURL(href), 10000)
    }
    if (vrmaSource instanceof File) {
      download(URL.createObjectURL(vrmaSource), true)
      return
    }
    try {
      const blob = await (await fetch(vrmaSource)).blob()
      download(URL.createObjectURL(blob), true)
    } catch {
      download(vrmaSource, false)
    }
  }

  return (
    <div
      className="relative overflow-hidden"
      style={style}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault()
      }}
      onDrop={(event) => {
        const file = Array.from(event.dataTransfer.files).find((item) =>
          item.name.toLowerCase().endsWith(".vrma")
        )
        if (file) {
          event.preventDefault()
          event.stopPropagation()
          void loadVrmaRef.current?.(file)
        }
      }}
    >
      <div ref={hostRef} className="absolute inset-0" />

      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          {isVrmaUrl(url) ? "Loading animation…" : "Loading VRM…"}
        </div>
      )}
      {status === "error" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground">
          {message || (isVrmaUrl(url) ? "Could not load the animation" : "Could not load the VRM")}
        </div>
      )}

      {status === "ready" && (
        <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2">
          {hasAnimation && (
            <button
              type="button"
              onClick={toggle}
              title={paused ? "Play animation" : "Pause animation"}
              aria-label={paused ? "Play animation" : "Pause animation"}
              className="flex h-9 items-center gap-1.5 rounded-full bg-black/70 px-3 text-xs font-medium text-white shadow-lg backdrop-blur transition hover:bg-black/85"
            >
              {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
              {paused ? "Play" : "Pause"}
            </button>
          )}
          <label className="flex h-9 cursor-pointer items-center gap-1.5 rounded-full bg-black/70 px-3 text-xs font-medium text-white shadow-lg backdrop-blur transition hover:bg-black/85">
            <Upload className="h-3.5 w-3.5" />
            {vrmaName || "Load .vrma"}
            <input type="file" accept=".vrma" className="hidden" onChange={onPick} />
          </label>
          {hasAnimation && (
            <button
              type="button"
              onClick={() => void downloadVrma()}
              title="Download .vrma"
              aria-label="Download .vrma"
              className="flex h-9 items-center gap-1.5 rounded-full bg-black/70 px-3 text-xs font-medium text-white shadow-lg backdrop-blur transition hover:bg-black/85"
            >
              <Download className="h-3.5 w-3.5" />
              .vrma
            </button>
          )}
        </div>
      )}

      {status === "ready" && message && (
        <div className="pointer-events-none absolute bottom-14 left-3 rounded bg-black/70 px-2 py-1 text-[11px] text-white">
          {message}
        </div>
      )}
    </div>
  )
})
