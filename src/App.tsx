import { useState } from 'react'
import type { Estimate } from './types/estimate'
import { processAudio, processText, reviseEstimate, reviseEstimateText } from './services/anthropicWorker'
import { loadSettings, saveSettings } from './services/settings'
import type { AppSettings } from './services/settings'
import { AudioUpload } from './components/AudioUpload'
import { EstimateReview } from './components/EstimateReview'
import { FinalizedEstimate } from './components/FinalizedEstimate'
import { StepperNav } from './components/StepperNav'
import { Settings } from './components/Settings'
import { PinGate } from './components/PinGate'
import './App.css'

type Step = 'upload' | 'review' | 'finalize'
const STEP_INDEX: Record<Step, number> = { upload: 0, review: 1, finalize: 3 }

type ProcessingState =
  | { type: 'idle' }
  | { type: 'processing'; message: string }
  | { type: 'error'; message: string }

const AUDIO_MESSAGES = [
  'Transcribing recording…',
  'Identifying tasks and materials…',
  'Matching supplier prices…',
  'Building your estimate…',
]

const TEXT_MESSAGES = [
  'Analyzing job description…',
  'Identifying tasks and materials…',
  'Building your estimate…',
]

export default function App() {
  const [step, setStep] = useState<Step>('upload')
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [procState, setProcState] = useState<ProcessingState>({ type: 'idle' })
  const [isRevising, setIsRevising] = useState(false)
  const [electricianName, setElectricianName] = useState('Your Name')
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsOpenToApiKey, setSettingsOpenToApiKey] = useState(false)

  function handleSaveSettings(updated: AppSettings) {
    saveSettings(updated)
    setSettings(updated)
  }

  function openSettings(toApiKey = false) {
    setSettingsOpenToApiKey(toApiKey)
    setShowSettings(true)
  }

  async function runWithProgress(fn: () => Promise<Estimate>, messages: string[]) {
    setProcState({ type: 'processing', message: messages[0] })
    let idx = 0
    const interval = setInterval(() => {
      idx = (idx + 1) % messages.length
      setProcState({ type: 'processing', message: messages[idx] })
    }, 4000)
    try {
      const result = await fn()
      setEstimate(result)
      setStep('review')
      setProcState({ type: 'idle' })
    } catch (err) {
      setProcState({ type: 'error', message: err instanceof Error ? err.message : 'Unknown error' })
    } finally {
      clearInterval(interval)
    }
  }

  const handleFileReady = (file: File) =>
    runWithProgress(() => processAudio(file, settings), AUDIO_MESSAGES)

  const handleTextReady = (text: string) =>
    runWithProgress(() => processText(text, settings), TEXT_MESSAGES)

  async function handleRevisionAudio(audio: Blob) {
    if (!estimate) return
    setIsRevising(true)
    try {
      const updated = await reviseEstimate(audio, estimate, settings)
      setEstimate(updated)
    } catch (err) {
      alert(`Revision failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setIsRevising(false)
    }
  }

  async function handleRevisionText(text: string) {
    if (!estimate) return
    setIsRevising(true)
    try {
      const updated = await reviseEstimateText(text, estimate, settings)
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
    <PinGate>
    <div className="app">
      <StepperNav currentStep={STEP_INDEX[step]} onSettingsClick={() => openSettings()} />
      {showSettings && (
        <Settings
          settings={settings}
          onSave={handleSaveSettings}
          onClose={() => setShowSettings(false)}
          openToApiKey={settingsOpenToApiKey}
        />
      )}
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
              <AudioUpload
                onFileReady={handleFileReady}
                onTextReady={handleTextReady}
                hasApiKey={!!settings.apiKey}
                onOpenSettings={() => openSettings(true)}
              />
            )}
          </>
        )}

        {step === 'review' && estimate && (
          <EstimateReview
            estimate={estimate}
            onEstimateChange={setEstimate}
            onRevisionAudio={handleRevisionAudio}
            onRevisionText={handleRevisionText}
            onFinalize={() => setStep('finalize')}
            isRevising={isRevising}
          />
        )}

        {step === 'finalize' && estimate && (
          <FinalizedEstimate
            estimate={estimate}
            electricianName={electricianName}
            hcpApiKey={settings.hcpApiKey || undefined}
            onNameChange={setElectricianName}
            onStartOver={handleStartOver}
            onBack={() => setStep('review')}
          />
        )}
      </main>
    </div>
    </PinGate>
  )
}
