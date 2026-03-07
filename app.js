/* ===== SolveIt — app.js ===== */

// --------------- Constants ---------------
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const CORS_PROXIES = [
    { name: 'allorigins', url: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}` },
    { name: 'corsproxy',  url: (u) => `https://corsproxy.io/?${encodeURIComponent(u)}` },
];

const MAX_CONTENT_LENGTH = 40000; // chars sent to Gemini
const HISTORY_KEY = 'solveit_history';
const API_KEY_KEY = 'solveit_api_key';
const MAX_HISTORY = 50;

const SYSTEM_PROMPT = `You are SolveIt, an expert problem solver. The user has given you the text content of a webpage. Your job is to figure out what the page is about and provide a comprehensive solution or explanation.

Instructions:
1. First, identify the type of content (math problem, coding challenge, quiz, puzzle, homework, article, form, tutorial, etc.)
2. Provide a clear, well-structured solution using markdown formatting
3. Use step-by-step reasoning where appropriate
4. Include the final answer prominently
5. If the content contains multiple problems, solve all of them
6. If it's an article or informational page, provide a thorough summary with key takeaways
7. If it's a coding problem, provide clean, working code with explanations
8. For math, show all work clearly

Format your response as follows:
## [Type of Content]
Brief one-line description of what you found.

---

[Your detailed solution here, using markdown headers, lists, code blocks, etc.]

If the content seems too vague or the page text is empty/unhelpful, explain what you see and suggest what the user could try instead.`;

// --------------- State ---------------
const state = {
    apiKey: localStorage.getItem(API_KEY_KEY) || '',
    history: JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'),
    isAnalyzing: false,
    abortController: null,
};

// --------------- DOM References ---------------
const $ = (sel) => document.querySelector(sel);
const dom = {
    // Setup
    setupModal:       $('#setupModal'),
    apiKeyInput:      $('#apiKeyInput'),
    saveKeyBtn:       $('#saveKeyBtn'),
    toggleKeyVis:     $('#toggleKeyVis'),
    // Settings
    settingsModal:    $('#settingsModal'),
    settingsToggle:   $('#settingsToggle'),
    closeSettings:    $('#closeSettings'),
    settingsApiKey:   $('#settingsApiKey'),
    toggleSettingsVis:$('#toggleSettingsKeyVis'),
    updateKeyBtn:     $('#updateKeyBtn'),
    clearHistoryBtn:  $('#clearHistoryBtn'),
    // Main
    mainContent:      $('#mainContent'),
    urlInput:         $('#urlInput'),
    pasteBtn:         $('#pasteBtn'),
    solveBtn:         $('#solveBtn'),
    solveBtnText:     $('.btn-solve-text'),
    solveBtnLoading:  $('.btn-solve-loading'),
    solveBtnArrow:    $('.btn-solve-arrow'),
    // Status
    statusBar:        $('#statusBar'),
    statusText:       $('#statusText'),
    // Results
    resultsSection:   $('#resultsSection'),
    resultsBody:      $('#resultsBody'),
    resultBadge:      $('#resultBadge'),
    resultUrl:        $('#resultUrl'),
    copyResultBtn:    $('#copyResultBtn'),
    newSolveBtn:      $('#newSolveBtn'),
    // Error
    errorSection:     $('#errorSection'),
    errorTitle:       $('#errorTitle'),
    errorMessage:     $('#errorMessage'),
    retryBtn:         $('#retryBtn'),
    // History
    historyToggle:    $('#historyToggle'),
    historySidebar:   $('#historySidebar'),
    closeHistory:     $('#closeHistory'),
    historyList:      $('#historyList'),
    sidebarOverlay:   $('#sidebarOverlay'),
};

