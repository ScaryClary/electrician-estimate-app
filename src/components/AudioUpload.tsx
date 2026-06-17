import { useRef, useState, useEffect } from 'react'

interface AudioUploadProps {
  onFileReady: (file: File) => void
  onTextReady: (text: string) => void
  hasApiKey: boolean
  onOpenSettings: () => void
}

const ACCEPTED_TYPES = '.m4a,.mp3,.wav,.mp4,.ogg,.webm,.aac,.flac'
const ACCEPTED_MIME = [
  'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg', 'audio/webm',
  'audio/aac', 'audio/flac', 'video/mp4', 'audio/x-m4a',
]

const EXAMPLE_JOB = `Customer wants to install a Tesla charger. They already have the charger — just need to run the wiring. Room in the panel for a breaker. Add a 30-amp breaker and run about 100 feet of wire from the panel to the garage.`

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const hasSpeechRecognition = typeof window !== 'undefined' &&
  ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)

export function AudioUpload({ onFileReady, onTextReady, hasApiKey, onOpenSettings }: AudioUploadProps) {
  const [jobText, setJobText] = useState('')        // unified — recording appends here, user can edit freely
  const [interimText, setInterimText] = useState('') // shown below textarea during recording, not in textarea
  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
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
        // Append confirmed words to the editable textarea
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
      // Restart automatically while recording is still active
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
          <div className="upload-icon">⚡</div>
          <h1>Electrician Estimate</h1>
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
        <div className="upload-icon">⚡</div>
        <h1>Electrician Estimate</h1>
        <p className="upload-tagline">Describe the job — record, type, or upload a recording</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Upload a file */}
      <div
        className={`drop-zone drop-zone-compact ${dragOver ? 'drag-over' : ''} ${selectedFile ? 'has-file' : ''}`}
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
          <div className="file-info-compact">
            <span className="file-icon-sm">🎙️</span>
            <span className="file-name">{selectedFile.name}</span>
            {duration !== null && <span className="file-duration">{formatDuration(duration)}</span>}
            <button className="btn-ghost file-clear-btn" onClick={(e) => { e.stopPropagation(); setSelectedFile(null); setDuration(null) }}>✕</button>
          </div>
        ) : (
          <div className="drop-prompt-compact">
            <span className="drop-icon-sm">📁</span>
            <span><strong>Upload a recording</strong> — tap or drag &amp; drop</span>
            <span className="drop-hint">m4a, mp3, wav, mp4, ogg</span>
          </div>
        )}
      </div>

      {selectedFile && (
        <button className="btn-primary btn-process" onClick={() => onFileReady(selectedFile)}>
          Transcribe &amp; generate estimate →
        </button>
      )}

      {/* Job description textarea — shared between typing and recording */}
      {!selectedFile && (
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

          {/* Interim text indicator — shown while recording, not in the textarea */}
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
