"use client"

import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { BVHLoader } from "three/addons/loaders/BVHLoader.js"
import { Download, Pause, Play } from "lucide-react"
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
} from "react"
import { RIG_COLOR } from "@/lib/vrma-rig"

export interface BVHViewerHandle {
  /** PNG data URL of the current frame (null before the renderer exists). */
  capture: () => string | null
}

interface BVHViewerProps {
  url: string
  /** File name for the download button; a blob URL has none of its own. */
  name?: string
  style?: CSSProperties
}

/**
 * BVH viewer — the bones-only view a .vrma gets, but a BVH carries its own
 * skeleton, so the motion is drawn on the rig it was captured with instead of
 * on a canonical humanoid. Same green lines and joint dots as the ExMR viewer.
 */
export const BVHViewer = forwardRef<BVHViewerHandle, BVHViewerProps>(function BVHViewer(
  { url, name, style },
  ref
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const mixerRef = useRef<THREE.AnimationMixer | null>(null)
  const actionRef = useRef<THREE.AnimationAction | null>(null)
  const frameRef = useRef<(() => void) | null>(null)

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [message, setMessage] = useState("")
  const [paused, setPaused] = useState(false)

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
    let group: THREE.Group | null = null

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(35, 1, 0.001, 100000)

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

    const resize = () => {
      const width = host.clientWidth || 1
      const height = host.clientHeight || 1
      // updateStyle stays on: with it off a HiDPI drawing buffer would be shown
      // at buffer size, cropping the skeleton to the top-left of the panel.
      renderer.setSize(width, height)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      // Re-frame, so a panel resized after load is not cropped.
      frameRef.current?.()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(host)

    const clock = new THREE.Clock()
    const animate = () => {
      if (disposed) return
      frame = requestAnimationFrame(animate)
      mixerRef.current?.update(clock.getDelta())
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    const load = async () => {
      try {
        setStatus("loading")
        const { skeleton, clip } = await new BVHLoader().loadAsync(url)
        if (disposed) return
        const root = skeleton.bones[0]
        if (!root) throw new Error("This BVH has no skeleton")

        group = new THREE.Group()
        group.add(root)

        const helper = new THREE.SkeletonHelper(root)
        const lineMaterial = helper.material as THREE.LineBasicMaterial
        lineMaterial.color = new THREE.Color(RIG_COLOR)
        lineMaterial.depthTest = false
        lineMaterial.depthWrite = false
        lineMaterial.transparent = true
        helper.renderOrder = 999
        group.add(helper)

        const mixer = new THREE.AnimationMixer(root)
        const action = mixer.clipAction(clip)
        action.play()
        mixer.update(0)
        group.updateMatrixWorld(true)

        const box = new THREE.Box3()
        const point = new THREE.Vector3()
        for (const bone of skeleton.bones) box.expandByPoint(bone.getWorldPosition(point))
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        if (size.lengthSq() < 1e-6) size.set(1, 1, 1)

        const jointGeometry = new THREE.SphereGeometry(Math.max(size.y, 1e-3) * 0.006, 10, 8)
        const jointMaterial = new THREE.MeshBasicMaterial({
          color: RIG_COLOR,
          depthTest: false,
          depthWrite: false,
          transparent: true,
        })
        for (const bone of skeleton.bones) {
          if (bone.name === "ENDSITE") continue
          const joint = new THREE.Mesh(jointGeometry, jointMaterial)
          joint.renderOrder = 1000
          joint.frustumCulled = false
          bone.add(joint)
        }

        scene.add(group)
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
          camera.near = Math.max(distance / 1000, 0.001)
          camera.far = distance * 100
          camera.updateProjectionMatrix()
          controls.target.copy(center)
          controls.update()
        }
        frameRef.current()

        setPaused(false)
        setStatus("ready")
        setMessage("")
      } catch (error) {
        if (disposed) return
        setStatus("error")
        setMessage(error instanceof Error ? error.message : "Could not load the BVH")
      }
    }
    void load()

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      controls.dispose()
      mixerRef.current?.stopAllAction()
      mixerRef.current = null
      actionRef.current = null
      frameRef.current = null
      if (group) {
        scene.remove(group)
        group.traverse((object) => {
          const mesh = object as THREE.Mesh
          mesh.geometry?.dispose?.()
          const material = mesh.material as THREE.Material | THREE.Material[] | undefined
          if (Array.isArray(material)) material.forEach((entry) => entry.dispose?.())
          else material?.dispose?.()
        })
        group = null
      }
      renderer.dispose()
      renderer.domElement.remove()
      rendererRef.current = null
    }
  }, [url])

  const toggle = () => {
    const action = actionRef.current
    if (!action) return
    action.paused = !action.paused
    setPaused(action.paused)
  }

  const download = async () => {
    const base = (name || url.split("/").pop()?.split(/[?#]/)[0] || "animation").replace(
      /\.(glb|gltf|vrm|vrma|bvh)$/i,
      ""
    )
    const fileName = `${base || "animation"}.bvh`
    const a = document.createElement("a")
    try {
      const blob = await (await fetch(url)).blob()
      a.href = URL.createObjectURL(blob)
      a.download = fileName
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10000)
    } catch {
      a.href = url
      a.download = fileName
      a.click()
    }
  }

  return (
    <div className="relative overflow-hidden" style={style}>
      <div ref={hostRef} className="absolute inset-0" />

      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          Loading BVH…
        </div>
      )}
      {status === "error" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground">
          {message || "Could not load the BVH"}
        </div>
      )}

      {status === "ready" && (
        <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2">
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
          <button
            type="button"
            onClick={() => void download()}
            title="Download .bvh"
            aria-label="Download .bvh"
            className="flex h-9 items-center gap-1.5 rounded-full bg-black/70 px-3 text-xs font-medium text-white shadow-lg backdrop-blur transition hover:bg-black/85"
          >
            <Download className="h-3.5 w-3.5" />
            .bvh
          </button>
        </div>
      )}
    </div>
  )
})
