/**
 * Cloudflare Worker — all backend logic lives here.
 * Secrets set via `wrangler secret put` or `.dev.vars` (local only):
 *   ANTHROPIC_API_KEY   (required)
 *   OPENAI_API_KEY      (required for Whisper transcription)
 *   HCP_API_KEY         (required for HouseCall Pro)
 *   ACCESS_CODE         (optional — if set, PIN gate is enforced)
 *   ALLOWED_ORIGIN      (e.g. https://estimate.clarity-ai-consulting.com, or * for dev)
 */

import Anthropic from '@anthropic-ai/sdk'

interface Env {
  ANTHROPIC_API_KEY: string
  OPENAI_API_KEY: string
  HCP_API_KEY: string
  ACCESS_CODE: string
  ALLOWED_ORIGIN: string
}

// ─── Default prompts (mirror src/services/settings.ts) ───────────────────────

const ESTIMATE_SYSTEM_PROMPT = `You are an expert electrician's assistant. Given a description of electrical work (either a transcript or a plain text description), generate a detailed, professional estimate.

Steps:
1. Identify the distinct PROJECTS at the worksite. A project is a whole installation, e.g. "Install Tesla charger" or "Install generator". A single worksite may have multiple projects — keep them as separate groups, but understand they are part of the same estimate.
2. For EACH project, create exactly ONE labor line item. The description is the concise project name (e.g. "Install Tesla charger", "Install generator") — NOT a breakdown of sub-steps. Do NOT split labor into "run cable", "install breaker", "connect wire", etc. The quantity is the TOTAL hours for the entire project at $95/hr. Set jobGroup to that same project name.
3. For each project, infer ALL materials a real electrician would need with realistic quantities and current market prices. Each material is its own line item, and its jobGroup MUST match the project name from its labor line so materials stay linked to the right project.
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
      "jobGroup": "project name, e.g. Install Tesla charger",
      "description": "concise project name (same as jobGroup)",
      "quantity": number,
      "unit": "hrs",
      "unitPrice": 95,
      "subtotal": number,
      "flagged": false
    },
    {
      "id": "unique string",
      "type": "material",
      "jobGroup": "project name this material belongs to (must match a labor line's jobGroup)",
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
  "taxRate": 0,
  "taxAmount": 0,
  "total": number,
  "flaggedItems": ["string describing flagged items"],
  "revisionHistory": []
}`

