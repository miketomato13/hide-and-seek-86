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
// Storage: Vercel KV (Upstash Redis via the Vercel Marketplace).
// Setup: Vercel dashboard -> Storage -> Create Database -> Upstash Redis (KV)
// -> Connect to this project. That injects KV_REST_API_URL / KV_REST_API_TOKEN
// and this file just works. Until then, GET returns {offline: true} and the
// game hides the leaderboard/counter gracefully.

import { kv } from '@vercel/kv';

const SCORE_KEY = 'hs86:leaderboard';
const SESS_TTL  = 45; // seconds; client must heartbeat faster than this

// ── Presence helpers ─────────────────────────────────────────────────────────

async function sessSet(id) {
  await kv.set(`hs86:sess:${id}`, '1', { ex: SESS_TTL });
}

async function sessDel(id) {
  await kv.del(`hs86:sess:${id}`);
}

async function sessCount() {
  // KEYS is fine here — presence keys are tiny and short-lived
  const keys = await kv.keys('hs86:sess:*');
  return keys.length;
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
      const flat = await kv.zrange(SCORE_KEY, 0, 9, { rev: true, withScores: true });
      const rows = [];
      for (let i = 0; i + 1 < flat.length; i += 2) {
        const [initials, level] = String(flat[i]).split('|');
        rows.push({ initials, level: parseInt(level, 10) || 1, score: Math.round(Number(flat[i + 1])) });
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
      const member = `${initials}|${level}|${Date.now()}|${Math.random().toString(36).slice(2, 7)}`;
      await kv.zadd(SCORE_KEY, { score, member });
      await kv.zremrangebyrank(SCORE_KEY, 0, -101); // keep top 100
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method not allowed' });

  } catch (err) {
    // KV not configured or transient failure — degrade gracefully
    return res.status(200).json({ offline: true, count: 0 });
  }
}
