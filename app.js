/* ===== SolveIt — app.js ===== */

// --------------- Authentication ---------------
// PBKDF2-HMAC-SHA256 with 100,000 iterations (same security as TwinCatcher Pro)
const AUTH_HASH = 'eed14aa4ff2fe7631f239ba1f2249aa5b08be06eb20b88fe13ae225b164202ce';
const AUTH_SALT = 'solveit_auth_salt_2026';
const AUTH_ITERATIONS = 100000;
const AUTH_SESSION_KEY = 'solveit_auth';
const AUTH_LOCKOUT_KEY = 'solveit_lockout';
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 5 * 60 * 1000; // 5 minutes

async function hashPassword(password) {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
    );
    const derivedBits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: encoder.encode(AUTH_SALT), iterations: AUTH_ITERATIONS, hash: 'SHA-256' },
        keyMaterial, 256
    );
    const hashArray = Array.from(new Uint8Array(derivedBits));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function isAuthenticated() {
    // Never persist — always require password on every page load
    return false;
}

function getLockoutState() {
    try {
        const data = JSON.parse(localStorage.getItem(AUTH_LOCKOUT_KEY) || '{}');
        return {
            attempts: data.attempts || 0,
            lockedUntil: data.lockedUntil || 0,
        };
    } catch {
        return { attempts: 0, lockedUntil: 0 };
    }
}

