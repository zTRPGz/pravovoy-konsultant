/* Защита публичного эндпоинта.
 *
 * Ключ GigaChat лежит на сервере, но сам эндпоинт открыт в интернете — значит,
 * кто угодно может дергать его и жечь квоту. Поэтому:
 *   - CORS и проверка Origin/Referer по белому списку (браузер чужого сайта
 *     не сможет позвать прокси из скрипта);
 *   - лимит запросов на IP в минуту и на весь процесс в сутки;
 *   - ограничение размера тела (16 КБ) и длины текста;
 *   - необязательный общий токен (SHARED_TOKEN) для собственных сборок.
 * Это не полноценная защита (IP подделывается заголовком, если прокси стоит за
 * доверенным балансировщиком), но она отсекает случайный и массовый перебор.
 */
"use strict";

const MAX_BODY = 16 * 1024;
const PER_IP = Number(process.env.RATE_LIMIT_PER_MIN || 12);
const PER_DAY = Number(process.env.RATE_LIMIT_PER_DAY || 400);

const hits = new Map();
let day = { key: "", n: 0 };

function today() { return new Date().toISOString().slice(0, 10); }

function rateOk(ip) {
  const d = today();
  if (day.key !== d) day = { key: d, n: 0 };
  if (day.n >= PER_DAY) return { ok: false, why: "суточный лимит прокси исчерпан" };
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(function (t) { return now - t < 60000; });
  if (arr.length >= PER_IP) {
    hits.set(ip, arr);
    return { ok: false, why: "слишком много запросов, подождите минуту" };
  }
  arr.push(now);
  hits.set(ip, arr);
  /* карта не должна расти бесконечно: чистим, когда в ней больше 5000 адресов */
  if (hits.size > 5000) {
    hits.forEach(function (v, k) { if (!v.some(function (t) { return now - t < 60000; })) hits.delete(k); });
  }
  day.n++;
  return { ok: true };
}

function origins() {
  const raw = String(process.env.ALLOWED_ORIGINS || "").trim();
  if (!raw || raw === "*") return ["*"];
  return raw.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
}

function originOk(req) {
  const list = origins();
  if (list[0] === "*") return true;
  const o = req.headers.origin || "";
  if (o && list.indexOf(o) !== -1) return true;
  /* Запрос не из браузера (curl, серверный вызов) — Origin пустой. Его пускаем
     только если разрешён referer сайта: так прокси нельзя превратить в открытый
     релей для чужих скриптов, но собственные проверки работают. */
  if (!o) {
    const ref = String(req.headers.referer || "");
    return list.some(function (x) { return ref.indexOf(x) === 0; });
  }
  return false;
}

function corsHeaders(req) {
  const list = origins();
  const o = req.headers.origin || "";
  const allow = list[0] === "*" ? "*" : (list.indexOf(o) !== -1 ? o : list[0]);
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin"
  };
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    let size = 0, over = false, chunks = [];
    req.on("data", function (c) {
      size += c.length;
      /* Сокет не рвём: если уничтожить запрос на полпути, клиент получит
         «other side closed» вместо внятного 413. Просто перестаём копить и
         отвечаем ошибкой по завершении — тело всё равно будет дочитано. */
      if (size > MAX_BODY) { over = true; chunks = []; return; }
      chunks.push(c);
    });
    req.on("end", function () {
      if (over) { reject(Object.assign(new Error("тело запроса больше 16 КБ"), { status: 413 })); return; }
      const s = Buffer.concat(chunks).toString("utf8");
      if (!s) return resolve({});
      try { resolve(JSON.parse(s)); } catch (e) { reject(Object.assign(new Error("ожидался JSON"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

function clientIp(req) {
  const xf = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xf || (req.socket && req.socket.remoteAddress) || "unknown";
}

module.exports = { rateOk: rateOk, originOk: originOk, corsHeaders: corsHeaders, readBody: readBody, clientIp: clientIp, PER_IP: PER_IP, PER_DAY: PER_DAY };
