const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'bot.sqlite');
const LEGACY_STATE_PATH = path.join(DATA_DIR, 'state.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

ensureDataDir();

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    notify_channel_id TEXT,
    gift_channel_id TEXT,
    id_channel_id TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS players (
    guild_id TEXT NOT NULL,
    fid TEXT NOT NULL,
    label TEXT,
    nickname TEXT,
    furnace_level INTEGER,
    added_by TEXT,
    added_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (guild_id, fid)
  );

  CREATE TABLE IF NOT EXISTS gift_codes (
    code TEXT PRIMARY KEY,
    date TEXT,
    source TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    last_validated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS giftcode_usage (
    guild_id TEXT NOT NULL,
    fid TEXT NOT NULL,
    code TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT,
    success INTEGER NOT NULL DEFAULT 0,
    redeemed_at TEXT NOT NULL,
    PRIMARY KEY (guild_id, fid, code)
  );

  CREATE TABLE IF NOT EXISTS redeem_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    code TEXT NOT NULL,
    source TEXT NOT NULL,
    total INTEGER NOT NULL,
    processed INTEGER NOT NULL,
    skipped INTEGER NOT NULL,
    success_count INTEGER NOT NULL,
    summary_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

function ensureColumn(tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

ensureColumn('guild_settings', 'id_channel_id', 'TEXT');

function nowIso() {
  return new Date().toISOString();
}

function getSetting(key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || null;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

function ensureGuildSettings(guildId) {
  db.prepare(`
    INSERT INTO guild_settings (guild_id, updated_at)
    VALUES (?, ?)
    ON CONFLICT(guild_id) DO NOTHING
  `).run(String(guildId), nowIso());
}

function migrateLegacyState() {
  if (getSetting('legacy_state_migrated') === '1') return;
  if (!fs.existsSync(LEGACY_STATE_PATH)) {
    setSetting('legacy_state_migrated', '1');
    return;
  }

  let state;
  try {
    state = JSON.parse(fs.readFileSync(LEGACY_STATE_PATH, 'utf8'));
  } catch {
    setSetting('legacy_state_migrated', '1');
    return;
  }

  for (const [guildId, guild] of Object.entries(state.guilds || {})) {
    ensureGuildSettings(guildId);
    if (guild.notifyChannelId) setNotifyChannel(guildId, guild.notifyChannelId);
    for (const player of guild.players || []) {
      addPlayer(guildId, player.fid, player.label || player.nickname || '', {
        nickname: player.nickname || '',
        stoveLv: player.stoveLv || null
      });
    }
    for (const entry of guild.history || []) {
      addHistory(guildId, entry);
    }
  }

  markCodesSeen(Object.values(state.seenCodes || {}));
  setSetting('legacy_state_migrated', '1');
}

function addPlayer(guildId, fid, label = '', info = {}, addedBy = '') {
  const normalizedGuildId = String(guildId);
  const normalizedFid = String(fid).trim();
  const current = nowIso();
  const existing = db.prepare('SELECT * FROM players WHERE guild_id = ? AND fid = ?').get(normalizedGuildId, normalizedFid);

  db.prepare(`
    INSERT INTO players (guild_id, fid, label, nickname, furnace_level, added_by, added_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, fid) DO UPDATE SET
      label = excluded.label,
      nickname = excluded.nickname,
      furnace_level = excluded.furnace_level,
      updated_at = excluded.updated_at
  `).run(
    normalizedGuildId,
    normalizedFid,
    String(label || '').trim(),
    info.nickname || '',
    info.stoveLv || null,
    addedBy || existing?.added_by || '',
    existing?.added_at || current,
    current
  );

  return {
    player: db.prepare('SELECT * FROM players WHERE guild_id = ? AND fid = ?').get(normalizedGuildId, normalizedFid),
    created: !existing
  };
}

function removePlayer(guildId, fid) {
  const result = db.prepare('DELETE FROM players WHERE guild_id = ? AND fid = ?').run(String(guildId), String(fid).trim());
  return result.changes > 0;
}

function normalizePlayer(row) {
  return {
    fid: row.fid,
    label: row.label || '',
    nickname: row.nickname || '',
    stoveLv: row.furnace_level || null,
    addedAt: row.added_at,
    updatedAt: row.updated_at
  };
}

function listPlayers(guildId) {
  return db.prepare('SELECT * FROM players WHERE guild_id = ? ORDER BY CAST(fid AS INTEGER), fid')
    .all(String(guildId))
    .map(normalizePlayer);
}

function setNotifyChannel(guildId, channelId) {
  ensureGuildSettings(guildId);
  db.prepare('UPDATE guild_settings SET notify_channel_id = ?, updated_at = ? WHERE guild_id = ?')
    .run(String(channelId), nowIso(), String(guildId));
}

function getNotifyChannel(guildId) {
  ensureGuildSettings(guildId);
  return db.prepare('SELECT notify_channel_id FROM guild_settings WHERE guild_id = ?').get(String(guildId))?.notify_channel_id || null;
}

function setGiftChannel(guildId, channelId) {
  ensureGuildSettings(guildId);
  db.prepare('UPDATE guild_settings SET gift_channel_id = ?, updated_at = ? WHERE guild_id = ?')
    .run(String(channelId), nowIso(), String(guildId));
}

function getGiftChannel(guildId) {
  ensureGuildSettings(guildId);
  return db.prepare('SELECT gift_channel_id FROM guild_settings WHERE guild_id = ?').get(String(guildId))?.gift_channel_id || null;
}

function getGuildByGiftChannel(channelId) {
  return db.prepare('SELECT guild_id, gift_channel_id FROM guild_settings WHERE gift_channel_id = ?').get(String(channelId)) || null;
}

function setIdChannel(guildId, channelId) {
  ensureGuildSettings(guildId);
  db.prepare('UPDATE guild_settings SET id_channel_id = ?, updated_at = ? WHERE guild_id = ?')
    .run(String(channelId), nowIso(), String(guildId));
}

function getIdChannel(guildId) {
  ensureGuildSettings(guildId);
  return db.prepare('SELECT id_channel_id FROM guild_settings WHERE guild_id = ?').get(String(guildId))?.id_channel_id || null;
}

function getGuildByIdChannel(channelId) {
  return db.prepare('SELECT guild_id, id_channel_id FROM guild_settings WHERE id_channel_id = ?').get(String(channelId)) || null;
}

function getConfiguredGuilds() {
  return db.prepare(`
    SELECT gs.guild_id, gs.notify_channel_id, gs.gift_channel_id, gs.id_channel_id, COUNT(p.fid) AS player_count
    FROM guild_settings gs
    JOIN players p ON p.guild_id = gs.guild_id
    GROUP BY gs.guild_id
    HAVING player_count > 0
  `).all().map((row) => ({
    guildId: row.guild_id,
    notifyChannelId: row.notify_channel_id,
    giftChannelId: row.gift_channel_id,
    idChannelId: row.id_channel_id,
    players: listPlayers(row.guild_id)
  }));
}

function upsertGiftCode(code, date = null, source = 'api', status = 'active') {
  const normalizedCode = String(code || '').trim();
  if (!normalizedCode) return;
  const current = nowIso();
  db.prepare(`
    INSERT INTO gift_codes (code, date, source, status, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      date = COALESCE(excluded.date, gift_codes.date),
      source = COALESCE(excluded.source, gift_codes.source),
      status = CASE WHEN gift_codes.status = 'invalid' THEN gift_codes.status ELSE excluded.status END,
      last_seen_at = excluded.last_seen_at
  `).run(normalizedCode, date || null, source, status, current, current);
}

function getSeenCodes() {
  const rows = db.prepare('SELECT code, date, first_seen_at FROM gift_codes').all();
  return Object.fromEntries(rows.map((row) => [row.code, { code: row.code, date: row.date, firstSeenAt: row.first_seen_at }]));
}

function markCodesSeen(codes, source = 'api') {
  for (const code of codes || []) {
    upsertGiftCode(code.code, code.date, source, 'active');
  }
}

function updateGiftCodeStatus(code, status) {
  db.prepare('UPDATE gift_codes SET status = ?, last_validated_at = ? WHERE code = ?').run(status, nowIso(), String(code).trim());
}

function getGiftCode(code) {
  return db.prepare('SELECT * FROM gift_codes WHERE code = ?').get(String(code).trim()) || null;
}

function hasGiftCodeUsage(guildId, fid, code) {
  return Boolean(db.prepare('SELECT 1 FROM giftcode_usage WHERE guild_id = ? AND fid = ? AND code = ?')
    .get(String(guildId), String(fid), String(code).trim()));
}

function recordGiftCodeUsage(guildId, fid, code, result) {
  db.prepare(`
    INSERT INTO giftcode_usage (guild_id, fid, code, status, message, success, redeemed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, fid, code) DO UPDATE SET
      status = excluded.status,
      message = excluded.message,
      success = excluded.success,
      redeemed_at = excluded.redeemed_at
  `).run(
    String(guildId),
    String(fid),
    String(code).trim(),
    result.status || 'UNKNOWN',
    result.message || '',
    result.success ? 1 : 0,
    nowIso()
  );
}

function getUsageStats(guildId, code) {
  const rows = db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM giftcode_usage
    WHERE guild_id = ? AND code = ?
    GROUP BY status
  `).all(String(guildId), String(code).trim());
  return Object.fromEntries(rows.map((row) => [row.status, row.count]));
}

function addHistory(guildId, entry) {
  db.prepare(`
    INSERT INTO redeem_history (guild_id, code, source, total, processed, skipped, success_count, summary_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(guildId),
    String(entry.code || ''),
    String(entry.source || 'unknown'),
    Number(entry.total || 0),
    Number(entry.processed || entry.total || 0),
    Number(entry.skipped || 0),
    Number(entry.successCount || 0),
    JSON.stringify(entry),
    nowIso()
  );
}

function getStorageStats(guildId = null) {
  const params = guildId ? [String(guildId)] : [];
  const guildWhere = guildId ? ' WHERE guild_id = ?' : '';
  return {
    players: db.prepare(`SELECT COUNT(*) AS count FROM players${guildWhere}`).get(...params).count,
    seenCodes: db.prepare('SELECT COUNT(*) AS count FROM gift_codes').get().count,
    usage: db.prepare(`SELECT COUNT(*) AS count FROM giftcode_usage${guildWhere}`).get(...params).count
  };
}

migrateLegacyState();

module.exports = {
  addHistory,
  addPlayer,
  getConfiguredGuilds,
  getGiftChannel,
  getGiftCode,
  getGuildByIdChannel,
  getGuildByGiftChannel,
  getIdChannel,
  getNotifyChannel,
  getSeenCodes,
  getStorageStats,
  getUsageStats,
  hasGiftCodeUsage,
  listPlayers,
  markCodesSeen,
  recordGiftCodeUsage,
  removePlayer,
  setGiftChannel,
  setIdChannel,
  setNotifyChannel,
  updateGiftCodeStatus,
  upsertGiftCode
};
