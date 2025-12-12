# TL Automation - Complete Technical Documentation

> **Written for future me**: Here's everything you need to understand this system you built. Trust me, you'll forget all this in a month.

---

## What This Does

TL Automation is a Chrome extension + Node.js server that automates the tedious process of processing TechLiquidators auction listings. Instead of manually:
1. Opening each auction
2. Downloading the manifest
3. Creating a spreadsheet
4. Copying item data
5. Recording notes

...this system does it all with one click.

---

## Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Chrome Ext     │────▶│  Node.js Server │────▶│  TechLiquidators│
│  (popup.js)     │     │  (server.js)    │     │  Website        │
│  (background.js)│     │  Port 3847      │     │                 │
└────────┬────────┘     └─────────────────┘     └─────────────────┘
         │                      │
         │                      ▼
         │              ┌─────────────────┐
         │              │  Decodo Proxies │
         │              │  (10 rotating)  │
         │              └─────────────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│  Google Apps    │────▶│  Google Sheets  │
│  Script (doPost)│     │  - WorkSheet    │
│                 │     │  - BSTOCK sheets│
│                 │     │  - Notes sheet  │
└─────────────────┘     └─────────────────┘
```

---

## File Structure & Purpose

### Extension (`/extension/`)

| File | Purpose |
|------|---------|
| `manifest.json` | Chrome extension configuration. Defines permissions, service worker, popup. |
| `popup.html` | The UI that appears when you click the extension icon. Has two tabs: Main and Settings. |
| `popup.js` | Handles UI interactions, sends requests to background.js, displays logs and progress. |
| `background.js` | **The brain**. Service worker that does batch processing, retries, and talks to server + Apps Script. Persists even when popup closes. |
| `content.js` | Injected into TL pages. Currently minimal - most work is done server-side. |

### Server (`/server.js`)

The Node.js server that does the heavy lifting. Why not do this in the extension? Because:
1. **CORS** - Extensions can't easily fetch cross-origin manifest files
2. **Proxies** - We need to rotate proxies to avoid rate limiting
3. **Parsing** - Heavy HTML/Excel parsing is better done server-side

### Google Apps Script (`/google-apps-script/Code.gs`)

Handles all Google Sheets operations. Runs on Google's servers. The extension POSTs data to it via Web App URL.

---

## Server.js - Deep Dive

### Proxy System

```javascript
const PROXIES = [
  { host: 'us.decodo.com', port: 10001, user: '...', pass: '...', label: 'Ken-1' },
  // ... 10 total proxies
];
```

**Why proxies?** TL rate-limits aggressive scraping. We rotate through 10 proxies to spread the load. Each request uses the next proxy in round-robin order.

```javascript
function getNextProxy() {
  const proxy = PROXIES[currentProxyIndex];
  currentProxyIndex = (currentProxyIndex + 1) % PROXIES.length;
  return proxy;
}
```

### Key Endpoints

#### `GET /api/health`
Simple health check. Returns `{ status: 'ok', proxies: 10 }`.

#### `GET /api/auction?url=...`
Fetches and parses a TL auction page.

**Returns:**
```javascript
{
  title: "Home Theater Acce, Computer Acce",  // Shortened title
  fullTitle: "Home Theater Accessories...",   // Full title
  condition: "UR",                            // Code: UR, UW, NC, LN, S
  conditionText: "Uninspected Returns",       // Human readable
  pstTime: "815",                             // Auction end time in PST
  manifestUrl: "https://...",                 // Link to Excel manifest
  sheetName: "TL Home Theater... UR 815",     // Name for the new sheet
  auctionUrl: "https://..."                   // Original URL
}
```

**Why shorten titles?** Google Sheets has a 31-character limit for sheet names. The `shortenTitle()` function aggressively truncates category names.

#### `GET /api/manifest?url=...`
Downloads and parses the Excel manifest file.

**The manifest contains:**
- Product names and SKUs
- Quantities and unit retail prices
- Categories and conditions

**Parsing logic:**
1. Download Excel file
2. Find the data sheet (first sheet that looks like data)
3. Map columns by header names (handles different column orders)
4. Extract items, calculate totals
5. Sort by Unit Retail (highest first), then by name

**Returns:**
```javascript
{
  count: 45,
  totalUnits: 120,
  totalRetail: 15234.56,
  items: [
    { productName: "TV Mount", sku: "123", quantity: 2, unitRetail: 49.99, category: "..." },
    // ...
  ]
}
```

#### `GET /api/process?url=...`
Combines both - fetches auction + manifest. This is what the extension typically calls.

---

## HTML Parsing - How We Extract Data

TL pages are Angular-based, so most dynamic content isn't in the initial HTML. But key info IS in the static HTML:

### Auction Title
```javascript
const titleMatch = html.match(/<h4[^>]*>([^<]+)</);
```
The `<h4>` tag in the listing header contains the full title.

### Condition
```javascript
const conditionMatch = html.match(/Condition[:\s]*<[^>]*>([^<]*)</i);
```
Pattern: `Condition: <span>Uninspected Returns</span>`

### End Time
```javascript
const dateMatch = html.match(/ends[:\s]+(\d{4}[\/\-]\d{2}[\/\-]\d{2})[\sT](\d{2}:\d{2})/i);
```
Pattern: `Ends: 2024-12-15 08:15:00`

Then we convert UTC to PST:
```javascript
function utcToPstTimeString(utcTimestamp) {
  // UTC-8 offset, returns "815" for 8:15 AM
}
```

### Manifest URL
```javascript
const manifestMatch = html.match(/href="([^"]*manifest[^"]*\.xlsx?)"/i)
  || html.match(/(https?:\/\/[^"'\s]*manifest[^"'\s]*\.xlsx?)/i);
```
Looks for any link containing "manifest" and ending in `.xls` or `.xlsx`.

---

## Background.js - The State Machine

The background service worker is complex because it needs to:
1. Handle long-running batch operations
2. Survive popup closes
3. Retry failed requests
4. Track and report progress

### State Variables
```javascript
let isProcessing = false;           // Are we currently batch processing?
let shouldCancel = false;           // User requested cancellation?
let currentProgress = { current: 0, total: 0, status: '' };
let logs = [];                      // Persistent log entries (max 200)
```

### Message Handling
```javascript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startBatch') { ... }
  if (message.action === 'cancelBatch') { ... }
  if (message.action === 'getStatus') { ... }
  if (message.action === 'getLogs') { ... }
  if (message.action === 'processSingle') { ... }
});
```

### Retry Logic
```javascript
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));  // Exponential backoff
    }
  }
}
```

### Badge Notifications
```javascript
function showLoadingBadge(current, total) {
  chrome.action.setBadgeText({ text: `${current}/${total}` });
  chrome.action.setBadgeBackgroundColor({ color: '#4facfe' });
}
```
The extension icon shows progress like "3/15" during batch processing.

---

## Google Apps Script - Sheet Magic

### How It's Called

The extension POSTs JSON to the Web App URL:
```javascript
await fetch(appsScriptUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify({
    action: 'processAuction',
    auction: { ... },
    manifest: { ... },
    worksheetRow: 5,
    config: { analysisSheetId: '...', notesSheetId: '...' }
  })
});
```

**Why `text/plain`?** CORS. Google Apps Script Web Apps handle `text/plain` better than `application/json` for cross-origin requests.

### `doPost(e)` - Entry Point
```javascript
function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const sheetIds = getSheetIds(data.config);
  
  if (data.action === 'processAuction') { ... }
  if (data.action === 'getLinks') { ... }
}
```

### `createBSTOCKSheet()` - The Template Duplicator

1. Opens the Analysis spreadsheet
2. Finds the "BSTOCK Template" sheet
3. Duplicates it with the new auction name
4. Populates cells:
   - **B1**: Auction URL (for VLOOKUP formulas)
   - **F1:G1**: Condition dropdown value
5. If name conflicts, decrements the time number (815 → 814 → 813)

### `populateNotesSheet()` - Item List Generator

Appends rows to the Notes spreadsheet:
```
| Category | Condition | Name | Qty | Price |
| Home Theater | USED | TV Mount | 2 | 49.99 |
```

**Smart row finding:**
```javascript
const columnAValues = sheet.getRange(1, 1, maxRows, 1).getValues();
for (let i = 0; i < columnAValues.length; i++) {
  if (columnAValues[i][0]) lastDataRow = i + 1;
}
startRow = lastDataRow + 1;
```
Scans column A to find the actual last row with data, ignoring formatting that might extend the sheet.

### `getLinksFromWorkSheet()` - Batch Link Fetcher

Returns all TL URLs from WorkSheet column A where column B is blank (not yet processed):
```javascript
const links = values
  .filter(item => 
    item.url.includes('techliquidators.com') &&
    (!item.sheetLink || item.sheetLink.trim() === '')
  );
