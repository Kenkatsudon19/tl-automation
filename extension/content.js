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
    const manifestLink = document.querySelector('a[href*="manifest"], button:contains("Download Manifest")');
    if (manifestLink) {
        data.manifestUrl = manifestLink.href;
    }

    return data;
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractData') {
        const data = extractAuctionData();
        sendResponse(data);
    }
    return true;
});