function saveLockoutState(state) {
    try { localStorage.setItem(AUTH_LOCKOUT_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

function setupAuth() {
    const overlay = document.getElementById('loginOverlay');
    const passwordInput = document.getElementById('loginPassword');
    const loginBtn = document.getElementById('loginBtn');
    const errorEl = document.getElementById('loginError');
    const lockoutEl = document.getElementById('loginLockout');
    const lockoutTimerEl = document.getElementById('lockoutTimer');
    const inputWrapper = passwordInput.closest('.login-input-wrapper');

    if (isAuthenticated()) {
        unlockApp();
        return;
    }

    // Check if currently locked out
    let lockoutInterval = null;
    function checkLockout() {
        const lockState = getLockoutState();
        const now = Date.now();
        if (lockState.lockedUntil > now) {
            loginBtn.disabled = true;
            passwordInput.disabled = true;
            lockoutEl.classList.remove('hidden');
            errorEl.classList.add('hidden');
            const updateTimer = () => {
                const remaining = Math.ceil((lockState.lockedUntil - Date.now()) / 1000);
                if (remaining <= 0) {
                    lockoutEl.classList.add('hidden');
                    loginBtn.disabled = false;
                    passwordInput.disabled = false;
                    passwordInput.focus();
                    saveLockoutState({ attempts: 0, lockedUntil: 0 });
                    clearInterval(lockoutInterval);
                } else {
                    lockoutTimerEl.textContent = remaining;
                }
            };
            updateTimer();
            lockoutInterval = setInterval(updateTimer, 1000);
            return true;
        }
        return false;
    }
    checkLockout();

    async function attemptLogin() {
        if (checkLockout()) return;

        const password = passwordInput.value;
        if (!password) {
            inputWrapper.classList.add('error');
            setTimeout(() => inputWrapper.classList.remove('error'), 400);
            return;
        }

        const hash = await hashPassword(password);
        if (hash === AUTH_HASH) {
            // Success
            // Don't persist auth — password required every reload
            saveLockoutState({ attempts: 0, lockedUntil: 0 });
            overlay.style.animation = 'fadeOut 0.3s ease forwards';
            setTimeout(unlockApp, 300);
        } else {
            // Failed
            const lockState = getLockoutState();
            lockState.attempts++;
            if (lockState.attempts >= MAX_LOGIN_ATTEMPTS) {
                lockState.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
            }
            saveLockoutState(lockState);

            errorEl.textContent = `Incorrect password (${MAX_LOGIN_ATTEMPTS - lockState.attempts} attempts remaining)`;
            if (lockState.attempts >= MAX_LOGIN_ATTEMPTS) {
                errorEl.classList.add('hidden');
            } else {
                errorEl.classList.remove('hidden');
            }
            inputWrapper.classList.add('error');
            setTimeout(() => inputWrapper.classList.remove('error'), 400);
            passwordInput.value = '';
            passwordInput.focus();
            checkLockout();
        }
    }

    loginBtn.addEventListener('click', attemptLogin);
    passwordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') attemptLogin();
    });
    // Clear error on typing
    passwordInput.addEventListener('input', () => {
        errorEl.classList.add('hidden');
    });
}

function unlockApp() {
    const overlay = document.getElementById('loginOverlay');
    const header = document.getElementById('appHeader');
    const main = document.getElementById('mainContent');
    const footer = document.getElementById('appFooter');

    overlay.classList.add('hidden');
    header.classList.remove('hidden');
    main.classList.remove('hidden');
    footer.classList.remove('hidden');

    // Now init the main app
    init();
}

// Run auth on page load
document.addEventListener('DOMContentLoaded', setupAuth);

// --------------- Constants ---------------
const GEMINI_MODELS = {
    'gemini-2.5-flash':      { label: 'Balanced', rpm: 10, rpd: 500 },
    'gemini-2.5-flash-lite': { label: 'Fast',     rpm: 30, rpd: 1000 },
};
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const DEFAULT_CORS_PROXIES = [
    { name: 'corsproxy',  url: (u) => `https://corsproxy.io/?${encodeURIComponent(u)}` },
    { name: 'allorigins', url: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}` },
];

const MAX_CONTENT_LENGTH = 30000;
const HISTORY_KEY = 'solveit_history';
const API_KEY_KEY = 'solveit_api_key';
const MODEL_KEY = 'solveit_model';
const PROXY_KEY = 'solveit_custom_proxy';
const RATE_KEY = 'solveit_rate';
const MAX_HISTORY = 30;
const PROXY_TIMEOUT_MS = 12000;

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
    apiKey: sessionStorage.getItem(API_KEY_KEY) || '',
    model: localStorage.getItem(MODEL_KEY) || 'gemini-2.5-flash',
    customProxy: localStorage.getItem(PROXY_KEY) || '',
    history: (() => {
        try {
            return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
        } catch {
            localStorage.removeItem(HISTORY_KEY);
            return [];
        }
    })(),
    isAnalyzing: false,
    abortController: null,
};

// --------------- Rate Limit Tracking ---------------
function getRateData() {
    try {
        const data = JSON.parse(localStorage.getItem(RATE_KEY) || '{}');
        const today = new Date().toISOString().slice(0, 10);
        if (data.date !== today) return { date: today, count: 0 };
        return data;
    } catch {
        return { date: new Date().toISOString().slice(0, 10), count: 0 };
    }
}

function recordRequest() {
    const data = getRateData();
    data.count++;
    try { localStorage.setItem(RATE_KEY, JSON.stringify(data)); } catch { /* ignore */ }
    updateRateBadge();
}

function updateRateBadge() {
    const data = getRateData();
    const modelInfo = GEMINI_MODELS[state.model];
    const maxDaily = modelInfo ? modelInfo.rpd : 500;
    const countEl = document.getElementById('rateLimitCount');
    const badge = document.getElementById('rateLimitBadge');
    const maxEl = badge.querySelector('.rate-limit-max');
    if (countEl) countEl.textContent = data.count;
    if (maxEl) maxEl.textContent = `/${maxDaily}`;
    // Warn when approaching limit
    if (data.count >= maxDaily * 0.8) {
        badge.classList.add('warn');
    } else {
        badge.classList.remove('warn');
    }
}

// --------------- CORS Proxies ---------------
function getCorsProxies() {
    const proxies = [];
    // Custom proxy takes priority
    if (state.customProxy) {
        proxies.push({
            name: 'custom',
            url: (u) => `${state.customProxy.replace(/\/$/, '')}/?url=${encodeURIComponent(u)}`,
        });
    }
    // Add default fallbacks
    proxies.push(...DEFAULT_CORS_PROXIES);
    return proxies;
}

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
    customProxyInput: $('#customProxyInput'),
    saveProxyBtn:     $('#saveProxyBtn'),
    clearProxyBtn:    $('#clearProxyBtn'),
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
    // Configure marked (no deprecated highlight option — we highlight post-render)
    marked.setOptions({
        breaks: true,
        gfm: true,
    });

    // Clear any old persisted API key from localStorage (now session-only)
    localStorage.removeItem(API_KEY_KEY);

    // Always show setup modal on fresh page load so user can enter/re-enter key
    if (!state.apiKey) {
        dom.setupModal.classList.remove('hidden');
    } else {
        dom.setupModal.classList.add('hidden');
    }

    updateRateBadge();
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
            sessionStorage.setItem(API_KEY_KEY, key);
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
        dom.customProxyInput.value = state.customProxy;
        // Set model radio
        const radio = document.querySelector(`input[name="model"][value="${state.model}"]`);
        if (radio) radio.checked = true;
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
        if (key.length < 10) {
            dom.settingsApiKey.style.borderColor = 'var(--error)';
            setTimeout(() => { dom.settingsApiKey.style.borderColor = ''; }, 2000);
            return;
        }
        state.apiKey = key;
        sessionStorage.setItem(API_KEY_KEY, key);
        dom.settingsModal.classList.add('hidden');
    });

    // Model selection
    document.querySelectorAll('input[name="model"]').forEach(radio => {
        radio.addEventListener('change', () => {
            state.model = radio.value;
            localStorage.setItem(MODEL_KEY, state.model);
            updateRateBadge();
        });
    });

    // Custom proxy
    dom.saveProxyBtn.addEventListener('click', () => {
        const proxy = dom.customProxyInput.value.trim();
        if (proxy && !proxy.startsWith('http')) {
            dom.customProxyInput.style.borderColor = 'var(--error)';
            setTimeout(() => { dom.customProxyInput.style.borderColor = ''; }, 2000);
            return;
        }
        state.customProxy = proxy;
        localStorage.setItem(PROXY_KEY, proxy);
        dom.settingsModal.classList.add('hidden');
    });

    dom.clearProxyBtn.addEventListener('click', () => {
        state.customProxy = '';
        localStorage.removeItem(PROXY_KEY);
        dom.customProxyInput.value = '';
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
            dom.urlInput.focus();
        } catch {
            dom.urlInput.setAttribute('placeholder', 'Clipboard access denied — paste manually (Ctrl+V)');
            setTimeout(() => {
                dom.urlInput.setAttribute('placeholder', 'Paste any website URL here...');
            }, 3000);
        }
    });

    // Solve button
    dom.solveBtn.addEventListener('click', () => {
        if (state.isAnalyzing) {
            if (state.abortController) state.abortController.abort();
        } else {
            solve();
        }
    });

    // Copy result
    dom.copyResultBtn.addEventListener('click', () => {
        const text = dom.resultsBody.innerText;
        navigator.clipboard.writeText(text).then(() => {
            const fb = dom.copyResultBtn.querySelector('.copy-feedback');
            fb.classList.remove('hidden');
            fb.style.animation = 'none';
            fb.offsetHeight;
            fb.style.animation = '';
            clearTimeout(fb._timeout);
            fb._timeout = setTimeout(() => fb.classList.add('hidden'), 1500);
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

    // Escape closes modals/sidebar
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

    if (!state.apiKey) {
        dom.setupModal.classList.remove('hidden');
        return;
    }

    // Check daily rate limit
    const rateData = getRateData();
    const modelInfo = GEMINI_MODELS[state.model];
    if (rateData.count >= (modelInfo?.rpd || 500)) {
        showError('Daily Limit Reached', `You've used all ${modelInfo.rpd} free requests for today. Try switching to the "${state.model === 'gemini-2.5-flash' ? 'Fast' : 'Balanced'}" model in Settings for a different limit, or wait until tomorrow.`);
        return;
    }

    state.isAnalyzing = true;
    state.abortController = new AbortController();

    setLoading(true);
    showStatus('Fetching page content...');
    hideError();
    hideResults();

    try {
        const html = await fetchUrl(url, state.abortController.signal);
        if (!html) throw new Error('Could not fetch the page. The site may be blocking access or the URL may be invalid.');

        showStatus('Extracting content...');
        const content = extractContent(html, url);
        if (!content || content.trim().length < 20) {
            throw new Error('Could not extract meaningful content from the page. It may require login or use heavy JavaScript rendering.');
        }

        showStatus('AI is analyzing the content...');
        const markdown = await analyzeWithGemini(content, url);

        // Track the request
        recordRequest();

        addToHistory(url, markdown);

    } catch (err) {
        if (err.name === 'AbortError') {
            showStatus('Cancelled.');
            setTimeout(hideStatus, 1500);
            return;
        }
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
    const proxies = getCorsProxies();

    for (const proxy of proxies) {
        try {
            const proxyUrl = proxy.url(url);
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

            const onAbort = () => controller.abort();
            if (signal) signal.addEventListener('abort', onAbort);

            const resp = await fetch(proxyUrl, {
                signal: controller.signal,
                headers: { 'Accept': 'text/html,application/xhtml+xml,*/*' },
            });
            clearTimeout(timeout);
            if (signal) signal.removeEventListener('abort', onAbort);

            if (!resp.ok) continue;

            const contentType = resp.headers.get('content-type') || '';
            if (contentType.includes('application/pdf')) {
                throw new Error('PDF files are not supported. Please paste a webpage URL instead, or copy the text content from the PDF.');
            }
            if (contentType.includes('image/')) {
                throw new Error('Image URLs are not supported. Please paste a webpage URL instead.');
            }

            const text = await resp.text();
            if (text && text.length > 50) return text;
        } catch (e) {
            if (e.name === 'AbortError' && signal?.aborted) throw e;
            if (e.message.includes('not supported')) throw e;
            continue;
        }
    }
    return null;
}

// --------------- Extract Content ---------------
function extractContent(html, url) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const removeSelectors = [
        'script', 'style', 'noscript', 'iframe',
        'body > nav', 'body > header', 'body > footer',
        '.sidebar', '.nav', '.menu', '.cookie', '.popup', '.modal',
        '.advertisement', '.ad', '[role="banner"]', '[role="navigation"]',
    ];
    removeSelectors.forEach(sel => {
        try { doc.querySelectorAll(sel).forEach(el => el.remove()); } catch { /* invalid selector */ }
    });

    const mainSelectors = ['main', 'article', '[role="main"]', '.content', '.post', '.entry', '#content', '#main'];
    let mainEl = null;
    for (const sel of mainSelectors) {
        mainEl = doc.querySelector(sel);
        if (mainEl && mainEl.textContent.trim().length > 100) break;
        mainEl = null;
    }

    const source = mainEl || doc.body;
    if (!source) return '';

    let text = '';
    const title = doc.querySelector('title');
    if (title) text += `Page Title: ${title.textContent.trim()}\n\n`;

    const walk = (node) => {
        if (!node) return '';
        let result = '';
        for (const child of node.childNodes) {
            if (child.nodeType === 3) {
                const t = child.textContent.trim();
                if (t) result += t + ' ';
            } else if (child.nodeType === 1) {
                const tag = child.tagName.toLowerCase();
                if (['h1','h2','h3','h4','h5','h6'].includes(tag)) {
                    result += `\n\n### ${child.textContent.trim()}\n`;
                } else if (tag === 'p') {
                    result += `\n${child.textContent.trim()}\n`;
                } else if (tag === 'li') {
                    result += `\n- ${child.textContent.trim()}`;
                } else if (tag === 'br') {
                    result += '\n';
                } else if (tag === 'pre') {
                    result += `\n\`\`\`\n${child.textContent}\n\`\`\`\n`;
                } else if (tag === 'code' && child.parentElement?.tagName !== 'PRE') {
                    result += `\`${child.textContent}\``;
                } else if (tag === 'img') {
                    const alt = child.getAttribute('alt');
                    if (alt && alt.length < 200) result += `[Image: ${alt.substring(0, 100)}] `;
                } else if (tag === 'a') {
                    const t = child.textContent.trim();
                    if (t) result += t + ' ';
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
    text = text.replace(/\n{3,}/g, '\n\n').trim();

    if (text.length > MAX_CONTENT_LENGTH) {
        text = text.substring(0, MAX_CONTENT_LENGTH) + '\n\n[Content truncated due to length]';
    }

    return text;
}

function extractTable(table) {
    let result = '';
    const rows = table.querySelectorAll('tr');
    rows.forEach((row, i) => {
        const cells = row.querySelectorAll('th, td');
        const cellTexts = Array.from(cells).map(c => c.textContent.trim());
        result += '| ' + cellTexts.join(' | ') + ' |\n';
        if (i === 0) {
            result += '| ' + cellTexts.map(() => '---').join(' | ') + ' |\n';
        }
    });
    return result;
}

// --------------- Gemini API (Streaming) ---------------
async function analyzeWithGemini(content, url) {
    const prompt = `${SYSTEM_PROMPT}\n\n---\nURL: ${url}\n\nPage Content:\n${content}`;

    const apiUrl = `${GEMINI_API_BASE}/${state.model}:streamGenerateContent?alt=sse&key=${state.apiKey}`;

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
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            ],
        }),
    });

    if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        if (resp.status === 400 && errBody.includes('API_KEY_INVALID')) {
            throw new Error('Invalid API key. Please check your Gemini API key in Settings.');
        }
        if (resp.status === 429) {
            const modelInfo = GEMINI_MODELS[state.model];
            throw new Error(`Rate limit reached. The free tier allows about ${modelInfo?.rpm || 10} requests per minute and ${modelInfo?.rpd || 500} per day. Please wait a moment and try again.`);
        }
        if (resp.status === 403) {
            throw new Error('API key does not have access. Make sure you enabled the Generative Language API in Google Cloud Console.');
        }
        throw new Error(`Gemini API returned status ${resp.status}. Please try again.`);
    }

    showResults(url);
    dom.resultsBody.innerHTML = '';
    dom.resultsBody.classList.add('streaming-cursor');

    let fullText = '';
    let renderScheduled = false;
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const scheduleRender = () => {
        if (renderScheduled) return;
        renderScheduled = true;
        requestAnimationFrame(() => {
            dom.resultsBody.innerHTML = DOMPurify.sanitize(marked.parse(fullText));
            dom.resultsBody.querySelectorAll('pre code:not(.hljs)').forEach(block => {
                hljs.highlightElement(block);
            });
            window.scrollTo(0, document.body.scrollHeight);
            renderScheduled = false;
        });
    };

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
                    scheduleRender();
                }
            } catch {
                // Skip malformed JSON chunks
            }
        }
    }

    // Final render
    dom.resultsBody.innerHTML = DOMPurify.sanitize(marked.parse(fullText));
    dom.resultsBody.querySelectorAll('pre code:not(.hljs)').forEach(block => {
        hljs.highlightElement(block);
    });
    dom.resultsBody.classList.remove('streaming-cursor');

    if (!fullText) {
        throw new Error('The AI did not return a response. The content may have been blocked by safety filters.');
    }

    return fullText;
}

