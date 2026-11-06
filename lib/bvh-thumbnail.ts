"use client"

import * as THREE from "three"
import { BVHLoader } from "three/addons/loaders/BVHLoader.js"
import { RIG_COLOR } from "./vrma-rig"

/**
 * Render a BVH to a PNG thumbnail.
 *
 * Unlike a .vrma, a BVH carries its own skeleton and bone offsets, so the motion
 * is drawn on the rig it was captured with — the same bones-only look the viewer
 * and the VRM animation thumbnail use.
 */
export async function renderBvhThumbnail(url: string, size = 512): Promise<HTMLImageElement> {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  })
  renderer.setPixelRatio(1)
  renderer.setSize(size, size, false)
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(30, 1, 0.001, 100000)

  const group = new THREE.Group()
  try {
    const { skeleton, clip } = await new BVHLoader().loadAsync(url)
    const root = skeleton.bones[0]
    if (!root) throw new Error("This BVH has no skeleton")
    group.add(root)

    // A frame into the clip says more about the motion than the rest pose.
    const mixer = new THREE.AnimationMixer(root)
    mixer.clipAction(clip).play()
    mixer.update(Math.min(clip.duration * 0.35, 1))
    group.updateMatrixWorld(true)

    const helper = new THREE.SkeletonHelper(root)
    const lineMaterial = helper.material as THREE.LineBasicMaterial
    lineMaterial.color = new THREE.Color(RIG_COLOR)
    lineMaterial.depthTest = false
    lineMaterial.depthWrite = false
    lineMaterial.transparent = true
    helper.renderOrder = 999
    group.add(helper)

    const box = new THREE.Box3()
    const point = new THREE.Vector3()
    for (const bone of skeleton.bones) box.expandByPoint(bone.getWorldPosition(point))
    const bounds = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    if (bounds.lengthSq() < 1e-6) bounds.set(1, 1, 1)

    const jointGeometry = new THREE.SphereGeometry(Math.max(bounds.y, 1e-3) * 0.006, 8, 6)
    const jointMaterial = new THREE.MeshBasicMaterial({
      color: RIG_COLOR,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    })
    for (const bone of skeleton.bones) {
      if (bone.name === "ENDSITE") continue
      const joint = new THREE.Mesh(jointGeometry, jointMaterial)
      joint.frustumCulled = false
      bone.add(joint)
    }

    scene.add(group)
    group.updateMatrixWorld(true)
    helper.updateMatrixWorld(true)

    const vFov = (camera.fov * Math.PI) / 180
    const distance =
      Math.max(
        (bounds.y / 2) / Math.tan(vFov / 2),
        (bounds.x / 2) / Math.tan(vFov / 2)
      ) * 1.25
    camera.position.set(center.x, center.y, center.z + distance)
    camera.near = Math.max(distance / 1000, 0.001)
    camera.far = distance * 100
    camera.lookAt(center)
    camera.updateProjectionMatrix()

    renderer.render(scene, camera)
    const dataUrl = renderer.domElement.toDataURL("image/png")

    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error("Could not decode the BVH thumbnail"))
      img.src = dataUrl
    })
  } finally {
    scene.remove(group)
    group.traverse((object) => {
      const mesh = object as THREE.Mesh
      mesh.geometry?.dispose?.()
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose?.())
      else material?.dispose?.()
    })
    renderer.dispose()
  }
}