```

---

## Data Flow - Single Auction Processing

```
1. User clicks "Process This Auction" on a TL page
   │
2. popup.js sends message to background.js
   │
3. background.js calls: GET http://localhost:3847/api/process?url=...
   │
4. server.js:
   ├── Fetches TL page via proxy
   ├── Parses HTML for title, condition, time, manifest URL
   ├── Downloads manifest Excel file
   ├── Parses Excel, extracts items
   └── Returns combined JSON
   │
5. background.js POSTs to Apps Script Web App URL
   │
6. Apps Script:
   ├── Creates new BSTOCK sheet from template
   ├── Populates Notes sheet with items
   ├── Updates WorkSheet with hyperlink to new sheet
   └── Returns success/error
   │
7. background.js updates badge, logs result
   │
8. popup.js displays log entries
```

---

## Data Flow - Batch Processing

```
1. User clicks "Process All Links from Sheet"
   │
2. background.js POSTs: { action: 'getLinks' } to Apps Script
   │
3. Apps Script returns array of unprocessed TL URLs with row numbers
   │
4. For each URL:
   ├── Call /api/process on server
   ├── POST result to Apps Script
   ├── Update badge "3/15"
   ├── Log success/failure
   ├── Check if cancelled
   └── Small delay (1 second)
   │
