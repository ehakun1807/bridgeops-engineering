import * as cheerio from 'cheerio';

export interface ScraperResult {
  equivalent: string;        // e.g., "1N4148 Diode"
  newPartNumber: string;     // e.g., "1N4148"
  confidence: 'exact' | 'spec-based';
  source: 'digikey' | 'mouser';
  sourceUrl: string;
}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

/**
 * Scrape Digi-Key for a part equivalent
 */
export async function scrapeDigiKey(manufacturer: string, partNumber: string): Promise<ScraperResult | null> {
  try {
    const searchQuery = `${manufacturer} ${partNumber}`;
    const searchUrl = `https://www.digikey.com/en/products/search?keywords=${encodeURIComponent(searchQuery)}`;

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': USER_AGENT
      }
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Try to find the first product result
    // Digi-Key typically shows products in a list with various selectors
    // Looking for product rows or links with product information

    let productUrl = null;
    let extractedPartNumber = null;
    let extractedManufacturer = null;

    // Try different selectors for Digi-Key product links
    const productLink = $('a[href*="/product/"]').first();
    if (productLink.length > 0) {
      productUrl = productLink.attr('href');
      const linkText = productLink.text().trim();

      // Extract part number from link text or nearby elements
      const partNumberMatch = linkText.match(/([A-Z0-9\-]+)/);
      if (partNumberMatch) {
        extractedPartNumber = partNumberMatch[1];
      }
    }

    // If we couldn't find a product link, try other selectors
    if (!productUrl) {
      // Try finding product in search results with different structure
      const rows = $('[data-sku], .search-result-item, .product-row');
      if (rows.length > 0) {
        const firstRow = rows.first();
        const link = firstRow.find('a').first();
        if (link.length > 0) {
          productUrl = link.attr('href');
        }
      }
    }

    if (!productUrl) {
      return null;
    }

    // Ensure the URL is absolute
    if (productUrl && !productUrl.startsWith('http')) {
      productUrl = `https://www.digikey.com${productUrl}`;
    }

    // If we didn't extract the part number from the link, use the original
    if (!extractedPartNumber) {
      extractedPartNumber = partNumber;
    }

    return {
      equivalent: `${extractedPartNumber} (Digi-Key)`,
      newPartNumber: extractedPartNumber,
      confidence: 'exact',
      source: 'digikey',
      sourceUrl: productUrl
    };

  } catch (error) {
    return null;
  }
}

/**
 * Scrape Mouser for a part equivalent
 */
export async function scrapeMouser(manufacturer: string, partNumber: string): Promise<ScraperResult | null> {
  try {
    const searchQuery = `${manufacturer} ${partNumber}`;
    const searchUrl = `https://www.mouser.com/Search/Refine?Keyword=${encodeURIComponent(searchQuery)}`;

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': USER_AGENT
      }
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Try to find the first product result
    let productUrl = null;
    let extractedPartNumber = null;
    let equivalent = null;

    // Try different selectors for Mouser product links and info
    const productLink = $('a[href*="/ProductDetail/"]').first();
    if (productLink.length > 0) {
      productUrl = productLink.attr('href');
      const linkText = productLink.text().trim();

      // Extract product information
      extractedPartNumber = linkText.split(/\s+/).filter(s => s.match(/[A-Z0-9\-]/i))[0];
      equivalent = linkText;
    }

    // If we couldn't find a product link, try other selectors
    if (!productUrl) {
      const rows = $('[data-asin], .search-result, .product-item');
      if (rows.length > 0) {
        const firstRow = rows.first();
        const link = firstRow.find('a').first();
        if (link.length > 0) {
          productUrl = link.attr('href');
          equivalent = link.text().trim();
        }
      }
    }

    if (!productUrl) {
      return null;
    }

    // Ensure the URL is absolute
    if (productUrl && !productUrl.startsWith('http')) {
      productUrl = `https://www.mouser.com${productUrl}`;
    }

    // If we didn't extract the part number, use the original
    if (!extractedPartNumber) {
      extractedPartNumber = partNumber;
    }

    if (!equivalent) {
      equivalent = `${extractedPartNumber} (Mouser)`;
    }

    return {
      equivalent: equivalent,
      newPartNumber: extractedPartNumber,
      confidence: 'spec-based',
      source: 'mouser',
      sourceUrl: productUrl
    };

  } catch (error) {
    return null;
  }
}

/**
 * Find an equivalent part by first trying Digi-Key, then Mouser
 */
export async function findEquivalent(manufacturer: string, partNumber: string): Promise<ScraperResult | null> {
  try {
    // Try Digi-Key first
    const digikeyResult = await scrapeDigiKey(manufacturer, partNumber);
    if (digikeyResult) {
      return digikeyResult;
    }

    // If not found on Digi-Key, try Mouser
    const mouserResult = await scrapeMouser(manufacturer, partNumber);
    if (mouserResult) {
      return mouserResult;
    }

    // Not found on either distributor
    return null;

  } catch (error) {
    return null;
  }
}
