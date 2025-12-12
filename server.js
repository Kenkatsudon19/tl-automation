const express = require('express');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { parse } = require('csv-parse/sync');
const cors = require('cors');
const XLSX = require('xlsx');

const app = express();
app.use(cors());
app.use(express.json());

// Proxy configuration - 10 rotating proxies
const PROXIES = [
  { host: 'us.decodo.com', port: 10001, user: 'spv8vggn22', pass: 'igaYGO6wf1Gai6v8+k', label: 'Ken-1' },
  { host: 'us.decodo.com', port: 10002, user: 'spv8vggn22', pass: 'igaYGO6wf1Gai6v8+k', label: 'Ken-2' },
  { host: 'us.decodo.com', port: 10003, user: 'spv8vggn22', pass: 'igaYGO6wf1Gai6v8+k', label: 'Ken-3' },
  { host: 'us.decodo.com', port: 10004, user: 'spv8vggn22', pass: 'igaYGO6wf1Gai6v8+k', label: 'Ken-4' },
  { host: 'us.decodo.com', port: 10005, user: 'spv8vggn22', pass: 'igaYGO6wf1Gai6v8+k', label: 'Ken-5' },
  { host: 'us.decodo.com', port: 10006, user: 'spv8vggn22', pass: 'igaYGO6wf1Gai6v8+k', label: 'Ken-6' },
  { host: 'us.decodo.com', port: 10007, user: 'spv8vggn22', pass: 'igaYGO6wf1Gai6v8+k', label: 'Ken-7' },
  { host: 'us.decodo.com', port: 10008, user: 'spv8vggn22', pass: 'igaYGO6wf1Gai6v8+k', label: 'Ken-8' },
  { host: 'us.decodo.com', port: 10009, user: 'spv8vggn22', pass: 'igaYGO6wf1Gai6v8+k', label: 'Ken-9' },
  { host: 'us.decodo.com', port: 10010, user: 'spv8vggn22', pass: 'igaYGO6wf1Gai6v8+k', label: 'Ken-10' }
];

let currentProxyIndex = 0;

// Get next proxy (round-robin)
function getNextProxy() {
  const proxy = PROXIES[currentProxyIndex];
  currentProxyIndex = (currentProxyIndex + 1) % PROXIES.length;
  return proxy;
}

// Create proxy agent
function createProxyAgent(proxy) {
  const proxyUrl = `http://${proxy.user}:${encodeURIComponent(proxy.pass)}@${proxy.host}:${proxy.port}`;
  return new HttpsProxyAgent(proxyUrl);
}

// Fetch with proxy retry logic
async function fetchWithProxy(url, options = {}, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const proxy = getNextProxy();
    console.log(`[Attempt ${attempt + 1}] Using proxy: ${proxy.label}`);

    try {
      const agent = createProxyAgent(proxy);
      const response = await axios.get(url, {
        httpsAgent: agent,
        httpAgent: agent,
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        ...options
      });
      return response;
    } catch (error) {
      console.error(`[${proxy.label}] Failed: ${error.message}`);
      if (attempt === maxRetries - 1) throw error;
    }
  }
}

// Convert UTC timestamp to PST time string (e.g., "809" for 8:09 AM)
function utcToPstTimeString(utcTimestamp) {
  const date = new Date(utcTimestamp);
  // Convert to PST (UTC-8)
  const pstOffset = -8 * 60; // minutes
  const pstDate = new Date(date.getTime() + (pstOffset * 60 * 1000));

  const hours = pstDate.getUTCHours();
  const minutes = pstDate.getUTCMinutes();

  // Format as "809" for 8:09 AM, "1430" for 2:30 PM
  return `${hours}${minutes.toString().padStart(2, '0')}`;
}

// Map condition text to code
function conditionToCode(conditionText) {
  const text = conditionText.toLowerCase();
  if (text.includes('uninspected')) return 'UR';
  if (text.includes('used') || text.includes('working')) return 'UW';
  if (text.includes('brand new')) return 'NC';
  if (text.includes('new') && !text.includes('like')) return 'NC';
  if (text.includes('like new')) return 'LN';
  if (text.includes('salvage')) return 'S';
  return 'UR'; // default
}

// Map condition code for Notes spreadsheet
function conditionForNotes(conditionCode) {
  const mapping = {
    'UR': 'USED',   // Uninspected Returns = USED
    'UW': 'USED',   // Used & Working = USED
    'NC': 'NEW',    // Brand New = NEW
    'LN': 'OB',     // Like New = OB
    'S': 'S'        // Salvage = S
  };
  return mapping[conditionCode] || conditionCode;
}

