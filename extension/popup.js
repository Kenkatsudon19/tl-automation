// TL Automation Popup
// Communicates with background service worker

const SERVER_URL = 'http://localhost:3847';

// DOM Elements
let statusDot, statusText, auctionTitle, auctionMeta, auctionCondition, auctionTime;
let processBtn, batchBtn, cancelBtn, progressContainer, progressFill, progressText, logContainer;
let appsScriptUrlInput, analysisSheetIdInput, notesSheetIdInput, saveSettingsBtn;
let refreshLogsBtn, clearLogsBtn;
let tabBtns, tabContents;

// State
let currentUrl = null;
let statusCheckInterval = null;

document.addEventListener('DOMContentLoaded', async () => {
    // Tab Elements
    tabBtns = document.querySelectorAll('.tab-btn');
    tabContents = document.querySelectorAll('.tab-content');

    // Main tab elements
    statusDot = document.getElementById('statusDot');
    statusText = document.getElementById('statusText');
    auctionTitle = document.getElementById('auctionTitle');
    auctionMeta = document.getElementById('auctionMeta');
    auctionCondition = document.getElementById('auctionCondition');
    auctionTime = document.getElementById('auctionTime');
    processBtn = document.getElementById('processBtn');
    batchBtn = document.getElementById('batchBtn');
    cancelBtn = document.getElementById('cancelBtn');
    progressContainer = document.getElementById('progressContainer');
    progressFill = document.getElementById('progressFill');
    progressText = document.getElementById('progressText');
    logContainer = document.getElementById('logContainer');
    refreshLogsBtn = document.getElementById('refreshLogsBtn');
    clearLogsBtn = document.getElementById('clearLogsBtn');

    // Settings tab elements
    appsScriptUrlInput = document.getElementById('appsScriptUrl');
    analysisSheetIdInput = document.getElementById('analysisSheetId');
    notesSheetIdInput = document.getElementById('notesSheetId');
    saveSettingsBtn = document.getElementById('saveSettingsBtn');

    // Setup tab navigation
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;
            switchTab(tabId);
        });
    });

    // Load saved settings
    await loadSettings();

    // Check server status
    await checkServerStatus();

    // Load logs from background
    await loadLogs();

    // Check if background is processing
    await checkBackgroundStatus();

    // Get current tab URL
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url?.includes('techliquidators.com')) {
        currentUrl = tab.url;
        auctionTitle.textContent = 'Loading auction details...';
        await loadAuctionPreview(tab.url);
    }

    processBtn.addEventListener('click', processCurrentAuction);
    batchBtn.addEventListener('click', startBatchProcessing);
    cancelBtn.addEventListener('click', cancelBatchProcessing);
    saveSettingsBtn.addEventListener('click', saveSettings);
    refreshLogsBtn.addEventListener('click', loadLogs);
    clearLogsBtn.addEventListener('click', clearLogs);

    // Periodically check background status
    statusCheckInterval = setInterval(async () => {
        await checkBackgroundStatus();
        await loadLogs();
    }, 3000);
});

// Cleanup on popup close
window.addEventListener('unload', () => {
    if (statusCheckInterval) {
        clearInterval(statusCheckInterval);
    }
});

function switchTab(tabId) {
    tabBtns.forEach(btn => btn.classList.remove('active'));
    tabContents.forEach(content => content.classList.remove('active'));

    document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
    document.getElementById(`tab-${tabId}`).classList.add('active');
}

async function loadSettings() {
    const storage = await chrome.storage.local.get(['appsScriptUrl', 'analysisSheetId', 'notesSheetId']);

    if (storage.appsScriptUrl) {
        appsScriptUrlInput.value = storage.appsScriptUrl;
    }
    if (storage.analysisSheetId) {
        analysisSheetIdInput.value = storage.analysisSheetId;
    }
    if (storage.notesSheetId) {
        notesSheetIdInput.value = storage.notesSheetId;
    }
}

async function saveSettings() {
    const settings = {
        appsScriptUrl: appsScriptUrlInput.value.trim(),
        analysisSheetId: analysisSheetIdInput.value.trim(),
        notesSheetId: notesSheetIdInput.value.trim()
    };

    if (!settings.appsScriptUrl) {
        alert('Apps Script URL is required!');
        return;
    }

    await chrome.storage.local.set(settings);

    // Show success and switch to main tab
    alert('Settings saved!');
    switchTab('main');
}

function getConfig() {
    return {
        analysisSheetId: analysisSheetIdInput.value.trim(),
        notesSheetId: notesSheetIdInput.value.trim()
    };
}