// --------------- Initialize ---------------
function init() {
    // Configure marked
    marked.setOptions({
        highlight: (code, lang) => {
            if (lang && hljs.getLanguage(lang)) {
                return hljs.highlight(code, { language: lang }).value;
            }
            return hljs.highlightAuto(code).value;
        },
        breaks: true,
        gfm: true,
    });

    // Show setup if no key
    if (!state.apiKey) {
        dom.setupModal.classList.remove('hidden');
    } else {
        dom.setupModal.classList.add('hidden');
    }

    renderHistory();
    setupEventListeners();
}

// --------------- Event Listeners ---------------
function setupEventListeners() {
    // API key setup
    dom.apiKeyInput.addEventListener('input', () => {
        dom.saveKeyBtn.disabled = dom.apiKeyInput.value.trim().length < 10;
    });

    dom.saveKeyBtn.addEventListener('click', () => {
        const key = dom.apiKeyInput.value.trim();
        if (key) {
            state.apiKey = key;
            localStorage.setItem(API_KEY_KEY, key);
            dom.setupModal.classList.add('hidden');
        }
    });

    dom.apiKeyInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !dom.saveKeyBtn.disabled) {
            dom.saveKeyBtn.click();
        }
    });

    // Toggle key visibility
    dom.toggleKeyVis.addEventListener('click', () => toggleVis(dom.apiKeyInput));
    dom.toggleSettingsVis.addEventListener('click', () => toggleVis(dom.settingsApiKey));

    // Settings
    dom.settingsToggle.addEventListener('click', () => {
        dom.settingsApiKey.value = state.apiKey;
        dom.settingsModal.classList.remove('hidden');
    });

    dom.closeSettings.addEventListener('click', () => {
        dom.settingsModal.classList.add('hidden');
    });

    dom.settingsModal.addEventListener('click', (e) => {
        if (e.target === dom.settingsModal) dom.settingsModal.classList.add('hidden');
    });

    dom.updateKeyBtn.addEventListener('click', () => {
        const key = dom.settingsApiKey.value.trim();
        if (key.length >= 10) {
            state.apiKey = key;
            localStorage.setItem(API_KEY_KEY, key);
            dom.settingsModal.classList.add('hidden');
        }
    });

    dom.clearHistoryBtn.addEventListener('click', () => {
        if (confirm('Clear all history?')) {
            state.history = [];
            localStorage.setItem(HISTORY_KEY, '[]');
            renderHistory();
        }
    });

    // URL input
    dom.urlInput.addEventListener('input', () => {
        dom.solveBtn.disabled = !isValidUrl(dom.urlInput.value.trim());
    });

    dom.urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !dom.solveBtn.disabled && !state.isAnalyzing) {
            dom.solveBtn.click();
        }
    });

    // Paste button
    dom.pasteBtn.addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            dom.urlInput.value = text;
            dom.urlInput.dispatchEvent(new Event('input'));
        } catch {
            // Clipboard API not available
        }
    });

    // Solve button
    dom.solveBtn.addEventListener('click', () => {
        if (!state.isAnalyzing) solve();
    });

    // Copy result
    dom.copyResultBtn.addEventListener('click', () => {
        const text = dom.resultsBody.innerText;
        navigator.clipboard.writeText(text).then(() => {
            const fb = dom.copyResultBtn.querySelector('.copy-feedback');
            fb.classList.remove('hidden');
            setTimeout(() => fb.classList.add('hidden'), 1500);
        });
    });

    // New solve
    dom.newSolveBtn.addEventListener('click', resetToInput);

    // Retry
    dom.retryBtn.addEventListener('click', () => {
        dom.errorSection.classList.add('hidden');
        solve();
    });

    // History sidebar
    dom.historyToggle.addEventListener('click', openHistory);
    dom.closeHistory.addEventListener('click', closeHistory);
    dom.sidebarOverlay.addEventListener('click', closeHistory);

    // Keyboard shortcut: Escape closes modals/sidebar
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (!dom.historySidebar.classList.contains('hidden')) closeHistory();
            if (!dom.settingsModal.classList.contains('hidden')) dom.settingsModal.classList.add('hidden');
        }
    });
}

