/*
 * SUPPLIER API INTEGRATION POINT
 *
 * The electrician's supplier (e.g. Rexel, Graybar, or a local electrical supply house)
 * may have an API or price feed. When that API key is available, implement the lookup here.
 * The function should search by item description or part number and return current pricing.
 * Items not found should fall back to AI estimate and be flagged with priceSource: 'needs_review'.
 *
 * Example integration steps:
 *   1. Add SUPPLIER_API_KEY to wrangler.toml secrets
 *   2. Replace the stub below with a real fetch() to the supplier's catalog/search endpoint
 *   3. Map the response to PriceLookupResult
 *   4. Return found: true with the price when matched
 */

export interface PriceLookupResult {
  found: boolean
  source: 'supplier_api' | 'not_configured'
  unitPrice?: number
  partNumber?: string
  description?: string
}

export async function lookupPrice(
  _itemDescription: string,
  _quantity: number
): Promise<PriceLookupResult> {
  return { found: false, source: 'not_configured' }
}
