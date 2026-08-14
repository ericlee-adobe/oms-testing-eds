/*
 * Local development proxy for the login block.
 *
 * The login block can't call ACC (https://accapi.gp1dev.aws.lge.com) from the
 * browser: ACC sends no CORS headers for the localhost origin, the gp1dev TLS
 * cert doesn't validate, it's an internal host, and — critically — ACC's sign
 * API needs server-only headers (X-Lge-System-ID, the secret X-Lge-Application-Key,
 * X-Lge-AccessKey/RefreshKey) that must never live in browser code.
 *
 * So this proxy no longer talks to ACC directly. It forwards to the deployed
 * `acc-proxy` App Builder action, which injects those headers server-side and
 * relays on to ACC. This proxy just gives local dev a same-origin localhost:3001
 * endpoint with permissive CORS.
 *
 *   browser -> localhost:3001/sign/api/lgEmpEmailCheck
 *           -> {ACC_PROXY_TARGET}/sign/api/lgEmpEmailCheck   (acc-proxy action)
 *           -> ACC
 *
 * Usage:  npm run proxy
 * Config: ACC_PROXY_TARGET (default: the Stage acc-proxy action URL below)
 *         PROXY_PORT       (default 3001)
 */
import { createServer } from 'node:http';

const TARGET = (
    process.env.ACC_PROXY_TARGET
    || 'https://285361-964browntortoise-stage.adobeio-static.net/api/v1/web/api-mesh/acc-proxy'
).replace(/\/$/, '');
const PORT = Number(process.env.PROXY_PORT || 3001);

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Lge-LocaleCode, Authorization',
    'Access-Control-Max-Age': '86400',
};

const server = createServer(async (req, res) => {
    // Answer the browser's preflight directly.
    if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
    }

    try {
        // Collect the incoming body.
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = chunks.length ? Buffer.concat(chunks) : undefined;

        const targetUrl = `${TARGET}${req.url}`;

        // Forward only the headers acc-proxy cares about (it injects ACC's own).
        const forwardHeaders = {};
        ['content-type', 'x-lge-localecode', 'authorization'].forEach((h) => {
            if (req.headers[h]) forwardHeaders[h] = req.headers[h];
        });

        const upstream = await fetch(targetUrl, {
            method: req.method,
            headers: forwardHeaders,
            body,
        });

        const responseBody = Buffer.from(await upstream.arrayBuffer());
        res.writeHead(upstream.status, {
            ...CORS_HEADERS,
            'Content-Type': upstream.headers.get('content-type') || 'application/json',
        });
        res.end(responseBody);
        // eslint-disable-next-line no-console
        console.log(`${req.method} ${req.url} -> ${upstream.status}`);
    } catch (error) {
        res.writeHead(502, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'proxy_error', message: error.message }));
        // eslint-disable-next-line no-console
        console.error(`proxy error for ${req.method} ${req.url}:`, error.message);
    }
});

server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`ACC proxy listening on http://localhost:${PORT} -> ${TARGET}`);
});
