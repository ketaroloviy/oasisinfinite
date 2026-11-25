import { verifyInitData } from './auth.js';
import balance from '../config/balance.json';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// GET /api/state: возвращает состояние игрока, при первом входе создаёт его.
async function handleState(request, env) {
  const header = request.headers.get('Authorization') || '';
  const initData = header.startsWith('tma ') ? header.slice(4) : '';
  const user = await verifyInitData(initData, env.BOT_TOKEN);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const now = Math.floor(Date.now() / 1000);
  const find = () =>
    env.DB.prepare('SELECT * FROM players WHERE telegram_id = ?').bind(user.id).first();

  let player = await find();
  let isNew = false;

  if (!player) {
    const s = balance.start;
    await env.DB.prepare(
      `INSERT OR IGNORE INTO players
       (telegram_id, username, first_name, level, xp, gold, aksum, nuggets, last_sync_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(user.id, user.username ?? null, user.first_name ?? null,
            s.level, s.xp, s.gold, s.aksum, s.nuggets, now, now)
      .run();
    await env.DB.prepare(
      'INSERT INTO event_log (telegram_id, type, payload, created_at) VALUES (?, ?, ?, ?)'
    )
      .bind(user.id, 'player_created', null, now)
      .run();
    player = await find();
    isNew = true;
  }

  return json({ isNew, player });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/state' && request.method === 'GET') {
      return handleState(request, env);
    }
    return json({ error: 'not_found' }, 404);
  },
};
