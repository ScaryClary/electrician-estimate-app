export interface AppSettings {
  apiKey: string
  hcpApiKey: string
  openAiApiKey: string
  estimateSystemPrompt: string
  revisionSystemPrompt: string
  laborRate: number
  defaultTaxRate: number
  pricingNotes: string
  jobNotes: string
  pricingList: string
}

const STORAGE_KEY = 'electrician_estimate_settings_v1'

export const DEFAULT_ESTIMATE_PROMPT = `You are an expert electrician's assistant. Given a description of electrical work (either a transcript or a plain text description), generate a detailed, professional estimate.

Steps:
1. Identify all distinct job tasks mentioned
2. For each task, create labor line items: description, estimated hours, {{LABOR_RATE}}/hr rate, subtotal
3. For each task, infer ALL materials a real electrician would need with realistic quantities and current market prices
4. Set confidence: "high" for standard items, "medium" if quantity is uncertain, "low" if you're inferring without clear signal
5. Flag any items needing the electrician's review (unusual scope, missing info, etc.)
6. Write a short 2-3 sentence audioSummary (for internal reference)
7. Extract customerNotes: anything specific the customer requested or mentioned
8. Create a short descriptive jobTitle
9. Write a professional scopeOfWork — this is the customer-facing document. Format it as plain text with clearly labeled sections:
   - One section per major task (section header on its own line, description paragraph below)
   - End with a "Notes, Contingencies & Exclusions" section listing assumptions, access requirements, what is/isn't included, and any conditions that could affect pricing
   - Write professionally in second/third person. Be specific about what work is being done and how.
   - Example section format: "Panel Upgrade\\nWe will install a new 200A main breaker panel, replace the meter base, install all new breakers..."
   - The contingencies section should cover things like: existing wiring condition assumptions, surface vs. concealed routing, permit requirements if applicable, what happens if walls need to be opened, customer-supplied vs. contractor-supplied materials

Return ONLY valid JSON (no markdown, no explanation):
{
  "id": "use crypto.randomUUID()",
  "createdAt": "ISO8601 timestamp",
  "audioSummary": "string",
  "scopeOfWork": "string — full professional scope with sections and contingencies, newlines as \\n",
  "customerNotes": "string",
  "jobTitle": "string",
  "lineItems": [
    {
      "id": "unique string",
      "type": "labor",
      "description": "string",
      "quantity": number,
      "unit": "hrs",
      "unitPrice": {{LABOR_RATE}},
      "subtotal": number,
      "flagged": false
    },
    {
      "id": "unique string",
      "type": "material",
      "description": "string",
      "quantity": number,
      "unit": "ea|ft|box|roll|bag|pk",
      "unitPrice": number,
      "subtotal": number,
      "priceSource": "ai_estimate",
      "confidence": "high|medium|low",
      "flagged": boolean
    }
  ],
  "subtotal": number,
  "taxRate": {{TAX_RATE}},
  "taxAmount": number,
  "total": number,
  "flaggedItems": ["string describing flagged items"],
  "revisionHistory": []
}`

export const DEFAULT_REVISION_PROMPT = `You are an expert electrician's assistant. You have the current estimate JSON and a description of changes to make (either a transcript or plain text).

Apply ALL changes described. Common types:
- Changing quantities (hours, footage, count)
- Adding new line items or tasks
- Removing items
- Correcting prices

Return ONLY valid JSON (no markdown):
{
  "estimate": { ...full updated estimate with all changes applied... },
  "changesApplied": ["Changed labor hours on panel replacement: 4 → 6 hrs", "Added: 50A sub-panel disconnect"]
}`

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  hcpApiKey: '',
  openAiApiKey: '',
  estimateSystemPrompt: DEFAULT_ESTIMATE_PROMPT,
  revisionSystemPrompt: DEFAULT_REVISION_PROMPT,
  laborRate: 95,
  defaultTaxRate: 0,
  pricingNotes: '',
  jobNotes: '',
  pricingList: '',
}

export function loadSettings(): AppSettings {
  const envDefaults = {
    apiKey: (import.meta.env.VITE_ANTHROPIC_API_KEY as string) || '',
    hcpApiKey: (import.meta.env.VITE_HCP_API_KEY as string) || '',
    openAiApiKey: (import.meta.env.VITE_OPENAI_API_KEY as string) || '',
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const stored = raw ? JSON.parse(raw) : {}
    return { ...DEFAULT_SETTINGS, ...envDefaults, ...stored }
  } catch {
    return { ...DEFAULT_SETTINGS, ...envDefaults }
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

export function resetSettings(): AppSettings {
  localStorage.removeItem(STORAGE_KEY)
  return { ...DEFAULT_SETTINGS }
}

export function resolvePrompt(template: string, settings: AppSettings): string {
  return template
    .replace(/\{\{LABOR_RATE\}\}/g, String(settings.laborRate))
    .replace(/\{\{TAX_RATE\}\}/g, String(settings.defaultTaxRate))
}
