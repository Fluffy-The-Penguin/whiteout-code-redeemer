const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STATE_PATH = path.join(DATA_DIR, 'state.json');

function defaultState() {
  return {
    guilds: {},
    seenCodes: {},
    lastFetchAt: null
  };
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadState() {
  ensureDataDir();
  if (!fs.existsSync(STATE_PATH)) {
    return defaultState();
  }

  try {
    return { ...defaultState(), ...JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) };
  } catch {
    return defaultState();
  }
}

function saveState(state) {
  ensureDataDir();
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function getGuildState(state, guildId) {
  if (!state.guilds[guildId]) {
    state.guilds[guildId] = {
      notifyChannelId: null,
      players: [],
      history: []
    };
  }

  return state.guilds[guildId];
}

function addPlayer(guildId, fid, label = '', info = {}) {
  const state = loadState();
  const guild = getGuildState(state, guildId);
  const normalizedFid = String(fid).trim();
  const existing = guild.players.find((player) => player.fid === normalizedFid);

  if (existing) {
    existing.label = label || existing.label || '';
    existing.nickname = info.nickname || existing.nickname || '';
    existing.stoveLv = info.stoveLv || existing.stoveLv || null;
    existing.updatedAt = new Date().toISOString();
    saveState(state);
    return { player: existing, created: false };
  }

  const player = {
    fid: normalizedFid,
    label: String(label || '').trim(),
    nickname: info.nickname || '',
    stoveLv: info.stoveLv || null,
    addedAt: new Date().toISOString()
  };
  guild.players.push(player);
  saveState(state);
  return { player, created: true };
}

function removePlayer(guildId, fid) {
  const state = loadState();
  const guild = getGuildState(state, guildId);
  const normalizedFid = String(fid).trim();
  const before = guild.players.length;
  guild.players = guild.players.filter((player) => player.fid !== normalizedFid);
  saveState(state);
  return before !== guild.players.length;
}

function listPlayers(guildId) {
  const state = loadState();
  return [...getGuildState(state, guildId).players];
}

function setNotifyChannel(guildId, channelId) {
  const state = loadState();
  getGuildState(state, guildId).notifyChannelId = channelId;
  saveState(state);
}

function getNotifyChannel(guildId) {
  const state = loadState();
  return getGuildState(state, guildId).notifyChannelId;
}

function getConfiguredGuilds() {
  const state = loadState();
  return Object.entries(state.guilds)
    .filter(([, guild]) => Array.isArray(guild.players) && guild.players.length > 0)
    .map(([guildId, guild]) => ({ guildId, ...guild }));
}

function getSeenCodes() {
  return loadState().seenCodes || {};
}

function markCodesSeen(codes) {
  const state = loadState();
  for (const code of codes) {
    state.seenCodes[code.code] = {
      code: code.code,
      date: code.date,
      firstSeenAt: state.seenCodes[code.code]?.firstSeenAt || new Date().toISOString()
    };
  }
  state.lastFetchAt = new Date().toISOString();
  saveState(state);
}

function addHistory(guildId, entry) {
  const state = loadState();
  const guild = getGuildState(state, guildId);
  guild.history.unshift({ ...entry, createdAt: new Date().toISOString() });
  guild.history = guild.history.slice(0, 100);
  saveState(state);
}

module.exports = {
  addHistory,
  addPlayer,
  getConfiguredGuilds,
  getNotifyChannel,
  getSeenCodes,
  listPlayers,
  markCodesSeen,
  removePlayer,
  setNotifyChannel
};
