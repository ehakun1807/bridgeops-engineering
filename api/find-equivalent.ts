// ---------------------------------------------------------------------------
// Vercel serverless function: GET /api/find-equivalent
//
// Handles component lookup requests with caching and rate limiting.
// Returns equivalent part information from distributor databases.
//
// Query parameters (both required):
// - manufacturer: string - Component manufacturer (e.g., "Texas Instruments")
// - partNumber: string - Component part number (e.g., "LM358")
//
// Response shape:
// {
//   equivalent: string | null;           // e.g., "LM358 (Digi-Key)" or null if not found
//   newPartNumber: string | null;        // e.g., "LM358" or null if not found
//   confidence: "exact" | "spec-based" | null;
//   source: "digikey" | "mouser" | null;
//   sourceUrl: string | null;            // e.g., "https://www.digikey.com/..."
//   cached: boolean;                     // true if result was from cache
//   error?: string;                      // present if an error occurred
// }
//
// Rate limiting: 1-2 second random delay before scraping to avoid being blocked.
// Cache: Results are cached for 30 days in Firestore.
// Error handling: All errors return proper JSON responses with 4xx/5xx status codes.
// ---------------------------------------------------------------------------

import { getCachedEquivalent, setCachedEquivalent } from '../utils/cacheManager';
import { findEquivalent } from '../utils/distributorScraper';

// Request/Response types
interface ReqLike {
  method: string;
  query: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;
}
interface ResLike {
  status(code: number): ResLike;
  json(data: any): ResLike;
}

// API Response interface
interface ApiResponse {
  equivalent: string | null;
  newPartNumber: string | null;
  confidence: 'exact' | 'spec-based' | null;
  source: 'digikey' | 'mouser' | null;
  sourceUrl: string | null;
  cached: boolean;
  error?: string;
}

/**
 * Validates and extracts query parameters
 * Returns null if validation fails, otherwise returns the validated params
 */
function validateQueryParams(
  query: Record<string, string | string[] | undefined>
): { manufacturer: string; partNumber: string } | null {
  const manufacturer = query.manufacturer;
  const partNumber = query.partNumber;

  // Check if parameters exist and are strings (not arrays)
  if (typeof manufacturer !== 'string' || typeof partNumber !== 'string') {
    return null;
  }

  // Trim and check if non-empty
  const trimmedMfg = manufacturer.trim();
  const trimmedPart = partNumber.trim();

  if (!trimmedMfg || !trimmedPart) {
    return null;
  }

  return {
    manufacturer: trimmedMfg,
    partNumber: trimmedPart
  };
}

/**
 * Adds a random 1-2 second delay to avoid rate limiting
 */
async function addRateLimitDelay(): Promise<void> {
  const delayMs = 1000 + Math.random() * 1000;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Main handler
 */
export default async function handler(req: ReqLike, res: ResLike) {
  // Validate HTTP method
  if (req.method !== 'GET') {
    return res.status(405).json({
      equivalent: null,
      newPartNumber: null,
      confidence: null,
      source: null,
      sourceUrl: null,
      cached: false,
      error: 'method not allowed'
    } as ApiResponse);
  }

  // Validate and extract query parameters
  const params = validateQueryParams(req.query);
  if (!params) {
    return res.status(400).json({
      equivalent: null,
      newPartNumber: null,
      confidence: null,
      source: null,
      sourceUrl: null,
      cached: false,
      error: 'missing or invalid required parameters: manufacturer, partNumber'
    } as ApiResponse);
  }

  const { manufacturer, partNumber } = params;

  try {
    // Try to get from cache first
    const cachedEntry = await getCachedEquivalent(manufacturer, partNumber);
    if (cachedEntry) {
      return res.status(200).json({
        equivalent: cachedEntry.equivalent,
        newPartNumber: cachedEntry.newPartNumber,
        confidence: cachedEntry.confidence,
        source: cachedEntry.source,
        sourceUrl: cachedEntry.sourceUrl,
        cached: true
      } as ApiResponse);
    }

    // Cache miss: add rate limiting delay
    await addRateLimitDelay();

    // Call the scraper to find equivalent
    const result = await findEquivalent(manufacturer, partNumber);

    if (result) {
      // Store in cache for future requests
      try {
        await setCachedEquivalent(manufacturer, partNumber, {
          equivalent: result.equivalent,
          newPartNumber: result.newPartNumber,
          confidence: result.confidence,
          source: result.source,
          sourceUrl: result.sourceUrl
        });
      } catch (cacheError) {
        // Log cache error but don't fail the response
        console.error('Failed to store result in cache:', cacheError);
      }

      return res.status(200).json({
        equivalent: result.equivalent,
        newPartNumber: result.newPartNumber,
        confidence: result.confidence,
        source: result.source,
        sourceUrl: result.sourceUrl,
        cached: false
      } as ApiResponse);
    }

    // No equivalent found
    return res.status(404).json({
      equivalent: null,
      newPartNumber: null,
      confidence: null,
      source: null,
      sourceUrl: null,
      cached: false,
      error: 'No equivalent found'
    } as ApiResponse);
  } catch (error) {
    console.error('Error in find-equivalent handler:', error);
    return res.status(500).json({
      equivalent: null,
      newPartNumber: null,
      confidence: null,
      source: null,
      sourceUrl: null,
      cached: false,
      error: 'internal server error'
    } as ApiResponse);
  }
}
