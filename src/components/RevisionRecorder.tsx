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

type Tab = 'voice' | 'text'
type RecordState = 'idle' | 'recording' | 'recorded'

const hasSpeechRecognition = typeof window !== 'undefined' &&
  ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)

export function RevisionRecorder({ onRevisionReady, onRevisionText, onCancel, isProcessing }: RevisionRecorderProps) {
  const [tab, setTab] = useState<Tab>('voice')
  const [recordState, setRecordState] = useState<RecordState>('idle')
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [revisionText, setRevisionText] = useState('')
  const [liveTranscript, setLiveTranscript] = useState('')
  const [interimText, setInterimText] = useState('')

  // Fallback: MediaRecorder blob for browsers without SpeechRecognition
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const blobRef = useRef<Blob | null>(null)

  // SpeechRecognition
  const recognitionRef = useRef<InstanceType<typeof SpeechRecognition> | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => () => {
    recognitionRef.current?.stop()
    recorderRef.current?.stop()
    if (timerRef.current) clearInterval(timerRef.current)
  }, [])

  function startTimer() {
    setSeconds(0)
    timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000)
  }

  function stopTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }

  async function startRecording() {
    setError(null)
    setLiveTranscript('')
    setInterimText('')

    if (hasSpeechRecognition) {
      const SR = (window as typeof window & { SpeechRecognition?: typeof SpeechRecognition; webkitSpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition
        || (window as typeof window & { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition!
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
        if (finalPart) setLiveTranscript(prev => prev + finalPart)
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
      setRecordState('recording')
      startTimer()
    } else {
      // Fallback: MediaRecorder for browsers without SpeechRecognition
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const recorder = new MediaRecorder(stream)
        chunksRef.current = []
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
        recorder.onstop = () => {
          stream.getTracks().forEach(t => t.stop())
          blobRef.current = new Blob(chunksRef.current, { type: 'audio/webm' })
          setRecordState('recorded')
        }
        recorder.start(250)
        recorderRef.current = recorder
        setRecordState('recording')
        startTimer()
      } catch {
        setError('Microphone access denied.')
      }
    }
  }

  function stopRecording() {
    if (hasSpeechRecognition) {
      const r = recognitionRef.current
      recognitionRef.current = null
      r?.stop()
      setInterimText('')
    } else {
      recorderRef.current?.stop()
      recorderRef.current = null
    }
    stopTimer()
    setRecordState('recorded')
  }

  function resetRecording() {
    setRecordState('idle')
    setSeconds(0)
    setLiveTranscript('')
    setInterimText('')
    blobRef.current = null
  }

  const finalTranscript = liveTranscript.trim()
  const displayText = finalTranscript + (interimText ? ' ' + interimText : '')

  function handleApply() {
    if (hasSpeechRecognition) {
      if (finalTranscript) onRevisionText(finalTranscript)
    } else {
      if (blobRef.current) onRevisionReady(blobRef.current)
    }
  }

  return (
    <div className="revision-panel-inner">
      <div className="revision-panel-header">
        <h3 className="revision-panel-title">Revise estimate</h3>
        <button className="revision-close-btn" onClick={onCancel} aria-label="Close">✕</button>
      </div>

      {isProcessing ? (
        <div className="revision-processing">
          <div className="spinner-large" />
          <p>Applying revision…</p>
        </div>
      ) : (
        <>
          <p className="revision-hint">Describe what needs to change — hours, materials, prices, new tasks.</p>

          <div className="tab-bar tab-bar-sm">
            <button className={`tab-btn ${tab === 'voice' ? 'active' : ''}`} onClick={() => setTab('voice')}>
              🎙 Voice
            </button>
            <button className={`tab-btn ${tab === 'text' ? 'active' : ''}`} onClick={() => setTab('text')}>
              ✏️ Type
            </button>
          </div>

          {error && <div className="error-banner">{error}</div>}

          {tab === 'voice' && (
            <div className="revision-voice-section">
              <div className="revision-transcript-box">
                {displayText
                  ? <p className="revision-transcript-text">{displayText}</p>
                  : <p className="revision-transcript-placeholder">
                      {recordState === 'recording' ? 'Listening…' : 'Tap Record and describe the changes.'}
                    </p>
                }
              </div>

              <div className="revision-voice-controls">
                {recordState === 'idle' && (
                  <button className="btn-record-start" onClick={startRecording}>🎙 Record</button>
                )}
                {recordState === 'recording' && (
                  <button className="btn-record-stop" onClick={stopRecording}>
                    ■ Stop &nbsp;{formatTime(seconds)}
                  </button>
                )}
                {recordState === 'recorded' && finalTranscript && (
                  <button className="btn-ghost reset-record-btn" onClick={resetRecording}>Re-record</button>
                )}
              </div>

              {recordState === 'recorded' && (hasSpeechRecognition ? finalTranscript : blobRef.current) && (
                <button className="btn-primary" onClick={handleApply}>
                  Apply revision →
                </button>
              )}
            </div>
          )}

          {tab === 'text' && (
            <div className="revision-text-section">
              <textarea
                className="job-textarea revision-textarea"
                placeholder={'e.g. "Change panel labor to 6 hours. Add a 50-amp circuit for the hot tub."'}
                value={revisionText}
                onChange={(e) => setRevisionText(e.target.value)}
                rows={6}
              />
              <button
                className="btn-primary"
                disabled={revisionText.trim().length < 5}
                onClick={() => onRevisionText(revisionText.trim())}
              >
                Apply revision →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
