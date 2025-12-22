/**
 * TechLiquidators Auction Automation - Google Apps Script
 * 
 * This script receives auction data from the Chrome extension (via proxy server)
 * and populates both the BSTOCK Template and Notes spreadsheet.
 * 
 * SETUP:
 * 1. Open Google Apps Script (script.google.com)
 * 2. Create a new project
 * 3. Paste this code
 * 4. Deploy as Web App (Execute as: Me, Who has access: Anyone)
 * 5. Copy the Web App URL and paste it in the extension settings
 */

// Default Configuration - Can be overridden from extension settings
const DEFAULT_ANALYSIS_SHEET_ID = '1i5gYasyESN8L332m3J5gzQjwIomiLZ1vQw8ZBz5rLJk';
const DEFAULT_NOTES_SHEET_ID = '15dsm8Awu0oW0yyn6xgaYTQ5jdnzMnXfVyqIsnoUx1GA';
const BSTOCK_TEMPLATE_NAME = 'BSTOCK Template';
const NOTES_TAB_NAME = 'BbList';

// Helper to get sheet IDs (from config or defaults)
function getSheetIds(config) {
  return {
    analysisSheetId: (config && config.analysisSheetId) || DEFAULT_ANALYSIS_SHEET_ID,
    notesSheetId: (config && config.notesSheetId) || DEFAULT_NOTES_SHEET_ID
  };
}

/**
 * Handle incoming POST requests from the extension
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const sheetIds = getSheetIds(data.config);
    
    if (data.action === 'processAuction') {
      const result = processAuction(data.auction, data.manifest, data.worksheetRow, sheetIds);
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    if (data.action === 'getLinks') {
      // Pass filter parameter - if 'all', return all TL links regardless of column B
      const getAll = data.filter === 'all';
      const links = getLinksFromWorkSheet(sheetIds, getAll);
      return ContentService.createTextOutput(JSON.stringify({ links: links }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    if (data.action === 'updatePrices') {
      const result = updatePrices(data.row, data.bid, data.shipping, sheetIds);
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    return ContentService.createTextOutput(JSON.stringify({ error: 'Unknown action' }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    console.error('doPost error:', error);
    return ContentService.createTextOutput(JSON.stringify({ error: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Handle GET requests (for testing)
 */
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ 
    status: 'ok',
    message: 'TL Automation Apps Script is running'
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Main function to process an auction
 * @param {object} auction - Auction data
 * @param {array} manifestItems - Manifest items
 * @param {number} worksheetRow - Row number in WorkSheet (optional)
 * @param {object} sheetIds - Sheet IDs from config
 */
function processAuction(auction, manifestItems, worksheetRow, sheetIds) {
  console.log('Processing auction:', auction.sheetName);
  console.log('Manifest items:', manifestItems.length);
  
  // Use passed sheetIds or defaults
  const ids = sheetIds || getSheetIds();
  
  // 1. Create BSTOCK sheet from template
  const bstockResult = createBSTOCKSheet(auction, manifestItems, ids);
  
  // 2. Populate Notes spreadsheet
  const notesResult = populateNotesSheet(auction, manifestItems, ids);
  
  // 3. Update WorkSheet column B with link to created sheet
  if (bstockResult.status === 'created') {
    let rowToUpdate = worksheetRow;
    if (!rowToUpdate && auction.auctionUrl) {
      rowToUpdate = findRowByUrl(auction.auctionUrl, ids);
    }
    
    if (rowToUpdate) {
      updateWorkSheetLink(rowToUpdate, auction.sheetName, ids);
    }
  }
  
  return {
    success: true,
    bstockSheet: bstockResult,
    notesSheet: notesResult
  };
}

/**
 * Find the row in WorkSheet that matches the given URL
 */
function findRowByUrl(url, sheetIds) {
  const ss = SpreadsheetApp.openById(sheetIds.analysisSheetId);
  const worksheet = ss.getSheetByName('WorkSheet');
  
  if (!worksheet) {
    console.error('WorkSheet not found');
    return null;
  }
  
  const lastRow = worksheet.getLastRow();
  if (lastRow < 4) return null;
  
  // Get all URLs from column A
  const range = worksheet.getRange(4, 1, lastRow - 3, 1);
  const values = range.getValues();
  
  // Find matching URL
  for (let i = 0; i < values.length; i++) {
    const cellUrl = values[i][0].toString().trim();
    // Match by checking if it contains the same auction ID
    if (cellUrl && (cellUrl === url || url.includes(cellUrl.split('/detail/')[1]?.split('/')[0] || 'NO_MATCH'))) {
      console.log('Found matching row:', i + 4, 'for URL:', url);
      return i + 4;  // Row number (accounting for header rows)
    }
  }
  
  console.log('No matching row found for URL:', url);
  return null;
}

/**
 * Update WorkSheet column B with a hyperlink to the created sheet
 */
