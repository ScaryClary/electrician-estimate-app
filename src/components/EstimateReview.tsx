import { useState } from 'react'
import type { Estimate, LineItem } from '../types/estimate'
import { LineItemTable } from './LineItemTable'
import { RevisionRecorder } from './RevisionRecorder'

interface EstimateReviewProps {
  estimate: Estimate
  onEstimateChange: (estimate: Estimate) => void
  onRevisionAudio: (audio: Blob) => Promise<void>
  onRevisionText: (text: string) => Promise<void>
  onFinalize: () => void
  isRevising: boolean
}

export function EstimateReview({
  estimate,
  onEstimateChange,
  onRevisionAudio,
  onRevisionText,
  onFinalize,
  isRevising,
}: EstimateReviewProps) {
  const [showRevisionPanel, setShowRevisionPanel] = useState(false)
  const [lastChanges, setLastChanges] = useState<string[]>([])
  const [editingTitle, setEditingTitle] = useState(false)

  function recalc(items: LineItem[], taxRate: number) {
    const subtotal = items.reduce((s, i) => s + i.subtotal, 0)
    const taxAmount = subtotal * (taxRate / 100)
    return { subtotal, taxAmount, total: subtotal + taxAmount }
  }

  function updateLineItem(id: string, field: keyof LineItem, value: string | number | boolean) {
    const updated = estimate.lineItems.map((item) => {
      if (item.id !== id) return item
      const next = { ...item, [field]: value }
      if (field === 'quantity' || field === 'unitPrice') {
        next.subtotal = Number(next.quantity) * Number(next.unitPrice)
      }
      return next
    })
    onEstimateChange({ ...estimate, lineItems: updated, ...recalc(updated, estimate.taxRate) })
  }

  function deleteLineItem(id: string) {
    const updated = estimate.lineItems.filter(i => i.id !== id)
    onEstimateChange({ ...estimate, lineItems: updated, ...recalc(updated, estimate.taxRate) })
  }

  function addLineItem(type: 'labor' | 'material') {
    const newItem: LineItem = {
      id: crypto.randomUUID(),
      type,
      description: '',
      quantity: type === 'labor' ? 1 : 1,
      unit: type === 'labor' ? 'hrs' : 'ea',
      unitPrice: type === 'labor' ? 95 : 0,
      subtotal: 0,
      priceSource: 'needs_review',
      confidence: 'low',
      flagged: false,
    }
    const updated = [...estimate.lineItems, newItem]
    onEstimateChange({ ...estimate, lineItems: updated, ...recalc(updated, estimate.taxRate) })
  }

  function updateTaxRate(rate: number) {
    const taxAmount = estimate.subtotal * (rate / 100)
    onEstimateChange({ ...estimate, taxRate: rate, taxAmount, total: estimate.subtotal + taxAmount })
  }

  async function handleRevisionReady(audio: Blob) {
    setShowRevisionPanel(false)
    await onRevisionAudio(audio)
    const latest = estimate.revisionHistory[estimate.revisionHistory.length - 1]
    if (latest) setLastChanges(latest.changesApplied)
  }

  async function handleRevisionText(text: string) {
    setShowRevisionPanel(false)
    await onRevisionText(text)
    const latest = estimate.revisionHistory[estimate.revisionHistory.length - 1]
    if (latest) setLastChanges(latest.changesApplied)
  }

  const flaggedCount = estimate.lineItems.filter(i => i.flagged).length

  return (
    <div className={`estimate-review-layout ${showRevisionPanel ? 'has-revision-panel' : ''}`}>
      {/* Main estimate column */}
      <div className="estimate-main">
        {/* Header — editable */}
        <div className="estimate-header">
          {editingTitle ? (
            <input
              className="item-input job-title-input"
              value={estimate.jobTitle}
              autoFocus
              onChange={(e) => onEstimateChange({ ...estimate, jobTitle: e.target.value })}
              onBlur={() => setEditingTitle(false)}
              onKeyDown={(e) => e.key === 'Enter' && setEditingTitle(false)}
            />
          ) : (
            <h2 className="job-title editable-field" onClick={() => setEditingTitle(true)} title="Tap to edit">
              {estimate.jobTitle || 'Untitled job'}
            </h2>
          )}
          <textarea
            className="summary-textarea"
            value={estimate.audioSummary}
            onChange={(e) => onEstimateChange({ ...estimate, audioSummary: e.target.value })}
            rows={3}
          />
        </div>

        {/* Revision loading banner */}
        {isRevising && (
          <div className="revision-loading-banner">
            <div className="spinner-sm" />
            <span>Applying your revision…</span>
          </div>
        )}

        {/* Last changes applied */}
        {lastChanges.length > 0 && !isRevising && (
          <div className="changelog-card">
            <strong>Revision applied:</strong>
            <ul>{lastChanges.map((c, i) => <li key={i}>{c}</li>)}</ul>
            <button className="btn-ghost" style={{ fontSize: 12, padding: '4px 0' }} onClick={() => setLastChanges([])}>Dismiss</button>
          </div>
        )}

        {/* Customer notes */}
        {estimate.customerNotes && (
          <div className="customer-notes-card">
            <p className="customer-notes-label">Customer notes</p>
            <textarea
              className="summary-textarea"
              value={estimate.customerNotes}
              onChange={(e) => onEstimateChange({ ...estimate, customerNotes: e.target.value })}
              rows={2}
            />
          </div>
        )}

        {/* Line items */}
        <LineItemTable
          items={estimate.lineItems}
          onUpdate={updateLineItem}
          onDelete={deleteLineItem}
          onAdd={addLineItem}
        />

        {/* Totals */}
        <div className="totals-section">
          <div className="total-row"><span>Subtotal</span><span>${estimate.subtotal.toFixed(2)}</span></div>
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
          {estimate.taxRate > 0 && (
            <div className="total-row"><span>Tax</span><span>${estimate.taxAmount.toFixed(2)}</span></div>
          )}
          <div className="total-row total-final"><span>Total</span><span>${estimate.total.toFixed(2)}</span></div>
        </div>

        {/* Flagged items — informational only, does not block finalize */}
        {estimate.flaggedItems.length > 0 && (
          <div className="flagged-section">
            <h4>⚠ {flaggedCount} item{flaggedCount !== 1 ? 's' : ''} may need attention</h4>
            <ul>{estimate.flaggedItems.map((item, i) => <li key={i}>{item}</li>)}</ul>
          </div>
        )}

        {/* Bottom action bar */}
        <div className="estimate-action-bar">
          <button
            className={`btn-primary ${showRevisionPanel ? 'btn-active' : ''}`}
            onClick={() => setShowRevisionPanel(p => !p)}
            disabled={isRevising}
          >
            {showRevisionPanel ? '✕ Close revision' : '🎙 Revise'}
          </button>
          <button className="btn-secondary" onClick={onFinalize}>
            Finalize →
          </button>
        </div>
      </div>

      {/* Revision side panel — no overlay, no darkening */}
      {showRevisionPanel && (
        <div className="revision-sidebar">
          <RevisionRecorder
            onRevisionReady={handleRevisionReady}
            onRevisionText={handleRevisionText}
            onCancel={() => setShowRevisionPanel(false)}
            isProcessing={isRevising}
          />
        </div>
      )}
    </div>
  )
}
