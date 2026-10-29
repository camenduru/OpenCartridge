"use client"

import React, { useEffect, useRef } from 'react'
import WaveSurfer from 'wavesurfer.js'

interface WaveformOverlayProps {
  audioUrl: string
  width: number
  height: number
  layerId: string
  currentTime?: number
  duration?: number
  onSeek?: (time: number) => void
  onReady?: () => void
}

export const WaveformOverlay: React.FC<WaveformOverlayProps> = ({
  audioUrl,
  width,
  height,
  layerId,
  currentTime = 0,
  duration = 0,
  onSeek,
  onReady
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const wavesurferRef = useRef<WaveSurfer | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#9fd7ffff',
      progressColor: '#2196f3',
      cursorColor: '#1976d2',
      barWidth: 2,
      barRadius: 1,
      height: height,
      normalize: true,
      interact: true, // Enable interaction for seeking
    })

    wavesurferRef.current = ws

    // Ensure pointer events pass through
    if (containerRef.current) {
      containerRef.current.style.pointerEvents = 'none'
    }

    ws.load(audioUrl)

    ws.on('ready', () => {
      // Seek to current time after loading
      if (duration > 0 && currentTime > 0) {
        const progress = currentTime / duration
        ws.seekTo(progress)
      }
      onReady?.()
    })

    ws.on('seek' as any, (progress: number) => {
      if (onSeek && duration > 0) {
        const time = progress * duration
        onSeek(time)
      }
    })

    return () => {
      ws.destroy()
    }
  }, [audioUrl, height, onReady])

  // Update cursor position when currentTime changes
  useEffect(() => {
    if (wavesurferRef.current && duration > 0) {
      const progress = currentTime / duration
      wavesurferRef.current.seekTo(progress)
    }
  }, [currentTime, duration])


  return (
    <div
      ref={containerRef}
      data-layer-id={layerId}
      style={{
        width: '100%',
        height: '100%',
        borderRadius: '4px',
        overflow: 'hidden',
        pointerEvents: 'none'
      }}
    />
  )
}