function updateWorkSheetLink(row, sheetName, sheetIds) {
  const ss = SpreadsheetApp.openById(sheetIds.analysisSheetId);
  const worksheet = ss.getSheetByName('WorkSheet');
  
  if (!worksheet) {
    console.error('WorkSheet not found for updating link');
    return;
  }
  
  // Create hyperlink formula: =HYPERLINK("#gid=SHEET_ID", "Sheet Name")
  const targetSheet = ss.getSheetByName(sheetName);
  if (targetSheet) {
    const sheetId = targetSheet.getSheetId();
    const spreadsheetUrl = ss.getUrl();
    const sheetUrl = `${spreadsheetUrl}#gid=${sheetId}`;
    
    // Set hyperlink in column B
    const cell = worksheet.getRange(row, 2);  // Column B
    cell.setFormula(`=HYPERLINK("${sheetUrl}", "${sheetName}")`);
    
    console.log(`Updated WorkSheet row ${row} column B with link to: ${sheetName}`);
  }
}

/**
 * Duplicate BSTOCK Template and populate with auction data
 */
function createBSTOCKSheet(auction, manifestItems, sheetIds) {
  const ss = SpreadsheetApp.openById(sheetIds.analysisSheetId);
  const template = ss.getSheetByName(BSTOCK_TEMPLATE_NAME);
  
  if (!template) {
    throw new Error('BSTOCK Template sheet not found');
  }
  
  // Generate unique sheet name - decrement time if name already exists
  let finalSheetName = auction.sheetName;
  let attempts = 0;
  const maxAttempts = 10;
  
  while (ss.getSheetByName(finalSheetName) && attempts < maxAttempts) {
    // Extract the time number from the end of the sheet name
    const match = finalSheetName.match(/^(.+)\s(\d+)$/);
    if (match) {
      const baseName = match[1];
      const timeNum = parseInt(match[2]) - 1;
      finalSheetName = `${baseName} ${timeNum}`;
      console.log('Sheet exists, trying:', finalSheetName);
    } else {
      // No time number at end, append -2
      finalSheetName = finalSheetName + '-2';
    }
    attempts++;
  }
  
  if (attempts >= maxAttempts) {
    console.log('Too many duplicate sheet names:', auction.sheetName);
    return { sheetName: auction.sheetName, status: 'already_exists' };
  }
  
  // Update auction.sheetName for hyperlink purposes
  auction.sheetName = finalSheetName;
  
  // Duplicate template
  const newSheet = template.copyTo(ss);
  newSheet.setName(finalSheetName);
  
  // Move to desired position (after BSTOCK Template)
  const templateIndex = template.getIndex();
  ss.setActiveSheet(newSheet);
  ss.moveActiveSheet(templateIndex + 1);
  
  // Populate data:
  // B1 = Auction Link
  newSheet.getRange('B1').setValue(auction.auctionUrl);
  
  // Set condition in F1:G1 (set on both cells to handle merged/unmerged scenarios)
  const conditionValue = getConditionDropdownValue(auction.condition);
  try {
    newSheet.getRange('F1').setValue(conditionValue);
    newSheet.getRange('G1').setValue(conditionValue);
    console.log('Set condition F1:G1:', conditionValue);
  } catch (e) {
    console.log('Error setting condition:', e.message);
  }
  
  // A12:A = UPC (as plain text to preserve leading zeros), C12:C = Qty
  if (manifestItems && manifestItems.length > 0) {
    // Convert UPC to string to preserve leading zeros
    const upcs = manifestItems.map(item => [String(item.upc || '')]);
    const qtys = manifestItems.map(item => [item.quantity]);
    
    const startRow = 12;
    // Set number format to plain text BEFORE setting values to preserve leading zeros
    const upcRange = newSheet.getRange(startRow, 1, upcs.length, 1);
    upcRange.setNumberFormat('@');  // @ = plain text format
    upcRange.setValues(upcs);  // Column A = UPC
    newSheet.getRange(startRow, 3, qtys.length, 1).setValues(qtys);  // Column C = Qty
  }
  
  console.log('Created BSTOCK sheet:', auction.sheetName);
  return { sheetName: auction.sheetName, status: 'created', itemCount: manifestItems.length };
}

/**
 * Map condition code to dropdown value
 */
function getConditionDropdownValue(conditionCode) {
  const mapping = {
    'UR': 'Uninspected Returns',
    'UW': 'Used & Working',
    'NC': 'New',
    'LN': 'Like New',
    'S': 'Salvage'
  };
  return mapping[conditionCode] || conditionCode;
}

/**
 * Populate Notes spreadsheet with manifest data
 */
