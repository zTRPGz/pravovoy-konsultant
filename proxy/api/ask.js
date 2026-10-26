/* Serverless-версия для Vercel: файл в api/ автоматически становится
 * эндпоинтом /api/ask. Логика — та же, что в server.js, через общий lib/.
 *
 * Проверено на Vercel (Node 20). Для Netlify нужен другой адаптер
 * (netlify/functions/ask.js с signature (event) => {statusCode, body}) —
 * см. proxy/README.md, раздел «Другие площадки».
 */
"use strict";

const { ask } = require("../lib/gigachat");
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
  const text = String(body.text || "").trim();
  if (text.length < 5) { res.status(400).json({ error: "слишком короткое описание" }); return; }
  if (!Array.isArray(body.norms) || !body.norms.length) {
    res.status(400).json({ error: "нужен перечень норм: без него модель начнёт выдумывать статьи" });
    return;
  }

  try {
    const out = await ask(body);
    res.status(200).json({ ok: true, plain: out.plain, cite: out.cite });
  } catch (e) {
    const code = e && e.status ? e.status : 502;
    console.error("[ask]", e && e.message ? e.message : e);
    res.status(code).json({ error: "GigaChat недоступен: " + (e && e.message ? e.message : "неизвестная ошибка") });
  }
};

function safeJson(s) {
  try { return JSON.parse(s); } catch (e) { return {}; }
}
