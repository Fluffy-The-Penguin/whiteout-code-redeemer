#!/usr/bin/env node

const fs = require('fs');
const { fetchGiftCodes } = require('./codeFetcher');
const { redeemCode } = require('./redeem');

function printUsage() {
  console.log('Usage:');
  console.log('  npm run redeem -- <gift-code> <fid> [fid...]');
  console.log('  npm run redeem -- <gift-code> --file players.txt');
  console.log('  npm run codes');
  console.log('  npm run redeem -- codes');
  console.log('  npm run redeem -- redeem-fetched <fid> [fid...]');
  console.log('  npm run redeem -- redeem-fetched --file players.txt');
  console.log('');
  console.log('Examples:');
  console.log('  npm run redeem -- WOSCODE123 12345678');
  console.log('  npm run redeem -- WOSCODE123 12345678 87654321');
  console.log('  npm run redeem -- redeem-fetched 12345678');
}

function readFidsFromArgs(args) {
  const fileIndex = args.indexOf('--file');
  if (fileIndex === -1) return args;

  const filePath = args[fileIndex + 1];
  if (!filePath) throw new Error('Missing path after --file');

  const fileFids = fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return [...args.slice(0, fileIndex), ...fileFids, ...args.slice(fileIndex + 2)];
}

function summarize(result) {
  const player = result.player?.nickname ? `${result.player.nickname} (${result.player.fid})` : result.player?.fid || 'unknown';
  return {
    player,
    success: result.success,
    status: result.status,
    message: result.message,
    attempts: result.attempts,
    captcha: result.captchaText,
    confidence: result.captchaConfidence ? Number(result.captchaConfidence.toFixed(3)) : undefined
  };
}

async function main() {
  const [commandOrCode, ...rest] = process.argv.slice(2);
  const code = commandOrCode;

  if (commandOrCode === 'codes' || commandOrCode === 'fetch-codes') {
    const { codes, invalid, fetchedAt } = await fetchGiftCodes();
    console.log(JSON.stringify({ fetchedAt, count: codes.length, invalidCount: invalid.length, codes }, null, 2));
    return;
  }

  if (commandOrCode === 'redeem-fetched') {
    if (rest.length === 0) {
      printUsage();
      process.exit(1);
    }

    const fids = readFidsFromArgs(rest);
    const { codes, invalid, fetchedAt } = await fetchGiftCodes();
    console.log(`Fetched ${codes.length} code(s) at ${fetchedAt}. Ignored ${invalid.length} invalid line(s).`);

    if (codes.length === 0) {
      console.log('No codes found.');
      return;
    }

    for (const codeInfo of codes) {
      console.log(`\nRedeeming fetched code ${codeInfo.code} (${codeInfo.date}) for ${fids.length} player(s)...`);
      for (const fid of fids) {
        try {
          const result = await redeemCode(fid, codeInfo.code);
          console.log(JSON.stringify({ code: codeInfo.code, date: codeInfo.date, ...summarize(result) }, null, 2));

          if (result.rateLimited && result.retryDelay) {
            console.log(`Rate limited. Waiting ${Math.ceil(result.retryDelay / 1000)}s before continuing...`);
            await new Promise((resolve) => setTimeout(resolve, result.retryDelay));
          }
        } catch (error) {
          console.error(JSON.stringify({ code: codeInfo.code, player: fid, success: false, status: 'ERROR', message: error.message }, null, 2));
        }
      }
    }
    return;
  }

  if (!code || rest.length === 0 || code === '--help' || code === '-h') {
    printUsage();
    process.exit(code ? 0 : 1);
  }

  const fids = readFidsFromArgs(rest);
  if (fids.length === 0) throw new Error('At least one player FID is required');

  console.log(`Redeeming ${code} for ${fids.length} player(s)...`);

  for (const fid of fids) {
    try {
      const result = await redeemCode(fid, code);
      console.log(JSON.stringify(summarize(result), null, 2));

      if (result.rateLimited && result.retryDelay) {
        console.log(`Rate limited. Waiting ${Math.ceil(result.retryDelay / 1000)}s before continuing...`);
        await new Promise((resolve) => setTimeout(resolve, result.retryDelay));
      }
    } catch (error) {
      console.error(JSON.stringify({ player: fid, success: false, status: 'ERROR', message: error.message }, null, 2));
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
