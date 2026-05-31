import { useState } from 'react'
import type { Estimate } from '../types/estimate'
import { submitToHCP } from '../services/housecallPro'

interface FinalizedEstimateProps {
  estimate: Estimate
  electricianName: string
  onNameChange: (name: string) => void
  onStartOver: () => void
}

export function FinalizedEstimate({ estimate, electricianName, onNameChange, onStartOver }: FinalizedEstimateProps) {
  const [customerName, setCustomerName] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')
  const [jobSite, setJobSite] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitToast, setSubmitToast] = useState<string | null>(null)
  const [revisionHistoryOpen, setRevisionHistoryOpen] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(electricianName)

  const laborItems = estimate.lineItems.filter(i => i.type === 'labor')
  const materialItems = estimate.lineItems.filter(i => i.type === 'material')

  async function handleSubmit() {
    setSubmitting(true)
    try {
      await submitToHCP(estimate)
      setSubmitToast('Estimate saved — HCP integration coming soon.')
      setTimeout(() => setSubmitToast(null), 4000)
    } finally {
      setSubmitting(false)
    }
  }

  function commitName() {
    setEditingName(false)
    onNameChange(nameDraft)
  }

  return (
    <div className="finalized-estimate">
      {submitToast && <div className="toast">{submitToast}</div>}

      {/* Document header */}
      <div className="doc-header">
        <div className="doc-title-block">
          <h1 className="doc-main-title">Electrical Estimate</h1>
          <div className="doc-meta">
            <span>Date: {new Date(estimate.createdAt).toLocaleDateString()}</span>
            <span> | </span>
            <span>
              Prepared by:{' '}
              {editingName ? (
                <input
                  className="inline-input"
                  value={nameDraft}
                  autoFocus
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={commitName}
                  onKeyDown={(e) => e.key === 'Enter' && commitName()}
                />
              ) : (
                <span className="editable-name" onClick={() => setEditingName(true)}>
                  {electricianName || 'Tap to add name'}
                </span>
              )}
            </span>
          </div>
          <h2 className="doc-job-title">{estimate.jobTitle}</h2>
        </div>
      </div>

      {/* Customer / job site section
          HCP INTEGRATION POINT — customer lookup will go here.
          When HCP API is connected, add a search field that queries
          GET /customers?q={name} and lets the electrician select the right customer.
          The selected customer's ID gets attached to the estimate payload
          for the eventual POST /estimates call. */}
      <div className="doc-section customer-section">
        <h3>Customer</h3>
        <div className="customer-fields">
          <input
            className="field-input"
            placeholder="Customer name"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
          />
          <input
            className="field-input"
            placeholder="Customer address"
            value={customerAddress}
            onChange={(e) => setCustomerAddress(e.target.value)}
          />
          <input
            className="field-input"
            placeholder="Job site (if different)"
            value={jobSite}
            onChange={(e) => setJobSite(e.target.value)}
          />
        </div>
      </div>

      {/* Scope summary */}
      <div className="doc-section">
        <h3>Scope of Work</h3>
        <p className="scope-text">{estimate.audioSummary}</p>
      </div>

      {/* Labor table */}
      {laborItems.length > 0 && (
        <div className="doc-section">
          <h3>Labor</h3>
          <table className="print-table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Hrs</th>
                <th>Rate</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {laborItems.map((item) => (
                <tr key={item.id} className={item.flagged ? 'row-flagged' : ''}>
                  <td>{item.flagged && '⚠️ '}{item.description}</td>
                  <td>{item.quantity}</td>
                  <td>${item.unitPrice.toFixed(2)}</td>
                  <td>${item.subtotal.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Materials table */}
      {materialItems.length > 0 && (
        <div className="doc-section">
          <h3>Materials</h3>
          <table className="print-table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>Unit Price</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {materialItems.map((item) => (
                <tr key={item.id} className={item.flagged ? 'row-flagged' : ''}>
                  <td>{item.flagged && '⚠️ '}{item.description}</td>
                  <td>{item.quantity}</td>
                  <td>{item.unit}</td>
                  <td>${item.unitPrice.toFixed(2)}</td>
                  <td>${item.subtotal.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Totals */}
      <div className="doc-section totals-block">
        <div className="totals-row"><span>Subtotal</span><span>${estimate.subtotal.toFixed(2)}</span></div>
        {estimate.taxRate > 0 && (
          <>
            <div className="totals-row"><span>Tax ({estimate.taxRate}%)</span><span>${estimate.taxAmount.toFixed(2)}</span></div>
          </>
        )}
        <div className="totals-row totals-total"><span>Total</span><span>${estimate.total.toFixed(2)}</span></div>
      </div>

      {/* Flagged / notes */}
      {estimate.flaggedItems.length > 0 && (
        <div className="doc-section flagged-notes">
          <h3>Notes / Items Requiring Follow-Up</h3>
          <ul>
            {estimate.flaggedItems.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </div>
      )}

      {/* Revision history accordion */}
      {estimate.revisionHistory.length > 0 && (
        <div className="doc-section">
          <button
            className="accordion-header"
            onClick={() => setRevisionHistoryOpen(x => !x)}
          >
            Revision history ({estimate.revisionHistory.length})
            <span>{revisionHistoryOpen ? '▲' : '▼'}</span>
          </button>
          {revisionHistoryOpen && (
            <div className="revision-history">
              {estimate.revisionHistory.map((rev) => (
                <div key={rev.id} className="revision-entry">
                  <div className="revision-timestamp">{new Date(rev.timestamp).toLocaleString()}</div>
                  <ul>
                    {rev.changesApplied.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="doc-actions">
        <button
          className="btn-primary btn-submit"
          onClick={handleSubmit}
          disabled={submitting}
        >
          {submitting ? 'Saving…' : 'Submit to Housecall Pro'}
        </button>
        <button className="btn-ghost" onClick={onStartOver}>Start new estimate</button>
      </div>
    </div>
  )
}
