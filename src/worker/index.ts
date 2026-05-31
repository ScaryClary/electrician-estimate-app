/**
 * Cloudflare Worker — all backend logic lives here.
 * Secrets configured in wrangler.toml (never in the frontend):
 *   - ANTHROPIC_API_KEY
 *   - HCP_API_KEY (future)
 *   - SUPPLIER_API_KEY (future)
 */

import Anthropic from '@anthropic-ai/sdk'

interface Env {
  ANTHROPIC_API_KEY: string
  ALLOWED_ORIGIN: string
}

const ESTIMATE_SYSTEM_PROMPT = `You are an expert electrician's assistant that analyzes audio recordings and generates detailed, accurate estimates.

When processing audio:
1. Transcribe the full conversation
2. Identify all distinct electrical job tasks mentioned
3. For each task, generate labor line items with description, estimated hours, hourly rate ($95/hr default), and subtotal
4. For each task, infer ALL materials an experienced electrician would need. Think carefully:
   - If someone says "run a 20-amp circuit 50 feet to the garage," you should infer: 12AWG Romex (estimate footage with 10% waste), a 20A breaker, a single gang box, wire nuts, staples, connector fittings, etc.
   - Include quantities, units, and realistic prices
5. For materials, set confidence: "high" for standard items, "medium" for items where quantity is uncertain, "low" for items you're inferring without clear signals
6. Set priceSource to "ai_estimate" for all materials (supplier API will override later)
7. Flag any items that need the electrician's review (unusual scope, unclear from audio, etc.)
8. Generate a 3-5 sentence audioSummary of what was discussed
9. Extract customerNotes: anything the customer specifically asked for, preferences, concerns
10. Create a short descriptive jobTitle

Return ONLY valid JSON matching this exact schema (no markdown, no explanation):
{
  "id": "uuid-v4",
  "createdAt": "ISO8601",
  "audioSummary": "string",
  "customerNotes": "string",
  "jobTitle": "string",
  "lineItems": [
    {
      "id": "uuid-v4",
      "type": "labor" | "material",
      "description": "string",
      "quantity": number,
      "unit": "hrs" | "ea" | "ft" | "box" | "roll" | "bag" | "pk" | "lb",
      "unitPrice": number,
      "subtotal": number,
      "priceSource": "ai_estimate" | "supplier_api" | "needs_review",
      "confidence": "high" | "medium" | "low",
      "flagged": boolean
    }
  ],
  "subtotal": number,
  "taxRate": 0,
  "taxAmount": 0,
  "total": number,
  "flaggedItems": ["string"],
  "revisionHistory": []
}`

const REVISION_SYSTEM_PROMPT = `You are an expert electrician's assistant. You will receive the current estimate JSON and a transcription of a voice revision from the electrician.

Apply ALL changes described in the revision. Common revision types:
- Changing quantities (hours, footage, count)
- Adding new line items or entire tasks
- Removing items
- Correcting prices
- Adding notes

Return ONLY valid JSON with:
1. The full updated estimate (same schema as before, with all changes applied)
2. A "changesApplied" array describing each change in plain English

Response format (JSON only, no markdown):
{
  "estimate": { ...full updated estimate... },
  "changesApplied": ["Changed labor hours on panel replacement: 4 → 6 hrs", "Added: 50A sub-panel disconnect"]
}`

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

function jsonResponse(data: unknown, status = 200, origin: string): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin),
    },
  })
}

async function fileToBase64(file: File | Blob): Promise<string> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function generateId(): string {
  return crypto.randomUUID()
}

