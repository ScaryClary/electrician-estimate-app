import { useState, useEffect, useRef } from 'react'
import type { Estimate } from '../types/estimate'
import { submitToHCP, fetchTodaysSchedule, searchCustomers, createCustomer, detectTaxRateByCity, LAFAYETTE_TAX_RATES } from '../services/housecallPro'
import type { HCPJob, HCPCustomer } from '../services/housecallPro'

interface FinalizedEstimateProps {
  estimate: Estimate
  electricianName: string
  hcpApiKey?: string
  onNameChange: (name: string) => void
  onStartOver: () => void
  onBack: () => void
}

export function FinalizedEstimate({ estimate, electricianName, hcpApiKey, onNameChange, onStartOver, onBack }: FinalizedEstimateProps) {
  const [customerName, setCustomerName] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')
  const [jobSite, setJobSite] = useState('')
  const [taxRate, setTaxRate] = useState(estimate.taxRate)
  const [taxAutoDetected, setTaxAutoDetected] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [revisionHistoryOpen, setRevisionHistoryOpen] = useState(false)

  const displayTaxAmount = estimate.subtotal * (taxRate / 100)
  const displayTotal = estimate.subtotal + displayTaxAmount

  const [todaysJobs, setTodaysJobs] = useState<HCPJob[]>([])
  const [jobsLoading, setJobsLoading] = useState(false)
  const [jobsError, setJobsError] = useState<string | null>(null)
  const [selectedJob, setSelectedJob] = useState<HCPJob | null>(null)

  const [customerSearch, setCustomerSearch] = useState('')
  const [searchResults, setSearchResults] = useState<HCPCustomer[]>([])
  const [searching, setSearching] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [showCreateCustomer, setShowCreateCustomer] = useState(false)
  const [newFirstName, setNewFirstName] = useState('')
  const [newLastName, setNewLastName] = useState('')
  const [creatingCustomer, setCreatingCustomer] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    if (!hcpApiKey) return
    setJobsLoading(true)
    setJobsError(null)
    fetchTodaysSchedule(hcpApiKey)
      .then(jobs => setTodaysJobs(jobs))
      .catch(err => setJobsError(err instanceof Error ? err.message : 'Failed to load schedule'))
      .finally(() => setJobsLoading(false))
  }, [hcpApiKey])

  function selectJob(job: HCPJob) {
    setSelectedJob(job)
    setSearchResults([])
    setCustomerSearch('')
    const name = [job.customer.first_name, job.customer.last_name].filter(Boolean).join(' ')
    setCustomerName(name)
    if (job.address) {
      const { street, city, state, zip } = job.address
      setCustomerAddress([street, city, state, zip].filter(Boolean).join(', '))
      const detected = detectTaxRateByCity(city)
      if (detected !== null) {
        setTaxRate(detected)
        setTaxAutoDetected(city)
      } else {
        setTaxAutoDetected(null)
      }
    } else {
      setCustomerAddress('')
      setTaxAutoDetected(null)
    }
  }

  function selectCustomerFromSearch(customer: HCPCustomer) {
    const primaryAddress = customer.addresses?.[0]
    const pseudoJob: HCPJob = {
      id: customer.id,
      customer,
      work_status: 'new_estimate',
      _entryType: 'Estimate',
      address: primaryAddress,
    }
    selectJob(pseudoJob)
  }

  function handleCustomerSearchChange(value: string) {
    setCustomerSearch(value)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (!value.trim() || !hcpApiKey) {
      setSearchResults([])
      return
    }
    searchTimer.current = setTimeout(async () => {
      setSearching(true)
      try {
        const results = await searchCustomers(value, hcpApiKey)
        setSearchResults(results)
      } catch {
        setSearchResults([])
      } finally {
        setSearching(false)
      }
    }, 400)
  }

  function formatTime(iso?: string) {
    if (!iso) return ''
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }

  const laborItems = estimate.lineItems.filter(i => i.type === 'labor')
  const materialItems = estimate.lineItems.filter(i => i.type === 'material')

  async function handleCreateCustomer() {
    if (!hcpApiKey || !newFirstName.trim()) return
    setCreatingCustomer(true)
    setCreateError(null)
    try {
      const customer = await createCustomer(hcpApiKey, newFirstName.trim(), newLastName.trim())
      selectCustomerFromSearch(customer)
      setShowCreateCustomer(false)
      setNewFirstName('')
      setNewLastName('')
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create customer')
    } finally {
      setCreatingCustomer(false)
    }
  }

  async function handleSubmit() {
    if (hcpApiKey && !selectedJob) {
      setSubmitError('Please select or create a customer before submitting.')
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      await submitToHCP(estimate, hcpApiKey, selectedJob ?? undefined)
      setSubmitted(true)
      setTimeout(() => onStartOver(), 2000)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Submission failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="submit-success-screen">
        <div className="submit-success-icon">✓</div>
        <h2>Estimate saved!</h2>
        <p>Starting a new estimate…</p>
        <div className="spinner-large" />
      </div>
    )
  }

  return (
    <div className="finalized-estimate">
      {/* Back button */}
      <button className="back-btn" onClick={onBack}>
        ← Back to estimate
      </button>

      {/* Today's schedule — only shown when HCP key is configured */}
      {hcpApiKey && (
        <div className="hcp-schedule-section">
          <div className="hcp-schedule-header">
            <h3 className="hcp-schedule-title">Today's schedule</h3>
            {jobsLoading && <div className="spinner-sm" />}
          </div>
          {jobsError && (
            <div className="hcp-error">
              <strong>Could not load schedule:</strong> {jobsError}
              {jobsError.includes('CORS') || jobsError.includes('Failed to fetch') ? (
                <p className="hcp-error-hint">The Housecall Pro API may not allow direct browser access. A server proxy is needed for production use.</p>
              ) : null}
            </div>
          )}
          {!jobsLoading && !jobsError && todaysJobs.length === 0 && (
            <p className="hcp-no-jobs">No jobs scheduled for today, or none returned by the API.</p>
          )}
          {todaysJobs.length > 0 && (
            <div className="hcp-job-list">
              {todaysJobs.map(job => {
                const name = [job.customer.first_name, job.customer.last_name].filter(Boolean).join(' ')
                const addr = job.address ? `${job.address.street}, ${job.address.city}` : ''
                const time = formatTime(job.scheduled_start)
                const isSelected = job.id === selectedJob?.id
                return (
                  <button
                    key={job.id}
                    className={`hcp-job-card ${isSelected ? 'hcp-job-selected' : ''}`}
                    onClick={() => selectJob(job)}
                  >
                    <div className="hcp-job-name">{name || 'Unknown customer'}</div>
                    {time && <div className="hcp-job-time">{time}</div>}
                    {addr && <div className="hcp-job-addr">{addr}</div>}
                    <div className="hcp-job-badges">
                      {job._entryType && (
                        <span className={`hcp-entry-type hcp-entry-${job._entryType.toLowerCase()}`}>{job._entryType}</span>
                      )}
                      {job.work_status && <span className="hcp-job-status">{job.work_status.replace(/_/g, ' ')}</span>}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
          {selectedJob && (
            <p className="hcp-selected-hint">Customer info filled in below — you can still edit it.</p>
          )}

          {/* Customer search */}
          <div className="hcp-search-section">
            <label className="hcp-search-label">Search customers by name</label>
            <div className="hcp-search-row">
              <input
                className="field-input hcp-search-input"
                type="text"
                placeholder="Type customer name…"
                value={customerSearch}
                onChange={(e) => handleCustomerSearchChange(e.target.value)}
                autoComplete="off"
              />
              {searching && <div className="spinner-sm" />}
            </div>
            {searchResults.length > 0 && (
              <div className="hcp-job-list hcp-search-results">
                {searchResults.map(c => {
                  const name = [c.first_name, c.last_name].filter(Boolean).join(' ')
                  const sub = [c.email, c.mobile_number || c.home_number].filter(Boolean).join(' · ')
                  return (
                    <button
                      key={c.id}
                      className="hcp-job-card"
                      onClick={() => selectCustomerFromSearch(c)}
                    >
                      <div className="hcp-job-name">{name || 'Unnamed customer'}</div>
                      {sub && <div className="hcp-job-addr">{sub}</div>}
                      {c.company && <div className="hcp-job-addr">{c.company}</div>}
                    </button>
                  )
                })}
              </div>
            )}
            {customerSearch.trim() && !searching && searchResults.length === 0 && (
              <p className="hcp-no-jobs">No customers found for "{customerSearch}"</p>
            )}

            {/* Create new customer */}
            {!showCreateCustomer ? (
              <button className="btn-ghost hcp-create-customer-btn" onClick={() => setShowCreateCustomer(true)}>
                + New customer
              </button>
            ) : (
              <div className="hcp-create-customer-form">
                <p className="hcp-search-label">Create new customer</p>
                <div className="hcp-create-customer-fields">
                  <input
                    className="field-input"
                    type="text"
                    placeholder="First name"
                    value={newFirstName}
                    onChange={(e) => setNewFirstName(e.target.value)}
                    autoFocus
                  />
                  <input
                    className="field-input"
                    type="text"
                    placeholder="Last name"
                    value={newLastName}
                    onChange={(e) => setNewLastName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreateCustomer()}
                  />
                </div>
                {createError && <p className="hcp-error" style={{ marginTop: 6 }}>{createError}</p>}
                <div className="hcp-create-customer-actions">
                  <button
                    className="btn-primary"
                    onClick={handleCreateCustomer}
                    disabled={creatingCustomer || !newFirstName.trim()}
                  >
                    {creatingCustomer ? 'Creating…' : 'Create customer'}
                  </button>
                  <button className="btn-ghost" onClick={() => { setShowCreateCustomer(false); setCreateError(null) }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Document header */}
      <div className="doc-header">
        <h1 className="doc-main-title">Electrical Estimate</h1>
        <div className="doc-meta">
          <span>Date: {new Date(estimate.createdAt).toLocaleDateString()}</span>
          <span> · </span>
          <span>
            By:{' '}
            <input
              className="inline-input"
              value={electricianName}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="Your name"
            />
          </span>
        </div>
        <h2 className="doc-job-title">{estimate.jobTitle}</h2>
      </div>

      {/* Customer */}
      <div className="doc-section customer-section">
        <h3>Customer</h3>
        <div className="customer-fields">
          <input className="field-input" placeholder="Customer name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          <input className="field-input" placeholder="Customer address" value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} />
          <input className="field-input" placeholder="Job site (if different)" value={jobSite} onChange={(e) => setJobSite(e.target.value)} />
        </div>
      </div>

      {/* Scope of Work */}
      <div className="doc-section">
        <h3>Scope of Work</h3>
        {estimate.scopeOfWork ? (
          <pre className="scope-text scope-professional">{estimate.scopeOfWork}</pre>
        ) : (
          <p className="scope-text">{estimate.audioSummary}</p>
        )}
      </div>

      {/* Customer Notes */}
      {estimate.customerNotes?.trim() && (
        <div className="doc-section">
          <h3>Customer Notes</h3>
          <p className="scope-text">{estimate.customerNotes}</p>
        </div>
      )}

      {/* Labor */}
      {laborItems.length > 0 && (
        <div className="doc-section">
          <h3>Labor</h3>
          <table className="print-table">
            <thead>
              <tr><th>Description</th><th>Hrs</th><th>Rate</th><th>Amount</th></tr>
            </thead>
            <tbody>
              {laborItems.map((item) => (
                <tr key={item.id} className={item.flagged ? 'row-flagged' : ''}>
                  <td>{item.flagged && '⚠ '}{item.description}</td>
                  <td>{item.quantity}</td>
                  <td>${item.unitPrice.toFixed(2)}</td>
                  <td>${item.subtotal.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Materials */}
      {materialItems.length > 0 && (
        <div className="doc-section">
          <h3>Materials</h3>
          <table className="print-table">
            <thead>
              <tr><th>Description</th><th>Qty</th><th>Unit</th><th>Unit $</th><th>Amount</th></tr>
            </thead>
            <tbody>
              {materialItems.map((item) => (
                <tr key={item.id} className={item.flagged ? 'row-flagged' : ''}>
                  <td>{item.flagged && '⚠ '}{item.description}</td>
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

      {/* Tax rate picker */}
      <div className="doc-section tax-rate-section">
        <div className="tax-rate-header">
          <label className="tax-rate-label">Tax rate</label>
          {taxAutoDetected && (
            <span className="tax-auto-badge">Auto-detected from {taxAutoDetected}</span>
          )}
        </div>
        <div className="tax-rate-row">
          <select
            className="field-input tax-rate-select"
            value={LAFAYETTE_TAX_RATES.find(e => e.rate === taxRate)?.rate ?? ''}
            onChange={(e) => {
              const val = parseFloat(e.target.value)
              if (!isNaN(val)) { setTaxRate(val); setTaxAutoDetected(null) }
            }}
          >
            <option value="">— Select area —</option>
            {LAFAYETTE_TAX_RATES.map(entry => (
              <option key={entry.label} value={entry.rate}>{entry.label}</option>
            ))}
          </select>
          <span className="tax-rate-custom-label">or enter:</span>
          <input
            className="field-input tax-rate-input"
            type="number"
            min="0"
            max="20"
            step="0.05"
            value={taxRate}
            onChange={(e) => { setTaxRate(parseFloat(e.target.value) || 0); setTaxAutoDetected(null) }}
          />
          <span className="tax-rate-pct">%</span>
        </div>
      </div>

      {/* Totals */}
      <div className="doc-section totals-block">
        <div className="totals-row"><span>Subtotal</span><span>${estimate.subtotal.toFixed(2)}</span></div>
        {taxRate > 0 && (
          <div className="totals-row"><span>Tax ({taxRate}%)</span><span>${displayTaxAmount.toFixed(2)}</span></div>
        )}
        <div className="totals-row totals-total"><span>Total</span><span>${displayTotal.toFixed(2)}</span></div>
      </div>

      {/* Flagged notes */}
      {estimate.flaggedItems.length > 0 && (
        <div className="doc-section flagged-notes">
          <h3>Notes / Follow-Up Items</h3>
          <ul>{estimate.flaggedItems.map((item, i) => <li key={i}>{item}</li>)}</ul>
        </div>
      )}

      {/* Revision history */}
      {estimate.revisionHistory.length > 0 && (
        <div className="doc-section">
          <button className="accordion-header" onClick={() => setRevisionHistoryOpen(x => !x)}>
            Revision history ({estimate.revisionHistory.length})
            <span>{revisionHistoryOpen ? '▲' : '▼'}</span>
          </button>
          {revisionHistoryOpen && (
            <div className="revision-history">
              {estimate.revisionHistory.map((rev) => (
                <div key={rev.id} className="revision-entry">
                  <div className="revision-timestamp">{new Date(rev.timestamp).toLocaleString()}</div>
                  <ul>{rev.changesApplied.map((c, i) => <li key={i}>{c}</li>)}</ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="doc-actions">
        {hcpApiKey && !selectedJob && (
          <div className="hcp-error hcp-no-customer-warning" style={{ marginBottom: 8 }}>
            No customer selected — search for an existing customer or create a new one above before submitting.
          </div>
        )}
        {submitError && (
          <div className="hcp-error" style={{ marginBottom: 8 }}>
            <strong>Submission failed:</strong> {submitError}
          </div>
        )}
        <button
          className="btn-primary btn-submit"
          onClick={handleSubmit}
          disabled={submitting || (!!hcpApiKey && !selectedJob)}
        >
          {submitting ? 'Saving…' : selectedJob ? `Submit to HCP — ${[selectedJob.customer.first_name, selectedJob.customer.last_name].join(' ')}` : 'Submit to Housecall Pro'}
        </button>
        <button className="btn-ghost" onClick={onStartOver}>Start new estimate</button>
      </div>
    </div>
  )
}
