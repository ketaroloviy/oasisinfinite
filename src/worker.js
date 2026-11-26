import { verifyInitData } from './auth.js';
import { levelInfo, applyClicks, refillQueue } from '../public/core.js';
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
  return verifyInitData(initData, env.BOT_TOKEN);
}

// Бонусы игрока. Пока их нет, позже сюда добавятся таланты.
function getMods() {
  return { clickGold: balance.mine.baseClickGold, xpMult: 1 };
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
        last_sync_at, created_at, click_tokens, click_tokens_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(user.id, user.username ?? null, user.first_name ?? null,
            s.level, s.xp, s.gold, s.aksum, s.nuggets, now, now,
            mine.burstClicks, nowMs)
      .run();
    await env.DB.prepare(
      'INSERT INTO event_log (telegram_id, type, payload, created_at) VALUES (?, ?, ?, ?)'
    )
      .bind(user.id, 'player_created', null, now)
      .run();
    p = await find();
    isNew = true;
  }
  return { p, isNew };
}

function toState(p) {
  let queue = [];
  try {
    queue = JSON.parse(p.vein_queue || '[]');
  } catch {
    queue = [];
  }
  return { gold: p.gold, xp: p.xp, nuggets: p.nuggets, queue, hits: p.vein_hits };
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
  };
}

// Сохраняет состояние. Работает только если никто не менял игрока с момента чтения (version).
async function save(env, p, s, tokens, tokensAt) {
  const r = await env.DB.prepare(
    `UPDATE players SET
       level = ?, xp = ?, gold = ?, nuggets = ?,
       vein_queue = ?, vein_hits = ?,
       click_tokens = ?, click_tokens_at = ?,
       last_sync_at = ?, version = version + 1
     WHERE telegram_id = ? AND version = ?`
  )
    .bind(levelInfo(s.xp).level, s.xp, s.gold, s.nuggets,
          JSON.stringify(s.queue), s.hits,
          tokens, tokensAt,
          Math.floor(tokensAt / 1000), p.telegram_id, p.version)
    .run();
  return r.meta.changes === 1;
}

// GET /api/state
async function handleState(request, env) {
  const user = await authUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const nowMs = Date.now();
  const { p, isNew } = await loadPlayer(env, user, nowMs);
  const s = toState(p);

  if (s.queue.length < mine.queueSize) {
    refillQueue(s.queue, mine, rand);
    await save(env, p, s, p.click_tokens, p.click_tokens_at);
  }

  return json({
    isNew,
    player: view(p, s),
    mods: getMods(p),
    mine: { clicksPerVein: mine.clicksPerVein, xpPerClick: mine.xpPerClick, veins: mine.veins },
  });
}

// POST /api/click  { clicks: N }
async function handleClick(request, env) {
  const user = await authUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);

  let body = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  let n = Math.floor(Number(body && body.clicks));
  if (!Number.isFinite(n) || n < 1) return json({ error: 'bad_request' }, 400);
  n = Math.min(n, mine.maxClicksPerRequest);

  for (let attempt = 0; attempt < 3; attempt++) {
    const nowMs = Date.now();
    const { p } = await loadPlayer(env, user, nowMs);
    const s = toState(p);
    refillQueue(s.queue, mine, rand);

    // Лимит скорости: «ведро» с пополнением maxClicksPerSecond в секунду.
    const elapsed = Math.max(0, nowMs - p.click_tokens_at) / 1000;
    const tokens = Math.min(mine.burstClicks, p.click_tokens + elapsed * mine.maxClicksPerSecond);
    const allowed = Math.min(n, Math.floor(tokens));

    const mods = getMods(p);
    const gained = applyClicks(s, allowed, mine, mods, (range) => randInt(range[0], range[1]));
    refillQueue(s.queue, mine, rand);

    const ok = await save(env, p, s, tokens - allowed, nowMs);
    if (!ok) continue; // кто-то успел изменить игрока, пробуем ещё раз

    if (gained.nuggets > 0) {
      await env.DB.prepare(
        'INSERT INTO event_log (telegram_id, type, payload, created_at) VALUES (?, ?, ?, ?)'
      )
        .bind(user.id, 'nuggets_found', JSON.stringify({ amount: gained.nuggets }), Math.floor(nowMs / 1000))
        .run();
    }

    return json({ player: view(p, s), mods, accepted: allowed, requested: n, gained });
  }
  return json({ error: 'busy' }, 409);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/state' && request.method === 'GET') {
      return handleState(request, env);
    }
    if (url.pathname === '/api/click' && request.method === 'POST') {
      return handleClick(request, env);
    }
    return json({ error: 'not_found' }, 404);
  },
};
