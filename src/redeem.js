const captchaSolver = require('./captchaSolver');
const { mergeCookies, postForm } = require('./apiClient');
const { ERROR_CODE_TO_STATUS, STATUS_MAP, WOS_API } = require('./config');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeStatus(message) {
  return String(message || '').toUpperCase().replace(/[.\s]+$/g, '');
}

function statusConfig(message) {
  return STATUS_MAP[normalizeStatus(message)] || null;
}

function errorResult(status, message, giftCodeActive = false) {
  return {
    success: false,
    status,
    message,
    giftCodeActive
  };
}

async function authenticatePlayer(fid) {
  let cookies = '';
  let lastError = null;

  for (let attempt = 1; attempt <= WOS_API.maxRetries; attempt++) {
    const response = await postForm(
      WOS_API.playerUrl,
      {
        fid: String(fid),
        time: Math.floor(Date.now() / 1000).toString()
      },
      cookies || undefined
    );

    cookies = mergeCookies(cookies, response.cookies);
    const message = String(response.data?.msg || '').toLowerCase();

    if (response.ok && message === 'success' && response.data?.data) {
      return {
        cookies,
        nickname: response.data.data.nickname || 'Unknown',
        stoveLv: response.data.data.stove_lv || 1
      };
    }

    if (message.includes('role not exist') || message.includes('not exist') || message.includes('invalid')) {
      return {
        playerNotExist: true,
        message: response.data?.msg || 'Player does not exist'
      };
    }

    lastError = response.data?.msg || `HTTP ${response.status}`;
    if (response.status === 429 || message.includes('too frequent') || message.includes('timeout')) {
      await wait(WOS_API.rateLimitDelayMs);
    } else if (attempt < WOS_API.maxRetries) {
      await wait(WOS_API.retryDelayMs);
    }
  }

  return {
    authFailed: true,
    message: lastError || 'Authentication failed'
  };
}

async function fetchCaptchaImage(fid, cookies) {
  const response = await postForm(
    WOS_API.captchaUrl,
    {
      fid: String(fid),
      time: Date.now().toString(),
      init: '0'
    },
    cookies || undefined
  );

  const mergedCookies = mergeCookies(cookies, response.cookies);

  if (response.status === 429) {
    return { error: 'CAPTCHA GET TOO FREQUENT', cookies: mergedCookies };
  }

  if (!response.ok || !response.data || typeof response.data !== 'object') {
    return { error: 'INVALID_RESPONSE', cookies: mergedCookies };
  }

  const image = response.data?.data?.img;
  if (typeof image === 'string') {
    const base64 = image.startsWith('data:') ? image.split(',')[1] : image;
    return {
      buffer: Buffer.from(base64, 'base64'),
      cookies: mergedCookies
    };
  }

  return {
    error: response.data?.msg || 'UNKNOWN_CAPTCHA_ERROR',
    authError: statusConfig(response.data?.msg)?.retry === 'captcha',
    cookies: mergedCookies
  };
}

function analyzeResponse(data) {
  if (!data || typeof data !== 'object') {
    return errorResult('EMPTY_RESPONSE', 'Empty API response', false);
  }

  const errCode = Number(data.err_code ?? data.errCode ?? 0);
  let rawMessage = typeof data.msg === 'string' ? data.msg : '';
  let status = normalizeStatus(rawMessage);

  if (!rawMessage && data.msg != null && !Number.isNaN(Number(data.msg))) {
    status = ERROR_CODE_TO_STATUS[Number(data.msg)] || `ERROR_${Number(data.msg)}`;
    rawMessage = status;
  }

  if (!status && errCode && ERROR_CODE_TO_STATUS[errCode]) {
    status = ERROR_CODE_TO_STATUS[errCode];
    rawMessage = status;
  }

  const known = STATUS_MAP[status];
  return {
    message: rawMessage || 'Unknown response',
    status: status || 'UNKNOWN_API_RESPONSE',
    errCode,
    details: data,
    ...(known || { success: false, giftCodeActive: false })
  };
}

