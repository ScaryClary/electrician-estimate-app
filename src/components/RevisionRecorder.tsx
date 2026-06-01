import { useEffect, useRef, useState } from 'react'

interface RevisionRecorderProps {
  onRevisionReady: (audio: Blob) => void
  onRevisionText: (text: string) => void
  onCancel: () => void
  isProcessing: boolean
}

function formatTime(s: number) {
  const m = Math.floor(s / 60)
  return `${m}:${(s % 60).toString().padStart(2, '0')}`
}

type Tab = 'audio' | 'text'
type RecordState = 'idle' | 'recording' | 'recorded'

export function RevisionRecorder({ onRevisionReady, onRevisionText, onCancel, isProcessing }: RevisionRecorderProps) {
  const [tab, setTab] = useState<Tab>('audio')
  const [recordState, setRecordState] = useState<RecordState>('idle')
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [revisionText, setRevisionText] = useState('')

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const blobRef = useRef<Blob | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animFrameRef = useRef<number>(0)
  const analyserRef = useRef<AnalyserNode | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      cancelAnimationFrame(animFrameRef.current)
    }
  }, [])

  function drawWaveform() {
    const canvas = canvasRef.current
    const analyser = analyserRef.current
    if (!canvas || !analyser) return
    const ctx = canvas.getContext('2d')!
    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)
    const c = canvas
    const a = analyser
    function draw() {
      animFrameRef.current = requestAnimationFrame(draw)
      a.getByteTimeDomainData(dataArray)
      ctx.fillStyle = '#1a1a2e'
      ctx.fillRect(0, 0, c.width, c.height)
      ctx.lineWidth = 2
      ctx.strokeStyle = '#e8a020'
      ctx.beginPath()
      const sliceWidth = c.width / bufferLength
      let x = 0
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0
        const y = (v * c.height) / 2
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
        x += sliceWidth
      }
      ctx.lineTo(c.width, c.height / 2)
      ctx.stroke()
    }
    draw()
  }

  async function startRecording() {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const audioCtx = new AudioContext()
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      analyserRef.current = analyser

      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        audioCtx.close()
        cancelAnimationFrame(animFrameRef.current)
        blobRef.current = new Blob(chunksRef.current, { type: 'audio/webm' })
        setRecordState('recorded')
      }
      recorder.start(250)
      recorderRef.current = recorder
      setRecordState('recording')
      setSeconds(0)
      timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000)
      setTimeout(drawWaveform, 100)
    } catch {
      setError('Microphone access denied. Please allow microphone access.')
    }
  }

  function stopRecording() {
    recorderRef.current?.stop()
    recorderRef.current = null
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }

  if (isProcessing) {
    return (
      <div className="revision-panel processing">
        <div className="spinner-large" />
        <p>Applying your revision…</p>
      </div>
    )
  }

  return (
    <div className="revision-panel">
      <div className="revision-header">
        <h3>Record a revision</h3>
        <p className="revision-hint">Describe what needs to change — hours, materials, new tasks, anything.</p>
      </div>

      <div className="tab-bar tab-bar-sm">
        <button className={`tab-btn ${tab === 'audio' ? 'active' : ''}`} onClick={() => setTab('audio')}>
          🎙 Voice
        </button>
        <button className={`tab-btn ${tab === 'text' ? 'active' : ''}`} onClick={() => setTab('text')}>
          ✏️ Type
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {tab === 'audio' && (
        <>
          {recordState === 'idle' && (
            <button className="btn-record-large" onClick={startRecording}>🎙 Start recording</button>
          )}
          {recordState === 'recording' && (
            <div className="recording-ui">
              <canvas ref={canvasRef} className="waveform-canvas" width={320} height={60} />
              <div className="recording-timer">{formatTime(seconds)}</div>
              <button className="btn-stop-large" onClick={stopRecording}>■ Stop recording</button>
            </div>
          )}
          {recordState === 'recorded' && (
            <div className="recorded-ui">
              <div className="recorded-check">✓ {formatTime(seconds)} recorded</div>
              <div className="recorded-actions">
                <button className="btn-primary" onClick={() => blobRef.current && onRevisionReady(blobRef.current)}>
                  Apply revision
                </button>
                <button className="btn-ghost" onClick={() => { setRecordState('idle'); setSeconds(0) }}>
                  Re-record
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'text' && (
        <div className="revision-text-section">
          <textarea
            className="job-textarea"
            placeholder={'e.g. "Change the panel labor to 6 hours instead of 4. Add a 50-amp circuit for the hot tub."'}
            value={revisionText}
            onChange={(e) => setRevisionText(e.target.value)}
            rows={5}
          />
          <button
            className="btn-primary"
            disabled={revisionText.trim().length < 5}
            onClick={() => onRevisionText(revisionText.trim())}
          >
            Apply revision
          </button>
        </div>
      )}

      <button className="btn-ghost cancel-revision" onClick={onCancel}>Cancel</button>
    </div>
  )
}