function populateNotesSheet(auction, manifestItems, sheetIds) {
  const ss = SpreadsheetApp.openById(sheetIds.notesSheetId);
  const sheet = ss.getSheetByName(NOTES_TAB_NAME);
  
  if (!sheet) {
    throw new Error('Notes sheet (BbList) not found');
  }
  
  // Find the last row with data in column A specifically
  // This ignores formatting and other columns that might have data far down
  let startRow = 2;  // Default: start at row 2 (assuming row 1 is header)
  
  try {
    // Get column A values up to row 10000 (reasonable limit)
    const maxRows = Math.min(sheet.getMaxRows(), 10000);
    const columnARange = sheet.getRange(1, 1, maxRows, 1);
    const columnAValues = columnARange.getValues();
    
    // Find last non-empty row in column A
    let lastDataRow = 0;
    for (let i = 0; i < columnAValues.length; i++) {
      const cellValue = columnAValues[i][0];
      if (cellValue !== '' && cellValue !== null && cellValue !== undefined) {
        lastDataRow = i + 1;  // +1 because array is 0-indexed
      }
    }
    
    // Start after the last row with data in column A
    startRow = Math.max(lastDataRow + 1, 2);
    
    console.log('Notes: Scanned column A - Last data row:', lastDataRow, 'Starting at row:', startRow);
  } catch (e) {
    console.log('Notes: Error finding last row:', e.message, '- starting at row 2');
    startRow = 2;
  }
  
  // Prepare data: A = UPC (plain text to preserve leading zeros), B = Product Name, C = Unit Retail, D = Condition
  if (manifestItems && manifestItems.length > 0) {
    // Convert UPC to string to preserve leading zeros
    const data = manifestItems.map(item => [
      String(item.upc || ''),             // Column A: Item # (UPC) - as string
      item.productName,                   // Column B: Item Description (Product Name)
      item.unitRetail,                    // Column C: Unit Retail (UR)
      auction.conditionForNotes           // Column D: Condition (UR, USED, NEW, OB)
    ]);
    
    // Set column A number format to plain text BEFORE setting values
    sheet.getRange(startRow, 1, data.length, 1).setNumberFormat('@');  // @ = plain text format for UPC column
    sheet.getRange(startRow, 1, data.length, 4).setValues(data);
    console.log('Pasted', data.length, 'items at row', startRow);
  }
  
  console.log('Updated Notes sheet with', manifestItems.length, 'items starting at row', startRow);
  return { tabName: NOTES_TAB_NAME, itemCount: manifestItems.length, startRow: startRow };
}

/**
 * Get all links from WorkSheet for batch processing
 * @param {object} sheetIds - Sheet IDs
 * @param {boolean} getAll - If true, return ALL TL links; if false, only where column B is blank
 */
function getLinksFromWorkSheet(sheetIds, getAll = false) {
  const ss = SpreadsheetApp.openById(sheetIds.analysisSheetId);
  const sheet = ss.getSheetByName('WorkSheet');
  
  if (!sheet) {
    throw new Error('WorkSheet not found');
  }
  
  // Get links from column A and B, starting from row 4
  const lastRow = sheet.getLastRow();
  if (lastRow < 4) {
    return [];
  }
  
  // Get both columns A and B
  const range = sheet.getRange(4, 1, lastRow - 3, 2);  // Columns A and B
  const values = range.getValues();
  
  // Filter based on getAll parameter
  const links = values
    .map((row, index) => ({ 
      url: row[0], 
      sheetLink: row[1],  // Column B value
      row: index + 4 
    }))
    .filter(item => {
      if (!item.url || !item.url.toString().includes('techliquidators.com')) {
        return false;  // Must be a TL link
      }
      if (getAll) {
        return true;  // Return all TL links
      }
      // Only if B is blank (for sheet creation)
      return !item.sheetLink || item.sheetLink.toString().trim() === '';
    });
  
  console.log(`Found ${links.length} links (getAll=${getAll})`);
  return links;
}

/**
 * Update bid and shipping prices in WorkSheet
 * Column C = Bid, Column D = Shipping
 */
function updatePrices(row, bid, shipping, sheetIds) {
  const ss = SpreadsheetApp.openById(sheetIds.analysisSheetId);
  const worksheet = ss.getSheetByName('WorkSheet');
  
  if (!worksheet) {
    return { error: 'WorkSheet not found' };
  }
  
  // Update Column C (Bid) and Column D (Shipping)
  worksheet.getRange(row, 3).setValue(bid);      // Column C = Bid
  worksheet.getRange(row, 4).setValue(shipping); // Column D = Shipping
  
  console.log(`Updated row ${row}: Bid=$${bid}, Shipping=$${shipping}`);
  return { success: true, row: row, bid: bid, shipping: shipping };
}

/**
 * Test function - run this to verify the script is working
 */
function testScript() {
  const testAuction = {
    title: 'Test Auction Title',
    sheetName: 'Test Acce UR 809',
    condition: 'UR',
    conditionForNotes: 'UR',
    auctionUrl: 'https://www.techliquidators.com/test'
  };
  
  const testManifest = [
    { upc: '123456789', productName: 'Test Product 1', quantity: 2, unitRetail: 49.99 },
    { upc: '987654321', productName: 'Test Product 2', quantity: 1, unitRetail: 99.99 }
  ];
  
  console.log('Testing with:', testAuction);
  console.log('Manifest items:', testManifest);
  
  // Run processAuction
  const result = processAuction(testAuction, testManifest);
  console.log('Result:', result);
}
