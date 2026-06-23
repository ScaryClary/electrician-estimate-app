import Anthropic from '@anthropic-ai/sdk'
import type { Estimate } from '../types/estimate'
import type { AppSettings } from './settings'
import { resolvePrompt } from './settings'

// In production the Worker handles all API calls — no keys needed in the browser.
// In dev, the SDK is used directly with keys from .env.local / settings.
const IS_PROD = !import.meta.env.DEV
const WORKER_URL = import.meta.env.VITE_WORKER_URL as string | undefined

function workerBase() {
  // Dev: local Worker at VITE_WORKER_URL (e.g. http://localhost:8787)
  // Prod: same-origin /api (Worker is routed to /api/* via Cloudflare)
  return IS_PROD ? '' : (WORKER_URL || 'http://localhost:8787')
}

function getClient(apiKey: string) {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
}

function parseJson(text: string) {
  const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  return JSON.parse(cleaned)
}

function recalcTotals(estimate: Estimate): Estimate {
  estimate.subtotal = estimate.lineItems.reduce((s, i) => s + i.subtotal, 0)
  estimate.taxAmount = estimate.subtotal * ((estimate.taxRate || 0) / 100)
  estimate.total = estimate.subtotal + estimate.taxAmount
  return estimate
}

async function fileToBase64(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1])
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function normalizeMimeType(type: string): string {
  if (type.includes('m4a') || type.includes('x-m4a')) return 'audio/mp4'
  if (type.startsWith('audio/') || type.startsWith('video/')) return type
  return 'audio/webm'
}

async function transcribeWithWhisper(file: File | Blob, openAiApiKey: string): Promise<string> {
  const base = import.meta.env.DEV ? '/openai-api' : 'https://api.openai.com'
  const form = new FormData()
  form.append('file', file, file instanceof File ? file.name : 'recording.webm')
  form.append('model', 'whisper-1')
  const res = await fetch(`${base}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${openAiApiKey}` },
    body: form,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Whisper error ${res.status}: ${text}`)
  }
  const data = await res.json()
  return data.text ?? ''
}

async function transcribeAudio(client: Anthropic, file: File | Blob, mimeType: string): Promise<string> {
  const safeMime = normalizeMimeType(mimeType)
  const base64 = await fileToBase64(file)

  // Send audio directly as base64 — no Files API upload needed
  const msg = await (client.messages.create as Function)({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: safeMime, data: base64 },
        },
        {
          type: 'text',
          text: 'Please transcribe this audio recording verbatim. Return only the transcription text, nothing else.',
        },
      ],
    }],
    betas: ['files-api-2025-04-14'],
  })

  return msg.content.find((b: { type: string; text?: string }) => b.type === 'text')?.text ?? ''
}

// ─── Production: call the Worker endpoints ────────────────────────────────────

async function workerFetch(path: string, form: FormData): Promise<Estimate> {
  const res = await fetch(`${workerBase()}${path}`, { method: 'POST', body: form })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Worker error ${res.status}: ${text}`)
  }
  return res.json() as Promise<Estimate>
}

