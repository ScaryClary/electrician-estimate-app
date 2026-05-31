/*
 * HCP INTEGRATION POINT
 *
 * POST this estimate to the appropriate HCP endpoint.
 * If a job already exists (job_id known), POST to /jobs/{job_id}/estimates.
 * If creating a new job, first POST to /jobs with customer_id, then attach the estimate.
 * See HCP API docs at https://docs.housecallpro.com
 *
 * Customer lookup:
 *   GET https://api.housecallpro.com/customers?q={name}
 *   Let the electrician select the matching customer, then attach customer_id to the payload.
 *
 * Auth:
 *   Add HCP_API_KEY to wrangler.toml secrets.
 *   Header: Authorization: Token {HCP_API_KEY}
 */

import type { Estimate } from '../types/estimate'

export async function submitToHCP(estimate: Estimate): Promise<void> {
  console.log('[HCP] Would submit estimate:', JSON.stringify(estimate, null, 2))
  // Simulate a brief async op so callers can await it
  await new Promise((resolve) => setTimeout(resolve, 500))
}