const REVISION_SYSTEM_PROMPT = `You are an expert electrician's assistant. You have the current estimate JSON and a description of changes to make (either a transcript or plain text).

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}

function jsonResponse(data: unknown, status = 200, origin: string): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  })
}

function parseJson(text: string) {
  const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  return JSON.parse(cleaned)
}

function recalcTotals(estimate: {
  lineItems: Array<{ subtotal: number }>
  taxRate: number
  subtotal?: number
  taxAmount?: number
  total?: number
}) {
  estimate.subtotal = estimate.lineItems.reduce((s, i) => s + i.subtotal, 0)
  estimate.taxAmount = estimate.subtotal * ((estimate.taxRate || 0) / 100)
  estimate.total = estimate.subtotal + estimate.taxAmount
  return estimate
}

// ─── OpenAI Whisper transcription ────────────────────────────────────────────

async function transcribeWithWhisper(audioBlob: Blob, mimeType: string, openaiApiKey: string): Promise<string> {
  const ext = (mimeType.includes('mp4') || mimeType.includes('m4a')) ? 'm4a' : 'webm'
  const form = new FormData()
  form.append('file', audioBlob, `recording.${ext}`)
  form.append('model', 'whisper-1')

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiApiKey}` },
    body: form,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Whisper error ${res.status}: ${text}`)
  }

  const data = await res.json() as { text: string }
  return data.text ?? ''
}

// ─── Route handlers ───────────────────────────────────────────────────────────

async function handleAuth(request: Request, env: Env, origin: string): Promise<Response> {
  if (!env.ACCESS_CODE) return jsonResponse({ valid: true }, 200, origin)
  const body = await request.json() as { code?: string }
  return jsonResponse({ valid: body.code === env.ACCESS_CODE }, 200, origin)
}

async function handleProcessAudio(request: Request, env: Env, origin: string): Promise<Response> {
  const formData = await request.formData()
  const audioFiles = formData.getAll('audio').filter((a): a is File => a instanceof File)
  const textInput = formData.get('text') as string | null
  const customPrompt = formData.get('estimatePrompt') as string | null
  const pricingNotes = formData.get('pricingNotes') as string | null
  const jobNotes = formData.get('jobNotes') as string | null
  const pricingList = formData.get('pricingList') as string | null

  if (audioFiles.length === 0 && !textInput) {
    return jsonResponse({ error: 'Provide an audio file or text description' }, 400, origin)
  }

  let jobDescription: string
  if (textInput) {
    jobDescription = textInput
  } else {
    if (!env.OPENAI_API_KEY) {
      return jsonResponse({ error: 'OPENAI_API_KEY not configured in Worker secrets' }, 500, origin)
    }
    try {
      const transcripts: string[] = []
      for (const file of audioFiles) {
        transcripts.push(await transcribeWithWhisper(file, file.type || 'audio/webm', env.OPENAI_API_KEY))
      }
      jobDescription = transcripts
        .map((t, i) => audioFiles.length > 1 ? `[Recording ${i + 1}]\n${t}` : t)
        .join('\n\n')
    } catch (err) {
      return jsonResponse({
        error: `Transcription failed: ${err instanceof Error ? err.message : String(err)}`,
      }, 500, origin)
    }
  }

  let systemPrompt = customPrompt || ESTIMATE_SYSTEM_PROMPT
  if (jobNotes?.trim()) systemPrompt += `\n\nJob & task notes from the electrician:\n${jobNotes.trim()}`
  if (pricingList?.trim()) systemPrompt += `\n\nPricing reference / price list:\n${pricingList.trim()}`
  if (pricingNotes?.trim()) systemPrompt += `\n\nAdditional pricing context:\n${pricingNotes.trim()}`

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: `Generate a complete electrical estimate for this job description:\n\n${jobDescription}`,
    }],
  })

  const responseText = message.content[0].type === 'text' ? message.content[0].text : ''
  let estimate
  try {
    estimate = parseJson(responseText)
    if (!estimate.id) estimate.id = crypto.randomUUID()
    if (!estimate.createdAt) estimate.createdAt = new Date().toISOString()
    if (!estimate.revisionHistory) estimate.revisionHistory = []
    recalcTotals(estimate)
  } catch {
    return jsonResponse({ error: 'Failed to parse estimate from AI', raw: responseText }, 500, origin)
  }

  return jsonResponse(estimate, 200, origin)
}

async function handleReviseEstimate(request: Request, env: Env, origin: string): Promise<Response> {
  const formData = await request.formData()
  const audioFile = formData.get('audio') as File | null
  const textInput = formData.get('text') as string | null
  const estimateJson = formData.get('estimate') as string | null
  const customRevisionPrompt = formData.get('revisionPrompt') as string | null

  if ((!audioFile && !textInput) || !estimateJson) {
    return jsonResponse({ error: 'Missing revision (audio or text) and/or estimate' }, 400, origin)
  }

  let currentEstimate
  try { currentEstimate = JSON.parse(estimateJson) } catch {
    return jsonResponse({ error: 'Invalid estimate JSON' }, 400, origin)
  }

  let revisionText: string
  if (textInput) {
    revisionText = textInput
  } else {
    if (!env.OPENAI_API_KEY) {
      return jsonResponse({ error: 'OPENAI_API_KEY not configured in Worker secrets' }, 500, origin)
    }
    try {
      revisionText = await transcribeWithWhisper(audioFile!, audioFile!.type || 'audio/webm', env.OPENAI_API_KEY)
    } catch (err) {
      return jsonResponse({
        error: `Transcription failed: ${err instanceof Error ? err.message : String(err)}`,
      }, 500, origin)
    }
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system: customRevisionPrompt || REVISION_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Current estimate:\n${JSON.stringify(currentEstimate, null, 2)}\n\nRevision instructions:\n${revisionText}`,
    }],
  })

  const responseText = message.content[0].type === 'text' ? message.content[0].text : ''
  let result
  try { result = parseJson(responseText) } catch {
    return jsonResponse({ error: 'Failed to parse revision from AI', raw: responseText }, 500, origin)
  }

  const updatedEstimate = result.estimate || result
  const changesApplied: string[] = result.changesApplied || []

  updatedEstimate.revisionHistory = [
    ...(currentEstimate.revisionHistory || []),
    {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      audioTranscript: revisionText,
      changesApplied,
    },
  ]
  recalcTotals(updatedEstimate)
  return jsonResponse(updatedEstimate, 200, origin)
}

async function handleHcpProxy(request: Request, env: Env, origin: string, hcpPath: string): Promise<Response> {
  if (!env.HCP_API_KEY) {
    return jsonResponse({ error: 'HCP_API_KEY not configured in Worker secrets' }, 500, origin)
  }

  const url = new URL(request.url)
  const hcpUrl = `https://api.housecallpro.com${hcpPath}${url.search}`

  const proxyReq = new Request(hcpUrl, {
    method: request.method,
    headers: {
      Authorization: `Token ${env.HCP_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
  })

  const hcpRes = await fetch(proxyReq)
  const body = await hcpRes.text()

  return new Response(body, {
    status: hcpRes.status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  })
}

// ─── Main fetch handler ───────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const origin = env.ALLOWED_ORIGIN || '*'

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin) })
    }

    // HCP proxy — pass through any HTTP method
    if (url.pathname.startsWith('/api/hcp/')) {
      const hcpPath = url.pathname.replace('/api/hcp', '')
      return handleHcpProxy(request, env, origin, hcpPath)
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    try {
      if (url.pathname === '/api/auth') return handleAuth(request, env, origin)
      if (url.pathname === '/api/process-audio') return handleProcessAudio(request, env, origin)
      if (url.pathname === '/api/revise-estimate') return handleReviseEstimate(request, env, origin)
      return jsonResponse({ error: 'Not found' }, 404, origin)
    } catch (err) {
      console.error('[Worker] Unhandled error:', err)
      return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500, origin)
    }
  },
}