5. Final badge shows ✓ or error count
```

---

## Configuration (Settings Tab)

| Setting | Purpose |
|---------|---------|
| Apps Script Web App URL | The deployed URL of Code.gs (looks like `https://script.google.com/macros/s/.../exec`) |
| Analysis Sheet ID | Google Sheet ID for BSTOCK analysis (the one with WorkSheet and BSTOCK Template) |
| Notes Sheet ID | Google Sheet ID for the Notes/items list |

**Where to find Sheet IDs:**
```
https://docs.google.com/spreadsheets/d/THIS_IS_THE_ID/edit
```

---

## Condition Mapping

| TL Condition | Code | Notes Sheet |
|--------------|------|-------------|
| Uninspected Returns | UR | USED |
| Used & Working | UW | USED |
| Brand New | NC | NEW |
| Like New | LN | OB |
| Salvage | S | S |

---

## Title Shortening Rules

Because sheet names are limited to 31 characters:

```javascript
'Accessories' → 'Acce'
'Electronics' → 'Elec'
'Computers' → 'Comp'
'Appliances' → 'Appl'
'Furniture' → 'Furn'
'Headphones' → 'Headphones'  // Short enough
```

Multiple "Acce" categories get combined:
```
"Home Theater Accessories, Computer Accessories, Camera Accessories"
→ "Home Theater/Comp/Camera Acce"
```

---

## Error Handling Philosophy

1. **Retry 3 times** - Network issues are common with proxied requests
2. **Log everything** - The Activity Log shows what happened
3. **Continue on failure** - Batch processing skips failed items, doesn't stop
4. **Badge shows errors** - Red background when things go wrong
5. **Don't crash** - Try/catch everywhere, graceful degradation

---

## Security Notes

- **Proxies use credentials** - Don't commit proxy passwords to public repos (oops, they're in server.js)
- **Apps Script is public** - Anyone with the URL can POST to it (but they'd need valid sheet IDs)
- **TL links only** - `getLinksFromWorkSheet()` filters for `techliquidators.com` URLs only

---

## Future Improvements (TODO)

1. **Real-time bid prices** - Requires Puppeteer or TL API access (attempted but TL blocks headless browsers)
2. **Shipping extraction** - Requires logged-in session or API
3. **Rate limiting** - Add configurable delays between requests
4. **Error recovery** - Resume batch processing after extension restart
5. **Multi-account** - Support multiple TL accounts with different credentials

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| "Server offline" | server.js not running | Run `node server.js` |
| "No links found" | All links already processed | Check WorkSheet column B |
| "WorkSheet not found" | Wrong Sheet ID | Update Settings with correct ID |
| Proxy errors | Proxy credentials expired | Update PROXIES in server.js |
| Sheet name conflicts | Time collision | System auto-decrements time (815→814) |

---

## Running Locally

```bash
# Install dependencies
npm install

# Start server
node server.js
# or double-click start.bat

# Load extension in Chrome
# 1. Go to chrome://extensions
# 2. Enable Developer Mode
# 3. Load Unpacked → Select /extension folder

# Deploy Apps Script
# 1. Create new Apps Script project
# 2. Paste Code.gs content
# 3. Deploy as Web App (anyone can access)
# 4. Copy the URL to extension settings
```

---

*Last updated: December 2024*
*Author: Past you, explaining to future you*
