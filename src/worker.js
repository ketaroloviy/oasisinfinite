import { checkInitData } from './auth.js';
import { levelInfo, applyClicks, refillQueue, minersCost } from '../public/core.js';
import { computeMods, NODE_BY_ID, checkBuy } from '../public/talents.js';
import balance from '../config/balance.json';

const mine = balance.mine;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function rand() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 4294967296;
}

function randInt(min, max) {
  return min + Math.floor(rand() * (max - min + 1));
}

async function authUser(request, env) {
  const header = request.headers.get('Authorization') || '';
  const initData = header.startsWith('tma ') ? header.slice(4) : '';
  return checkInitData(initData, env.BOT_TOKEN);
}

// Ответ 401 с подсказкой, что именно не так (токен, подпись и т.д.).
function unauthorized(env, reason) {
  return json({
    error: 'unauthorized',
    reason,
    hasToken: !!env.BOT_TOKEN,
    tokenLooksOk: /^\d+:[A-Za-z0-9_-]{30,}$/.test(env.BOT_TOKEN || ''),
  }, 401);
}

// Бонусы игрока по купленным талантам (без временной лихорадки).
function getMods(talents) {
  return computeMods(talents, mine);
}

// Бонусы с учётом алмазной лихорадки, если она сейчас идёт.
function effectiveMods(base, feverUntil, nowMs) {
  if (!base.fever || feverUntil <= nowMs) return base;
  return { ...base, clickGold: base.clickGold * mine.feverMult, minerGold: base.minerGold * mine.feverMult };
}

function publicMine() {
  const { clicksPerVein, xpPerClick, veins, minerBaseCost, minerGrowth, minerMax,
          minerBaseRate, offlineCapSeconds, feverSeconds, feverMult } = mine;
  return { clicksPerVein, xpPerClick, veins, minerBaseCost, minerGrowth, minerMax,
           minerBaseRate, offlineCapSeconds, feverSeconds, feverMult };
}

function logEvent(env, userId, type, payload, nowMs) {
  return env.DB.prepare(
    'INSERT INTO event_log (telegram_id, type, payload, created_at) VALUES (?, ?, ?, ?)'
  )
    .bind(userId, type, payload ? JSON.stringify(payload) : null, Math.floor(nowMs / 1000))
    .run();
}

