const WOS_API = Object.freeze({
  secret: 'tB87#kPtkxqOS2',
  playerUrl: 'https://wos-giftcode-api.centurygame.com/api/player',
  giftCodeUrl: 'https://wos-giftcode-api.centurygame.com/api/gift_code',
  captchaUrl: 'https://wos-giftcode-api.centurygame.com/api/captcha',
  origin: 'https://wos-giftcode.centurygame.com',
  maxRetries: 3,
  maxCaptchaAttempts: 10,
  retryDelayMs: 3000,
  rateLimitDelayMs: 60000
});

const GIFT_CODE_SYNC_API = Object.freeze({
  apiKey: 'super_secret_bot_token_nobody_will_ever_find',
  apiUrl: 'http://gift-code-api.whiteout-bot.com/giftcode_api.php'
});

const STATUS_MAP = Object.freeze({
  'CAPTCHA CHECK ERROR': { success: false, giftCodeActive: null, retry: 'captcha' },
  'CAPTCHA EXPIRED': { success: false, giftCodeActive: null, retry: 'captcha' },
  'CAPTCHA GET TOO FREQUENT': { success: false, giftCodeActive: true, retry: 'rate' },
  'CAPTCHA CHECK TOO FREQUENT': { success: false, giftCodeActive: true, retry: 'rate' },
  'TIMEOUT RETRY': { success: false, giftCodeActive: true, retry: 'rate' },
  'ROLE NOT EXIST': { success: false, giftCodeActive: true, playerNotExist: true },
  'SUCCESS': { success: true, giftCodeActive: true },
  'RECEIVED': { success: true, giftCodeActive: true },
  'SAME TYPE EXCHANGE': { success: true, giftCodeActive: true },
  'USED': { success: true, giftCodeActive: false },
  'TIME ERROR': { success: true, giftCodeActive: false },
  'CDK NOT FOUND': { success: true, giftCodeActive: false },
  'STOVE_LV ERROR': { success: true, giftCodeActive: true },
  'RECHARGE_MONEY ERROR': { success: true, giftCodeActive: true },
  'RECHARGE_MONEY_VIP ERROR': { success: true, giftCodeActive: true },
  'NOT LOGIN': { success: false, giftCodeActive: null, retry: 'captcha' },
  'SIGN ERROR': { success: false, giftCodeActive: null, retry: 'captcha' }
});

const ERROR_CODE_TO_STATUS = Object.freeze({
  40001: 'ROLE NOT EXIST',
  40004: 'TIMEOUT RETRY',
  40005: 'USED',
  40006: 'STOVE_LV ERROR',
  40007: 'TIME ERROR',
  40008: 'RECEIVED',
  40011: 'SAME TYPE EXCHANGE',
  40014: 'CDK NOT FOUND',
  40017: 'RECHARGE_MONEY ERROR',
  40018: 'RECHARGE_MONEY_VIP ERROR',
  40100: 'CAPTCHA GET TOO FREQUENT',
  40101: 'CAPTCHA CHECK TOO FREQUENT',
  40102: 'CAPTCHA EXPIRED',
  40103: 'CAPTCHA CHECK ERROR'
});

module.exports = {
  GIFT_CODE_SYNC_API,
  WOS_API,
  STATUS_MAP,
  ERROR_CODE_TO_STATUS
};