// --------------- Core: Solve ---------------
async function solve() {
    const url = dom.urlInput.value.trim();
    if (!isValidUrl(url) || state.isAnalyzing) return;

    // Check API key
    if (!state.apiKey) {
        dom.setupModal.classList.remove('hidden');
        return;
    }

    state.isAnalyzing = true;
    state.abortController = new AbortController();

    setLoading(true);
    showStatus('Fetching page content...');
    hideError();
    hideResults();

    try {
        // 1. Fetch the URL content
        const html = await fetchUrl(url, state.abortController.signal);
        if (!html) throw new Error('Could not fetch the page. The site may be blocking access.');

        // 2. Extract text
        showStatus('Extracting content...');
        const content = extractContent(html, url);
        if (!content || content.trim().length < 20) {
            throw new Error('Could not extract meaningful content from the page. It may require login or use heavy JavaScript rendering.');
        }

        // 3. Analyze with Gemini (streaming)
        showStatus('AI is analyzing the content...');
        await analyzeWithGemini(content, url);

        // 4. Save to history
        const solutionText = dom.resultsBody.innerHTML;
        addToHistory(url, solutionText);

    } catch (err) {
        if (err.name === 'AbortError') return;
        showError(getErrorTitle(err), err.message);
    } finally {
        state.isAnalyzing = false;
        state.abortController = null;
        setLoading(false);
        hideStatus();
    }
}

// --------------- Fetch URL ---------------
async function fetchUrl(url, signal) {
    for (const proxy of CORS_PROXIES) {
        try {
            const proxyUrl = proxy.url(url);
            const resp = await fetch(proxyUrl, {
                signal,
                headers: { 'Accept': 'text/html,application/xhtml+xml,*/*' },
            });
            if (!resp.ok) continue;
            const text = await resp.text();
            if (text && text.length > 50) return text;
        } catch (e) {
            if (e.name === 'AbortError') throw e;
            continue;
        }
    }
    return null;
}

// --------------- Extract Content ---------------
function extractContent(html, url) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Remove unwanted elements
    const remove = ['script', 'style', 'noscript', 'iframe', 'svg', 'nav', 'footer',
                     'header', '.sidebar', '.nav', '.menu', '.cookie', '.popup', '.modal',
                     '.advertisement', '.ad', '[role="banner"]', '[role="navigation"]'];
    remove.forEach(sel => {
        doc.querySelectorAll(sel).forEach(el => el.remove());
    });

    // Try to get main content first
    const mainSelectors = ['main', 'article', '[role="main"]', '.content', '.post', '.entry', '#content', '#main'];
    let mainEl = null;
    for (const sel of mainSelectors) {
        mainEl = doc.querySelector(sel);
        if (mainEl && mainEl.textContent.trim().length > 100) break;
        mainEl = null;
    }

    const source = mainEl || doc.body;
    if (!source) return '';

    // Extract text with some structure
    let text = '';
    const title = doc.querySelector('title');
    if (title) text += `Page Title: ${title.textContent.trim()}\n\n`;

    // Walk through elements and preserve structure
    const walk = (node) => {
        if (!node) return '';
        let result = '';
        for (const child of node.childNodes) {
            if (child.nodeType === 3) { // Text node
                const t = child.textContent.trim();
                if (t) result += t + ' ';
            } else if (child.nodeType === 1) { // Element
                const tag = child.tagName.toLowerCase();
                if (['h1','h2','h3','h4','h5','h6'].includes(tag)) {
                    result += `\n\n### ${child.textContent.trim()}\n`;
                } else if (tag === 'p') {
                    result += `\n${child.textContent.trim()}\n`;
                } else if (tag === 'li') {
                    result += `\n- ${child.textContent.trim()}`;
                } else if (tag === 'br') {
                    result += '\n';
                } else if (tag === 'pre' || tag === 'code') {
                    result += `\n\`\`\`\n${child.textContent}\n\`\`\`\n`;
                } else if (tag === 'img') {
                    const alt = child.getAttribute('alt');
                    if (alt) result += `[Image: ${alt}] `;
                } else if (tag === 'a') {
                    const href = child.getAttribute('href');
                    const t = child.textContent.trim();
                    if (t && href) result += `${t} (${href}) `;
                    else if (t) result += t + ' ';
                } else if (tag === 'table') {
                    result += '\n' + extractTable(child) + '\n';
                } else {
                    result += walk(child);
                }
            }
        }
        return result;
    };

    text += walk(source);

    // Clean up
    text = text.replace(/\n{3,}/g, '\n\n').trim();

    // Truncate if too long
    if (text.length > MAX_CONTENT_LENGTH) {
        text = text.substring(0, MAX_CONTENT_LENGTH) + '\n\n[Content truncated due to length]';
    }

    return text;
}

