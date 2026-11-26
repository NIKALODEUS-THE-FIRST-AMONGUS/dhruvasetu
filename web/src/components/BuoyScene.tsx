import { AnimatePresence, motion, useAnimationFrame, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useRef } from 'react'
import type { BuoyState } from '../data/types'

const WIDTH = 400
const HEIGHT = 300
const SURFACE = 158
const CENTRE = 200
const WAVELENGTH = 560
const SCALE = 0.33 // pixels per millimetre of hull
const WATERLINE = 177 // mm above the keel plate: 10 mm below the ice belt, the tank target

/** Outline of hull H3, right half, as (radius, height) in millimetres from the Fusion
 *  model's parameters: keel can 220 x 80, 25 degree ice cone, belt 320 x 55, lid rising 90.
 *  The can and cone are joined by flanges that turn inward, so the outside has no step. */
const HALF_PROFILE: readonly (readonly [number, number])[] = [
  [104, 0], [110, 6], [110, 80], [160, 187.2], [160, 248.2], [146, 248.2], [60, 338.2],
]
const at = (radius: number, height: number) => `${(radius * SCALE).toFixed(1)} ${((WATERLINE - height) * SCALE).toFixed(1)}`
const HULL = `M${[...HALF_PROFILE.map(([r, z]) => at(r, z)), ...[...HALF_PROFILE].reverse().map(([r, z]) => at(-r, z))].join(' L')} Z`
const level = (height: number) => (WATERLINE - height) * SCALE
const MAST_TOP = level(450)

const ICE_FLOES = [
  'M18 -3 l40 -3 l12 5 l-34 5 l-20 -2 z', 'M84 -2 l38 -2 l8 5 l-40 3 z', 'M256 -3 l34 1 l10 4 l-36 4 l-12 -4 z',
  'M312 -2 l44 -3 l16 6 l-40 4 z', 'M134 -1 l22 -1 l-2 5 l-20 1 z', 'M246 -1 l-6 5 l-18 -1 l2 -4 z',
]

interface BuoySceneProps {
  waveHeightM: number | null
  wavePeriodS: number | null
  tiltDeg: number | null
  state: BuoyState
  /** Changes with every report: sends a ring out from the antenna. */
  pulse: number
}

/** The buoy riding the sea it reports. The swell passes at the measured period, its
 *  height follows the measured wave height and the hull leans by the measured tilt.
 *  Nothing here moves unless a measurement moves it. */
export function BuoyScene({ waveHeightM, wavePeriodS, tiltDeg, state, pulse }: BuoySceneProps) {
  const still = useReducedMotion()
  const sea = useRef<SVGPathElement>(null)
  const surface = useRef<SVGPathElement>(null)
  const buoy = useRef<SVGGElement>(null)
  const lastFrame = useRef(0)

  const frozen = state === 'ICE'
  const amplitude = frozen ? 1.2 : Math.min(20, Math.max(2.5, 4 + 5 * (waveHeightM ?? 0)))
  const period = Math.max(2, wavePeriodS ?? 8)
  const tilt = frozen ? 0 : tiltDeg ?? 0

  const draw = useCallback(
    (seconds: number) => {
      const k = (2 * Math.PI) / WAVELENGTH
      const omega = (2 * Math.PI) / period
      const height = (x: number) =>
        SURFACE + amplitude * Math.sin(k * x - omega * seconds) + 0.28 * amplitude * Math.sin(2.3 * k * x - 1.7 * omega * seconds + 1.3)
      let line = ''
      for (let x = 0; x <= WIDTH; x += 10) line += `${x ? 'L' : 'M'}${x} ${height(x).toFixed(1)} `
      surface.current?.setAttribute('d', line)
      sea.current?.setAttribute('d', `${line}L${WIDTH} ${HEIGHT} L0 ${HEIGHT} Z`)
      const slope =
        Math.cos(k * CENTRE - omega * seconds) + 0.644 * Math.cos(2.3 * k * CENTRE - 1.7 * omega * seconds + 1.3)
      const lean = (tilt * slope) / 1.644
      buoy.current?.setAttribute('transform', `translate(${CENTRE} ${height(CENTRE).toFixed(1)}) rotate(${lean.toFixed(2)})`)
    },
    [amplitude, period, tilt],
  )

  useEffect(() => {
    if (still) draw(0)
  }, [still, draw])

  useAnimationFrame((time) => {
    if (still || time - lastFrame.current < 33) return
    lastFrame.current = time
    draw(time / 1000)
  })

  return (
    <svg
      className="scene"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={
        frozen
          ? 'The buoy held still in ice.'
          : `The buoy riding a swell of ${(waveHeightM ?? 0).toFixed(1)} metres every ${period.toFixed(1)} seconds, leaning up to ${tilt.toFixed(0)} degrees.`
      }
    >
      <g ref={buoy} transform={`translate(${CENTRE} ${SURFACE})`}>
        <line className="scene__mast" x1="0" y1={level(338.2)} x2="0" y2={MAST_TOP} />
        <circle className="scene__metal" cx="0" cy={MAST_TOP} r="2" />
        <motion.circle
          key={pulse}
          className="scene__ping"
          cx="0"
          cy={MAST_TOP}
          initial={{ r: 3, opacity: 0.85 }}
          animate={{ r: 40, opacity: 0 }}
          transition={{ duration: 1.9, ease: 'easeOut' }}
        />
        {[-85 * SCALE, 0, 85 * SCALE].map((x) => (
          <rect key={x} className="scene__metal" x={x - 1.2} y={level(0)} width="2.4" height={65 * SCALE} />
        ))}
        <rect className="scene__metal" x={-100 * SCALE} y={level(-35)} width={200 * SCALE} height={18 * SCALE} />
        <path className="scene__hull" d={HULL} />
        <rect className="scene__belt" x={-160 * SCALE} y={level(242.2)} width={320 * SCALE} height={55 * SCALE} />
        <line className="scene__mast" style={{ strokeWidth: 0.8 }} x1={-110 * SCALE} y1={level(80)} x2={110 * SCALE} y2={level(80)} />
      </g>
      <path ref={sea} className="scene__sea" />
      <path ref={surface} className="scene__surface" />
      <AnimatePresence>
        {frozen && (
          <motion.g key="ice" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 1.2 }}>
            <g transform={`translate(0 ${SURFACE})`}>
              {ICE_FLOES.map((floe) => (
                <path key={floe} className="scene__ice" d={floe} />
              ))}
            </g>
          </motion.g>
        )}
      </AnimatePresence>
    </svg>
  )
}
