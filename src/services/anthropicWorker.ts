import type { Estimate } from '../types/estimate'

const WORKER_URL = import.meta.env.VITE_WORKER_URL || 'http://localhost:8787'

export async function processAudio(audioFile: File): Promise<Estimate> {
  const formData = new FormData()
  formData.append('audio', audioFile)

  const res = await fetch(`${WORKER_URL}/api/process-audio`, {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Worker error ${res.status}: ${text}`)
  }

  return res.json()
}

export async function reviseEstimate(
  revisionAudio: Blob,
  currentEstimate: Estimate
): Promise<Estimate> {
  const formData = new FormData()
  formData.append('audio', revisionAudio, 'revision.webm')
  formData.append('estimate', JSON.stringify(currentEstimate))

  const res = await fetch(`${WORKER_URL}/api/revise-estimate`, {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Worker error ${res.status}: ${text}`)
  }

  return res.json()
}
