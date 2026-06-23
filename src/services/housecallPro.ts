import type { Estimate } from '../types/estimate'

export interface HCPAddress {
  id: string
  street: string
  city: string
  state: string
  zip: string
}

export interface HCPCustomer {
  id: string
  first_name: string
  last_name: string
  email?: string
  mobile_number?: string
  home_number?: string
  company?: string
  addresses?: HCPAddress[]
}

export interface LafayetteTaxEntry {
  label: string
  rate: number
  cities: string[]
}

// Sales tax rates for the Lafayette, LA metro area (2026)
// State: 5% + local add-ons vary by city. Source: salestaxhandbook.com
export const LAFAYETTE_TAX_RATES: LafayetteTaxEntry[] = [
  { label: 'Duson — 11.25%',                      rate: 11.25, cities: ['duson'] },
  { label: 'Lafayette (city) — 11%',               rate: 11.0,  cities: ['lafayette'] },
  { label: 'Scott — 11%',                          rate: 11.0,  cities: ['scott'] },
  { label: 'Broussard — 11%',                      rate: 11.0,  cities: ['broussard'] },
  { label: 'Carencro — 11%',                       rate: 11.0,  cities: ['carencro'] },
  { label: 'Youngsville — 10.5%',                  rate: 10.5,  cities: ['youngsville'] },
  { label: 'Unincorporated Lafayette Parish — 9%', rate: 9.0,   cities: [] },
]

export function detectTaxRateByCity(city: string): number | null {
  const lower = city.toLowerCase().trim()
  for (const entry of LAFAYETTE_TAX_RATES) {
    if (entry.cities.includes(lower)) return entry.rate
  }
  return null
}

export interface HCPJob {
  id: string
  customer: HCPCustomer
  address?: HCPAddress
  work_status: string
  scheduled_start?: string
  scheduled_end?: string
  note?: string
  invoice_number?: string
  _entryType?: 'Job' | 'Estimate'
}

const IS_PROD = !import.meta.env.DEV

function hcpFullPath(path: string) {
  // Dev: /hcp-api/customers → Vite strips prefix, hits HCP directly
  // Prod: /api/hcp/customers → Worker proxy injects the HCP API key
  return IS_PROD ? `/api/hcp${path}` : `/hcp-api${path}`
}

function hcpHeaders(apiKey: string) {
  return {
    // In production the Worker injects Authorization — don't expose key in browser
    ...(IS_PROD ? {} : { Authorization: `Token ${apiKey}` }),
    'Content-Type': 'application/json',
  }
}

