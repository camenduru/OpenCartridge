"use client"

/**
 * Rig inspector canvas.
 *
 * `@google/model-viewer` renders a GLB but never exposes its three.js scene, so
 * a `SkeletonHelper` cannot be attached to it. This component does the render
 * itself: one GLB, one scene, orbit controls, and the skeleton drawn on top of
 * the mesh (depth test off) so bones inside the body are still visible.
 *
 * Loaded through `next/dynamic` with `ssr: false` — three touches `window` at
 * construction time and has no business in a server render.
 */

import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

export type RigStatus = {
  state: 'loading' | 'ready' | 'no-rig' | 'error'
  /** Number of bones found in the loaded model. */
  bones: number
  message?: string
}

export interface GLBRigCanvasHandle {
  /** PNG data URL of the current frame, or null if nothing has rendered. */
  capture: () => string | null
}

interface GLBRigCanvasProps {
  glbUrl: string
  onStatus?: (status: RigStatus) => void
}

export const GLBRigCanvas = forwardRef<GLBRigCanvasHandle, GLBRigCanvasProps>(
  function GLBRigCanvas({ glbUrl, onStatus }, ref) {
    const hostRef = useRef<HTMLDivElement | null>(null)
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
    const sceneRef = useRef<THREE.Scene | null>(null)
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)

    // Held in a ref so a caller passing an inline callback cannot retrigger the
    // load effect — that would reload the GLB on every parent render.
    const onStatusRef = useRef(onStatus)
    useEffect(() => {
      onStatusRef.current = onStatus
    }, [onStatus])

    useImperativeHandle(ref, () => ({
      capture: () => {
        const renderer = rendererRef.current
        const scene = sceneRef.current
        const camera = cameraRef.current
        if (!renderer || !scene || !camera) return null
        // Draw one fresh frame before reading the buffer; `preserveDrawingBuffer`
        // is set below, but this also guarantees the current camera angle.
        renderer.render(scene, camera)
        return renderer.domElement.toDataURL('image/png')
      },
    }), [])

    useEffect(() => {
      const host = hostRef.current
      if (!host) return

      let disposed = false
      let frame = 0

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 5000)
      // Rigs are generated from GLBs that face -Z, so the rig view starts on the
      // -Z side too — same front-on framing as the shaded model-viewer.
      camera.position.set(0, 1, -3)

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      renderer.setClearColor(0x000000, 0)
      renderer.domElement.style.width = '100%'
      renderer.domElement.style.height = '100%'
      renderer.domElement.style.display = 'block'
      host.appendChild(renderer.domElement)

      sceneRef.current = scene
      cameraRef.current = camera
      rendererRef.current = renderer

      // Flat even light: this is an inspection view, not a beauty render.
      scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2))
      const key = new THREE.DirectionalLight(0xffffff, 2)
      key.position.set(2, 4, 3)
      scene.add(key)

      const controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
      controls.dampingFactor = 0.08

      const resize = () => {
        const width = host.clientWidth || 1
        const height = host.clientHeight || 1
        renderer.setSize(width, height, false)
        camera.aspect = width / height
        camera.updateProjectionMatrix()
      }
      resize()
      const observer = new ResizeObserver(resize)
      observer.observe(host)

      const animate = () => {
        if (disposed) return
        frame = requestAnimationFrame(animate)
        controls.update()
        renderer.render(scene, camera)
      }
      animate()

      onStatusRef.current?.({ state: 'loading', bones: 0 })

      const loader = new GLTFLoader()
      loader.load(
        glbUrl,
        (gltf) => {
          if (disposed) return
          const model = gltf.scene
          scene.add(model)

          let bones = 0
          model.traverse((child) => {
            if ((child as THREE.Bone).isBone) bones += 1
          })

          if (bones > 0) {
            const helper = new THREE.SkeletonHelper(model)
            const material = helper.material as THREE.LineBasicMaterial
            // Bones live inside the mesh; without this the body hides its own
            // rig, which is the one thing this view exists to show.
            material.depthTest = false
            material.depthWrite = false
            material.transparent = true
            helper.renderOrder = 999
            scene.add(helper)
          }

          // Frame whatever came back — rigged GLBs arrive at wildly different
          // scales, so a fixed camera distance is useless.
          const box = new THREE.Box3().setFromObject(model)
          const size = new THREE.Vector3()
          const center = new THREE.Vector3()
          box.getSize(size)
          box.getCenter(center)
          const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1
          const distance = radius / Math.sin((camera.fov * Math.PI) / 360)
          camera.position
            .copy(center)
            .add(new THREE.Vector3(-0.6, 0.4, -1).normalize().multiplyScalar(distance * 1.15))
          camera.near = Math.max(distance / 1000, 0.001)
          camera.far = distance * 100
          camera.updateProjectionMatrix()
          controls.target.copy(center)
          controls.update()

          onStatusRef.current?.({ state: bones > 0 ? 'ready' : 'no-rig', bones })
        },
        undefined,
        (error) => {
          if (disposed) return
          const message = error instanceof Error ? error.message : 'Could not load the model'
          onStatusRef.current?.({ state: 'error', bones: 0, message })
        }
      )

      return () => {
        disposed = true
        cancelAnimationFrame(frame)
        observer.disconnect()
        controls.dispose()
        scene.traverse((object) => {
          const mesh = object as THREE.Mesh
          mesh.geometry?.dispose?.()
          const material = mesh.material as THREE.Material | THREE.Material[] | undefined
          if (Array.isArray(material)) material.forEach((entry) => entry.dispose?.())
          else material?.dispose?.()
        })
        renderer.dispose()
        if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement)
        sceneRef.current = null
        cameraRef.current = null
        rendererRef.current = null
      }
    }, [glbUrl])

    return <div ref={hostRef} className="w-full h-full" />
  }
)
