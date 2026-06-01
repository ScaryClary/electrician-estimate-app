import { useRef, useState } from 'react'

interface AudioUploadProps {
  onFileReady: (file: File) => void
  onTextReady: (text: string) => void
}

const ACCEPTED_TYPES = '.m4a,.mp3,.wav,.mp4,.ogg,.webm,.aac,.flac'
const ACCEPTED_MIME = [
  'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg', 'audio/webm',
  'audio/aac', 'audio/flac', 'video/mp4', 'audio/x-m4a',
]

const EXAMPLE_JOB = `Replace the 100-amp main panel with a new 200-amp panel. Run two new 20-amp circuits about 40 feet to the garage. Install GFCI outlets in both bathrooms and the kitchen. Customer also wants a dedicated 30-amp circuit for a hot tub on the back patio, about 60 feet from the panel.`

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

type Tab = 'upload' | 'text'

export function AudioUpload({ onFileReady, onTextReady }: AudioUploadProps) {
  const [tab, setTab] = useState<Tab>('upload')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [jobText, setJobText] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function handleFile(file: File) {
    setError(null)
    const isValid = ACCEPTED_MIME.some(t => file.type === t) || file.name.match(/\.(m4a|mp3|wav|mp4|ogg|webm|aac|flac)$/i)
    if (!isValid) {
      setError('Unsupported file type. Please upload an audio or video file.')
      return
    }
    setSelectedFile(file)
    const url = URL.createObjectURL(file)
    const audio = new Audio(url)
    audio.addEventListener('loadedmetadata', () => {
      if (isFinite(audio.duration)) setDuration(audio.duration)
      URL.revokeObjectURL(url)
    })
    audio.addEventListener('error', () => URL.revokeObjectURL(url))
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  async function startRecording() {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        const file = new File([blob], `recording-${Date.now()}.webm`, { type: 'audio/webm' })
        setSelectedFile(file)
        setDuration(recordingSeconds)
      }
      recorder.start(250)
      mediaRecorderRef.current = recorder
      setIsRecording(true)
      setRecordingSeconds(0)
      timerRef.current = setInterval(() => setRecordingSeconds(s => s + 1), 1000)
    } catch {
      setError('Microphone access denied. Please allow microphone access and try again.')
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop()
      mediaRecorderRef.current = null
    }
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    setIsRecording(false)
  }

  return (
    <div className="upload-screen">
      <div className="upload-hero">
        <div className="upload-icon">⚡</div>
        <h1>Electrician Estimate</h1>
        <p className="upload-tagline">Upload a recording or describe the job to generate an instant estimate</p>
      </div>

      {/* Tab switcher */}
      <div className="tab-bar">
        <button
          className={`tab-btn ${tab === 'upload' ? 'active' : ''}`}
          onClick={() => { setTab('upload'); setError(null) }}
        >
          🎙 Audio / Recording
        </button>
        <button
          className={`tab-btn ${tab === 'text' ? 'active' : ''}`}
          onClick={() => { setTab('text'); setError(null) }}
        >
          ✏️ Type description
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {tab === 'upload' && (
        <>
          <div
            className={`drop-zone ${dragOver ? 'drag-over' : ''} ${selectedFile ? 'has-file' : ''}`}
            onClick={() => !selectedFile && fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_TYPES}
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
            />
            {selectedFile ? (
              <div className="file-info">
                <div className="file-icon">🎙️</div>
                <div className="file-name">{selectedFile.name}</div>
                {duration !== null && <div className="file-duration">{formatDuration(duration)}</div>}
                <button className="btn-ghost" onClick={(e) => { e.stopPropagation(); setSelectedFile(null); setDuration(null) }}>
                  Choose different file
                </button>
              </div>
            ) : (
              <div className="drop-prompt">
                <div className="drop-icon">📁</div>
                <p><strong>Tap to choose a file</strong> or drag and drop</p>
                <p className="drop-hint">m4a, mp3, wav, mp4, ogg — any voice memo format</p>
              </div>
            )}
          </div>

          {!selectedFile && (
            <div className="record-section">
              <div className="record-divider"><span>or record directly</span></div>
              {isRecording ? (
                <div className="recording-active">
                  <div className="pulse-ring" />
                  <button className="btn-record-stop" onClick={stopRecording}>
                    ■ Stop ({formatDuration(recordingSeconds)})
                  </button>
                </div>
              ) : (
                <button className="btn-record-start" onClick={startRecording}>
                  🎙 Record voice note
                </button>
              )}
            </div>
          )}

          {selectedFile && (
            <button className="btn-primary btn-process" onClick={() => onFileReady(selectedFile)}>
              Process recording →
            </button>
          )}
        </>
      )}

      {tab === 'text' && (
        <div className="text-input-section">
          <p className="text-input-hint">
            Describe the job in plain language — exactly like you'd explain it to a helper.
          </p>
          <textarea
            className="job-textarea"
            placeholder={EXAMPLE_JOB}
            value={jobText}
            onChange={(e) => setJobText(e.target.value)}
            rows={7}
          />
          <button
            className="btn-ghost use-example"
            onClick={() => setJobText(EXAMPLE_JOB)}
          >
            Use example job
          </button>
          <button
            className="btn-primary btn-process"
            disabled={jobText.trim().length < 20}
            onClick={() => onTextReady(jobText.trim())}
          >
            Generate estimate →
          </button>
        </div>
      )}
    </div>
  )
}
