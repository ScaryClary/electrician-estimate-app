import { useState } from 'react'
import type { LineItem } from '../types/estimate'

interface LineItemTableProps {
  items: LineItem[]
  onUpdate: (id: string, field: keyof LineItem, value: string | number | boolean) => void
}

const PRICE_SOURCE_COLORS: Record<string, string> = {
  supplier_api: 'dot-green',
  ai_estimate: 'dot-yellow',
  needs_review: 'dot-red',
}

const PRICE_SOURCE_LABELS: Record<string, string> = {
  supplier_api: 'Supplier price',
  ai_estimate: 'AI estimate',
  needs_review: 'Needs review',
}

interface EditableCellProps {
  value: string | number
  onSave: (val: string | number) => void
  type?: 'text' | 'number'
  prefix?: string
}

function EditableCell({ value, onSave, type = 'text', prefix }: EditableCellProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))

  function commit() {
    setEditing(false)
    const parsed = type === 'number' ? parseFloat(draft) || 0 : draft
    onSave(parsed)
  }

  if (editing) {
    return (
      <input
        className="cell-input"
        type={type}
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
      />
    )
  }

  return (
    <span className="cell-editable" onClick={() => { setDraft(String(value)); setEditing(true) }}>
      {prefix}{type === 'number' ? Number(value).toFixed(2) : value}
    </span>
  )
}

export function LineItemTable({ items, onUpdate }: LineItemTableProps) {
  const laborItems = items.filter(i => i.type === 'labor')
  const materialItems = items.filter(i => i.type === 'material')

  function renderSection(sectionItems: LineItem[], title: string) {
    if (sectionItems.length === 0) return null
    return (
      <div className="line-item-section">
        <h3 className="section-title">{title}</h3>
        <div className="line-item-table">
          <div className="table-header">
            <span>Description</span>
            <span>Qty</span>
            <span>Unit</span>
            <span>Unit Price</span>
            <span>Subtotal</span>
            <span>Source</span>
          </div>
          {sectionItems.map((item) => (
            <div key={item.id} className={`table-row ${item.flagged ? 'row-flagged' : ''}`}>
              <div className="cell cell-description">
                {item.flagged && <span className="flag-icon" title="Needs review">⚠️</span>}
                <EditableCell
                  value={item.description}
                  onSave={(val) => onUpdate(item.id, 'description', val)}
                />
              </div>
              <div className="cell cell-qty">
                <EditableCell
                  value={item.quantity}
                  type="number"
                  onSave={(val) => onUpdate(item.id, 'quantity', val)}
                />
              </div>
              <div className="cell cell-unit">
                <EditableCell
                  value={item.unit}
                  onSave={(val) => onUpdate(item.id, 'unit', val)}
                />
              </div>
              <div className="cell cell-price">
                <EditableCell
                  value={item.unitPrice}
                  type="number"
                  prefix="$"
                  onSave={(val) => onUpdate(item.id, 'unitPrice', val)}
                />
              </div>
              <div className="cell cell-subtotal">
                ${item.subtotal.toFixed(2)}
              </div>
              <div className="cell cell-source">
                {item.priceSource && (
                  <span
                    className={`price-dot ${PRICE_SOURCE_COLORS[item.priceSource]}`}
                    title={PRICE_SOURCE_LABELS[item.priceSource]}
                  />
                )}
                {item.confidence && item.confidence !== 'high' && (
                  <span className={`confidence-badge conf-${item.confidence}`}>{item.confidence}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="line-items-container">
      {renderSection(laborItems, 'Labor')}
      {renderSection(materialItems, 'Materials')}
    </div>
  )
}