function extractTable(table) {
    let result = '';
    const rows = table.querySelectorAll('tr');
    rows.forEach(row => {
        const cells = row.querySelectorAll('th, td');
        const cellTexts = Array.from(cells).map(c => c.textContent.trim());
        result += '| ' + cellTexts.join(' | ') + ' |\n';
    });
    return result;
}

// --------------- Gemini API (Streaming) ---------------
async function analyzeWithGemini(content, url) {
    const prompt = `${SYSTEM_PROMPT}\n\n---\nURL: ${url}\n\nPage Content:\n${content}`;

    const apiUrl = `${GEMINI_API_BASE}/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${state.apiKey}`;

    const resp = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: state.abortController?.signal,
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 8192,
            },
            safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            ],
        }),
    });

    if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        if (resp.status === 400 && errBody.includes('API_KEY_INVALID')) {
            throw new Error('Invalid API key. Please check your Gemini API key in Settings.');
        }
        if (resp.status === 429) {
            throw new Error('Rate limit reached. The free tier allows 15 requests per minute. Please wait a moment and try again.');
        }
        if (resp.status === 403) {
            throw new Error('API key does not have access. Make sure you enabled the Generative Language API in Google Cloud Console.');
        }
        throw new Error(`Gemini API returned status ${resp.status}. Please try again.`);
    }

    // Show results area and stream into it
    showResults(url);
    dom.resultsBody.innerHTML = '';
    dom.resultsBody.classList.add('streaming-cursor');

    let fullText = '';
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;

            try {
                const data = JSON.parse(jsonStr);
                const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (text) {
                    fullText += text;
                    dom.resultsBody.innerHTML = marked.parse(fullText);
                    // Apply syntax highlighting to new code blocks
                    dom.resultsBody.querySelectorAll('pre code:not(.hljs)').forEach(block => {
                        hljs.highlightElement(block);
                    });
                    // Scroll to bottom during streaming
                    dom.resultsBody.scrollTop = dom.resultsBody.scrollHeight;
                }
            } catch {
                // Skip malformed JSON chunks
            }
        }
    }

    dom.resultsBody.classList.remove('streaming-cursor');

    if (!fullText) {
        throw new Error('The AI did not return a response. The content may have been blocked by safety filters.');
    }
}

// --------------- History ---------------
function addToHistory(url, solutionHtml) {
    const entry = {
        id: Date.now(),
        url,
        solutionHtml,
        timestamp: new Date().toISOString(),
    };
    state.history.unshift(entry);
    if (state.history.length > MAX_HISTORY) state.history.pop();
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
    renderHistory();
}

function deleteHistoryItem(id) {
    state.history = state.history.filter(h => h.id !== id);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
    renderHistory();
}

