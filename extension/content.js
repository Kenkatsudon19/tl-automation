// Content script for TechLiquidators pages
// This script runs on TL auction pages and can interact with the DOM

console.log('[TL Automation] Content script loaded');

// Extract auction data from the current page
function extractAuctionData() {
    const data = {
        title: '',
        condition: '',
        pstTime: '',
        manifestUrl: ''
    };

    // Try to get title from h1 or page title
    const h1 = document.querySelector('h1');
    if (h1) {
        data.title = h1.textContent.trim().split(' - ')[0];
    }

    // Look for condition text
    const bodyText = document.body.innerText;
    const conditionMatch = bodyText.match(/Condition:\s*([^\n]+)/i);
    if (conditionMatch) {
        const condText = conditionMatch[1].toLowerCase();
        if (condText.includes('uninspected')) data.condition = 'UR';
        else if (condText.includes('used') || condText.includes('working')) data.condition = 'UW';
        else if (condText.includes('brand new')) data.condition = 'NC';
        else if (condText.includes('new') && !condText.includes('like')) data.condition = 'NC';
        else if (condText.includes('like new')) data.condition = 'LN';
        else if (condText.includes('salvage')) data.condition = 'S';
    }

    // Look for PST time
    const pstMatch = bodyText.match(/PST\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (pstMatch) {
        data.pstTime = `${pstMatch[1]}${pstMatch[2]}`;
    }

    // Look for manifest download link
    const manifestLink = document.querySelector('a[href*="manifest"]');
    if (manifestLink) {
        data.manifestUrl = manifestLink.href;
    }

    return data;
}

// Extract current bid and shipping from Price Breakdown section
function extractPrices() {
    let bid = 0;
    let shipping = 0;

    // Helper to parse price string
    const parsePrice = (str) => {
        if (!str || str.includes('---') || str.includes('--')) return 0;
        const match = str.match(/\$?([\d,]+(?:\.\d{2})?)/);
        return match ? parseFloat(match[1].replace(/,/g, '')) : 0;
    };

    // Find all pricing box items using the discovered selectors
    const pricingItems = document.querySelectorAll('.lot-pricing-box-item');

    pricingItems.forEach(item => {
        const labelEl = item.querySelector('.col-xs-9');
        const valueEl = item.querySelector('.col-xs-3');

        if (!labelEl || !valueEl) return;

        const label = labelEl.textContent.trim().toLowerCase();
        const valueText = valueEl.textContent.trim();

        // Check for bid-related labels
        if (label.includes('current bid') || label.includes('starting bid') || label.includes('lot price')) {
            bid = parsePrice(valueText);
            console.log('[TL] Found bid:', bid, 'from label:', label);
        }

        // Check for shipping label
        if (label.includes('shipping')) {
            shipping = parsePrice(valueText);
            console.log('[TL] Found shipping:', shipping, 'from label:', label);
        }
    });

    // Fallback: try generic text search if pricing box not found
    if (bid === 0) {
        const bodyText = document.body.innerText;
        // Look for "Current Bid" followed by a price
        const bidMatch = bodyText.match(/(?:Current Bid|Starting Bid|Lot Price)[^\$]*\$([\d,]+(?:\.\d{2})?)/i);
        if (bidMatch) {
            bid = parseFloat(bidMatch[1].replace(/,/g, ''));
            console.log('[TL] Fallback bid found:', bid);
        }
    }

    return { bid, shipping };
}

// Check if auction is closed
function isAuctionClosed() {
    const text = document.body.innerText;
    return text.includes('Auction Closed') || text.includes('Bidding has ended');
}

// Listen for messages from background/popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractData') {
        const data = extractAuctionData();
        sendResponse(data);
    } else if (request.action === 'extractPrices') {
        const prices = extractPrices();
        const closed = isAuctionClosed();
        sendResponse({ ...prices, closed });
    }
    return true;
});