// Parse auction page HTML to extract details
function parseAuctionPage(html, url) {
  // Extract title from edit-listing-title attribute
  // Pattern: title='Home Theater Accessories, Home Monitoring & Automation, Baby Essentials - Insignia...'
  let fullTitle = '';
  const titleMatch = html.match(/edit-listing-title[^>]*title='([^']+)'/i) ||
    html.match(/edit-listing-title[^>]*title="([^"]+)"/i);
  if (titleMatch) {
    fullTitle = titleMatch[1]
      .replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"');
  }

  // Get category part (before " - " brand section and before " - Orig. Retail")
  let title = fullTitle.split(' - ')[0].trim();

  // Shorten common words
  title = title.replace(/Accessories/gi, 'Acce');
  title = title.replace(/Automation/gi, 'Auto');
  title = title.replace(/Electronics/gi, 'Elec');
  title = title.replace(/Monitoring/gi, 'Monitor');
  title = title.replace(/Essentials/gi, 'Essen');
  title = title.replace(/Computer/gi, 'Comp');
  title = title.replace(/Entertainment/gi, 'Ent');

  // Combine multiple "Acce" categories: "Home Theater Acce, Comp Acce" -> "Home Theater/Comp Acce"
  // First, split by comma
  const parts = title.split(',').map(p => p.trim());

  // Find categories ending in "Acce"
  const acceParts = parts.filter(p => p.endsWith('Acce'));
  const nonAcceParts = parts.filter(p => !p.endsWith('Acce'));

  // If multiple Acce categories, combine them
  if (acceParts.length > 1) {
    // Remove " Acce" from each, join with "/", add " Acce" at end
    const acceCategories = acceParts.map(p => p.replace(/ Acce$/, '')).join('/');
    title = [...nonAcceParts, acceCategories + ' Acce'].filter(Boolean).join(', ');
  }

  // Limit title length (max 45 chars to keep sheet name shorter)
  if (title.length > 45) {
    title = title.substring(0, 45).trim();
    // Don't end on partial word or comma
    const lastSpace = title.lastIndexOf(' ');
    if (lastSpace > 25) {
      title = title.substring(0, lastSpace);
    }
  }

  // Extract condition from "<strong>Condition:</strong> Uninspected Returns"
  let conditionText = 'Uninspected Returns';
  const conditionMatch = html.match(/<strong>Condition:<\/strong>\s*([^<\n]+)/i);
  if (conditionMatch) {
    conditionText = conditionMatch[1].trim();
    // Remove the description after the dash
    conditionText = conditionText.split(' - ')[0].trim();
  }
  const condition = conditionToCode(conditionText);

  // Extract auction end time from data-timestamp attribute
  // Pattern: data-timestamp='2025-12-12T16:10:00Z'
  let pstTime = '';
  const timestampMatch = html.match(/data-timestamp=['"]([^'"]+)['"]/i);
  if (timestampMatch) {
    pstTime = utcToPstTimeString(timestampMatch[1]);
    console.log(`UTC: ${timestampMatch[1]} -> PST Time: ${pstTime}`);
  }

  // Extract manifest download URL (xlsx file)
  // Pattern: href="/pallet_manifests/PTRF29353/...xlsx"
  let manifestUrl = '';
  const manifestMatch = html.match(/href="([^"]*pallet_manifests[^"]*\.xlsx)"/i);
  if (manifestMatch) {
    manifestUrl = manifestMatch[1];
    if (!manifestUrl.startsWith('http')) {
      manifestUrl = `https://www.techliquidators.com${manifestUrl.startsWith('/') ? '' : '/'}${manifestUrl}`;
    }
  }

  // Extract current bid price - try multiple patterns
  let bidPrice = 0;

  // Pattern 1: Look for price in lot-pricing-box area (Angular rendered)
  // Matches: <div class="col-xs-3 text-left ng-binding"...>$201.90</div>
  const pricingBoxMatch = html.match(/lot-pricing-box[\s\S]{0,500}?\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i);
  if (pricingBoxMatch) {
    bidPrice = parseFloat(pricingBoxMatch[1].replace(/,/g, '')) || 0;
    console.log('Found price in lot-pricing-box:', bidPrice);
  }

  // Pattern 2: Look for ng-binding with dollar amount
  if (bidPrice === 0) {
    const ngBindingMatch = html.match(/ng-binding[^>]*>\s*\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i);
    if (ngBindingMatch) {
      bidPrice = parseFloat(ngBindingMatch[1].replace(/,/g, '')) || 0;
      console.log('Found price in ng-binding:', bidPrice);
    }
  }

  // Pattern 3: Look for price-drop class area
  if (bidPrice === 0) {
    const priceDropMatch = html.match(/price-drop[\s\S]{0,100}?\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i);
    if (priceDropMatch) {
      bidPrice = parseFloat(priceDropMatch[1].replace(/,/g, '')) || 0;
      console.log('Found price in price-drop:', bidPrice);
    }
  }

  // Pattern 4: Fallback to JSON-LD schema (starting price, not current bid)
  if (bidPrice === 0) {
    try {
      const schemaMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
      if (schemaMatch) {
        const schemaData = JSON.parse(schemaMatch[1]);
        if (schemaData && schemaData.offers && schemaData.offers.price) {
          bidPrice = parseFloat(schemaData.offers.price) || 0;
          console.log('Using starting price from JSON-LD:', bidPrice);
        }
      }
    } catch (e) {
      console.log('JSON-LD parse error:', e.message);
    }
  }

  console.log('Final Bid Price:', bidPrice);

  // Extract shipping cost
  // If shows "$---" or "No Address" or not found, use 0
  let shipping = 0;
  const shippingMatch = html.match(/Shipping[^$]*\$(\d+(?:\.\d{2})?)/i);
  if (shippingMatch && !html.includes('No Address')) {
    shipping = parseFloat(shippingMatch[1]) || 0;
  }
  console.log('Shipping:', shipping);

  // Build sheet name: "TL Title ConditionCode PSTTime" (with TL prefix)
  const sheetName = `TL ${title} ${condition} ${pstTime}`.trim();

  return {
    title,
    fullTitle,
    condition,
    conditionText,
    conditionForNotes: conditionForNotes(condition),
    pstTime,
    manifestUrl,
    sheetName,
    bidPrice,
    shipping
  };
}

