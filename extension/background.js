// TL Automation - Background Service Worker
// Handles batch processing, persistent logs, and settings

const SERVER_URL = 'http://localhost:3847';

// State
let isProcessing = false;
let shouldCancel = false;
let currentProgress = { current: 0, total: 0, status: '' };
let logs = [];
const MAX_LOGS = 200;

// Add a log entry
function addLog(message, type = 'info') {
    const entry = {
        time: new Date().toLocaleTimeString(),
        message,
        type
    };
    logs.push(entry);

    // Keep logs limited
    if (logs.length > MAX_LOGS) {
        logs = logs.slice(-MAX_LOGS);
    }

    console.log(`[${type}] ${message}`);
}

// Clear logs
function clearLogs() {
    logs = [];
    addLog('Logs cleared', 'info');
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'startBatch') {
        startBatchProcessing(message.appsScriptUrl, message.config);
        sendResponse({ started: true });
    } else if (message.action === 'cancelBatch') {
        shouldCancel = true;
        addLog('Cancel requested...', 'info');
        sendResponse({ cancelled: true });
    } else if (message.action === 'getStatus') {
        sendResponse({
            isProcessing,
            progress: currentProgress,
            shouldCancel,
            logs: logs
        });
    } else if (message.action === 'getLogs') {
        sendResponse({ logs: logs });
    } else if (message.action === 'clearLogs') {
        clearLogs();
        sendResponse({ cleared: true });
    } else if (message.action === 'processSingle') {
        processSingleAuction(message.url, message.appsScriptUrl, message.config)
            .then(result => sendResponse(result))
            .catch(err => sendResponse({ error: err.message }));
        return true;
    }
    return true;
});

// Badge helpers
function setBadge(text, color) {
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color });
}

function clearBadge() {
    chrome.action.setBadgeText({ text: '' });
}

function showLoadingBadge(current, total) {
    setBadge(`${current}`, '#4facfe');
}

function showSuccessBadge() {
    setBadge('✓', '#4caf50');
    setTimeout(clearBadge, 10000);
}

function showErrorBadge() {
    setBadge('!', '#f44336');
    setTimeout(clearBadge, 10000);
}

// Fetch with retry logic
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, {
                ...options,
                signal: AbortSignal.timeout(60000)
            });
            if (response.ok) return response;

            if (response.status >= 400 && response.status < 500) {
                throw new Error(`HTTP ${response.status}`);
            }
            throw new Error(`HTTP ${response.status}`);
        } catch (error) {
            if (attempt < maxRetries) {
                addLog(`Retry ${attempt}/${maxRetries}: ${error.message}`, 'info');
                await new Promise(r => setTimeout(r, 1000 * attempt));
            } else {
                throw error;
            }
        }
    }
}

// Process single auction
async function processSingleAuction(url, appsScriptUrl, config = {}) {
    addLog(`Processing: ${url.substring(0, 50)}...`, 'info');

    const processResponse = await fetchWithRetry(
        `${SERVER_URL}/api/process?url=${encodeURIComponent(url)}`
    );
    const data = await processResponse.json();

    if (!data.auction || !data.manifest) {
        throw new Error('Invalid auction data');
    }

    addLog(`Found ${data.manifest.count} items: ${data.auction.sheetName}`, 'success');

    const sheetResponse = await fetchWithRetry(appsScriptUrl, {
        method: 'POST',
        mode: 'cors',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
            action: 'processAuction',
            auction: data.auction,
            manifest: data.manifest.items,
            config: config
        })
    });

    const result = await sheetResponse.json();
    addLog(`✓ Created: ${data.auction.sheetName}`, 'success');
    return { success: true, sheetName: data.auction.sheetName, itemCount: data.manifest.count };
}

// Main batch processing
async function startBatchProcessing(appsScriptUrl, config = {}) {
    if (isProcessing) {
        addLog('Already processing', 'error');
        return;
    }

    isProcessing = true;
    shouldCancel = false;
    addLog('=== Starting batch processing ===', 'info');

    try {
        setBadge('...', '#888');
        addLog('Fetching links from WorkSheet...', 'info');

        const linksResponse = await fetchWithRetry(appsScriptUrl, {
            method: 'POST',
            mode: 'cors',
            redirect: 'follow',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'getLinks', config: config })
        });

        const linksData = await linksResponse.json();
        const links = linksData.links || [];

        if (links.length === 0) {
            addLog('No unprocessed links found (column B blank)', 'error');
            currentProgress = { current: 0, total: 0, status: 'No links found' };
            showErrorBadge();
            isProcessing = false;
            return;
        }

        addLog(`Found ${links.length} links to process`, 'success');
        currentProgress = { current: 0, total: links.length, status: 'Starting...' };

        let processed = 0;
        let failed = 0;

        for (let i = 0; i < links.length; i++) {
            if (shouldCancel) {
                addLog(`Cancelled at ${i}/${links.length}`, 'error');
                currentProgress.status = `Cancelled`;
                showErrorBadge();
                break;
            }

            const link = links[i];
            currentProgress = {
                current: i + 1,
                total: links.length,
                status: `Processing ${i + 1}/${links.length}...`
            };
            showLoadingBadge(i + 1, links.length);

            try {
                addLog(`[${i + 1}/${links.length}] ${link.url.split('/detail/')[1]?.split('/')[0] || link.url}`, 'info');

                const processResponse = await fetchWithRetry(
                    `${SERVER_URL}/api/process?url=${encodeURIComponent(link.url)}`
                );
                const data = await processResponse.json();

                await fetchWithRetry(appsScriptUrl, {
                    method: 'POST',
                    mode: 'cors',
                    redirect: 'follow',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({
                        action: 'processAuction',
                        auction: data.auction,
                        manifest: data.manifest.items,
                        worksheetRow: link.row,
                        config: config
                    })
                });

                processed++;
                addLog(`✓ ${data.auction.sheetName} (${data.manifest.count} items)`, 'success');

            } catch (error) {
                failed++;
                addLog(`✗ Failed row ${link.row}: ${error.message}`, 'error');
            }

            // Delay
            if (i < links.length - 1 && !shouldCancel) {
                await new Promise(r => setTimeout(r, 1500));
            }
        }

        currentProgress = {
            current: links.length,
            total: links.length,
            status: `Done: ${processed} ok, ${failed} failed`
        };

        addLog(`=== Batch complete: ${processed} succeeded, ${failed} failed ===`, processed > 0 ? 'success' : 'error');

        if (failed === 0 && processed > 0) {
            showSuccessBadge();
        } else {
            showErrorBadge();
        }

    } catch (error) {
        addLog(`Batch error: ${error.message}`, 'error');
        currentProgress.status = `Error: ${error.message}`;
        showErrorBadge();
    } finally {
        isProcessing = false;
        shouldCancel = false;
    }
}

// Keep service worker alive
setInterval(() => {
    if (isProcessing) {
        console.log('Keep-alive:', currentProgress.status);
    }
}, 20000);

addLog('TL Automation service worker loaded', 'info');
