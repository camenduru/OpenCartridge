"use client"

import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { VRMAnimationLoaderPlugin, type VRMAnimation } from "@pixiv/three-vrm-animation"
import { RIG_COLOR, buildHumanoidRig, createRigClip } from "./vrma-rig"

/**
 * Render a .vrma to a PNG thumbnail.
 *
 * A .vrma has no mesh, so model-viewer has nothing to draw and the canvas layer
 * used to fall back to a generic "3D File" box. This draws what the VRM viewer's
 * bones mode draws — the animation on a humanoid rig — one frame in, on an
 * offscreen canvas, and returns an <img> so the existing crop/size code can
 * treat it like any other capture.
 */
export async function renderVrmaThumbnail(url: string, size = 512): Promise<HTMLImageElement> {
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
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000)

  const loader = new GLTFLoader()
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser))

  const { rig, bones } = buildHumanoidRig()
  try {
    const gltf = await loader.loadAsync(url)
    const animation = (gltf.userData.vrmAnimations as VRMAnimation[] | undefined)?.[0]
    if (!animation) throw new Error("This file is not a VRM animation")

    // A frame into the clip says more about the motion than the T-pose at 0.
    const mixer = new THREE.AnimationMixer(rig)
    mixer.clipAction(createRigClip(animation)).play()
    mixer.update(Math.min(animation.duration * 0.35, 1))

    const helper = new THREE.SkeletonHelper(rig)
    const lineMaterial = helper.material as THREE.LineBasicMaterial
    lineMaterial.color = new THREE.Color(RIG_COLOR)
    lineMaterial.depthTest = false
    lineMaterial.depthWrite = false
    lineMaterial.transparent = true
    helper.renderOrder = 999
    rig.add(helper)

    const jointGeometry = new THREE.SphereGeometry(0.01, 8, 6)
    const jointMaterial = new THREE.MeshBasicMaterial({
      color: RIG_COLOR,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    })
    for (const bone of Object.values(bones)) {
      const joint = new THREE.Mesh(jointGeometry, jointMaterial)
      joint.frustumCulled = false
      bone.add(joint)
    }

    scene.add(rig)
    rig.updateMatrixWorld(true)
    helper.updateMatrixWorld(true)

    const box = new THREE.Box3()
    const point = new THREE.Vector3()
    for (const bone of Object.values(bones)) box.expandByPoint(bone.getWorldPosition(point))
    const bounds = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    if (bounds.lengthSq() < 1e-6) bounds.set(1, 1, 1)

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
      img.onerror = () => reject(new Error("Could not decode the VRMA thumbnail"))
      img.src = dataUrl
    })
  } finally {
    scene.remove(rig)
    rig.traverse((object) => {
      const mesh = object as THREE.Mesh
      mesh.geometry?.dispose?.()
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose?.())
      else material?.dispose?.()
    })
    renderer.dispose()
  }
}