async function loadPlayer(env, user, nowMs) {
  const find = () =>
    env.DB.prepare('SELECT * FROM players WHERE telegram_id = ?').bind(user.id).first();

  let p = await find();
  let isNew = false;
  if (!p) {
    const s = balance.start;
    const now = Math.floor(nowMs / 1000);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO players
       (telegram_id, username, first_name, level, xp, gold, aksum, nuggets,
        last_sync_at, created_at, click_tokens, click_tokens_at, idle_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(user.id, user.username ?? null, user.first_name ?? null,
            s.level, s.xp, s.gold, s.aksum, s.nuggets, now, now,
            mine.burstClicks, nowMs, nowMs)
      .run();
    await logEvent(env, user.id, 'player_created', null, nowMs);
    p = await find();
    isNew = true;
  }
  return { p, isNew };
}

function parseJsonArray(text) {
  try {
    const a = JSON.parse(text || '[]');
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

function toState(p) {
  let queue = [];
  try {
    queue = JSON.parse(p.vein_queue || '[]');
  } catch {
    queue = [];
  }
  return {
    gold: p.gold, xp: p.xp, nuggets: p.nuggets,
    queue, hits: p.vein_hits,
    miners: p.miners, idleAt: p.idle_at,
    talents: parseJsonArray(p.talents), feverUntil: p.fever_until, smelter: p.smelter_unlocked,
  };
}

function view(p, s) {
  return {
    first_name: p.first_name,
    gold: s.gold,
    xp: s.xp,
    nuggets: s.nuggets,
    aksum: p.aksum,
    queue: s.queue,
    hits: s.hits,
    miners: s.miners,
    talents: s.talents,
    feverUntil: s.feverUntil,
    smelterUnlocked: s.smelter,
  };
}

// Сохраняет состояние. Срабатывает, только если игрока никто не менял с момента чтения (version).
async function save(env, p, s, tokens, tokensAt, nowMs) {
  const r = await env.DB.prepare(
    `UPDATE players SET
       level = ?, xp = ?, gold = ?, nuggets = ?,
       vein_queue = ?, vein_hits = ?,
       miners = ?, idle_at = ?,
       talents = ?, fever_until = ?, smelter_unlocked = ?,
       click_tokens = ?, click_tokens_at = ?,
       last_sync_at = ?, version = version + 1
     WHERE telegram_id = ? AND version = ?`
  )
    .bind(levelInfo(s.xp).level, s.xp, s.gold, s.nuggets,
          JSON.stringify(s.queue), s.hits,
          s.miners, s.idleAt,
          JSON.stringify(s.talents), s.feverUntil, s.smelter,
          tokens, tokensAt,
          Math.floor(nowMs / 1000), p.telegram_id, p.version)
    .run();
  return r.meta.changes === 1;
}

// Начисляет золото шахтёров за время с прошлого обращения (не больше offlineCapSeconds).
// Пока шла алмазная лихорадка, шахтёры приносили вдвое больше.
function settleIdle(s, base, nowMs) {
  const raw = s.idleAt ? Math.max(0, (nowMs - s.idleAt) / 1000) : 0;
  const credited = Math.min(raw, mine.offlineCapSeconds);
  let feverSec = 0;
  if (base.fever && s.idleAt) {
    feverSec = Math.min(credited, Math.max(0, Math.min(nowMs, s.feverUntil) - s.idleAt) / 1000);
  }
  const gold = s.miners * base.minerGold * (credited + feverSec * (mine.feverMult - 1));
  s.gold += gold;
  s.idleAt = nowMs;
  return { seconds: raw, credited, gold, capped: raw > mine.offlineCapSeconds };
}

// Общий каркас для всех действий: читает игрока, начисляет доход шахтёров,
// выполняет действие fn, сохраняет и отвечает. При гонке запросов повторяет.
async function mutate(env, user, fn) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const nowMs = Date.now();
    const { p, isNew } = await loadPlayer(env, user, nowMs);
    const s = toState(p);
    const base = getMods(s.talents);
    refillQueue(s.queue, mine, rand);
    const idle = settleIdle(s, base, nowMs);
    const mods = effectiveMods(base, s.feverUntil, nowMs);

    const out = fn({ p, s, mods, base, nowMs }) || {};
    if (out.fail) return json({ error: out.fail.error }, out.fail.status);
    refillQueue(s.queue, mine, rand);

    const tokens = out.tokens === undefined ? p.click_tokens : out.tokens;
    const tokensAt = out.tokens === undefined ? p.click_tokens_at : nowMs;
    const ok = await save(env, p, s, tokens, tokensAt, nowMs);
    if (!ok) continue; // кто-то успел изменить игрока, пробуем ещё раз

    for (const [type, payload] of out.events || []) {
      await logEvent(env, user.id, type, payload, nowMs);
    }
    return json({ ...(out.body || {}), isNew, player: view(p, s), mods: getMods(s.talents), idle, serverTime: nowMs });
  }
  return json({ error: 'busy' }, 409);
}

// GET /api/state
async function handleState(request, env) {
  const auth = await authUser(request, env);
  if (!auth.user) return unauthorized(env, auth.reason);
  return mutate(env, auth.user, () => ({ body: { mine: publicMine() } }));
}

// POST /api/click  { clicks: N }
async function handleClick(request, env) {
  const auth = await authUser(request, env);
  if (!auth.user) return unauthorized(env, auth.reason);

  let body = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  let n = Math.floor(Number(body && body.clicks));
  if (!Number.isFinite(n) || n < 1) return json({ error: 'bad_request' }, 400);
  n = Math.min(n, mine.maxClicksPerRequest);

  return mutate(env, auth.user, ({ p, s, mods, base, nowMs }) => {
    // Лимит скорости: «ведро» с пополнением maxClicksPerSecond в секунду.
    const elapsed = Math.max(0, nowMs - p.click_tokens_at) / 1000;
    const tokens = Math.min(mine.burstClicks, p.click_tokens + elapsed * mine.maxClicksPerSecond);
    const allowed = Math.min(n, Math.floor(tokens));
    const gained = applyClicks(s, allowed, mine, mods, (range) => {
      const n = randInt(range[0], range[1]);
      return rand() < base.doubleNugget ? n * 2 : n;
    });
    if (gained.nuggets > 0 && base.fever) s.feverUntil = nowMs + mine.feverSeconds * 1000;
    return {
      tokens: tokens - allowed,
      body: { accepted: allowed, requested: n, gained },
      events: gained.nuggets > 0 ? [['nuggets_found', { amount: gained.nuggets }]] : [],
    };
  });
}

// POST /api/hire  { count: N }
async function handleHire(request, env) {
  const auth = await authUser(request, env);
  if (!auth.user) return unauthorized(env, auth.reason);

  let body = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const count = Math.floor(Number(body && body.count));
  if (!Number.isFinite(count) || count < 1 || count > mine.minerMax) {
    return json({ error: 'bad_request' }, 400);
  }

  return mutate(env, auth.user, ({ s }) => {
    if (s.miners + count > mine.minerMax) return { fail: { error: 'limit', status: 409 } };
    const cost = minersCost(mine, s.miners, count);
    if (s.gold < cost) return { fail: { error: 'not_enough_gold', status: 409 } };
    s.gold -= cost;
    s.miners += count;
    return { body: { hired: count, cost }, events: [['miners_hired', { count, cost }]] };
  });
}

// POST /api/talent  { id: "pick_1" }
async function handleTalent(request, env) {
  const auth = await authUser(request, env);
  if (!auth.user) return unauthorized(env, auth.reason);

  let body = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const node = NODE_BY_ID[body && body.id];
  if (!node) return json({ error: 'bad_request' }, 400);

  return mutate(env, auth.user, ({ s }) => {
    const err = checkBuy(node, s.talents, levelInfo(s.xp).level, s.gold, s.nuggets);
    if (err) return { fail: { error: err, status: 409 } };
    if (node.cost.nuggets !== undefined) s.nuggets -= node.cost.nuggets;
    else s.gold -= node.cost.gold;
    s.talents.push(node.id);
    if (node.effect.type === 'unlock') s.smelter = 1;
    return { body: { bought: node.id }, events: [['talent_bought', { id: node.id }]] };
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/state' && request.method === 'GET') return handleState(request, env);
    if (url.pathname === '/api/click' && request.method === 'POST') return handleClick(request, env);
    if (url.pathname === '/api/hire' && request.method === 'POST') return handleHire(request, env);
    if (url.pathname === '/api/talent' && request.method === 'POST') return handleTalent(request, env);
    return json({ error: 'not_found' }, 404);
  },
};
