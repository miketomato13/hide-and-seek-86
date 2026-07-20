// /api/scores — arcade leaderboard + presence counter.
//
// Leaderboard:
//   GET  /api/scores          -> { scores: [{initials, score, level}] }
//   POST /api/scores          -> {initials, score, level} adds a score (top 100 kept)
//
// Presence counter (heartbeat model, TTL 45s):
//   POST /api/scores?action=join&id=<uuid>  -> { count: N }
//   POST /api/scores?action=beat&id=<uuid>  -> { count: N }
//   POST /api/scores?action=leave&id=<uuid> -> { count: N }
//   GET  /api/scores?action=count           -> { count: N }
//
// Storage: Upstash Redis via KV_REST_API_URL + KV_REST_API_TOKEN env vars.
// Injected automatically when you connect an Upstash KV store in Vercel dashboard.

const SCORE_KEY = 'hs86:scores';
const SESS_TTL  = 45; // seconds; client heartbeats every 20s

function kvUrl() { return process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL; }
function kvTok() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

async function kv(cmd) {
  const url = kvUrl(), tok = kvTok();
  if (!url || !tok) throw new Error('KV not configured');
  const r = await fetch(`${url}/${cmd.map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${tok}` }
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  return d.result;
}

// ── Presence helpers ──────────────────────────────────────────────────────────

async function sessSet(id) {
  await kv(['SET', `hs86:sess:${id}`, '1', 'EX', String(SESS_TTL)]);
}

async function sessDel(id) {
  await kv(['DEL', `hs86:sess:${id}`]);
}

async function sessCount() {
  // Use SCAN instead of KEYS (KEYS is disabled on large Upstash DBs)
  let cursor = '0', count = 0;
  do {
    const res = await kv(['SCAN', cursor, 'MATCH', 'hs86:sess:*', 'COUNT', '100']);
    cursor = String(res[0]);
    count += Array.isArray(res[1]) ? res[1].length : 0;
  } while (cursor !== '0');
  return count;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { action, id } = req.query;

  try {
    // ── Presence routes ───────────────────────────────────────────────────────
    if (action === 'count') {
      return res.status(200).json({ count: await sessCount() });
    }

    if (action === 'join' || action === 'beat' || action === 'leave') {
      if (!id) return res.status(400).json({ error: 'id required' });
      if (action === 'leave') {
        await sessDel(id);
      } else {
        await sessSet(id);
      }
      return res.status(200).json({ count: await sessCount() });
    }

    // ── Leaderboard routes ────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const flat = await kv(['ZRANGE', SCORE_KEY, '0', '9', 'REV', 'WITHSCORES']);
      const rows = [];
      if (Array.isArray(flat)) {
        for (let i = 0; i + 1 < flat.length; i += 2) {
          const [initials, level, , , diff] = String(flat[i]).split('|');
          rows.push({ initials, level: parseInt(level, 10) || 1, score: Math.round(Number(flat[i + 1])), difficulty: diff || 'hard' });
        }
      }
      return res.status(200).json({ scores: rows });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const initials = String(body.initials || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
      const score    = Math.floor(Number(body.score));
      const level    = Math.floor(Number(body.level));
      if (!initials || !Number.isFinite(score) || score < 0 || score > 100000 ||
          !Number.isFinite(level) || level < 1 || level > 999) {
        return res.status(400).json({ error: 'invalid score payload' });
      }
      const diff = ['easy','hard'].includes(body.difficulty) ? body.difficulty : 'hard';
      const member = `${initials}|${level}|${Date.now()}|${Math.random().toString(36).slice(2, 7)}|${diff}`;
      await kv(['ZADD', SCORE_KEY, String(score), member]);
      await kv(['ZREMRANGEBYRANK', SCORE_KEY, '0', '-101']);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method not allowed' });

  } catch (err) {
    // KV not configured or transient failure — degrade gracefully
    return res.status(200).json({ offline: true, count: 0, err: err.message });
  }
}
