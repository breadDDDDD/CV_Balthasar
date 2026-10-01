import { useId } from 'react'

export type MascotMood = 'idle' | 'thinking' | 'talking'

interface Props {
  mood?: MascotMood
  size?: number
  className?: string
}

const HAIR = '#4a2c36'
const HAIR_BACK = '#38202a'
const SKIN = '#fbe3d2'

/* Biel, the assistant. Drawn after Yuki Osanai (Shoshimin: How to Become Ordinary):
   chin-length brown bob with a blunt fringe, large rose eyes, sailor uniform. */
export function Mascot({ mood = 'idle', size = 64, className = '' }: Props) {
  const iris = useId()
  const eye = (cx: number, lid: string, lash: string) => (
    <g className="mascot__eye">
      <ellipse cx={cx} cy="72" rx="6.4" ry="7.8" fill={`url(#${iris})`} />
      <ellipse cx={cx} cy="73.5" rx="2.6" ry="3.6" fill="#4d0b2b" />
      <circle cx={cx - 2.4} cy="68.6" r="2.3" fill="#fff" />
      <circle cx={cx + 2.6} cy="76.4" r="1.1" fill="#fff" opacity=".85" />
      <path d={lid} stroke="#2b161d" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <path d={lash} stroke="#2b161d" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </g>
  )

  return (
    <svg
      className={`mascot mascot--${mood} ${className}`}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label="Biel, the CV assistant"
    >
      <defs>
        <linearGradient id={iris} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6d1038" />
          <stop offset=".55" stopColor="#c22a63" />
          <stop offset="1" stopColor="#ff7fa8" />
        </linearGradient>
      </defs>
      <g className="mascot__bob">
        {/* back of the bob, curving in at the chin */}
        <path
          d="M17 62C17 30 37 11 60 11s43 19 43 51c0 14-2 25-7 34-4 4-12 4-16 1H40c-4 3-12 3-16-1-5-9-7-20-7-34z"
          fill={HAIR_BACK}
        />
        {/* uniform */}
        <path d="M24 120c2-13 14-20 36-20s34 7 36 20z" fill="#1c2048" />
        <path d="M53 90h14v12l-7 9-7-9z" fill="#eecbb7" />
        <path d="M46 99l14 15 14-15 12 6-9 15H43l-9-15z" fill="#2a2f66" />
        <path d="M41 103.5 55 120M79 103.5 65 120" stroke="#ecdfd2" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <path d="M54.5 111l5.5 4 5.5-4v9l-5.5-3.5-5.5 3.5z" fill="#c0304a" />
        {/* face */}
        <path d="M34 56h52c0 22-10 37-26 37S34 78 34 56z" fill={SKIN} />
        <path d="M34 56h52v8c-16-5-36-5-52 0z" fill="#e7bfab" opacity=".75" />
        <ellipse cx="42.5" cy="80" rx="4.6" ry="2.6" fill="#e8718f" opacity=".3" />
        <ellipse cx="77.5" cy="80" rx="4.6" ry="2.6" fill="#e8718f" opacity=".3" />
        {/* eyes */}
        <g className="mascot__eyes">
          {eye(47, 'M39 67.5c4-4.6 11.5-5.4 16.5-1.2', 'M39 67.5l-2.4-1.6')}
          {eye(73, 'M64.5 66.3c5-4.2 12.500-3.400 16.500 1.200', 'M81 67.500l2.400-1.600')}
        </g>
        <path d="M59.600 80.500l.9 1.300" stroke="#d9a590" strokeWidth="1.400" strokeLinecap="round" />
        {/* mouth */}
        <path className="mascot__smile" d="M55.500 85.500q4.500 2.800 9 0" stroke="#8a3f46" strokeWidth="1.800" fill="none" strokeLinecap="round" />
        <ellipse className="mascot__talk" cx="60" cy="86.500" rx="3" ry="2.600" fill="#8a3f46" />
        {/* blunt fringe and the locks that frame the face */}
        <path
          d="M31 64C31 38 44 23 60 23s29 15 29 41c0 9-1 18-3 26-1-9-1-19-3-27l-4-4-4 4-5-4-4 4-6-4-6 4-4-4-5 4-4-4-4 4c-2 8-2 18-3 27-2-8-3-17-3-26z"
          fill={HAIR}
        />
        <path d="M39 37c11-8 31-8 42 0" stroke="#7d5562" strokeWidth="3" fill="none" strokeLinecap="round" opacity=".7" />
        <path d="M50 33v24M70 33v24M60 30v27" stroke={HAIR_BACK} strokeWidth="1" fill="none" strokeLinecap="round" opacity=".55" />
      </g>
      <g className="mascot__dots" fill="#ecdfd2">
        <circle cx="100" cy="18" r="3" />
        <circle cx="108" cy="10" r="2.300" />
        <circle cx="114" cy="3" r="1.600" />
      </g>
    </svg>
  )
}