async function processAudioHandler(request: Request, env: Env, origin: string): Promise<Response> {
  const formData = await request.formData()
  const audioFile = formData.get('audio') as File | null

  if (!audioFile) {
    return jsonResponse({ error: 'No audio file provided' }, 400, origin)
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

  // Detect media type
  const mimeType = audioFile.type || 'audio/mpeg'
  const validAudioTypes = ['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm', 'audio/ogg', 'audio/m4a']
  const normalizedType = mimeType.includes('m4a') ? 'audio/mp4' :
                         validAudioTypes.includes(mimeType) ? mimeType : 'audio/mpeg'

  // Audio files from hour-long customer conversations are expected and normal.
  // The Anthropic API handles large files via base64 encoding in the messages API.
  // If files exceed limits, consider chunking or using the Files API for uploads.
  const audioBase64 = await fileToBase64(audioFile)

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    system: ESTIMATE_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: normalizedType as 'audio/mpeg' | 'audio/mp4' | 'audio/wav' | 'audio/webm' | 'audio/ogg',
              data: audioBase64,
            },
          } as never,
          {
            type: 'text',
            text: 'Please analyze this audio recording and generate a complete electrical estimate in JSON format.',
          },
        ],
      },
    ],
  })

  const responseText = message.content[0].type === 'text' ? message.content[0].text : ''

  // Strip any markdown code fences if Claude wrapped the JSON
  const jsonText = responseText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

  let estimate
  try {
    estimate = JSON.parse(jsonText)
    // Ensure required fields
    if (!estimate.id) estimate.id = generateId()
    if (!estimate.createdAt) estimate.createdAt = new Date().toISOString()
    if (!estimate.revisionHistory) estimate.revisionHistory = []
    if (!estimate.taxRate) estimate.taxRate = 0
    if (!estimate.taxAmount) estimate.taxAmount = 0
    // Recalculate totals to be safe
    estimate.subtotal = estimate.lineItems.reduce((sum: number, item: {subtotal: number}) => sum + item.subtotal, 0)
    estimate.taxAmount = estimate.subtotal * (estimate.taxRate / 100)
    estimate.total = estimate.subtotal + estimate.taxAmount
  } catch {
    return jsonResponse({ error: 'Failed to parse estimate from AI', raw: responseText }, 500, origin)
  }

  return jsonResponse(estimate, 200, origin)
}

async function reviseEstimateHandler(request: Request, env: Env, origin: string): Promise<Response> {
  const formData = await request.formData()
  const audioFile = formData.get('audio') as File | Blob | null
  const estimateJson = formData.get('estimate') as string | null

  if (!audioFile || !estimateJson) {
    return jsonResponse({ error: 'Missing audio or estimate' }, 400, origin)
  }

  let currentEstimate
  try {
    currentEstimate = JSON.parse(estimateJson)
  } catch {
    return jsonResponse({ error: 'Invalid estimate JSON' }, 400, origin)
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

  const audioBase64 = await fileToBase64(audioFile)
  const mimeType = (audioFile as File).type || 'audio/webm'
  const normalizedType = mimeType.includes('m4a') ? 'audio/mp4' :
                         mimeType || 'audio/webm'

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    system: REVISION_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: normalizedType as 'audio/mpeg' | 'audio/mp4' | 'audio/wav' | 'audio/webm' | 'audio/ogg',
              data: audioBase64,
            },
          } as never,
          {
            type: 'text',
            text: `Here is the current estimate:\n\n${JSON.stringify(currentEstimate, null, 2)}\n\nPlease apply all changes described in the revision audio and return the updated estimate with a changesApplied summary.`,
          },
        ],
      },
    ],
  })

  const responseText = message.content[0].type === 'text' ? message.content[0].text : ''
  const jsonText = responseText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

  let result
  try {
    result = JSON.parse(jsonText)
  } catch {
    return jsonResponse({ error: 'Failed to parse revision from AI', raw: responseText }, 500, origin)
  }

  const updatedEstimate = result.estimate || result
  const changesApplied: string[] = result.changesApplied || []

  // Add this revision to the history
  updatedEstimate.revisionHistory = [
    ...(currentEstimate.revisionHistory || []),
    {
      id: generateId(),
      timestamp: new Date().toISOString(),
      audioTranscript: '[revision audio]',
      changesApplied,
    },
  ]

  // Recalculate totals
  updatedEstimate.subtotal = updatedEstimate.lineItems.reduce(
    (sum: number, item: {subtotal: number}) => sum + item.subtotal, 0
  )
  updatedEstimate.taxAmount = updatedEstimate.subtotal * ((updatedEstimate.taxRate || 0) / 100)
  updatedEstimate.total = updatedEstimate.subtotal + updatedEstimate.taxAmount

  return jsonResponse(updatedEstimate, 200, origin)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const origin = env.ALLOWED_ORIGIN || '*'

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin) })
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    try {
      if (url.pathname === '/api/process-audio') {
        return await processAudioHandler(request, env, origin)
      }

      if (url.pathname === '/api/revise-estimate') {
        return await reviseEstimateHandler(request, env, origin)
      }

      if (url.pathname === '/api/submit-estimate') {
        // Placeholder — HCP integration goes here
        return jsonResponse({ success: true, message: 'Estimate received (HCP not yet wired)' }, 200, origin)
      }

      return jsonResponse({ error: 'Not found' }, 404, origin)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return jsonResponse({ error: message }, 500, origin)
    }
  },
}
