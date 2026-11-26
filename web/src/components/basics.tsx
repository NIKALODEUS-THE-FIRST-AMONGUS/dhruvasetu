import { motion, useMotionValueEvent, useReducedMotion, useSpring } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

/** The mark: the pole star (Dhruva) over a bridge (Setu) and the sea. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M24 3 L26.4 10.6 L34 13 L26.4 15.4 L24 23 L21.6 15.4 L14 13 L21.6 10.6 Z" fill="var(--magenta)" />
      <path d="M6 33 Q24 15 42 33" stroke="currentColor" />
      <path d="M6 33 V39 M42 33 V39" stroke="currentColor" />
      <path d="M4 43 q5 -4 10 0 t10 0 t10 0 t10 0" stroke="var(--sea)" />
    </svg>
  )
}

/** A numbered marker of the reading guide. Shown only while the guide is open. */
export function Step({ number, shown }: { number: number; shown: boolean }) {
  return shown ? (
    <span className="step" aria-label={`Step ${number} of the guide`}>
      {number}
    </span>
  ) : null
}

interface AnimatedNumberProps {
  value: number | null
  format: (value: number | null) => string
}

/** A number that eases to its new value instead of jumping. The digits are written
 *  straight into the page so that a new report does not re-render the tile around it. */
export function AnimatedNumber({ value, format }: AnimatedNumberProps) {
  const element = useRef<HTMLSpanElement>(null)
  const formatter = useRef(format)
  const [firstText] = useState(() => format(value))
  const still = useReducedMotion()
  const spring = useSpring(value ?? 0, { stiffness: 140, damping: 24, mass: 0.8 })

  useEffect(() => {
    formatter.current = format
  }, [format])

  useEffect(() => {
    if (value === null) {
      if (element.current) element.current.textContent = formatter.current(null)
    } else if (still) {
      spring.jump(value)
      if (element.current) element.current.textContent = formatter.current(value)
    } else {
      spring.set(value)
    }
  }, [value, still, spring])

  useMotionValueEvent(spring, 'change', (current) => {
    if (element.current && value !== null) element.current.textContent = formatter.current(current)
  })

  return <span ref={element}>{firstText}</span>
}

const SPARK_WIDTH = 240
const SPARK_HEIGHT = 44
const SPARK_POINTS = 60
const SPARK_PAD = 5

/** A small curve of recent values. The width is always sixty reports: with fewer, the curve
 *  starts further right and the room before it stays empty, because nothing was measured
 *  there. The path keeps the same number of points all the same, so one curve can ease into
 *  the next when a report arrives: the points it has too many of lie on its first value. */
export function Sparkline({ values, label, minSpan = 0 }: { values: readonly number[]; label: string; minSpan?: number }) {
  if (values.length < 2) {
    return <svg className="spark" role="img" aria-label={`${label}: not enough reports yet`} />
  }
  const tail = values.slice(-SPARK_POINTS)
  const empty = SPARK_POINTS - tail.length
  // Never zoom in further than `minSpan`: sensor noise must not look like weather.
  const least = Math.min(...tail)
  const most = Math.max(...tail)
  const span = Math.max(most - least, minSpan) || 1
  const low = (least + most) / 2 - span / 2
  const x = (index: number) => (Math.max(index, empty) / (SPARK_POINTS - 1)) * SPARK_WIDTH
  const y = (value: number) => SPARK_HEIGHT - SPARK_PAD - ((value - low) / span) * (SPARK_HEIGHT - 2 * SPARK_PAD)
  const line = Array.from({ length: SPARK_POINTS }, (_, index) => {
    const value = tail[Math.max(index - empty, 0)]!
    return `${index ? 'L' : 'M'}${x(index).toFixed(1)} ${y(value).toFixed(1)}`
  }).join(' ')
  const dot = `M${SPARK_WIDTH} ${y(tail[tail.length - 1]!).toFixed(1)} h0.01`
  const ease = { duration: 0.6, ease: [0.22, 0.8, 0.26, 1] as const }
  return (
    <svg className="spark" viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <path className="spark__base" d={`M0 ${SPARK_HEIGHT - 0.5} H${SPARK_WIDTH}`} />
      <motion.path className="spark__line" initial={false} animate={{ d: line }} transition={ease} />
      <motion.path className="spark__line" style={{ strokeWidth: 6.5 }} initial={false} animate={{ d: dot }} transition={ease} />
    </svg>
  )
}