function renderHistory() {
    if (state.history.length === 0) {
        dom.historyList.innerHTML = `
            <div class="empty-history">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <p>No history yet. Solve something!</p>
            </div>`;
        return;
    }

    dom.historyList.innerHTML = state.history.map(item => {
        const displayUrl = item.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
        const time = formatTime(item.timestamp);
        return `
            <div class="history-item" data-id="${item.id}">
                <button class="history-delete" data-delete-id="${item.id}" title="Delete">&times;</button>
                <div class="history-url">${escapeHtml(displayUrl)}</div>
                <div class="history-time">${time}</div>
            </div>`;
    }).join('');

    // Attach click handlers
    dom.historyList.querySelectorAll('.history-item').forEach(el => {
        el.addEventListener('click', (e) => {
            if (e.target.closest('.history-delete')) return;
            const id = parseInt(el.dataset.id);
            const item = state.history.find(h => h.id === id);
            if (item) loadHistoryItem(item);
        });
    });

    dom.historyList.querySelectorAll('.history-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteHistoryItem(parseInt(btn.dataset.deleteId));
        });
    });
}

function loadHistoryItem(item) {
    closeHistory();
    dom.urlInput.value = item.url;
    dom.solveBtn.disabled = false;
    showResults(item.url);
    dom.resultsBody.innerHTML = item.solutionHtml;
    // Re-highlight code blocks
    dom.resultsBody.querySelectorAll('pre code:not(.hljs)').forEach(block => {
        hljs.highlightElement(block);
    });
}

// --------------- UI Helpers ---------------
function setLoading(loading) {
    if (loading) {
        dom.solveBtnText.classList.add('hidden');
        dom.solveBtnArrow.classList.add('hidden');
        dom.solveBtnLoading.classList.remove('hidden');
        dom.solveBtn.disabled = true;
        dom.urlInput.disabled = true;
    } else {
        dom.solveBtnText.classList.remove('hidden');
        dom.solveBtnArrow.classList.remove('hidden');
        dom.solveBtnLoading.classList.add('hidden');
        dom.solveBtn.disabled = !isValidUrl(dom.urlInput.value.trim());
        dom.urlInput.disabled = false;
    }
}

function showStatus(msg) {
    dom.statusBar.classList.remove('hidden');
    dom.statusText.textContent = msg;
}

function hideStatus() {
    dom.statusBar.classList.add('hidden');
}

function showResults(url) {
    dom.resultsSection.classList.remove('hidden');
    dom.errorSection.classList.add('hidden');
    const displayUrl = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    dom.resultUrl.textContent = displayUrl;
}

function hideResults() {
    dom.resultsSection.classList.add('hidden');
}

function showError(title, message) {
    dom.errorSection.classList.remove('hidden');
    dom.resultsSection.classList.add('hidden');
    dom.errorTitle.textContent = title;
    dom.errorMessage.textContent = message;
}

function hideError() {
    dom.errorSection.classList.add('hidden');
}

function resetToInput() {
    dom.urlInput.value = '';
    dom.urlInput.disabled = false;
    dom.solveBtn.disabled = true;
    hideResults();
    hideError();
    hideStatus();
    dom.urlInput.focus();
}

function openHistory() {
    dom.historySidebar.classList.remove('hidden');
    dom.sidebarOverlay.classList.remove('hidden');
}

function closeHistory() {
    dom.historySidebar.classList.add('hidden');
    dom.sidebarOverlay.classList.add('hidden');
}

function toggleVis(input) {
    input.type = input.type === 'password' ? 'text' : 'password';
}

// --------------- Utilities ---------------
function isValidUrl(str) {
    try {
        const u = new URL(str);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatTime(iso) {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now - d;
    const mins = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMs / 3600000);
    const days = Math.floor(diffMs / 86400000);

    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString();
}

function getErrorTitle(err) {
    const msg = err.message.toLowerCase();
    if (msg.includes('api key')) return 'API Key Issue';
    if (msg.includes('rate limit')) return 'Rate Limited';
    if (msg.includes('fetch') || msg.includes('blocking')) return 'Could Not Fetch Page';
    if (msg.includes('extract')) return 'Content Extraction Failed';
    return 'Something Went Wrong';
}

// --------------- Start ---------------
init();
