/* Автономный прокси к GigaChat: `node proxy/server.js`.
 *
 * Подходит для VPS, Yandex Cloud (виртуальная машина) и Docker-площадок —
 * любого места, где можно запустить Node 18+.
 * Никаких зависимостей: только стандартная библиотека, поэтому деплой —
 * копирование каталога и `node proxy/server.js`.
 *
 * Переменные окружения — см. proxy/.env.example.
 */
"use strict";

const http = require("http");
const app = require("./lib/app");
const g = require("./lib/guard");

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";

function send(res, code, obj, extra) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  }, extra || {}));
  res.end(body);
}

const server = http.createServer(async function (req, res) {
  const cors = g.corsHeaders(req);
  const url = (req.url || "").split("?")[0];

  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }

  if (url === "/health" || url === "/") return send(res, 200, app.health(), cors);

  if (url !== "/ask") return send(res, 404, { error: "нет такого метода" }, cors);
  if (req.method !== "POST") return send(res, 405, { error: "нужен POST" }, cors);
  if (!g.originOk(req)) return send(res, 403, { error: "источник не разрешён (ALLOWED_ORIGINS)" }, cors);

  const rl = g.rateOk(g.clientIp(req));
  if (!rl.ok) return send(res, 429, { error: rl.why }, cors);

  const shared = process.env.SHARED_TOKEN || "";
  if (shared && String(req.headers["x-proxy-token"] || "") !== shared) {
    return send(res, 401, { error: "нет токена прокси" }, cors);
  }

  let body;
  try { body = await g.readBody(req); }
  catch (e) { return send(res, e.status || 400, { error: e.message }, cors); }

  const out = await app.askBody(body);
  return send(res, out.status, out.json, cors);
});

server.listen(PORT, HOST, function () {
  console.log("прокси слушает http://" + HOST + ":" + PORT + (require("./lib/gigachat").mock() ? "  [MOCK]" : ""));
  console.log("ALLOWED_ORIGINS=" + (process.env.ALLOWED_ORIGINS || "*"));
  if (!process.env.GIGACHAT_CLIENT_SECRET && !require("./lib/gigachat").mock()) {
    console.warn("ВНИМАНИЕ: не задан GIGACHAT_CLIENT_SECRET — запросы к GigaChat будут падать");
  }
});
