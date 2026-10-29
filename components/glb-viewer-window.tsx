"use client"

import React, { useRef, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/button'
import { X, Minus, Maximize2, Camera } from 'lucide-react'

// Dynamically import model-viewer to avoid SSR issues
const ModelViewer = dynamic(() => import('@google/model-viewer').then(() => {
  // Return a component that renders the model-viewer
  return ({ children, ...props }: any) => {
    // Use React.createElement to avoid TypeScript issues
    return React.createElement('model-viewer', props, children)
  }
}), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center h-full text-sm text-muted-foreground">Loading 3D viewer...</div>
})

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
  const [isLoading, setIsLoading] = useState(true)

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

  // Handle model load event
  useEffect(() => {
    if (viewerRef.current) {
      const handleProgress = (e: any) => {
        if (e.detail?.totalProgress === 1) {
          setIsLoading(false)
        }
      }
      const handleLoad = () => setIsLoading(false)
      viewerRef.current.addEventListener('progress', handleProgress)
      viewerRef.current.addEventListener('load', handleLoad)
      return () => {
        if (viewerRef.current) {
          viewerRef.current.removeEventListener('progress', handleProgress)
          viewerRef.current.removeEventListener('load', handleLoad)
        }
      }
    }
  }, [])

  // Fallback: hide progress bar after 3 seconds
  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 3000)
    return () => clearTimeout(timer)
  }, [])


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
    if (!viewerRef.current || !onCapture) return

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
            <ModelViewer
              ref={viewerRef}
              src={glbUrl}
              alt="3D Model"
              camera-controls
              auto-rotate
              style={{
                width: '100%',
                height: '100%',
                backgroundColor: 'transparent'
              }}
              onError={(e: Event) => {
                console.error('Model viewer error:', e)
                setError('Failed to load GLB file')
              }}
            >
              {isLoading && (
                <div slot="progress-bar" className="w-full h-1 bg-muted rounded">
                  <div className="h-full bg-primary rounded animate-pulse"></div>
                </div>
              )}
            </ModelViewer>
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