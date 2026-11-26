// Проверка подписи Telegram initData (HMAC-SHA256).
// Возвращает объект пользователя или null, если подпись неверна или данные устарели.
const enc = new TextEncoder();

async function hmac(keyBytes, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

function toHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Возвращает { user } при успехе или { reason } с причиной отказа.
export async function checkInitData(initData, botToken, maxAgeSeconds = 86400) {
  if (!botToken) return { reason: 'no_bot_token' };
  if (!initData) return { reason: 'no_init_data' };

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { reason: 'no_hash' };
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = await hmac(enc.encode('WebAppData'), botToken);
  const computed = toHex(await hmac(secretKey, dataCheckString));
  if (computed !== hash) return { reason: 'bad_signature' };

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSeconds) return { reason: 'expired' };

  try {
    const user = JSON.parse(params.get('user'));
    return user && user.id ? { user } : { reason: 'no_user' };
  } catch {
    return { reason: 'no_user' };
  }
}

export async function verifyInitData(initData, botToken, maxAgeSeconds = 86400) {
  const r = await checkInitData(initData, botToken, maxAgeSeconds);
  return r.user || null;
}
