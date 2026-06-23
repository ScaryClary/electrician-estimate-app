import { useState } from 'react'
import type { AppSettings } from '../services/settings'
import { DEFAULT_SETTINGS, resetSettings } from '../services/settings'

interface SettingsProps {
  settings: AppSettings
  onSave: (settings: AppSettings) => void
  onClose: () => void
  openToApiKey?: boolean
}

type SettingsTab = 'api' | 'notes' | 'pricing' | 'estimate'

// In production the Cloudflare Worker holds all API keys — never show/store them in the browser.
const SHOW_API_KEYS = import.meta.env.DEV

export function Settings({ settings, onSave, onClose, openToApiKey }: SettingsProps) {
  const [tab, setTab] = useState<SettingsTab>(openToApiKey && SHOW_API_KEYS ? 'api' : 'notes')
  const [showKey, setShowKey] = useState(false)
  const [showHcpKey, setShowHcpKey] = useState(false)
  const [showOpenAiKey, setShowOpenAiKey] = useState(false)
  const [draft, setDraft] = useState<AppSettings>({ ...settings })
  const [saved, setSaved] = useState(false)

  function handleSave() {
    onSave(draft)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function handleReset() {
    if (!confirm('Reset all prompts and settings to defaults?')) return
    const defaults = resetSettings()
    setDraft({ ...defaults })
  }

  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  const isDirty = JSON.stringify(draft) !== JSON.stringify(settings)

  return (
    <div className="settings-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings-panel">
        <div className="settings-header">
          <div>
            <h2 className="settings-title">Admin</h2>
            <p className="settings-subtitle">Edit prompts, pricing context, and API keys</p>
          </div>
          <button className="settings-close" onClick={onClose} aria-label="Close settings">✕</button>
        </div>

        <div className="tab-bar settings-tabs">
          {SHOW_API_KEYS && (
            <button className={`tab-btn ${tab === 'api' ? 'active' : ''}`} onClick={() => setTab('api')}>
              API Keys
            </button>
          )}
          <button className={`tab-btn ${tab === 'notes' ? 'active' : ''}`} onClick={() => setTab('notes')}>
            Job Notes
          </button>
          <button className={`tab-btn ${tab === 'pricing' ? 'active' : ''}`} onClick={() => setTab('pricing')}>
            Pricing
          </button>
          <button className={`tab-btn ${tab === 'estimate' ? 'active' : ''}`} onClick={() => setTab('estimate')}>
            AI Prompts
          </button>
        </div>

        <div className="settings-body">
          {tab === 'api' && SHOW_API_KEYS && (
            <div className="settings-section">
              <div className="api-key-info">
                <p className="settings-field-hint">
                  Your Anthropic API key is stored only in your browser's local storage. It's sent directly to Anthropic — never to any other server.
                  Get a key at <strong>console.anthropic.com</strong>.
                </p>
              </div>
              <div className="pricing-field">
                <label className="field-label">Anthropic API Key</label>
                <div className="api-key-row">
                  <input
                    className="field-input api-key-input"
                    type={showKey ? 'text' : 'password'}
                    value={draft.apiKey}
                    onChange={(e) => update('apiKey', e.target.value)}
                    placeholder="sk-ant-..."
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button className="btn-ghost show-key-btn" onClick={() => setShowKey(s => !s)}>
                    {showKey ? 'Hide' : 'Show'}
                  </button>
                </div>
                {draft.apiKey && (
                  <p className="api-key-status">
                    {draft.apiKey.startsWith('sk-ant-') ? '✓ Looks like a valid Anthropic key' : '⚠ Key should start with sk-ant-'}
                  </p>
                )}
              </div>

              <div className="pricing-field" style={{ marginTop: 24 }}>
                <label className="field-label">Housecall Pro API Key</label>
                <p className="settings-field-hint">
                  Used to pull today's schedule on the Finalize screen so you can attach the estimate to an existing job.
                  Find it in HCP under <strong>Settings → Integrations → API</strong>.
                </p>
                <div className="api-key-row">
                  <input
                    className="field-input api-key-input"
                    type={showHcpKey ? 'text' : 'password'}
                    value={draft.hcpApiKey}
                    onChange={(e) => update('hcpApiKey', e.target.value)}
                    placeholder="HCP API key"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button className="btn-ghost show-key-btn" onClick={() => setShowHcpKey(s => !s)}>
                    {showHcpKey ? 'Hide' : 'Show'}
                  </button>
                </div>
                {draft.hcpApiKey && (
                  <p className="api-key-status">✓ HCP key saved</p>
                )}
              </div>

              <div className="pricing-field" style={{ marginTop: 24 }}>
                <label className="field-label">OpenAI API Key (Whisper transcription)</label>
                <p className="settings-field-hint">
                  When set, audio is transcribed using OpenAI Whisper instead of Claude — faster, cheaper, and more accurate for voice recordings.
                  Get a key at <strong>platform.openai.com</strong>.
                </p>
                <div className="api-key-row">
                  <input
                    className="field-input api-key-input"
                    type={showOpenAiKey ? 'text' : 'password'}
                    value={draft.openAiApiKey}
                    onChange={(e) => update('openAiApiKey', e.target.value)}
                    placeholder="sk-proj-..."
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button className="btn-ghost show-key-btn" onClick={() => setShowOpenAiKey(s => !s)}>
                    {showOpenAiKey ? 'Hide' : 'Show'}
                  </button>
                </div>
                {draft.openAiApiKey && (
                  <p className="api-key-status">
                    {draft.openAiApiKey.startsWith('sk-') ? '✓ Whisper active — audio will use OpenAI transcription' : '⚠ Key should start with sk-'}
                  </p>
                )}
              </div>
            </div>
          )}

          {tab === 'notes' && (
            <div className="settings-section">
              <div className="pricing-field">
                <label className="field-label">Job & task notes</label>
                <p className="settings-field-hint">
                  Notes about what certain jobs involve, what your expectations are, common task definitions, scope clarifications, things the AI should know about how you work.
                  This is fed to the AI on every estimate.
                </p>
                <textarea
                  className="job-textarea"
                  value={draft.jobNotes}
                  onChange={(e) => update('jobNotes', e.target.value)}
                  rows={14}
                  placeholder={"Examples:\n\n• 'Panel upgrade' always means 200A main, new meter base, new breakers, full inspection-ready install\n• 'Run a circuit' includes breaker, wire, box, device, and cover plate — not just wire\n• All outdoor outlets must be GFCI and in-use covers\n• Hot tub / spa = 50A GFCI breaker, 50A disconnect within 5ft of unit, THWN wire\n• EV charger install = 50A circuit, dedicated breaker, NEMA 14-50 outlet or hardwired\n• Service call minimum = 1 hr labor even if job is quick\n• Customer expects itemized breakdown of labor and materials separately"}
                />
              </div>
            </div>
          )}

          {tab === 'estimate' && (
            <div className="settings-section">
              <div className="prompt-group">
                <h4 className="prompt-group-label">Estimate prompt</h4>
                <p className="settings-field-hint">
                  Sent to Claude when generating a new estimate from audio or text.
                  Use <code className="inline-code">{'{{LABOR_RATE}}'}</code> and <code className="inline-code">{'{{TAX_RATE}}'}</code> as placeholders.
                </p>
                <textarea
                  className="prompt-textarea"
                  value={draft.estimateSystemPrompt}
                  onChange={(e) => update('estimateSystemPrompt', e.target.value)}
                  rows={14}
                  spellCheck={false}
                />
                <button className="btn-ghost reset-prompt-btn" onClick={() => update('estimateSystemPrompt', DEFAULT_SETTINGS.estimateSystemPrompt)}>
                  Reset to default
                </button>
              </div>

              <div className="prompt-group">
                <h4 className="prompt-group-label">Revision prompt</h4>
                <p className="settings-field-hint">
                  Used when the electrician records a voice revision or types correction instructions. The current estimate JSON is appended automatically.
                </p>
                <textarea
                  className="prompt-textarea"
                  value={draft.revisionSystemPrompt}
                  onChange={(e) => update('revisionSystemPrompt', e.target.value)}
                  rows={10}
                  spellCheck={false}
                />
                <button className="btn-ghost reset-prompt-btn" onClick={() => update('revisionSystemPrompt', DEFAULT_SETTINGS.revisionSystemPrompt)}>
                  Reset to default
                </button>
              </div>
            </div>
          )}

          {tab === 'pricing' && (
            <div className="settings-section">
              <div className="pricing-fields">
                <div className="pricing-field">
                  <label className="field-label">Labor rate ($/hr)</label>
                  <p className="settings-field-hint">Default hourly rate for labor line items. Injected into the estimate prompt via {'{{LABOR_RATE}}'}.</p>
                  <input
                    className="field-input pricing-input"
                    type="number"
                    min="0"
                    step="5"
                    value={draft.laborRate}
                    onChange={(e) => update('laborRate', parseFloat(e.target.value) || 0)}
                  />
                </div>

                <div className="pricing-field">
                  <label className="field-label">Default tax rate (%)</label>
                  <p className="settings-field-hint">Applied to new estimates automatically. Injected via {'{{TAX_RATE}}'}.</p>
                  <input
                    className="field-input pricing-input"
                    type="number"
                    min="0"
                    step="0.1"
                    value={draft.defaultTaxRate}
                    onChange={(e) => update('defaultTaxRate', parseFloat(e.target.value) || 0)}
                  />
                </div>

                <div className="pricing-field">
                  <label className="field-label">Price list / material costs</label>
                  <p className="settings-field-hint">
                    List your actual material costs, flat-rate prices for common jobs, or typical price ranges. The AI will use these numbers directly when building estimates.
                    In the future this can be auto-populated from your supplier's API.
                  </p>
                  <textarea
                    className="job-textarea"
                    value={draft.pricingList}
                    onChange={(e) => update('pricingList', e.target.value)}
                    rows={10}
                    placeholder={"Examples:\n\n# Flat-rate job prices\nOutlet add (1 circuit, 50ft): $350\nGFCI outlet replace: $125\nPanel upgrade 200A: $2,800–$3,500\nEV charger install (50A): $650–$900\nHot tub circuit: $800–$1,200\n\n# Common material costs\n12AWG Romex (per ft): $0.65\n20A breaker: $18\nSingle-gang box: $3\nGFCI outlet: $22\nNEMA 14-50 outlet: $35\n200A main breaker: $85"}
                  />
                </div>

                <div className="pricing-field">
                  <label className="field-label">General pricing notes</label>
                  <p className="settings-field-hint">
                    Markup rules, supplier preferences, regional pricing notes, or anything else that affects how you price jobs.
                  </p>
                  <textarea
                    className="job-textarea"
                    value={draft.pricingNotes}
                    onChange={(e) => update('pricingNotes', e.target.value)}
                    rows={5}
                    placeholder={"• 20% markup on all materials\n• Labor rate includes travel within 30 miles\n• Minimum job charge = 1 hr labor + truck fee\n• We source from Rexel — prices reflect their typical rates"}
                  />
                </div>

                <div className="pricing-future-section">
                  <h4 className="future-heading">Coming soon</h4>
                  <div className="future-item">
                    <div className="future-icon">🔌</div>
                    <div>
                      <strong>Supplier API integration</strong>
                      <p>Connect your Rexel, Graybar, or other supplier account to pull live material prices automatically.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="settings-footer">
          <button className="btn-ghost" onClick={handleReset}>Reset all to defaults</button>
          <div className="settings-footer-right">
            <button className="btn-secondary settings-cancel" onClick={onClose}>Cancel</button>
            <button
              className="btn-primary settings-save"
              onClick={handleSave}
              disabled={!isDirty && !saved}
            >
              {saved ? '✓ Saved' : 'Save settings'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
