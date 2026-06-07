# Whiteout Code Redeemer

Minimal Whiteout Survival gift-code redeemer with both CLI and Discord auto-redeem modes.

This is intentionally much smaller than the Discord bot. It keeps only the redeem flow:

1. Authenticate player FID.
2. Fetch captcha.
3. Solve captcha using the ONNX model.
4. Submit the gift code.
5. Print the result.

## Install

```bash
npm install
```

## Discord Auto Redeem Bot

Create `.env` from `.env.example` and fill in your Discord bot token:

```bash
DISCORD_TOKEN=your_bot_token_here
```

Start the bot. This deploys global slash commands automatically, then starts the auto-redeem watcher:

```bash
npm start
```

Global Discord commands can take some time to appear after the first startup.

## Server Panel Setup

Use GitHub repo deployment and set only this as the bot file:

```text
BOT JS FILE: index.js
```

You do not need a start bash file. `index.js` handles command deployment and starts the bot watcher.

Required environment variable:

```text
DISCORD_TOKEN=your_bot_token_here
```

Optional environment variables:

```text
CHECK_INTERVAL_MIN_MS=300000
CHECK_INTERVAL_MAX_MS=600000
REDEEM_EXISTING_ON_START=false
```

Discord commands:

```text
/channel-set
/gift-channel-set
/player-add fid:12345678 label:Main
/player-remove fid:12345678
/players
/codes
/redeem-code code:gogoWOS
/watch-status
```

Automatic behavior:

- The bot checks the central code API every 5-10 minutes by default.
- `/player-add` verifies the FID immediately and stores the player's nickname and furnace level.
- `/gift-channel-set` makes the current channel listen for posted gift codes like `Code: gogoWOS` or `gogoWOS`.
- On first startup, it records existing codes and waits for future new codes.
- When a new code appears later, it redeems that code for every saved player in each configured server.
- It stores every code/player result and skips already-recorded player/code pairs next time.
- If a code returns `USED`, `TIME ERROR`, or `CDK NOT FOUND`, it stops redeeming that code for remaining players.
- Results are posted in the channel set by `/channel-set`.
- Saved players, seen codes, usage records, and history are stored locally in `data/bot.sqlite`.
- Enable `Message Content Intent` in the Discord Developer Portal if you want gift-channel message detection to work.

If you want the bot to redeem existing fetched codes on first startup too, set this in `.env`:

```bash
REDEEM_EXISTING_ON_START=true
```

## Usage

Fetch current known codes from the same central API used by the Discord bot:

```bash
npm run codes
```

Redeem for one player:

```bash
npm run redeem -- WOSCODE123 12345678
```

Redeem for multiple players:

```bash
npm run redeem -- WOSCODE123 12345678 87654321
```

Redeem from a text file, one FID per line:

```bash
npm run redeem -- WOSCODE123 --file players.txt
```

Fetch codes automatically, then redeem every fetched code for one player:

```bash
npm run redeem -- redeem-fetched 12345678
```

Fetch codes automatically, then redeem every fetched code for players from a file:

```bash
npm run redeem -- redeem-fetched --file players.txt
```

## Notes

- Code fetching uses the same public sync API configured in the original Discord bot.
- Whiteout Survival redemption requires captcha solving, so this project includes the model files under `model/`.
- The CenturyGame endpoint is rate-limited. If the API returns rate-limit status, the CLI waits before continuing.
- Common statuses include `SUCCESS`, `RECEIVED`, `USED`, `TIME ERROR`, `CDK NOT FOUND`, and `ROLE NOT EXIST`.

## Check Syntax

```bash
npm run check
```
