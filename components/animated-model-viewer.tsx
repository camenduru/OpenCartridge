"use client"

import { useEffect, useRef, useState, type CSSProperties, type MutableRefObject } from "react"
import { Pause, Play } from "lucide-react"

// Generated GLBs face -Z; model-viewer's default orbit looks from +Z, at the
// back. Start on the -Z side so the model opens front-first.
const FRONT_CAMERA_ORBIT = "180deg 75deg auto"

interface AnimatedModelViewerProps {
  src: string
  alt?: string
  cameraOrbit?: string
  style?: CSSProperties
  /** Receives the <model-viewer> element, e.g. for toBlob() capture. */
  viewerRef?: MutableRefObject<any>
  onError?: (event: Event) => void
  /** Show the floating bottom-left Play/Pause pill (default true). */
  showControls?: boolean
  /** Reports animation availability and playback state, for a parent toolbar. */
  onPlaybackChange?: (state: { animations: number; paused: boolean }) => void
}

/**
 * model-viewer with an explicit play/pause control.
 *
 * Animation playback is never started automatically: the result opens on its
 * first frame and waits for the button, so a static thumbnail and a moving
 * model cannot be confused. Models without an animation show no button.
 */
export function AnimatedModelViewer({
  src,
  alt = "3D model",
  cameraOrbit = FRONT_CAMERA_ORBIT,
  style,
  viewerRef,
  onError,
  showControls = true,
  onPlaybackChange,
}: AnimatedModelViewerProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [animationCount, setAnimationCount] = useState(0)
  const [paused, setPaused] = useState(true)

  // Keep the latest callbacks without remounting the viewer when a parent
  // re-renders with a fresh inline arrow.
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const onPlaybackChangeRef = useRef(onPlaybackChange)
  onPlaybackChangeRef.current = onPlaybackChange

  useEffect(() => {
    let cancelled = false
    let viewer: any = null

    setStatus("loading")
    setAnimationCount(0)
    setPaused(true)

    const mount = async () => {
      await import("@google/model-viewer")
      if (cancelled || !stageRef.current) return

      viewer = document.createElement("model-viewer")
      viewer.setAttribute("src", src)
      viewer.setAttribute("alt", alt)
      viewer.setAttribute("camera-controls", "")
      viewer.setAttribute("auto-rotate", "")
      viewer.setAttribute("camera-orbit", cameraOrbit)
      viewer.style.width = "100%"
      viewer.style.height = "100%"
      viewer.style.display = "block"
      viewer.style.backgroundColor = "transparent"
      if (viewerRef) viewerRef.current = viewer

      viewer.addEventListener("load", () => {
        if (cancelled || !viewer) return
        const animations = Array.isArray(viewer.availableAnimations)
          ? viewer.availableAnimations.length
          : 0
        setAnimationCount(animations)
        setStatus("ready")
        if (animations > 0) {
          // The whole point: never start on its own.
          viewer.pause()
        }
        setPaused(true)
        onPlaybackChangeRef.current?.({ animations, paused: true })
      })
      viewer.addEventListener("error", (event: Event) => {
        if (cancelled) return
        setStatus("error")
        onErrorRef.current?.(event)
      })

      stageRef.current.appendChild(viewer)
    }

    void mount()

    return () => {
      cancelled = true
      if (viewer) {
        viewer.remove()
        if (viewerRef && viewerRef.current === viewer) viewerRef.current = null
      }
    }
  }, [src, alt, cameraOrbit, viewerRef])

  const togglePlayback = () => {
    const viewer =
      viewerRef?.current ?? stageRef.current?.querySelector("model-viewer")
    if (!viewer || animationCount === 0) return

    if (viewer.paused) {
      viewer.play()
      setPaused(false)
      onPlaybackChangeRef.current?.({ animations: animationCount, paused: false })
    } else {
      viewer.pause()
      setPaused(true)
      onPlaybackChangeRef.current?.({ animations: animationCount, paused: true })
    }
  }

  return (
    <div className="relative overflow-hidden" style={style}>
      {/* model-viewer is created imperatively so the playback API is available
          even though the package is imported client-side only. */}
      <div ref={stageRef} className="absolute inset-0" />

      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          Loading 3D viewer…
        </div>
      )}
      {status === "error" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          Could not load the model
        </div>
      )}

      {showControls && status === "ready" && animationCount > 0 && (
        <button
          type="button"
          onClick={togglePlayback}
          title={paused ? "Play animation" : "Pause animation"}
          aria-label={paused ? "Play animation" : "Pause animation"}
          aria-pressed={!paused}
          className="absolute bottom-3 left-3 z-10 flex h-9 items-center gap-1.5 rounded-full bg-black/70 px-3 text-xs font-medium text-white shadow-lg backdrop-blur transition hover:bg-black/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          {paused ? (
            <Play className="h-3.5 w-3.5" />
          ) : (
            <Pause className="h-3.5 w-3.5" />
          )}
          {paused ? "Play" : "Pause"}
        </button>
      )}
    </div>
  )
}
