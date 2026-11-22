/**
 * BPG Academy — Local Full-Stack Development Server Entry Point (server.js)
 * Modularized across:
 *   - server/config.js (Ports, MIME types, IP discovery, response helpers)
 *   - server/router.js (API routing & zero-cache static file delivery)
 *   - api/*.js         (Serverless-compatible database & OTP handlers)
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

// Load .env if present (supports RESEND_API_KEY, GMAIL_USER, GMAIL_APP_PASSWORD, GOOGLE_CLIENT_ID)
try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(line => {
            const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
            if (m && !process.env[m[1]]) {
                process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
            }
        });
    }
} catch (e) {}

const { PORTS, getLocalIp } = require('./server/config');
const { handleRequest } = require('./server/router');

PORTS.forEach(port => {
    const server = http.createServer(handleRequest);
    server.on('error', err => {
        if (err.code === 'EADDRINUSE') {
            console.log(`[BPG Server] Port ${port} is already active.`);
        }
    });
    const localIp = getLocalIp();
    server.listen(port, '0.0.0.0', () => {
        console.log(`BPG Academy Full-Stack Server live on port ${port}:`);
        console.log(`  -> Student Sanctuary: http://localhost:${port}/`);
        console.log(`  -> Network / Mobile : http://${localIp}:${port}/`);
        console.log(`  -> Secret Admin CMS : http://localhost:${port}/admin-k9x4m7p2q8z`);
        console.log(`  -> Database API     : http://localhost:${port}/api/academy-state`);
        console.log(`  -> 1-Person Friend  : http://${localIp}:${port}/?pass=friend`);
        console.log(`  -> Zip Download     : http://localhost:${port}/download`);
    });
});
