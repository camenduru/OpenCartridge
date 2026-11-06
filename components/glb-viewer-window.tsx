"use client"

import React, { useRef, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/button'
import { X, Minus, Maximize2, Camera, Bone, Play, Pause } from 'lucide-react'
import type { GLBRigCanvasHandle, RigStatus } from './glb-rig-canvas'
import { AnimatedModelViewer } from './animated-model-viewer'

// three.js is client-only (it touches `window` when a renderer is constructed),
// so the rig canvas never participates in the server render.
const RigCanvas = dynamic(
  () => import('./glb-rig-canvas').then((mod) => mod.GLBRigCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">Loading rig viewer…</div>
    ),
  }
) as any

// three-vrm is client-only (WebGL + DOM), so the VRM viewer never renders on
// the server.
const VRMViewer = dynamic(
  () => import('./vrm-viewer').then((mod) => mod.VRMViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">Loading VRM viewer…</div>
    ),
  }
) as any

interface GLBViewerWindowProps {
  glbUrl: string
  title: string
  onClose: () => void
  onCapture?: (imageDataUrl: string) => void
  initialPosition?: { x: number; y: number }
  initialSize?: { width: number; height: number }
}

export function GLBViewerWindow({
  glbUrl,
  title,
  onClose,
  onCapture,
  initialPosition = { x: 100, y: 100 },
  initialSize = { width: 600, height: 500 }
}: GLBViewerWindowProps) {
  const viewerRef = useRef<any>(null)
  const vrmRef = useRef<{ capture: () => string | null } | null>(null)
  const rigRef = useRef<GLBRigCanvasHandle | null>(null)
  const isVrm =
    /\.vrm(\?|#|$)/i.test(glbUrl) || /\.vrm(\?|#|$)/i.test(title)
  // A .vrma is an animation with no mesh at all; the VRM viewer draws it as
  // bones, which is the only thing there is to show.
  const isVrma =
    /\.vrma(\?|#|$)/i.test(glbUrl) || /\.vrma(\?|#|$)/i.test(title)

  // Bone overlay: off by default — the shaded model is what most people want,
  // and the rig view swaps the renderer rather than layering over it.
  const [showBones, setShowBones] = useState(false)
  const [rigStatus, setRigStatus] = useState<RigStatus | null>(null)
  // Animation availability comes from the loaded GLB; the header button owns
  // playback in this window, so the viewer's floating pill is hidden.
  const [playback, setPlayback] = useState<{ animations: number; paused: boolean }>({
    animations: 0,
    paused: true,
  })

  // Window state
  const [position, setPosition] = useState(initialPosition)
  const [size, setSize] = useState(initialSize)
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [isMinimized, setIsMinimized] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)
  const [originalSize, setOriginalSize] = useState(initialSize)
  const [originalPosition, setOriginalPosition] = useState(initialPosition)

  const [error, setError] = useState<string | null>(null)

  // Update position and size when props change
  useEffect(() => {
    setPosition(initialPosition)
    setSize(initialSize)
    setOriginalSize(initialSize)
  }, [initialPosition, initialSize])



  // Handle window dragging
  const handleWindowMouseDown = (e: React.MouseEvent) => {
    if ((e.target as Element).closest('button')) return // Don't drag if clicking on buttons
    setIsDragging(true)
    setDragStart({
      x: e.clientX - position.x,
      y: e.clientY - position.y
    })
  }

  // Handle window resizing
  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
    setDragStart({
      x: e.clientX - size.width,
      y: e.clientY - size.height
    })
  }

  // Global mouse move and up handlers for dragging and resizing
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        setPosition({
          x: e.clientX - dragStart.x,
          y: e.clientY - dragStart.y
        })
      } else if (isResizing) {
        const newWidth = Math.max(300, e.clientX - dragStart.x)
        const newHeight = Math.max(200, e.clientY - dragStart.y)
        setSize({ width: newWidth, height: newHeight })
      }
    }

    const handleGlobalMouseUp = () => {
      setIsDragging(false)
      setIsResizing(false)
    }

    if (isDragging || isResizing) {
      document.addEventListener('mousemove', handleGlobalMouseMove)
      document.addEventListener('mouseup', handleGlobalMouseUp)
    }

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove)
      document.removeEventListener('mouseup', handleGlobalMouseUp)
    }
  }, [isDragging, isResizing, dragStart])


  const toggleMinimize = () => {
    setIsMinimized(!isMinimized)
  }

  const toggleMaximize = () => {
    if (isMaximized) {
      setPosition(originalPosition)
      setSize(originalSize)
      setIsMaximized(false)
    } else {
      setOriginalPosition(position)
      setOriginalSize(size)
      // Maximize to canvas area
      const canvas = document.querySelector('canvas')
      if (canvas) {
        const rect = canvas.getBoundingClientRect()
        setPosition({ x: rect.left, y: rect.top })
        setSize({ width: rect.width, height: rect.height })
      } else {
        // Fallback to window size
        setPosition({ x: 0, y: 0 })
        setSize({ width: window.innerWidth, height: window.innerHeight })
      }
      setIsMaximized(true)
    }
  }

  const handleCapture = async () => {
    if (!onCapture) return

    // The rig view is our own WebGL canvas — model-viewer's toBlob does not
    // exist here, so read the renderer's buffer instead.
    if (showBones && !isVrma) {
      const dataUrl = rigRef.current?.capture()
      if (dataUrl) onCapture(dataUrl)
      return
    }

    if (isVrm || isVrma) {
      const dataUrl = vrmRef.current?.capture()
      if (dataUrl) onCapture(dataUrl)
      return
    }

    if (!viewerRef.current) return

    try {
      // Use model-viewer's toBlob method to capture with transparency
      const blob = await viewerRef.current.toBlob({
        mimeType: 'image/png',
        idealAspect: true
      })

      if (blob) {
        const reader = new FileReader()
        reader.onload = () => {
          const imageDataUrl = reader.result as string
          onCapture(imageDataUrl)
        }
        reader.readAsDataURL(blob)
      }
    } catch (error) {
      console.error('Failed to capture GLB view:', error)
    }
  }

  const togglePlayback = () => {
    const viewer = viewerRef.current
    if (!viewer || playback.animations === 0 || showBones) return

    if (viewer.paused) {
      viewer.play()
      setPlayback({ animations: playback.animations, paused: false })
    } else {
      viewer.pause()
      setPlayback({ animations: playback.animations, paused: true })
    }
  }

  if (error) {
    return (
      <div
        className="fixed bg-red-100/90 dark:bg-red-900/90 backdrop-blur-sm border border-red-300 dark:border-red-600 rounded-lg shadow-lg z-50"
        style={{
          left: `${position.x}px`,
          top: `${position.y}px`,
          width: `${size.width}px`,
          minHeight: '150px'
        }}
      >
        <div className="flex items-center justify-between p-2 bg-red-200/90 dark:bg-red-800/90 backdrop-blur-sm rounded-t-lg cursor-move">
          <span className="text-sm font-medium text-red-800 dark:text-red-200">GLB Viewer Error</span>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-6 w-6 p-0">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="p-4">
          <p className="text-red-700 dark:text-red-300">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed bg-transparent border border-gray-300 dark:border-gray-600 rounded-lg shadow-xl z-50 overflow-hidden"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${size.width}px`,
        height: isMinimized ? '40px' : `${size.height}px`
      }}
    >
      {/* Title Bar */}
      <div
        className="flex items-center justify-between p-2 bg-gray-100/90 dark:bg-[#323232]/90 backdrop-blur-sm border-b border-gray-300 dark:border-gray-600 cursor-move select-none"
        onMouseDown={handleWindowMouseDown}
      >
        <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{title}</span>
        <div className="flex items-center gap-1">
          {playback.animations > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={togglePlayback}
              disabled={showBones}
              className={`h-6 w-6 p-0 ${!showBones && !playback.paused ? 'bg-primary/15 text-primary' : ''}`}
              title={
                showBones
                  ? 'Switch off the bones view to play the animation'
                  : playback.paused
                    ? 'Play animation'
                    : 'Pause animation'
              }
              aria-label={playback.paused ? 'Play animation' : 'Pause animation'}
              aria-pressed={!playback.paused}
            >
              {playback.paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            </Button>
          )}
          {!isVrma && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowBones((value) => !value)}
              className={`h-6 w-6 p-0 ${showBones ? 'bg-primary/15 text-primary' : ''}`}
              title={showBones ? 'Hide bones' : 'Show bones'}
              aria-pressed={showBones}
            >
              <Bone className="h-3 w-3" />
            </Button>
          )}
          {onCapture && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCapture}
              className="h-6 w-6 p-0"
              title="Capture Image"
            >
              <Camera className="h-3 w-3" />
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={toggleMinimize} className="h-6 w-6 p-0">
            <Minus className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="sm" onClick={toggleMaximize} className="h-6 w-6 p-0">
            <Maximize2 className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-6 w-6 p-0 hover:bg-red-100 dark:hover:bg-red-900">
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Content */}
      {!isMinimized && (
        <>
          <div className="flex-1 relative" style={{ height: `${size.height - 40}px` }}>
            {/* Playback is explicit: the result opens on frame 0 and the
                Play/Pause button lives in the viewer's bottom-left corner. */}
            {showBones && !isVrma ? (
              <RigCanvas ref={rigRef} glbUrl={glbUrl} onStatus={setRigStatus} />
            ) : isVrm || isVrma ? (
              <VRMViewer
                ref={vrmRef}
                url={glbUrl}
                style={{ width: '100%', height: '100%' }}
              />
            ) : (
              <AnimatedModelViewer
                src={glbUrl}
                alt="3D Model"
                viewerRef={viewerRef}
                style={{ width: '100%', height: '100%' }}
                showControls={false}
                onPlaybackChange={setPlayback}
                onError={(e: Event) => {
                  console.error('Model viewer error:', e)
                  setError('Failed to load GLB file')
                }}
              />
            )}

            {/* What the rig view found — a rigged GLB that came back without
                bones looks identical to a rigged one until you ask. */}
            {showBones && rigStatus && (
              <div className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] leading-tight text-white">
                {rigStatus.state === 'loading' && 'Loading rig…'}
                {rigStatus.state === 'error' && (rigStatus.message || 'Could not load the model')}
                {rigStatus.state === 'no-rig' && 'No skeleton in this model'}
                {rigStatus.state === 'ready' && `${rigStatus.bones} bones`}
              </div>
            )}
          </div>

          {/* Resize Handle */}
          <div
            className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
            onMouseDown={handleResizeMouseDown}
          >
            <div className="w-full h-full bg-gray-300 dark:bg-gray-600 rounded-tl"></div>
          </div>
        </>
      )}
    </div>
  )
}