// Parse manifest XLSX file
function parseManifestXLSX(buffer) {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(sheet);

    // Log column headers for debugging
    if (jsonData.length > 0) {
      console.log('XLSX columns found:', Object.keys(jsonData[0]));
    }

    const items = jsonData.map(row => ({
      upc: String(row['UPC'] || row['upc'] || ''),
      productName: String(row['Product Name'] || row['product_name'] || row['Item'] || row['Description'] || '').trim(),
      quantity: parseInt(row['Quantity'] || row['quantity'] || row['Qty'] || '1'),
      unitRetail: parseFloat(String(row['Orig. Retail'] || row['Unit Retail'] || row['Price'] || '0').replace(/[$,]/g, ''))
    }));

    // Sort: Unit Retail highest to lowest, then Product Name A-Z for ties
    items.sort((a, b) => {
      // First sort by Unit Retail (highest to lowest)
      if (b.unitRetail !== a.unitRetail) {
        return b.unitRetail - a.unitRetail;
      }
      // Then by Product Name (A-Z) for items with same price
      const nameA = a.productName.toUpperCase();
      const nameB = b.productName.toUpperCase();
      if (nameA < nameB) return -1;
      if (nameA > nameB) return 1;
      return 0;
    });

    // Debug: log first 5 items to verify sorting
    console.log(`Sorted ${items.length} items (Unit Retail desc, then Name A-Z). First 5:`);
    items.slice(0, 5).forEach((item, i) => {
      console.log(`  ${i + 1}. $${item.unitRetail} - "${item.productName}"`);
    });

    return items;
  } catch (error) {
    console.error('XLSX Parse Error:', error);
    return [];
  }
}

// API: Fetch and parse auction page
app.get('/api/auction', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL required' });

    console.log(`\n=== Fetching auction: ${url} ===`);
    const response = await fetchWithProxy(url);
    const auctionData = parseAuctionPage(response.data, url);
    auctionData.auctionUrl = url;

    console.log('Parsed auction data:', JSON.stringify(auctionData, null, 2));
    res.json(auctionData);
  } catch (error) {
    console.error('Auction fetch error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// API: Fetch and parse manifest
app.get('/api/manifest', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL required' });

    console.log(`\n=== Fetching manifest: ${url} ===`);
    const response = await fetchWithProxy(url, { responseType: 'arraybuffer' });
    const items = parseManifestXLSX(response.data);

    console.log(`Parsed ${items.length} items from manifest`);
    res.json({ items, count: items.length });
  } catch (error) {
    console.error('Manifest fetch error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// API: Full process - fetch auction + manifest, return combined data
app.get('/api/process', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL required' });

    console.log(`\n=== Processing auction: ${url} ===`);

    // Fetch auction page
    const auctionResponse = await fetchWithProxy(url);
    const auctionData = parseAuctionPage(auctionResponse.data, url);
    auctionData.auctionUrl = url;

    // Fetch manifest if URL found
    let manifestItems = [];
    if (auctionData.manifestUrl) {
      console.log(`Fetching manifest from: ${auctionData.manifestUrl}`);
      const manifestResponse = await fetchWithProxy(auctionData.manifestUrl, { responseType: 'arraybuffer' });
      manifestItems = parseManifestXLSX(manifestResponse.data);
      console.log(`Parsed ${manifestItems.length} items from manifest`);
    } else {
      console.log('No manifest URL found');
    }

    const result = {
      auction: auctionData,
      manifest: {
        items: manifestItems,
        count: manifestItems.length
      }
    };

    console.log('Result:', JSON.stringify({ ...result, manifest: { ...result.manifest, items: `[${result.manifest.count} items]` } }, null, 2));
    res.json(result);
  } catch (error) {
    console.error('Process error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// API: Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', proxies: PROXIES.length });
});

const PORT = process.env.PORT || 3847;
app.listen(PORT, () => {
  console.log(`\n🚀 TL Automation Server running on http://localhost:${PORT}`);
  console.log(`📡 ${PROXIES.length} proxies configured`);
  console.log('\nEndpoints:');
  console.log(`  GET /api/health - Health check`);
  console.log(`  GET /api/auction?url=... - Fetch auction details`);
  console.log(`  GET /api/manifest?url=... - Fetch and parse manifest`);
  console.log(`  GET /api/process?url=... - Full process (auction + manifest)`);
});
