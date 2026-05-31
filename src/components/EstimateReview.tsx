import { useState } from 'react'
import type { Estimate, LineItem } from '../types/estimate'
import { LineItemTable } from './LineItemTable'
import { RevisionRecorder } from './RevisionRecorder'

interface EstimateReviewProps {
  estimate: Estimate
  onEstimateChange: (estimate: Estimate) => void
  onRevisionAudio: (audio: Blob) => Promise<void>
  onFinalize: () => void
  isRevising: boolean
}

export function EstimateReview({
  estimate,
  onEstimateChange,
  onRevisionAudio,
  onFinalize,
  isRevising,
}: EstimateReviewProps) {
  const [showRevisionRecorder, setShowRevisionRecorder] = useState(false)
  const [customerNotesExpanded, setCustomerNotesExpanded] = useState(false)
  const [flaggedDismissed, setFlaggedDismissed] = useState(false)
  const [lastChanges, setLastChanges] = useState<string[]>([])

  function updateLineItem(id: string, field: keyof LineItem, value: string | number | boolean) {
    const updated = estimate.lineItems.map((item) => {
      if (item.id !== id) return item
      const next = { ...item, [field]: value }
      if (field === 'quantity' || field === 'unitPrice') {
        next.subtotal = Number(next.quantity) * Number(next.unitPrice)
      }
      return next
    })
    const subtotal = updated.reduce((sum, i) => sum + i.subtotal, 0)
    const taxAmount = subtotal * (estimate.taxRate / 100)
    onEstimateChange({ ...estimate, lineItems: updated, subtotal, taxAmount, total: subtotal + taxAmount })
  }

  function updateTaxRate(rate: number) {
    const taxAmount = estimate.subtotal * (rate / 100)
    onEstimateChange({ ...estimate, taxRate: rate, taxAmount, total: estimate.subtotal + taxAmount })
  }

  async function handleRevisionReady(audio: Blob) {
    setShowRevisionRecorder(false)
    await onRevisionAudio(audio)
    const latest = estimate.revisionHistory[estimate.revisionHistory.length - 1]
    if (latest) setLastChanges(latest.changesApplied)
  }

  const unflaggedCount = estimate.lineItems.filter(i => i.flagged).length
  const canFinalize = flaggedDismissed || unflaggedCount === 0

  return (
    <div className="estimate-review">
      {/* Job header */}
      <div className="estimate-header">
        <h2 className="job-title">{estimate.jobTitle}</h2>
        <p className="audio-summary">{estimate.audioSummary}</p>
      </div>

      {/* Customer notes */}
      {estimate.customerNotes && (
        <div className="customer-notes-card">
          <button
            className="collapsible-header"
            onClick={() => setCustomerNotesExpanded(x => !x)}
          >
            <span>Customer notes</span>
            <span>{customerNotesExpanded ? '▲' : '▼'}</span>
          </button>
          {customerNotesExpanded && (
            <p className="customer-notes-body">{estimate.customerNotes}</p>
          )}
        </div>
      )}

      {/* Revision changelog */}
      {lastChanges.length > 0 && (
        <div className="changelog-card">
          <strong>Last revision applied:</strong>
          <ul>
            {lastChanges.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      )}

      {/* Line items */}
      <LineItemTable items={estimate.lineItems} onUpdate={updateLineItem} />

      {/* Totals */}
      <div className="totals-section">
        <div className="total-row">
          <span>Subtotal</span>
          <span>${estimate.subtotal.toFixed(2)}</span>
        </div>
        <div className="total-row">
          <span>Tax rate (%)</span>
          <input
            className="tax-input"
            type="number"
            min="0"
            step="0.1"
            value={estimate.taxRate}
            onChange={(e) => updateTaxRate(parseFloat(e.target.value) || 0)}
          />
        </div>
        <div className="total-row">
          <span>Tax</span>
          <span>${estimate.taxAmount.toFixed(2)}</span>
        </div>
        <div className="total-row total-final">
          <span>Total</span>
          <span>${estimate.total.toFixed(2)}</span>
        </div>
      </div>

      {/* Flagged items */}
      {estimate.flaggedItems.length > 0 && (
        <div className="flagged-section">
          <h4>⚠️ Items needing attention</h4>
          <ul>
            {estimate.flaggedItems.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
          {!flaggedDismissed && (
            <button className="btn-ghost" onClick={() => setFlaggedDismissed(true)}>
              Dismiss and proceed
            </button>
          )}
        </div>
      )}

      {/* Revision recorder overlay */}
      {showRevisionRecorder && (
        <div className="revision-overlay">
          <RevisionRecorder
            onRevisionReady={handleRevisionReady}
            onCancel={() => setShowRevisionRecorder(false)}
            isProcessing={isRevising}
          />
        </div>
      )}

      {/* Sticky footer */}
      <div className="sticky-footer">
        <button
          className="btn-primary"
          onClick={() => setShowRevisionRecorder(true)}
          disabled={isRevising}
        >
          🎙 Record revision
        </button>
        <button
          className={`btn-secondary ${!canFinalize ? 'btn-disabled' : ''}`}
          onClick={canFinalize ? onFinalize : undefined}
          title={!canFinalize ? 'Dismiss flagged items first' : undefined}
        >
          Finalize estimate
        </button>
      </div>
    </div>
  )
}
