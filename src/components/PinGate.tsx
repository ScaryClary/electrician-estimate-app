import { useState } from 'react'

const STORAGE_KEY = 'ee_unlocked'
const WORKER_BASE = !import.meta.env.DEV ? '' : (import.meta.env.VITE_WORKER_URL as string || 'http://localhost:8787')

export function PinGate({ children }: { children: React.ReactNode }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const [unlocked, setUnlocked] = useState(() => {
    if (import.meta.env.DEV) return true
    return localStorage.getItem(STORAGE_KEY) === 'true'
  })

  if (unlocked) return <>{children}</>

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setChecking(true)
    try {
      const res = await fetch(`${WORKER_BASE}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: pin }),
      })
      const data = await res.json() as { valid: boolean }
      if (data.valid) {
        localStorage.setItem(STORAGE_KEY, 'true')
        setUnlocked(true)
      } else {
        setError('Incorrect access code')
        setPin('')
      }
    } catch {
      setError('Could not reach server — try again')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="pin-gate">
      <div className="pin-gate-card">
        <img
          src="/tools/electrician-estimate/freedom-electric-logo.svg"
          onError={(e) => { (e.target as HTMLImageElement).src = '/freedom-electric-logo.svg' }}
          alt="Freedom Electric"
          className="pin-gate-logo"
        />
        <h2 className="pin-gate-title">Freedom Electric</h2>
        <p className="pin-gate-subtitle">Enter your access code to continue</p>
        <form onSubmit={handleSubmit} className="pin-gate-form">
          <input
            type="password"
            className="pin-gate-input"
            value={pin}
            onChange={e => setPin(e.target.value)}
            placeholder="Access code"
            autoFocus
            disabled={checking}
          />
          {error && <p className="pin-gate-error">{error}</p>}
          <button type="submit" className="btn-primary" disabled={checking || !pin}>
            {checking ? 'Checking…' : 'Enter'}
          </button>
        </form>
      </div>
    </div>
  )
}
