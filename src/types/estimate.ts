export interface LineItem {
  id: string
  type: 'labor' | 'material'
  /** The project/job this line belongs to, e.g. "Install Tesla charger". Links labor + materials for the same job. */
  jobGroup?: string
  description: string
  quantity: number
  unit: string // 'hrs', 'ea', 'ft', 'box', etc.
  unitPrice: number
  subtotal: number
  priceSource?: 'supplier_api' | 'ai_estimate' | 'needs_review'
  confidence?: 'high' | 'medium' | 'low'
  flagged?: boolean
}

export interface Revision {
  id: string
  timestamp: string
  audioTranscript: string
  changesApplied: string[]
}

export interface Estimate {
  id: string
  createdAt: string
  audioSummary: string
  scopeOfWork?: string
  customerNotes: string
  jobTitle: string
  lineItems: LineItem[]
  subtotal: number
  taxRate: number
  taxAmount: number
  total: number
  flaggedItems: string[]
  revisionHistory: Revision[]
}
