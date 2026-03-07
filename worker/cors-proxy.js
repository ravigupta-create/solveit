/**
 * SolveIt CORS Proxy — Cloudflare Worker
 *
 * Free tier: 100,000 requests/day, no credit card required.
 *
 * Deploy:
 *   1. Go to https://workers.cloudflare.com and sign up (free, no credit card)
 *   2. Click "Create a Worker"
 *   3. Paste this entire file into the editor
 *   4. Click "Save and Deploy"
 *   5. Copy your worker URL (e.g. https://solveit-proxy.YOUR_NAME.workers.dev)
 *   6. In SolveIt Settings, paste it as your Custom Proxy URL
 */

const ALLOWED_ORIGINS = [
    'https://ravigupta-create.github.io',
    'http://localhost',
    'http://127.0.0.1',
];

// Block requests to private/internal networks
const BLOCKED_HOSTNAMES = [
    'localhost', '127.0.0.1', '0.0.0.0',
];

function isBlockedHost(hostname) {
    hostname = hostname.toLowerCase();
    if (BLOCKED_HOSTNAMES.includes(hostname)) return true;
    if (hostname.endsWith('.local') || hostname.endsWith('.internal')) return true;
    // Block private IP ranges
    if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(hostname)) return true;
    return false;
}

export default {
    async fetch(request) {
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: corsHeaders(request),
            });
        }

        const url = new URL(request.url);
        const targetUrl = url.searchParams.get('url');

        if (!targetUrl) {
            return new Response(JSON.stringify({ error: 'Missing ?url= parameter' }), {
                status: 400,
                headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
            });
        }

        let parsed;
        try {
            parsed = new URL(targetUrl);
        } catch {
            return new Response(JSON.stringify({ error: 'Invalid URL' }), {
                status: 400,
                headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
            });
        }

        // Only allow http/https
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return new Response(JSON.stringify({ error: 'Only HTTP/HTTPS URLs allowed' }), {
                status: 403,
                headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
            });
        }

        // Block private networks
        if (isBlockedHost(parsed.hostname)) {
            return new Response(JSON.stringify({ error: 'Private/internal URLs are blocked' }), {
                status: 403,
                headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
            });
        }

        try {
            const response = await fetch(targetUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; SolveIt/1.0)',
                    'Accept': 'text/html,application/xhtml+xml,*/*',
                },
                redirect: 'follow',
            });

            // Only proxy text-based content
            const contentType = response.headers.get('content-type') || '';
            if (!contentType.includes('text/') && !contentType.includes('application/json') && !contentType.includes('application/xml')) {
                return new Response(JSON.stringify({ error: 'Non-text content type: ' + contentType }), {
                    status: 415,
                    headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
                });
            }

            const body = await response.text();
            return new Response(body, {
                status: response.status,
                headers: {
                    ...corsHeaders(request),
                    'Content-Type': contentType,
                },
            });
        } catch (err) {
            return new Response(JSON.stringify({ error: 'Fetch failed: ' + err.message }), {
                status: 502,
                headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
            });
        }
    },
};

function corsHeaders(request) {
    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.some(o => origin.startsWith(o));
    return {
        'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
    };
}
