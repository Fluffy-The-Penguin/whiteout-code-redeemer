const http = require('http');
const https = require('https');
const { GIFT_CODE_SYNC_API } = require('./config');

function requestJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObject = new URL(url);
    const isHttps = urlObject.protocol === 'https:';
    const request = (isHttps ? https : http).request(
      {
        hostname: urlObject.hostname,
        port: urlObject.port || (isHttps ? 443 : 80),
        path: `${urlObject.pathname}${urlObject.search}`,
        method: 'GET',
        headers
      },
      (response) => {
        let raw = '';
        response.on('data', (chunk) => {
          raw += chunk;
        });
        response.on('end', () => {
          let data = raw;
          try {
            data = JSON.parse(raw);
          } catch {
            // Keep raw text for clearer error messages.
          }

          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            data,
            raw
          });
        });
      }
    );

    request.setTimeout(15000, () => {
      request.destroy();
      reject(new Error(`Request timed out: ${url}`));
    });
    request.on('error', reject);
    request.end();
  });
}

function parseCodeLine(line) {
  const parts = String(line || '').trim().split(/\s+/);
  if (parts.length !== 2) return null;

  const [code, dateText] = parts;
  if (!/^[a-zA-Z0-9]+$/.test(code)) return null;

  const dateMatch = dateText.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!dateMatch) return null;

  const [, day, month, year] = dateMatch;
  return {
    code,
    date: `${year}-${month}-${day}`,
    raw: line
  };
}

async function fetchGiftCodes() {
  const response = await requestJson(GIFT_CODE_SYNC_API.apiUrl, {
    'Content-Type': 'application/json',
    'X-API-Key': GIFT_CODE_SYNC_API.apiKey
  });

  if (!response.ok) {
    throw new Error(`Gift-code API returned HTTP ${response.status}: ${String(response.raw).slice(0, 200)}`);
  }

  if (!response.data || typeof response.data !== 'object') {
    throw new Error(`Gift-code API returned invalid response: ${String(response.raw).slice(0, 200)}`);
  }

  if (response.data.error || response.data.detail) {
    throw new Error(response.data.error || response.data.detail);
  }

  const seen = new Set();
  const invalid = [];
  const codes = [];

  for (const line of response.data.codes || []) {
    const parsed = parseCodeLine(line);
    if (!parsed) {
      invalid.push(line);
      continue;
    }

    if (!seen.has(parsed.code)) {
      seen.add(parsed.code);
      codes.push(parsed);
    }
  }

  codes.sort((a, b) => b.date.localeCompare(a.date));

  return {
    codes,
    invalid,
    fetchedAt: new Date().toISOString()
  };
}

module.exports = {
  fetchGiftCodes
};
