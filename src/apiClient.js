const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { WOS_API } = require('./config');

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 4, keepAliveMsecs: 30000 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 4, keepAliveMsecs: 30000 });

const BROWSER_PROFILES = [
  {
    versions: [124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135],
    platforms: [
      { os: 'Windows NT 10.0; Win64; x64', secPlatform: '"Windows"' },
      { os: 'Windows NT 11.0; Win64; x64', secPlatform: '"Windows"' },
      { os: 'Macintosh; Intel Mac OS X 10_15_7', secPlatform: '"macOS"' },
      { os: 'X11; Linux x86_64', secPlatform: '"Linux"' }
    ],
    buildSecUa: (version) => `"Not:A-Brand";v="99", "Google Chrome";v="${version}", "Chromium";v="${version}"`
  }
];

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function generateBrowserHeaders() {
  const profile = randomItem(BROWSER_PROFILES);
  const version = randomItem(profile.versions);
  const platform = randomItem(profile.platforms);

  return {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.7',
    Origin: WOS_API.origin,
    Referer: `${WOS_API.origin}/`,
    'User-Agent': `Mozilla/5.0 (${platform.os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`,
    'sec-ch-ua': profile.buildSecUa(version),
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': platform.secPlatform,
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'sec-gpc': '1'
  };
}

function encodeData(payload) {
  const encoded = Object.keys(payload)
    .sort()
    .map((key) => `${key}=${typeof payload[key] === 'object' ? JSON.stringify(payload[key]) : payload[key]}`)
    .join('&');
  const sign = crypto.createHash('md5').update(encoded + WOS_API.secret).digest('hex');
  return `sign=${sign}&${encoded}`;
}

function postForm(url, payload, cookies) {
  return new Promise((resolve, reject) => {
    const body = encodeData(payload);
    const urlObject = new URL(url);
    const isHttps = urlObject.protocol === 'https:';
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
      ...generateBrowserHeaders()
    };

    if (cookies) {
      headers.Cookie = cookies;
    }

    const request = (isHttps ? https : http).request(
      {
        hostname: urlObject.hostname,
        port: urlObject.port || (isHttps ? 443 : 80),
        path: urlObject.pathname,
        method: 'POST',
        agent: isHttps ? httpsAgent : httpAgent,
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
            // Keep raw text for non-JSON responses.
          }

          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            data,
            raw,
            cookies: response.headers['set-cookie'] || [],
            rateLimit: {
              limit: response.headers['x-ratelimit-limit'] ? Number(response.headers['x-ratelimit-limit']) : undefined,
              remaining: response.headers['x-ratelimit-remaining'] ? Number(response.headers['x-ratelimit-remaining']) : undefined
            }
          });
        });
      }
    );

    request.setTimeout(15000, () => {
      request.destroy();
      reject(new Error(`Request timed out: ${url}`));
    });
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function mergeCookies(existing, setCookies) {
  const cookieMap = new Map();

  if (existing) {
    for (const part of existing.split(';')) {
      const trimmed = part.trim();
      const equalsIndex = trimmed.indexOf('=');
      if (equalsIndex > 0) {
        cookieMap.set(trimmed.slice(0, equalsIndex), trimmed);
      }
    }
  }

  for (const cookie of setCookies || []) {
    const nameValue = cookie.split(';')[0].trim();
    const equalsIndex = nameValue.indexOf('=');
    if (equalsIndex > 0) {
      cookieMap.set(nameValue.slice(0, equalsIndex), nameValue);
    }
  }

  return Array.from(cookieMap.values()).join('; ');
}

module.exports = {
  mergeCookies,
  postForm
};
