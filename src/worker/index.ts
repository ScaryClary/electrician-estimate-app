/**
 * Cloudflare Worker — all backend logic lives here.
 * Secrets configured via wrangler secret put or .dev.vars (local only):
 *   - ANTHROPIC_API_KEY  (required)
 *   - ALLOWED_ORIGIN     (e.g. https://your-pages-domain.pages.dev, or * for dev)
 */

import Anthropic from '@anthropic-ai/sdk'

interface Env {
  ANTHROPIC_API_KEY: string
  ALLOWED_ORIGIN: string
}

const ESTIMATE_SYSTEM_PROMPT = `You are an expert electrician's assistant. Given a description of electrical work (either a transcript or a plain text description), generate a detailed, professional estimate.

Steps:
1. Identify all distinct job tasks mentioned (e.g. "replace panel", "run circuit to garage", "install GFCI outlets")
2. For each task, create labor line items: description, estimated hours, $95/hr rate, subtotal
3. For each task, infer ALL materials a real electrician would need. Think carefully:
   - "run a 20-amp circuit 50 feet to the garage" → 12AWG Romex (55ft with waste), 20A breaker, single-gang box, wire nuts, staples, connector fittings, etc.
   - Include realistic quantities and current market prices
4. Set confidence: "high" for standard items, "medium" if quantity is uncertain, "low" if you're inferring without clear signal
5. Flag any items needing the electrician's review (unusual scope, missing info, etc.)
6. Write a 3-5 sentence audioSummary of the job scope
7. Extract customerNotes: anything specific the customer requested
8. Create a short descriptive jobTitle

Return ONLY valid JSON (no markdown, no explanation):
{
  "id": "use crypto.randomUUID()",
  "createdAt": "ISO8601 timestamp",
  "audioSummary": "string",
  "customerNotes": "string",
  "jobTitle": "string",
  "lineItems": [
    {
      "id": "unique string",
      "type": "labor",
      "description": "string",
      "quantity": number,
      "unit": "hrs",
      "unitPrice": 95,
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

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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

function recalcTotals(estimate: { lineItems: Array<{subtotal: number}>; taxRate: number; subtotal?: number; taxAmount?: number; total?: number }) {
  estimate.subtotal = estimate.lineItems.reduce((s, i) => s + i.subtotal, 0)
  estimate.taxAmount = estimate.subtotal * ((estimate.taxRate || 0) / 100)
  estimate.total = estimate.subtotal + estimate.taxAmount
  return estimate
}

/**
 * Transcribe audio using the Anthropic Files API.
 * Steps: upload the audio file, ask Claude to transcribe it, delete the file.
 * Falls back gracefully if upload fails (e.g. unsupported format).
 */
async function transcribeAudio(client: Anthropic, audioBlob: Blob, mimeType: string): Promise<string> {
  // Normalize mime type to something the Files API accepts
  const safeMime = (
    mimeType.includes('m4a') ? 'audio/mp4' :
    mimeType.startsWith('audio/') || mimeType.startsWith('video/') ? mimeType :
    'audio/mpeg'
  ) as Parameters<typeof client.beta.files.upload>[0]['file'] extends { type?: infer T } ? T : string

  // Upload the audio to the Anthropic Files API
  const buffer = await audioBlob.arrayBuffer()
  const file = new File([buffer], 'recording', { type: safeMime })

  let fileId: string
  try {
    const uploaded = await (client.beta.files as unknown as {
      upload: (params: { file: File }) => Promise<{ id: string }>
    }).upload({ file })
    fileId = uploaded.id
  } catch (err) {
    throw new Error(`Audio upload failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  try {
    const msg = await client.beta.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'file', file_id: fileId },
          } as never,
          {
            type: 'text',
            text: 'Please transcribe this audio recording verbatim. Return only the transcription text, nothing else.',
          },
        ],
      }],
      betas: ['files-api-2025-04-14'],
    } as never)

    const transcription = (msg as { content: Array<{ type: string; text: string }> })
      .content.find(b => b.type === 'text')?.text || ''
    return transcription
  } finally {
    // Clean up the uploaded file
    try {
      await (client.beta.files as unknown as { delete: (id: string) => Promise<void> }).delete(fileId)
    } catch {
      // Non-fatal
    }
  }
}

async function processAudioHandler(request: Request, env: Env, origin: string): Promise<Response> {
  const formData = await request.formData()
  const audioFile = formData.get('audio') as File | null
  const textInput = formData.get('text') as string | null

  if (!audioFile && !textInput) {
    return jsonResponse({ error: 'Provide an audio file or text description' }, 400, origin)
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

  let jobDescription: string
  if (textInput) {
    jobDescription = textInput
  } else {
    // Transcribe the audio first
    try {
      jobDescription = await transcribeAudio(client, audioFile!, audioFile!.type || 'audio/mpeg')
    } catch (err) {
      return jsonResponse({
        error: `Transcription failed: ${err instanceof Error ? err.message : String(err)}`,
      }, 500, origin)
    }
  }

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    system: ESTIMATE_SYSTEM_PROMPT,
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

async function reviseEstimateHandler(request: Request, env: Env, origin: string): Promise<Response> {
  const formData = await request.formData()
  const audioFile = formData.get('audio') as File | Blob | null
  const textInput = formData.get('text') as string | null
  const estimateJson = formData.get('estimate') as string | null

  if ((!audioFile && !textInput) || !estimateJson) {
    return jsonResponse({ error: 'Missing revision (audio or text) and/or estimate' }, 400, origin)
  }

  let currentEstimate
  try { currentEstimate = JSON.parse(estimateJson) } catch {
    return jsonResponse({ error: 'Invalid estimate JSON' }, 400, origin)
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

  let revisionText: string
  if (textInput) {
    revisionText = textInput
  } else {
    try {
      const mimeType = (audioFile as File).type || 'audio/webm'
      revisionText = await transcribeAudio(client, audioFile!, mimeType)
    } catch (err) {
      return jsonResponse({
        error: `Transcription failed: ${err instanceof Error ? err.message : String(err)}`,
      }, 500, origin)
    }
  }

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    system: REVISION_SYSTEM_PROMPT,
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const origin = env.ALLOWED_ORIGIN || '*'

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin) })
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    try {
      if (url.pathname === '/api/process-audio') return processAudioHandler(request, env, origin)
      if (url.pathname === '/api/revise-estimate') return reviseEstimateHandler(request, env, origin)
      if (url.pathname === '/api/submit-estimate') {
        return jsonResponse({ success: true, message: 'Estimate received (HCP not yet wired)' }, 200, origin)
      }
      return jsonResponse({ error: 'Not found' }, 404, origin)
    } catch (err) {
      return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500, origin)
    }
  },
}