async function redeemCode(fid, code) {
  let auth = await authenticatePlayer(fid);
  let cookies = auth?.cookies || '';

  if (!auth || auth.authFailed || auth.playerNotExist) {
    if (auth?.playerNotExist) {
      return {
        success: false,
        status: 'ROLE NOT EXIST',
        message: auth.message,
        giftCodeActive: true,
        playerNotExist: true
      };
    }
    return errorResult('PLAYER_AUTH_FAILED', auth?.message || `Player authentication failed for FID ${fid}`, false);
  }

  let lastResult = null;
  let authRetryCount = 0;

  for (let attempt = 1; attempt <= WOS_API.maxCaptchaAttempts; attempt++) {
    const captcha = await fetchCaptchaImage(fid, cookies);
    if (captcha.cookies) cookies = captcha.cookies;

    if (!captcha.buffer) {
      if (captcha.authError) {
        authRetryCount++;
        if (authRetryCount > 2) {
          return errorResult('MAX_AUTH_RETRIES', `Authentication keeps failing for FID ${fid}`, false);
        }

        auth = await authenticatePlayer(fid);
        cookies = auth?.cookies || '';
        attempt--;
        continue;
      }

      const config = statusConfig(captcha.error);
      if (config?.retry === 'rate') {
        return {
          ...errorResult(normalizeStatus(captcha.error), captcha.error, config.giftCodeActive),
          rateLimited: true,
          retryDelay: WOS_API.rateLimitDelayMs,
          attempts: attempt
        };
      }

      lastResult = errorResult('CAPTCHA_FETCH_FAILED', captcha.error || 'Unable to fetch captcha image', false);
      await wait(WOS_API.retryDelayMs);
      continue;
    }

    const solved = await captchaSolver.solve(captcha.buffer);
    const response = await postForm(
      WOS_API.giftCodeUrl,
      {
        fid: String(fid),
        cdk: code,
        captcha_code: solved.text,
        time: Date.now().toString()
      },
      cookies || undefined
    );

    if (!response.ok || !response.data) {
      if (response.status === 429) {
        return {
          ...errorResult('HTTP_429', 'HTTP 429 Too Many Requests', false),
          rateLimited: true,
          retryDelay: WOS_API.rateLimitDelayMs,
          attempts: attempt
        };
      }

      lastResult = errorResult('HTTP_ERROR', `HTTP ${response.status}`, false);
      await wait(WOS_API.retryDelayMs);
      continue;
    }

    const result = {
      ...analyzeResponse(response.data),
      captchaText: solved.text,
      captchaConfidence: solved.confidence,
      attempts: attempt,
      player: {
        fid: String(fid),
        nickname: auth.nickname,
        stoveLv: auth.stoveLv
      }
    };

    if (result.retry === 'captcha') {
      lastResult = result;
      await wait(WOS_API.retryDelayMs);
      continue;
    }

    if (result.retry === 'rate') {
      return {
        ...result,
        rateLimited: true,
        retryDelay: WOS_API.rateLimitDelayMs
      };
    }

    return result;
  }

  return {
    ...(lastResult || errorResult('MAX_ATTEMPTS_EXCEEDED', 'Maximum captcha attempts exceeded', false)),
    captchaExhausted: true
  };
}

async function fetchPlayerInfo(fid) {
  const auth = await authenticatePlayer(fid);

  if (!auth || auth.authFailed) {
    return {
      success: false,
      status: 'PLAYER_AUTH_FAILED',
      message: auth?.message || `Player authentication failed for FID ${fid}`
    };
  }

  if (auth.playerNotExist) {
    return {
      success: false,
      status: 'ROLE NOT EXIST',
      message: auth.message || 'Player does not exist',
      playerNotExist: true
    };
  }

  return {
    success: true,
    fid: String(fid),
    nickname: auth.nickname,
    stoveLv: auth.stoveLv
  };
}

module.exports = {
  fetchPlayerInfo,
  redeemCode
};
