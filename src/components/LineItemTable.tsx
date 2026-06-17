import type { LineItem } from '../types/estimate'

interface LineItemTableProps {
  items: LineItem[]
  onUpdate: (id: string, field: keyof LineItem, value: string | number | boolean) => void
  onDelete?: (id: string) => void
  onAdd?: (type: 'labor' | 'material') => void
}

const PRICE_SOURCE_DOT: Record<string, string> = {
  supplier_api: 'dot-green',
  ai_estimate: 'dot-yellow',
  needs_review: 'dot-red',
}

export function LineItemTable({ items, onUpdate, onDelete, onAdd }: LineItemTableProps) {
  const laborItems = items.filter(i => i.type === 'labor')
  const materialItems = items.filter(i => i.type === 'material')

  function handleQtyOrPrice(id: string, field: 'quantity' | 'unitPrice', raw: string) {
    const val = parseFloat(raw) || 0
    onUpdate(id, field, val)
  }

  function renderItem(item: LineItem) {
    const isLabor = item.type === 'labor'
    return (
      <div key={item.id} className={`line-item-card ${item.flagged ? 'item-flagged' : ''}`}>
        <div className="item-row-top">
          <input
            className="item-input item-description"
            type="text"
            value={item.description}
            onChange={(e) => onUpdate(item.id, 'description', e.target.value)}
            placeholder="Description"
          />
          {onDelete && (
            <button className="item-delete-btn" onClick={() => onDelete(item.id)} title="Remove line item">
              ×
            </button>
          )}
        </div>
        <div className="item-row-bottom">
          <div className="item-field">
            <label className="item-field-label">{isLabor ? 'Hours' : 'Qty'}</label>
            <input
              className="item-input item-qty"
              type="number"
              value={item.quantity}
              min="0"
              step={isLabor ? '0.5' : '1'}
              onChange={(e) => handleQtyOrPrice(item.id, 'quantity', e.target.value)}
            />
          </div>
          {!isLabor && (
            <div className="item-field">
              <label className="item-field-label">Unit</label>
              <input
                className="item-input item-unit"
                type="text"
                value={item.unit}
                onChange={(e) => onUpdate(item.id, 'unit', e.target.value)}
                placeholder="ea"
              />
            </div>
          )}
          <div className="item-field">
            <label className="item-field-label">{isLabor ? '$/hr' : 'Unit $'}</label>
            <input
              className="item-input item-price"
              type="number"
              value={item.unitPrice}
              min="0"
              step="0.01"
              onChange={(e) => handleQtyOrPrice(item.id, 'unitPrice', e.target.value)}
            />
          </div>
          <div className="item-field item-subtotal-field">
            <label className="item-field-label">Total</label>
            <span className="item-subtotal">${item.subtotal.toFixed(2)}</span>
          </div>
          {item.priceSource && (
            <div className="item-source-dot">
              <span
                className={`price-dot ${PRICE_SOURCE_DOT[item.priceSource] ?? ''}`}
                title={item.priceSource === 'supplier_api' ? 'Supplier price' : item.priceSource === 'ai_estimate' ? 'AI estimate' : 'Needs review'}
              />
              {item.confidence && item.confidence !== 'high' && (
                <span className={`confidence-badge conf-${item.confidence}`}>{item.confidence}</span>
              )}
            </div>
          )}
        </div>
        {item.flagged && <div className="item-flag-note">⚠ Needs review</div>}
      </div>
    )
  }

  function renderSection(sectionItems: LineItem[], title: string, type: 'labor' | 'material') {
    return (
      <div className="line-item-section">
        <h3 className="section-title">{title}</h3>
        <div className="line-item-cards">
          {sectionItems.map(renderItem)}
        </div>
        {onAdd && (
          <button className="add-item-btn" onClick={() => onAdd(type)}>
            + Add {type === 'labor' ? 'labor' : 'material'} line
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="line-items-container">
      {renderSection(laborItems, 'Labor', 'labor')}
      {renderSection(materialItems, 'Materials', 'material')}
    </div>
  )
}