function buildEstimateForm(settings: AppSettings, extra: Record<string, string | File | Blob> = {}): FormData {
  const form = new FormData()
  form.append('estimatePrompt', resolvePrompt(settings.estimateSystemPrompt, settings))
  if (settings.pricingNotes?.trim()) form.append('pricingNotes', settings.pricingNotes)
  if (settings.jobNotes?.trim()) form.append('jobNotes', settings.jobNotes)
  if (settings.pricingList?.trim()) form.append('pricingList', settings.pricingList)
  for (const [k, v] of Object.entries(extra)) form.append(k, v)
  return form
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function processAudio(files: File[], settings: AppSettings): Promise<Estimate> {
  if (IS_PROD) {
    const form = buildEstimateForm(settings)
    for (const file of files) form.append('audio', file)
    return workerFetch('/api/process-audio', form)
  }
  const client = getClient(settings.apiKey)
  const transcripts: string[] = []
  for (const file of files) {
    const t = settings.openAiApiKey
      ? await transcribeWithWhisper(file, settings.openAiApiKey)
      : await transcribeAudio(client, file, file.type || 'audio/mpeg')
    transcripts.push(t)
  }
  const combined = transcripts
    .map((t, i) => files.length > 1 ? `[Recording ${i + 1}]\n${t}` : t)
    .join('\n\n')
  return generateEstimate(client, combined, settings)
}

export async function processText(description: string, settings: AppSettings): Promise<Estimate> {
  if (IS_PROD) {
    return workerFetch('/api/process-audio', buildEstimateForm(settings, { text: description }))
  }
  const client = getClient(settings.apiKey)
  return generateEstimate(client, description, settings)
}

async function generateEstimate(client: Anthropic, jobDescription: string, settings: AppSettings): Promise<Estimate> {
  let systemPrompt = resolvePrompt(settings.estimateSystemPrompt, settings)
  if (settings.jobNotes?.trim()) {
    systemPrompt += `\n\nJob & task notes from the electrician:\n${settings.jobNotes.trim()}`
  }
  if (settings.pricingList?.trim()) {
    systemPrompt += `\n\nPricing reference / price list:\n${settings.pricingList.trim()}`
  }
  if (settings.pricingNotes?.trim()) {
    systemPrompt += `\n\nAdditional pricing context:\n${settings.pricingNotes.trim()}`
  }

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: `Generate a complete electrical estimate for this job description:\n\n${jobDescription}`,
    }],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text : ''
  const estimate = parseJson(text) as Estimate
  if (!estimate.id) estimate.id = crypto.randomUUID()
  if (!estimate.createdAt) estimate.createdAt = new Date().toISOString()
  if (!estimate.revisionHistory) estimate.revisionHistory = []
  return recalcTotals(estimate)
}

export async function reviseEstimate(
  revisionAudio: Blob,
  currentEstimate: Estimate,
  settings: AppSettings,
): Promise<Estimate> {
  if (IS_PROD) {
    const form = new FormData()
    form.append('audio', revisionAudio)
    form.append('estimate', JSON.stringify(currentEstimate))
    form.append('revisionPrompt', resolvePrompt(settings.revisionSystemPrompt, settings))
    return workerFetch('/api/revise-estimate', form)
  }
  const client = getClient(settings.apiKey)
  const revisionText = await transcribeAudio(client, revisionAudio, revisionAudio.type || 'audio/webm')
  return applyRevision(client, revisionText, currentEstimate, settings)
}

export async function reviseEstimateText(
  revisionText: string,
  currentEstimate: Estimate,
  settings: AppSettings,
): Promise<Estimate> {
  if (IS_PROD) {
    const form = new FormData()
    form.append('text', revisionText)
    form.append('estimate', JSON.stringify(currentEstimate))
    form.append('revisionPrompt', resolvePrompt(settings.revisionSystemPrompt, settings))
    return workerFetch('/api/revise-estimate', form)
  }
  const client = getClient(settings.apiKey)
  return applyRevision(client, revisionText, currentEstimate, settings)
}

async function applyRevision(
  client: Anthropic,
  revisionText: string,
  currentEstimate: Estimate,
  settings: AppSettings,
): Promise<Estimate> {
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system: resolvePrompt(settings.revisionSystemPrompt, settings),
    messages: [{
      role: 'user',
      content: `Current estimate:\n${JSON.stringify(currentEstimate, null, 2)}\n\nRevision instructions:\n${revisionText}`,
    }],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text : ''
  const result = parseJson(text)
  const updated = (result.estimate || result) as Estimate
  const changes: string[] = result.changesApplied || []

  updated.revisionHistory = [
    ...(currentEstimate.revisionHistory || []),
    {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      audioTranscript: revisionText,
      changesApplied: changes,
    },
  ]
  return recalcTotals(updated)
}
