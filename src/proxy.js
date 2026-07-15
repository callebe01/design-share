import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const INSPECT_PATH = '/__design-share__/inspect.js';
const INSPECT_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'inspect.js');
const INJECT_TAG = `<script src="${INSPECT_PATH}"></script>`;

// Sits in front of a preview dev server on its own port. Mirrors every path
// 1:1 so absolute asset URLs keep working, injects the inspector script into
// HTML responses, and pipes websocket upgrades straight through so hot module
// reload keeps working.
export function startInjectingProxy(targetUrl) {
  const target = new URL(targetUrl);

  const server = http.createServer((req, res) => {
    if (req.url === INSPECT_PATH) {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(INSPECT_FILE));
    }

    const headers = { ...req.headers, host: target.host };
    delete headers['accept-encoding']; // keep HTML plain so injection is trivial

    const upstream = http.request({
      hostname: target.hostname,
      port: target.port,
      path: req.url,
      method: req.method,
      headers,
    }, (up) => {
      const type = up.headers['content-type'] || '';
      const outHeaders = { ...up.headers };

      // Point same-host redirects back at the proxy
      if (outHeaders.location) {
        outHeaders.location = outHeaders.location.replace(target.host, `localhost:${server.address().port}`);
      }

      if (type.includes('text/html')) {
        const chunks = [];
        up.on('data', (c) => chunks.push(c));
        up.on('end', () => {
          let body = Buffer.concat(chunks).toString('utf8');
          if (body.includes('</body>')) {
            body = body.replace('</body>', `${INJECT_TAG}</body>`);
          } else if (body.includes('</html>')) {
            body = body.replace('</html>', `${INJECT_TAG}</html>`);
          } else {
            body += INJECT_TAG;
          }
          delete outHeaders['content-length'];
          delete outHeaders['content-encoding'];
          res.writeHead(up.statusCode, outHeaders);
          res.end(body);
        });
      } else {
        res.writeHead(up.statusCode, outHeaders);
        up.pipe(res);
      }
    });

    upstream.on('error', () => {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('preview process is not responding');
    });
    req.pipe(upstream);
  });

  // Raw tcp passthrough for websockets (vite/next HMR)
  server.on('upgrade', (req, socket, head) => {
    const conn = net.connect(Number(target.port), target.hostname, () => {
      const headerLines = Object.entries(req.headers)
        .map(([k, v]) => `${k}: ${k === 'host' ? target.host : v}`)
        .join('\r\n');
      conn.write(`${req.method} ${req.url} HTTP/1.1\r\n${headerLines}\r\n\r\n`);
      if (head && head.length) conn.write(head);
      socket.pipe(conn);
      conn.pipe(socket);
    });
    const drop = () => { socket.destroy(); conn.destroy(); };
    conn.on('error', drop);
    socket.on('error', drop);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://localhost:${server.address().port}/` });
    });
  });
}
