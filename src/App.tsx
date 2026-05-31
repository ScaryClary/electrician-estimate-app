import { useState } from 'react'
import type { Estimate } from './types/estimate'
import { processAudio, reviseEstimate } from './services/anthropicWorker'
import { AudioUpload } from './components/AudioUpload'
import { EstimateReview } from './components/EstimateReview'
import { FinalizedEstimate } from './components/FinalizedEstimate'
import { StepperNav } from './components/StepperNav'
import './App.css'

type Step = 'upload' | 'review' | 'finalize'

const STEP_INDEX: Record<Step, number> = { upload: 0, review: 1, finalize: 3 }

type ProcessingState =
  | { type: 'idle' }
  | { type: 'processing'; message: string }
  | { type: 'error'; message: string }

const PROCESSING_MESSAGES = [
  'Transcribing recording…',
  'Identifying tasks and materials…',
  'Matching supplier prices…',
  'Building your estimate…',
]

export default function App() {
  const [step, setStep] = useState<Step>('upload')
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [procState, setProcState] = useState<ProcessingState>({ type: 'idle' })
  const [isRevising, setIsRevising] = useState(false)
  const [electricianName, setElectricianName] = useState('Your Name')

  async function handleFileReady(file: File) {
    setProcState({ type: 'processing', message: PROCESSING_MESSAGES[0] })
    let idx = 0

    const interval = setInterval(() => {
      idx = (idx + 1) % PROCESSING_MESSAGES.length
      setProcState({ type: 'processing', message: PROCESSING_MESSAGES[idx] })
    }, 4000)

    try {
      const result = await processAudio(file)
      setEstimate(result)
      setStep('review')
      setProcState({ type: 'idle' })
    } catch (err) {
      setProcState({ type: 'error', message: err instanceof Error ? err.message : 'Unknown error' })
    } finally {
      clearInterval(interval)
    }
  }

  async function handleRevisionAudio(audio: Blob) {
    if (!estimate) return
    setIsRevising(true)
    try {
      const updated = await reviseEstimate(audio, estimate)
      setEstimate(updated)
    } catch (err) {
      alert(`Revision failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setIsRevising(false)
    }
  }

  function handleStartOver() {
    setEstimate(null)
    setStep('upload')
    setProcState({ type: 'idle' })
  }

  return (
    <div className="app">
      <StepperNav currentStep={STEP_INDEX[step]} />

      <main className="main-content">
        {step === 'upload' && (
          <>
            {procState.type === 'processing' && (
              <div className="processing-screen">
                <div className="spinner-large" />
                <p className="processing-message">{procState.message}</p>
                <p className="processing-sub">This can take 20–60 seconds for long recordings</p>
              </div>
            )}
            {procState.type === 'error' && (
              <div className="error-screen">
                <div className="error-icon">⚠️</div>
                <p>{procState.message}</p>
                <button className="btn-primary" onClick={handleStartOver}>Try again</button>
              </div>
            )}
            {procState.type === 'idle' && (
              <AudioUpload onFileReady={handleFileReady} />
            )}
          </>
        )}

        {step === 'review' && estimate && (
          <EstimateReview
            estimate={estimate}
            onEstimateChange={setEstimate}
            onRevisionAudio={handleRevisionAudio}
            onFinalize={() => setStep('finalize')}
            isRevising={isRevising}
          />
        )}

        {step === 'finalize' && estimate && (
          <FinalizedEstimate
            estimate={estimate}
            electricianName={electricianName}
            onNameChange={setElectricianName}
            onStartOver={handleStartOver}
          />
        )}
      </main>
    </div>
  )
}