// --------------- History ---------------
function addToHistory(url, markdown) {
    const entry = {
        id: Date.now(),
        url,
        markdown,
        timestamp: new Date().toISOString(),
    };
    state.history.unshift(entry);
    if (state.history.length > MAX_HISTORY) state.history.pop();

    try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
    } catch {
        while (state.history.length > 1) {
            state.history.pop();
            try {
                localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
                break;
            } catch {
                continue;
            }
        }
    }
    renderHistory();
}

function deleteHistoryItem(id) {
    state.history = state.history.filter(h => h.id !== id);
    try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
    } catch { /* ignore */ }
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

    const content = item.markdown || item.solutionHtml || '';
    if (item.markdown) {
        dom.resultsBody.innerHTML = DOMPurify.sanitize(marked.parse(content));
    } else {
        dom.resultsBody.innerHTML = DOMPurify.sanitize(content);
    }
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
        dom.solveBtn.disabled = false;
        dom.solveBtn.classList.add('is-cancellable');
        dom.urlInput.disabled = true;
    } else {
        dom.solveBtnText.classList.remove('hidden');
        dom.solveBtnArrow.classList.remove('hidden');
        dom.solveBtnLoading.classList.add('hidden');
        dom.solveBtn.disabled = !isValidUrl(dom.urlInput.value.trim());
        dom.solveBtn.classList.remove('is-cancellable');
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
    dom.closeHistory.focus();
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
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
        const hostname = u.hostname.toLowerCase();
        if (hostname === 'localhost' ||
            hostname.startsWith('127.') ||
            hostname.startsWith('10.') ||
            hostname.startsWith('192.168.') ||
            hostname === '0.0.0.0' ||
            hostname.endsWith('.local') ||
            hostname.endsWith('.internal')) {
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
    if (msg.includes('rate limit') || msg.includes('daily limit')) return 'Rate Limited';
    if (msg.includes('fetch') || msg.includes('blocking')) return 'Could Not Fetch Page';
    if (msg.includes('extract')) return 'Content Extraction Failed';
    if (msg.includes('not supported')) return 'Unsupported Content';
    return 'Something Went Wrong';
}

// --------------- Start ---------------
// init() is called by setupAuth() after password verification
