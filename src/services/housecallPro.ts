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

function toHcpItem(item: Estimate['lineItems'][number]) {
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

function serviceItemsPayload(estimate: Estimate) {
  return estimate.lineItems.filter(i => i.type === 'labor').map(toHcpItem)
}

function materialItemsPayload(estimate: Estimate) {
  return estimate.lineItems.filter(i => i.type === 'material').map(toHcpItem)
}

export async function createCustomer(
  apiKey: string,
  firstName: string,
  lastName: string,
): Promise<HCPCustomer> {
  const data = await hcpFetch(apiKey, '/customers', {
    method: 'POST',
    body: JSON.stringify({ first_name: firstName, last_name: lastName }),
  })
  return data.customer ?? data
}

export async function submitToHCP(estimate: Estimate, apiKey?: string, selectedJob?: HCPJob): Promise<void> {
  if (!apiKey || !selectedJob) {
    console.log('[HCP] No API key or selected job — skipping real submission')
    await new Promise((resolve) => setTimeout(resolve, 500))
    return
  }

  const services = serviceItemsPayload(estimate)
  const materials = materialItemsPayload(estimate)
  const noteLines = [
    estimate.scopeOfWork || estimate.audioSummary || estimate.jobTitle,
    estimate.customerNotes?.trim() ? `Customer notes: ${estimate.customerNotes.trim()}` : '',
  ].filter(Boolean)
  const note = noteLines.join('\n\n')

  console.log('[HCP] Submitting', services.length, 'service + ', materials.length, 'material items to', selectedJob._entryType, selectedJob.id)

  if (selectedJob._entryType === 'Estimate') {
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
    const created = await hcpFetch(apiKey, '/estimates', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    console.log('[HCP] Created estimate:', JSON.stringify(created, null, 2))

  } else {
    // For a Job entry: add services and materials directly to the job
    console.log('[HCP] Adding line items to job…')
    for (const item of services) {
      await hcpFetch(apiKey, `/jobs/${selectedJob.id}/line_items`, {
        method: 'POST',
        body: JSON.stringify(item),
      })
    }
    for (const item of materials) {
      await hcpFetch(apiKey, `/jobs/${selectedJob.id}/line_items`, {
        method: 'POST',
        body: JSON.stringify(item),
      })
    }
  }

  console.log('[HCP] Done.')
}
