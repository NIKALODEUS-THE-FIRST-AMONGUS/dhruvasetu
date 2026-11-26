import { useEffect, useRef, useState } from 'react'
import type { Drift } from '../lib/format'

const METRES_PER_MINUTE = 111_320 / 60
const GRID_STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5]
const SCALE_BARS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000]

interface ChartletProps {
  drift: Drift | null
  /** First position of the track: the origin the drift is measured from. */
  originLat: number | null
  originLon: number | null
  waterName: string
}

const minutesOf = (degrees: number) => {
  const absolute = Math.abs(degrees)
  return ((absolute - Math.floor(absolute)) * 60).toFixed(2).padStart(5, '0')
}

function useSize() {
  const element = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    if (!element.current) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height) })
    })
    observer.observe(element.current)
    return () => observer.disconnect()
  }, [])
  return [element, size] as const
}

/** A piece of chart around the buoy: graticule in minutes of arc, the drift track, a
 *  scale bar and north. Drawn by the page itself at the size of its panel, so the
 *  lettering stays sharp and no map server is needed. */
export function Chartlet({ drift, originLat, originLon, waterName }: ChartletProps) {
  const [element, { width, height }] = useSize()
  const ready = width > 120 && height > 120
  const hasFix = drift !== null && originLat !== null && originLon !== null

  let drawing = null
  if (ready && !hasFix) {
    drawing = (
      <text className="chartlet__text" x={width / 2} y={height / 2} textAnchor="middle">
        no fix
      </text>
    )
  } else if (ready && hasFix) {
    const plot = { left: 58, right: width - 18, top: 58, bottom: height - 26 }
    const centreX = (plot.left + plot.right) / 2
    const centreY = (plot.top + plot.bottom) / 2
    const east = drift.path.map((point) => point[0])
    const north = drift.path.map((point) => point[1])
    const spanEast = Math.max(Math.max(...east) - Math.min(...east), 40)
    const spanNorth = Math.max(Math.max(...north) - Math.min(...north), 40)
    const scale = Math.min((plot.right - plot.left) / (spanEast * 1.3), (plot.bottom - plot.top) / (spanNorth * 1.6))
    const midEast = (Math.max(...east) + Math.min(...east)) / 2
    const midNorth = (Math.max(...north) + Math.min(...north)) / 2
    const x = (metres: number) => centreX + (metres - midEast) * scale
    const y = (metres: number) => centreY - (metres - midNorth) * scale
    const eastScale = Math.cos((originLat * Math.PI) / 180)

    const gridLines = (origin: number, metresPerMinute: number, low: number, high: number, minPixels: number) => {
      const step = GRID_STEPS.find((minutes) => minutes * metresPerMinute * scale >= minPixels) ?? 5
      const first = Math.ceil((origin * 60 + low / metresPerMinute) / step)
      const last = Math.floor((origin * 60 + high / metresPerMinute) / step)
      return Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => {
        const minutes = (first + index) * step
        return { degrees: minutes / 60, metres: (minutes - origin * 60) * metresPerMinute }
      })
    }
    const parallels = gridLines(originLat, METRES_PER_MINUTE, midNorth - (plot.bottom - centreY) / scale, midNorth + (centreY - plot.top) / scale, 44)
    const meridians = gridLines(originLon, METRES_PER_MINUTE * eastScale, midEast - (centreX - plot.left) / scale, midEast + (plot.right - centreX) / scale, 84)
    const bar = SCALE_BARS.find((metres) => metres * scale >= 60) ?? 5000
    const track = drift.path.map(([e, n]) => `${x(e).toFixed(1)},${y(n).toFixed(1)}`).join(' ')
    const [startEast, startNorth] = drift.path[0]!
    const [nowEast, nowNorth] = drift.path[drift.path.length - 1]!

    drawing = (
      <>
        <rect className="chartlet__grid" x={plot.left} y={plot.top} width={plot.right - plot.left} height={plot.bottom - plot.top} fill="none" />
        {parallels.map((line) => (
          <g key={`lat${line.degrees}`}>
            <line className="chartlet__grid" x1={plot.left} x2={plot.right} y1={y(line.metres)} y2={y(line.metres)} />
            <text className="chartlet__text" x={plot.left - 7} y={y(line.metres) + 3.5} textAnchor="end">
              {minutesOf(line.degrees)}′
            </text>
          </g>
        ))}
        {meridians.map((line) => (
          <g key={`lon${line.degrees}`}>
            <line className="chartlet__grid" x1={x(line.metres)} x2={x(line.metres)} y1={plot.top} y2={plot.bottom} />
            <text className="chartlet__text" x={x(line.metres)} y={plot.bottom + 15} textAnchor="middle">
              {minutesOf(line.degrees)}′
            </text>
          </g>
        ))}
        <text className="chartlet__water" x={plot.left + 14} y={plot.bottom - 14}>
          {waterName}
        </text>
        <polyline className="chartlet__track" points={track} />
        <circle className="chartlet__ink" cx={x(startEast)} cy={y(startNorth)} r="3" />
        <circle className="chartlet__ink" cx={x(nowEast)} cy={y(nowNorth)} r="6.5" fill="var(--paper)" />
        <circle cx={x(nowEast)} cy={y(nowNorth)} r="2.4" fill="var(--magenta)" />
        <g transform={`translate(${plot.left + 24} ${plot.top + 30})`}>
          <path d="M0 -14 L3 -3 L14 0 L3 3 L0 14 L-3 3 L-14 0 L-3 -3 Z" className="chartlet__ink" fill="var(--paper)" />
          <path d="M0 -14 L3 -3 L-3 -3 Z" fill="var(--ink)" />
          <text className="chartlet__text" x="0" y="-18" textAnchor="middle">
            N
          </text>
        </g>
        <g transform={`translate(${plot.right - 12 - bar * scale} ${plot.bottom - 12})`}>
          <path className="chartlet__ink" d={`M0 -4 V0 H${(bar * scale).toFixed(1)} V-4`} />
          <text className="chartlet__text" x={(bar * scale) / 2} y="-7" textAnchor="middle">
            {bar} m
          </text>
        </g>
      </>
    )
  }

  return (
    <div ref={element} className="chartlet">
      {ready && (
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={hasFix ? `Drift track: ${drift.distanceM.toFixed(0)} metres from the first position shown.` : 'No position fix'}
        >
          {drawing}
        </svg>
      )}
    </div>
  )
}
