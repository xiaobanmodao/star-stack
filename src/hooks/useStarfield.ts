import { useEffect, useRef } from 'react'

export function useStarfield(lowPerformanceMode: boolean) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let stars: { x: number; y: number; r: number; alpha: number; color: string }[] = []
    let width = 0
    let height = 0

    const createStars = () => {
      const dpr = Math.max(window.devicePixelRatio || 1, 1)
      width = window.innerWidth
      height = window.innerHeight
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const count = lowPerformanceMode ? 90 : Math.max(160, Math.floor((width * height) / 9000))
      const palette = ['255, 255, 255', '196, 220, 255', '255, 236, 210']
      stars = Array.from({ length: count }, () => {
        const bright = Math.random() > 0.92
        const color = palette[Math.floor(Math.random() * palette.length)]
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          r: bright ? Math.random() * 1.4 + 0.6 : Math.random() * 0.9 + 0.25,
          alpha: bright ? Math.random() * 0.5 + 0.3 : Math.random() * 0.3 + 0.1,
          color,
        }
      })
    }

    const draw = () => {
      ctx.clearRect(0, 0, width, height)
      for (const star of stars) {
        ctx.beginPath()
        ctx.fillStyle = `rgba(${star.color}, ${star.alpha})`
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    createStars()
    draw()

    const handleResize = () => {
      createStars()
      draw()
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [lowPerformanceMode])

  return canvasRef
}