async function hcpFetch(apiKey: string, path: string, options?: RequestInit) {
  const res = await fetch(hcpFullPath(path), {
    ...options,
    headers: { ...hcpHeaders(apiKey), ...(options?.headers ?? {}) },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    console.error('[HCP] Error body:', text)
    throw new Error(`Housecall Pro error ${res.status}: ${text}`)
  }
  return res.json()
}

async function fetchFromHCP(apiKey: string, endpoint: string, params: URLSearchParams): Promise<HCPJob[]> {
  const res = await fetch(`${hcpFullPath(`/${endpoint}`)}?${params}`, {
    headers: hcpHeaders(apiKey),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Housecall Pro error ${res.status}: ${text}`)
  }
  const data = await res.json()
  return data[endpoint] ?? []
}

export async function searchCustomers(query: string, apiKey: string): Promise<HCPCustomer[]> {
  if (!query.trim()) return []
  const params = new URLSearchParams({ q: query.trim(), per_page: '10', page: '1' })
  const data = await hcpFetch(apiKey, `/customers?${params}`, { method: 'GET' })
  return data.customers ?? []
}

export async function fetchTodaysSchedule(apiKey: string): Promise<HCPJob[]> {
  const now = new Date()
  const startOfDay = new Date(now)
  startOfDay.setHours(0, 0, 0, 0)
  const endOfDay = new Date(now)
  endOfDay.setHours(23, 59, 59, 999)

  const params = new URLSearchParams({
    per_page: '50',
    page: '1',
    scheduled_start_min: startOfDay.toISOString(),
    scheduled_start_max: endOfDay.toISOString(),
  })

  const [jobs, estimates] = await Promise.allSettled([
    fetchFromHCP(apiKey, 'jobs', params).then(items =>
      items.map(j => ({ ...j, _entryType: 'Job' as const }))
    ),
    fetchFromHCP(apiKey, 'estimates', params).then(items =>
      items.map(e => ({ ...e, _entryType: 'Estimate' as const }))
    ),
  ])

  const results: HCPJob[] = []
  if (jobs.status === 'fulfilled') results.push(...jobs.value)
  if (estimates.status === 'fulfilled') results.push(...estimates.value)

  results.sort((a, b) => {
    if (!a.scheduled_start) return 1
    if (!b.scheduled_start) return -1
    return a.scheduled_start.localeCompare(b.scheduled_start)
  })

  return results
}

type EstimateLineItem = Estimate['lineItems'][number]

function toHcpItem(item: EstimateLineItem) {
  return {
    name: item.description || (item.type === 'labor' ? 'Labor' : 'Material'),
    description: item.description,
    quantity: item.quantity,
    // HCP expects unit_price in cents (integer), not dollars
    unit_price: Math.round(item.unitPrice * 100),
    unit_cost: 0,
    // Materials are taxable in Louisiana; labor is not for residential work
    taxable: item.type === 'material',
  }
}

/** The job/project an item belongs to. Falls back to a single bucket if untagged. */
function groupKey(item: EstimateLineItem): string {
  return (item.jobGroup && item.jobGroup.trim()) || 'Project'
}

// One labor line per project — already produced that way by the AI, sent as-is.
function serviceItemsPayload(estimate: Estimate) {
  return estimate.lineItems.filter(i => i.type === 'labor').map(toHcpItem)
}

/**
 * One lump-sum material line per project. HCP shows e.g. "Tesla charger install
 * materials" with the project's total material cost — NOT every screw and wire.
 * The itemized breakdown goes into the notes instead (see materialsBreakdownNote).
 */
function materialItemsPayload(estimate: Estimate) {
  const materials = estimate.lineItems.filter(i => i.type === 'material')
  const groups = new Map<string, number>()
  for (const m of materials) {
    groups.set(groupKey(m), (groups.get(groupKey(m)) ?? 0) + m.subtotal)
  }
  return Array.from(groups.entries()).map(([job, total]) => ({
    name: `${job} — materials`,
    description: `Materials for ${job} (itemized in notes)`,
    quantity: 1,
    unit_price: Math.round(total * 100),
    unit_cost: 0,
    taxable: true,
  }))
}

/** Itemized per-project materials list for the HCP private/customer notes. */
function materialsBreakdownNote(estimate: Estimate): string {
  const materials = estimate.lineItems.filter(i => i.type === 'material')
  if (materials.length === 0) return ''
  const groups = new Map<string, EstimateLineItem[]>()
  for (const m of materials) {
    const k = groupKey(m)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(m)
  }
  const sections: string[] = ['MATERIALS BREAKDOWN']
  for (const [job, items] of groups) {
    const total = items.reduce((s, i) => s + i.subtotal, 0)
    sections.push(`\n${job} — materials ($${total.toFixed(2)}):`)
    for (const i of items) {
      sections.push(`  • ${i.description} — ${i.quantity} ${i.unit} @ $${i.unitPrice.toFixed(2)} = $${i.subtotal.toFixed(2)}`)
    }
  }
  return sections.join('\n')
}

export interface NewCustomerInput {
  firstName: string
  lastName: string
  phone?: string
}

export async function createCustomer(
  apiKey: string,
  input: NewCustomerInput,
): Promise<HCPCustomer> {
  const body: Record<string, unknown> = {
    first_name: input.firstName,
    last_name: input.lastName,
  }
  if (input.phone?.trim()) body.mobile_number = input.phone.trim()
  const data = await hcpFetch(apiKey, '/customers', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return data.customer ?? data
}

/** Optional appointment for a new estimate/job. */
export interface HCPSchedule {
  start: string // ISO8601
  end: string   // ISO8601
}

export async function submitToHCP(
  estimate: Estimate,
  apiKey?: string,
  selectedJob?: HCPJob,
  schedule?: HCPSchedule | null,
): Promise<void> {
  // In production the Worker injects the HCP key — apiKey is not required
  if ((!apiKey && !IS_PROD) || !selectedJob) {
    console.log('[HCP] No API key or selected job — skipping real submission')
    await new Promise((resolve) => setTimeout(resolve, 500))
    return
  }
  const key = apiKey ?? ''

  const services = serviceItemsPayload(estimate)
  const materials = materialItemsPayload(estimate)
  const breakdown = materialsBreakdownNote(estimate)
  const noteLines = [
    estimate.scopeOfWork || estimate.audioSummary || estimate.jobTitle,
    estimate.customerNotes?.trim() ? `Customer notes: ${estimate.customerNotes.trim()}` : '',
    breakdown,
  ].filter(Boolean)
  const note = noteLines.join('\n\n')

  console.log('[HCP] Submitting', services.length, 'service + ', materials.length, 'material lines to', selectedJob._entryType, selectedJob.id)

  // New customer/estimate WITH an appointment → create a scheduled Job instead.
  if (selectedJob._entryType === 'Estimate' && schedule) {
    console.log('[HCP] Creating scheduled job for customer', selectedJob.customer.id)
    const jobPayload: Record<string, unknown> = {
      customer_id: selectedJob.customer.id,
      line_items: [...services, ...materials],
      note,
      schedule: {
        scheduled_start: schedule.start,
        scheduled_end: schedule.end,
        arrival_window: 0,
      },
    }
    if (selectedJob.address?.id) jobPayload.address_id = selectedJob.address.id
    const createdJob = await hcpFetch(key, '/jobs', {
      method: 'POST',
      body: JSON.stringify(jobPayload),
    })
    console.log('[HCP] Created scheduled job:', JSON.stringify(createdJob, null, 2))

  } else if (selectedJob._entryType === 'Estimate') {
    console.log('[HCP] Creating new estimate for customer', selectedJob.customer.id)
    const payload: Record<string, unknown> = {
      customer_id: selectedJob.customer.id,
      note,
      options: [{
        name: 'Option #1',
        line_items: services,
        materials,
      }],
    }
    if (selectedJob.address?.id) payload.address_id = selectedJob.address.id
    const created = await hcpFetch(key, '/estimates', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    console.log('[HCP] Created estimate:', JSON.stringify(created, null, 2))

  } else {
    // For a Job entry: add services and materials directly to the job
    console.log('[HCP] Adding line items to job…')
    for (const item of services) {
      await hcpFetch(key, `/jobs/${selectedJob.id}/line_items`, {
        method: 'POST',
        body: JSON.stringify(item),
      })
    }
    for (const item of materials) {
      await hcpFetch(key, `/jobs/${selectedJob.id}/line_items`, {
        method: 'POST',
        body: JSON.stringify(item),
      })
    }
    // Save the itemized materials breakdown + scope onto the job's note.
    if (note.trim()) {
      await hcpFetch(key, `/jobs/${selectedJob.id}`, {
        method: 'PUT',
        body: JSON.stringify({ note }),
      }).catch(err => console.warn('[HCP] Could not update job note:', err))
    }
  }

  console.log('[HCP] Done.')
}
