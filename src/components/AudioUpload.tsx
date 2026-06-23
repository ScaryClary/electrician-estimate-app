import { useRef, useState, useEffect } from 'react'

interface AudioUploadProps {
  onFilesReady: (files: File[]) => void
  onTextReady: (text: string) => void
  hasApiKey: boolean
  onOpenSettings: () => void
}

interface PickedFile {
  file: File
  duration: number | null
}

const ACCEPTED_TYPES = '.m4a,.mp3,.wav,.mp4,.ogg,.webm,.aac,.flac'
const ACCEPTED_MIME = [
  'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg', 'audio/webm',
  'audio/aac', 'audio/flac', 'video/mp4', 'audio/x-m4a',
]

const EXAMPLE_JOB = `Customer wants to install a Tesla charger. They already have the charger — just need to run the wiring. Room in the panel for a breaker. Add a 30-amp breaker and run about 100 feet of wire from the panel to the garage.`

const LOGO_SRC = import.meta.env.DEV
  ? '/freedom-electric-logo.svg'
  : '/tools/electrician-estimate/freedom-electric-logo.svg'

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const hasSpeechRecognition = typeof window !== 'undefined' &&
  ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)

export function AudioUpload({ onFilesReady, onTextReady, hasApiKey, onOpenSettings }: AudioUploadProps) {
  const [jobText, setJobText] = useState('')
  const [interimText, setInterimText] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [selectedFiles, setSelectedFiles] = useState<PickedFile[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const recognitionRef = useRef<InstanceType<typeof SpeechRecognition> | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => () => {
    recognitionRef.current?.stop()
    if (timerRef.current) clearInterval(timerRef.current)
  }, [])

  function addFiles(files: File[]) {
    setError(null)
    const valid: File[] = []
    for (const file of files) {
      const ok = ACCEPTED_MIME.some(t => file.type === t) || file.name.match(/\.(m4a|mp3|wav|mp4|ogg|webm|aac|flac)$/i)
      if (ok) valid.push(file)
    }
    if (valid.length === 0) {
      setError('Unsupported file type. Please upload an audio or video file.')
      return
    }
    setSelectedFiles(prev => [...prev, ...valid.map(file => ({ file, duration: null }))])
    // Read durations asynchronously and patch them in
    for (const file of valid) {
      const url = URL.createObjectURL(file)
      const audio = new Audio(url)
      audio.addEventListener('loadedmetadata', () => {
        if (isFinite(audio.duration)) {
          setSelectedFiles(prev => prev.map(p =>
            p.file === file ? { ...p, duration: audio.duration } : p
          ))
        }
        URL.revokeObjectURL(url)
      })
      audio.addEventListener('error', () => URL.revokeObjectURL(url))
    }
  }

  function removeFile(target: File) {
    setSelectedFiles(prev => prev.filter(p => p.file !== target))
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length) addFiles(files)
  }

  function startRecording() {
    setError(null)
    const SR = (window as typeof window & { SpeechRecognition?: typeof SpeechRecognition; webkitSpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition
      || (window as typeof window & { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition
    if (!SR) {
      setError('Live recording requires Chrome on Android, Mac, or Windows. Type your job description below instead.')
      return
    }

    const recognition = new SR()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalPart = ''
      let interimPart = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript
        if (event.results[i].isFinal) finalPart += t + ' '
        else interimPart += t
      }
      if (finalPart) {
        setJobText(prev => {
          const spacer = prev && !prev.endsWith(' ') ? ' ' : ''
          return prev + spacer + finalPart
        })
      }
      setInterimText(interimPart)
    }

    recognition.onerror = (e: SpeechRecognitionErrorEvent) => {
      if (e.error !== 'aborted') setError(`Mic error: ${e.error}`)
      stopRecording()
    }

    recognition.onend = () => {
      setInterimText('')
      if (recognitionRef.current) recognition.start()
    }

    recognition.start()
    recognitionRef.current = recognition
    setIsRecording(true)
    setRecordingSeconds(0)
    timerRef.current = setInterval(() => setRecordingSeconds(s => s + 1), 1000)
  }

  function stopRecording() {
    const r = recognitionRef.current
    recognitionRef.current = null
    r?.stop()
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    setIsRecording(false)
    setInterimText('')
  }

  if (!hasApiKey) {
    return (
      <div className="upload-screen">
        <div className="upload-hero">
          <img src={LOGO_SRC} alt="Freedom Electric" className="upload-brand-logo" />
          <h1>Freedom Electric Estimator</h1>
        </div>
        <div className="api-key-prompt">
          <div className="api-key-icon">🔑</div>
          <h3>Add your Anthropic API key to get started</h3>
          <p>Your key is stored only in your browser — never sent anywhere except directly to Anthropic.</p>
          <button className="btn-primary" onClick={onOpenSettings}>Open Settings to add API key</button>
        </div>
      </div>
    )
  }

  const canGenerate = jobText.trim().length >= 10

  return (
    <div className="upload-screen">
      <div className="upload-hero">
        <img src={LOGO_SRC} alt="Freedom Electric" className="upload-brand-logo" />
        <h1>Freedom Electric Estimator</h1>
        <p className="upload-tagline">Describe the job — record, type, or upload a recording</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Upload files — supports multiple recordings */}
      <div
        className={`drop-zone drop-zone-compact ${dragOver ? 'drag-over' : ''} ${selectedFiles.length ? 'has-file' : ''}`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES}
          multiple
          style={{ display: 'none' }}
          onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) addFiles(fs); e.target.value = '' }}
        />
        <div className="drop-prompt-compact">
          <span className="drop-icon-sm">📁</span>
          <span><strong>Upload recordings</strong> — tap or drag &amp; drop (add as many as you need)</span>
          <span className="drop-hint">m4a, mp3, wav, mp4, ogg</span>
        </div>
      </div>

      {selectedFiles.length > 0 && (
        <div className="selected-files-list">
          {selectedFiles.map(({ file, duration }, i) => (
            <div className="file-info-compact" key={`${file.name}-${i}`}>
              <span className="file-icon-sm">🎙️</span>
              <span className="file-name">{file.name}</span>
              {duration !== null && <span className="file-duration">{formatDuration(duration)}</span>}
              <button className="btn-ghost file-clear-btn" onClick={() => removeFile(file)}>✕</button>
            </div>
          ))}
        </div>
      )}

      {selectedFiles.length > 0 && (
        <button className="btn-primary btn-process" onClick={() => onFilesReady(selectedFiles.map(p => p.file))}>
          Transcribe &amp; generate estimate{selectedFiles.length > 1 ? ` (${selectedFiles.length} recordings)` : ''} →
        </button>
      )}

      {/* Job description textarea — shared between typing and recording */}
      {selectedFiles.length === 0 && (
        <div className="job-input-section">
          <div className="job-input-header">
            <label className="job-input-label">Job description</label>
            <div className="record-inline-controls">
              {isRecording ? (
                <button className="btn-record-inline active" onClick={stopRecording}>
                  <span className="record-dot" /> Stop &nbsp;{formatDuration(recordingSeconds)}
                </button>
              ) : (
                <button
                  className="btn-record-inline"
                  onClick={startRecording}
                  disabled={!hasSpeechRecognition}
                  title={hasSpeechRecognition ? 'Record voice note' : 'Not supported in this browser'}
                >
                  🎙 Record
                </button>
              )}
            </div>
          </div>

          <textarea
            ref={textareaRef}
            className={`job-textarea ${isRecording ? 'textarea-recording' : ''}`}
            placeholder={EXAMPLE_JOB}
            value={jobText}
            onChange={(e) => setJobText(e.target.value)}
            rows={8}
          />

          {interimText && (
            <p className="interim-indicator">Hearing: <em>{interimText}</em></p>
          )}

          <div className="job-input-actions">
            <button className="btn-ghost use-example" onClick={() => setJobText(EXAMPLE_JOB)}>
              Use example
            </button>
            <button
              className="btn-primary"
              disabled={!canGenerate || isRecording}
              onClick={() => onTextReady(jobText.trim())}
            >
              {isRecording ? 'Stop recording first' : 'Generate estimate →'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
