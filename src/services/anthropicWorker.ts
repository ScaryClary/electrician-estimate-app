import type { Estimate } from '../types/estimate'

const WORKER_URL = import.meta.env.VITE_WORKER_URL || 'http://localhost:8787'

async function checkResponse(res: Response): Promise<Estimate> {
  if (!res.ok) {
    let msg = `Worker error ${res.status}`
    try {
      const body = await res.json() as { error?: string }
      if (body.error) msg += `: ${body.error}`
    } catch {
      msg += `: ${await res.text()}`
    }
    throw new Error(msg)
  }
  return res.json()
}

export async function processAudio(audioFile: File): Promise<Estimate> {
  const formData = new FormData()
  formData.append('audio', audioFile)
  const res = await fetch(`${WORKER_URL}/api/process-audio`, { method: 'POST', body: formData })
  return checkResponse(res)
}

export async function processText(description: string): Promise<Estimate> {
  const formData = new FormData()
  formData.append('text', description)
  const res = await fetch(`${WORKER_URL}/api/process-audio`, { method: 'POST', body: formData })
  return checkResponse(res)
}

export async function reviseEstimate(
  revisionAudio: Blob,
  currentEstimate: Estimate
): Promise<Estimate> {
  const formData = new FormData()
  formData.append('audio', revisionAudio, 'revision.webm')
  formData.append('estimate', JSON.stringify(currentEstimate))
  const res = await fetch(`${WORKER_URL}/api/revise-estimate`, { method: 'POST', body: formData })
  return checkResponse(res)
}

export async function reviseEstimateText(
  revisionText: string,
  currentEstimate: Estimate
): Promise<Estimate> {
  const formData = new FormData()
  formData.append('text', revisionText)
  formData.append('estimate', JSON.stringify(currentEstimate))
  const res = await fetch(`${WORKER_URL}/api/revise-estimate`, { method: 'POST', body: formData })
  return checkResponse(res)
}