async function checkServerStatus() {
    try {
        const response = await fetch(`${SERVER_URL}/api/health`, { signal: AbortSignal.timeout(5000) });
        if (response.ok) {
            const data = await response.json();
            statusDot.classList.add('connected');
            statusText.textContent = `Server online \u2022 ${data.proxies} proxies`;
            processBtn.disabled = false;
            batchBtn.disabled = false;
        }
    } catch (error) {
        statusDot.classList.remove('connected');
        statusText.textContent = 'Server offline';
    }
}

async function loadLogs() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getLogs' });
        if (response && response.logs) {
            renderLogs(response.logs);
        }
    } catch (error) {
        console.log('Error loading logs:', error);
    }
}

async function clearLogs() {
    await chrome.runtime.sendMessage({ action: 'clearLogs' });
    await loadLogs();
}

function renderLogs(logs) {
    if (logs.length === 0) {
        logContainer.innerHTML = '<div class="log-entry">No logs yet...</div>';
        return;
    }

    logContainer.innerHTML = logs.map(log =>
        `<div class="log-entry ${log.type}">[${log.time}] ${log.message}</div>`
    ).join('');

    logContainer.scrollTop = logContainer.scrollHeight;
}

async function checkBackgroundStatus() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getStatus' });

        if (response.isProcessing) {
            showProgress(true);
            updateProgress(
                Math.round((response.progress.current / Math.max(response.progress.total, 1)) * 100),
                response.progress.status
            );
            batchBtn.disabled = true;
            cancelBtn.style.display = 'block';
        } else {
            showProgress(false);
            cancelBtn.style.display = 'none';

            // Re-enable batch button if server is online
            const serverOnline = statusDot.classList.contains('connected');
            batchBtn.disabled = !serverOnline;
        }
    } catch (error) {
        console.log('Background status check error:', error);
    }
}

async function loadAuctionPreview(url) {
    try {
        const response = await fetch(`${SERVER_URL}/api/auction?url=${encodeURIComponent(url)}`, {
            signal: AbortSignal.timeout(30000)
        });
        if (response.ok) {
            const data = await response.json();
            auctionTitle.textContent = data.title || 'Unknown Auction';
            if (data.condition || data.pstTime) {
                auctionMeta.style.display = 'flex';
                auctionCondition.textContent = data.condition || '';
                auctionTime.textContent = data.pstTime ? `PST ${data.pstTime}` : '';
            }
        }
    } catch (error) {
        auctionTitle.textContent = 'Failed to load auction';
    }
}

async function processCurrentAuction() {
    if (!currentUrl) return;

    // Get Apps Script URL
    const storage = await chrome.storage.local.get('appsScriptUrl');
    const appsScriptUrl = storage.appsScriptUrl;

    if (!appsScriptUrl) {
        alert('Apps Script URL not configured. Go to Settings tab.');
        switchTab('settings');
        return;
    }

    processBtn.disabled = true;
    showProgress(true);
    updateProgress(20, 'Processing...');

    try {
        const result = await chrome.runtime.sendMessage({
            action: 'processSingle',
            url: currentUrl,
            appsScriptUrl: appsScriptUrl,
            config: getConfig()
        });

        if (result.error) {
            throw new Error(result.error);
        }

        updateProgress(100, 'Complete!');
        setTimeout(() => {
            showProgress(false);
            loadLogs();
        }, 2000);

    } catch (error) {
        alert(`Error: ${error.message}`);
        showProgress(false);
    } finally {
        processBtn.disabled = false;
    }
}

async function startBatchProcessing() {
    const storage = await chrome.storage.local.get('appsScriptUrl');
    const appsScriptUrl = storage.appsScriptUrl;

    if (!appsScriptUrl) {
        alert('Apps Script URL not configured. Go to Settings tab.');
        switchTab('settings');
        return;
    }

    // Send to background
    await chrome.runtime.sendMessage({
        action: 'startBatch',
        appsScriptUrl: appsScriptUrl,
        config: getConfig()
    });

    // Update UI
    batchBtn.disabled = true;
    cancelBtn.style.display = 'block';
    showProgress(true);
    updateProgress(0, 'Starting...');
}

async function cancelBatchProcessing() {
    await chrome.runtime.sendMessage({ action: 'cancelBatch' });
    cancelBtn.style.display = 'none';
}

function showProgress(show) {
    progressContainer.classList.toggle('active', show);
    if (!show) {
        progressFill.style.width = '0%';
    }
}

function updateProgress(percent, text) {
    progressFill.style.width = `${percent}%`;
    progressText.textContent = text;
}
