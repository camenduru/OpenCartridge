"use client"

import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm"

/**
 * Render a VRM avatar to a square PNG thumbnail.
 *
 * model-viewer can only show the base glTF of a VRM: the avatar's MToon
 * materials, its spring bones and (for VRM 0.x) its orientation are all
 * ignored, which is why a canvas layer used to fall back to a generic
 * "3D File" box. This renders the avatar through three-vrm exactly the way
 * the VRM viewer does, on an offscreen canvas, and returns an <img> so the
 * existing crop/size code can treat it like a model-viewer capture.
 */
export async function renderVrmThumbnail(url: string, size = 512): Promise<HTMLImageElement> {
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
  scene.add(new THREE.AmbientLight(0xffffff, 1.6))
  const key = new THREE.DirectionalLight(0xffffff, 2.2)
  key.position.set(1.5, 3, 2.5)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0xffffff, 0.8)
  fill.position.set(-2, 1.5, -1.5)
  scene.add(fill)

  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000)

  const loader = new GLTFLoader()
  loader.register((parser) => new VRMLoaderPlugin(parser))

  let vrm: VRM | null = null
  try {
    const gltf = await loader.loadAsync(url)
    vrm = (gltf.userData.vrm as VRM | undefined) ?? null
    if (!vrm) throw new Error("This file is not a VRM avatar")

    // VRM 0.x faces the opposite way; match it to VRM 1.0.
    if (vrm.meta?.metaVersion === "0") VRMUtils.rotateVRM0(vrm)
    vrm.scene.traverse((object) => {
      object.frustumCulled = false
    })
    scene.add(vrm.scene)
    vrm.update(0)
    vrm.scene.updateMatrixWorld(true)

    const box = new THREE.Box3().setFromObject(vrm.scene)
    const bounds = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())

    // Derive the front from the feet-to-toes direction, so both VRM generations
    // are photographed face-first instead of from behind.
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
      forward = rightFoot.clone().sub(leftFoot).cross(new THREE.Vector3(0, 1, 0))
    }
    forward.y = 0
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, 1)
    forward.normalize()

    const vFov = (camera.fov * Math.PI) / 180
    const distance =
      Math.max(
        (bounds.y / 2) / Math.tan(vFov / 2),
        (bounds.x / 2) / Math.tan(vFov / 2)
      ) * 1.15
    camera.position.copy(center).addScaledVector(forward, distance)
    camera.position.y = center.y + bounds.y * 0.02
    camera.near = Math.max(distance / 1000, 0.001)
    camera.far = distance * 100
    camera.lookAt(center)
    camera.updateProjectionMatrix()

    renderer.render(scene, camera)
    const dataUrl = renderer.domElement.toDataURL("image/png")

    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error("Could not decode the VRM thumbnail"))
      img.src = dataUrl
    })
  } finally {
    if (vrm) {
      scene.remove(vrm.scene)
      VRMUtils.deepDispose(vrm.scene)
    }
    renderer.dispose()
  }
}
