/* Serverless-версия для Vercel: файл в api/ автоматически становится
 * эндпоинтом /api/ask. Логика — та же, что в server.js, через общий lib/.
 *
 * Проверено на Vercel (Node 20). Для Netlify есть свой адаптер:
 * netlify/functions/ask.js с сигнатурой (event) => {statusCode, body}.
 */
"use strict";

const { askBody } = require("../lib/app");
const g = require("../lib/guard");

module.exports = async function handler(req, res) {
  const cors = g.corsHeaders(req);
  Object.keys(cors).forEach(function (k) { res.setHeader(k, cors[k]); });

  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "нужен POST" }); return; }
  if (!g.originOk(req)) { res.status(403).json({ error: "источник не разрешён (ALLOWED_ORIGINS)" }); return; }

  const rl = g.rateOk(g.clientIp(req));
  if (!rl.ok) { res.status(429).json({ error: rl.why }); return; }

  const shared = process.env.SHARED_TOKEN || "";
  if (shared && String(req.headers["x-proxy-token"] || "") !== shared) {
    res.status(401).json({ error: "нет токена прокси" });
    return;
  }

  const body = typeof req.body === "string" ? safeJson(req.body) : (req.body || {});
  const out = await askBody(body);
  res.status(out.status).json(out.json);
};

function safeJson(s) {
  try { return JSON.parse(s); } catch (e) { return {}; }
}
