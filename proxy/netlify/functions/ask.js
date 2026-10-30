/* Serverless-адаптер для Netlify Functions (Node 18+).
 *
 * Деплой: база `proxy`, сборка не нужна. Маршруты /ask и /health заданы в
 * proxy/netlify.toml. Логика ответа общая с server.js и Vercel — lib/app.js.
 *
 * У бесплатного Netlify функция живёт 10 секунд, поэтому таймаут GigaChat
 * ограничен 9 секундами: лучше вернуть понятную 502, чем оборваться на
 * платформе. Ответ GigaChat обычно 2–3 секунды, запаса хватает.
 */
"use strict";

if (!process.env.GIGACHAT_TIMEOUT_MS) process.env.GIGACHAT_TIMEOUT_MS = "9000";

const { askBody, health } = require("../../lib/app");
const g = require("../../lib/guard");

function lower(headers) {
  const out = {};
  Object.keys(headers || {}).forEach(function (k) { out[k.toLowerCase()] = headers[k]; });
  return out;
}

function reply(status, json, cors) {
  return {
    statusCode: status,
    headers: Object.assign({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }, cors || {}),
    body: JSON.stringify(json)
  };
}

exports.handler = async function (event) {
  const headers = lower(event.headers);
  /* x-nf-client-connection-ip ставит сама Netlify. Подставляем его в
     X-Forwarded-For, чтобы guard не поверил подделанному клиентом заголовку
     и не дал обойти лимит одним и тем же адресом. */
  const ip = headers["x-nf-client-connection-ip"] || headers["x-forwarded-for"] || "unknown";
  const req = {
    headers: Object.assign({}, headers, { "x-forwarded-for": ip }),
    socket: { remoteAddress: ip }
  };
  const cors = g.corsHeaders(req);
  const method = String(event.httpMethod || "GET").toUpperCase();

  if (method === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
  if (method !== "POST") return reply(200, health(), cors);

  if (!g.originOk(req)) return reply(403, { error: "источник не разрешён (ALLOWED_ORIGINS)" }, cors);

  const rl = g.rateOk(g.clientIp(req));
  if (!rl.ok) return reply(429, { error: rl.why }, cors);

  const shared = process.env.SHARED_TOKEN || "";
  if (shared && String(headers["x-proxy-token"] || "") !== shared) {
    return reply(401, { error: "нет токена прокси" }, cors);
  }

  let raw = event.body || "";
  if (event.isBase64Encoded) raw = Buffer.from(raw, "base64").toString("utf8");
  if (Buffer.byteLength(raw) > g.MAX_BODY) {
    return reply(413, { error: "тело запроса больше 16 КБ" }, cors);
  }

  let body = {};
  if (raw) {
    try { body = JSON.parse(raw); } catch (e) {
      return reply(400, { error: "ожидался JSON" }, cors);
    }
  }

  const out = await askBody(body);
  return reply(out.status, out.json, cors);
};
