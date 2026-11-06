"use client"

import * as THREE from "three"
import { VRMHumanBoneParentMap } from "@pixiv/three-vrm"
import type { VRMAnimation } from "@pixiv/three-vrm-animation"

export function isVrmaUrl(url: string) {
  return /\.vrma(\?|#|$)/i.test(url)
}

/** The green the ExMR BVH viewer draws its skeleton in. */
export const RIG_COLOR = 0x4bf0b6

/**
 * A .vrma carries bone rotations and a hips height, never bone offsets or a
 * node hierarchy — the cartridge writes one flat node per humanoid bone — so a
 * bone-only preview needs a rig to hang the motion on. This is the canonical
 * VRM humanoid T-pose in metres: the animation drives it exactly as it drives
 * an avatar, because VRMA rotations are already in the normalized humanoid
 * space.
 */
export const RIG_TPOSE: Record<string, [number, number, number]> = {
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

export const HIPS_HEIGHT = RIG_TPOSE.hips[1]

for (const [name, [x, y, z]] of Object.entries(RIG_TPOSE)) {
  if (!name.startsWith("left")) continue
  RIG_TPOSE[`right${name.slice(4)}`] = [-x, y, z]
}

export interface HumanoidRig {
  rig: THREE.Group
  bones: Record<string, THREE.Bone>
}

/** Bones are named after the VRM humanoid, so track names resolve directly. */
export function buildHumanoidRig(): HumanoidRig {
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
export function createRigClip(animation: VRMAnimation): THREE.AnimationClip {
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
