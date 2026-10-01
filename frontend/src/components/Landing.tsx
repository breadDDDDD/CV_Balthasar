import { useRef, useState } from 'react'
import { motion, useMotionValue, useReducedMotion, useSpring } from 'motion/react'
import { FilePlus2, Upload } from 'lucide-react'

interface Props {
  busy: boolean
  error: string | null
  formats: string[]
  maxBytes: number
  onFile: (file: File) => void
  onBlank: () => void
}

// Line widths that read as a CV: a name, a contact line, then headed blocks.
const LINES = [38, 62, 0, 24, 88, 80, 84, 0, 28, 86, 74, 90, 66, 0, 22, 82, 70]

function Sheet({ depth, spread }: { depth: number; spread: boolean }) {
  return (
    <motion.div
      className="stack__sheet"
      animate={{
        z: depth * (spread ? 46 : 24),
        x: depth * (spread ? -26 : -12),
        y: depth * (spread ? -20 : -9),
        rotateZ: depth * (spread ? -5 : -2.5),
      }}
      transition={{ type: 'spring', bounce: 0.25, duration: 0.6 }}
    >
      {LINES.map((w, i) =>
        w === 0 ? <i key={i} className="gap" /> : <i key={i} style={{ width: `${w}%` }} className={i === 0 ? 'name' : w < 30 ? 'head' : ''} />,
      )}
    </motion.div>
  )
}

export function Landing({ busy, error, formats, maxBytes, onFile, onBlank }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const reduceMotion = useReducedMotion()
  const rx = useSpring(useMotionValue(54), { stiffness: 90, damping: 18 })
  const rz = useSpring(useMotionValue(-22), { stiffness: 90, damping: 18 })

  const onMove = (e: React.PointerEvent) => {
    if (reduceMotion || e.pointerType !== 'mouse') return
    rx.set(54 - (e.clientY / window.innerHeight - 0.5) * 14)
    rz.set(-22 + (e.clientX / window.innerWidth - 0.5) * 16)
  }

  const formatList = formats.map((f) => f.toUpperCase()).join(', ')

  return (
    <motion.main
      className={`landing ${over ? 'is-over' : ''}`}
      exit={{ opacity: 0, scale: 1.03 }}
      transition={{ duration: 0.28, ease: 'easeIn' }}
      onPointerMove={onMove}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const file = e.dataTransfer.files[0]
        if (file) onFile(file)
      }}
    >
      <div className="landing__copy">
        <p className="brand">Balthasar</p>
        <h1>Change one line of your CV. The rest of the page keeps up.</h1>
        <p className="landing__lede">
          Open the CV you already have. It is split into sections you can edit, reorder and hide, with the printed page
          beside you the whole time.
        </p>
        <div className="landing__actions">
          <button type="button" className="btn btn--primary btn--large" disabled={busy} onClick={() => inputRef.current?.click()}>
            <Upload size={18} /> {busy ? 'Reading your CV' : 'Open a CV'}
          </button>
          <button type="button" className="btn btn--quiet btn--large" disabled={busy} onClick={onBlank}>
            <FilePlus2 size={18} /> Start from a blank page
          </button>
        </div>
        <p className="landing__fine">
          Or drop a file anywhere. {formatList}, up to {Math.round(maxBytes / 1048576)} MB. The file is read and thrown
          away; your CV stays in this browser tab.
        </p>
        {error && (
          <p className="landing__error" role="alert">
            {error}
          </p>
        )}
        <input
          ref={inputRef}
          type="file"
          hidden
          accept={formats.map((f) => `.${f}`).join(',')}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onFile(file)
            e.target.value = ''
          }}
        />
      </div>

      <div className="stack" aria-hidden="true">
        <motion.div className={`stack__tilt ${busy ? 'is-busy' : ''}`} style={{ rotateX: rx, rotateZ: rz }}>
          <Sheet depth={0} spread={over || busy} />
          <Sheet depth={1} spread={over || busy} />
          <Sheet depth={2} spread={over || busy} />
        </motion.div>
      </div>
    </motion.main>
  )
}
