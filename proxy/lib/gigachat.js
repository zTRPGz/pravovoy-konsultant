/* GigaChat: OAuth, запрос и разбор ответа.
 *
 * Задача прокси — не «сгенерировать юридический ответ», а объяснить простыми
 * словами те нормы, которые сайт уже подобрал локально. Поэтому модель
 * получает закрытый список норм (id + кодекс + номер + название) и не имеет
 * права ссылаться ни на что другое: ответ возвращается вместе с массивом
 * `cite`, а браузер проверяет каждый id по своей базе и выбрасывает чужие.
 *
 * Секрет (client_secret) живёт только здесь. В браузер он не попадает никогда:
 * сайт статический, и любая попытка «сходить в GigaChat напрямую» означала бы
 * опубликованный ключ.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const tls = require("tls");

const OAUTH_URL = process.env.GIGACHAT_OAUTH_URL || "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";
const API_URL = process.env.GIGACHAT_API_URL || "https://gigachat.devices.sberbank.ru/api/v1/chat/completions";
const SCOPE = process.env.GIGACHAT_SCOPE || "GIGACHAT_API_PERS";
const MODEL = process.env.GIGACHAT_MODEL || "GigaChat";
const TIMEOUT_MS = Number(process.env.GIGACHAT_TIMEOUT_MS || 25000);

/* Корневой сертификат НУЦ Минцифры нужен, чтобы Node доверял TLS GigaChat.
   Сначала пробуем файл рядом с прокси (его можно заменить, не трогая код), а
   если файла нет — берём встроенную копию: на Vercel PEM рядом с serverless-
   функцией может не оказаться, и соединение падает с SELF_SIGNED_CERT_IN_CHAIN. */
const CA_PATH = path.join(__dirname, "..", "russian_trusted_root_ca.pem");
let CA = null;
function caCert() {
  if (CA === null) {
    try { CA = fs.readFileSync(CA_PATH, "utf8"); } catch (e) { CA = ""; }
    if (!CA) CA = require("./russian-root-ca");
  }
  return CA ? tls.rootCertificates.concat(CA) : undefined;
}

/* Запрос через http/https, а не глобальный fetch: только здесь можно передать
   сертификат НУЦ напрямую. Возвращает { status, text }; сетевые ошибки
   пробрасывает с кодом (SELF_SIGNED_CERT_IN_CHAIN, ENOTFOUND, ECONNRESET). */
function request(url, opts) {
  opts = opts || {};
  return new Promise(function (resolve, reject) {
    const u = new URL(url);
    const mod = u.protocol === "http:" ? http : https;
    const body = opts.body == null ? "" : String(opts.body);
    const headers = Object.assign({}, opts.headers || {});
    if (body) headers["Content-Length"] = Buffer.byteLength(body);
    const req = mod.request(u, {
      method: opts.method || "GET",
      headers: headers,
      ca: u.protocol === "https:" ? caCert() : undefined,
      timeout: opts.timeout || TIMEOUT_MS
    }, function (res) {
      const chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () {
        resolve({ status: res.statusCode || 0, text: Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.on("timeout", function () {
      req.destroy(new Error("таймаут " + Math.round((opts.timeout || TIMEOUT_MS) / 1000) + " с"));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

/* Токен живёт 30 минут; обновляем за минуту до истечения и никогда не
   запрашиваем дважды параллельно — иначе при первом же всплеске запросов
   получаем пачку одинаковых OAuth-вызовов и лишний расход квоты. */
let token = { value: "", exp: 0 };
let tokenPromise = null;

function mock() {
  return String(process.env.GIGACHAT_MOCK || "") === "1";
}

/* У сетевой ошибки причина лежит в e.code (https-запрос) или e.cause (fetch):
   без неё в браузере остаётся бесполезное «fetch failed». Код причины
   (ENOTFOUND, ECONNRESET, SELF_SIGNED_CERT_IN_CHAIN) секретов не раскрывает
   и сразу показывает, что чинить. */
function errorText(e) {
  const msg = e && e.message ? e.message : String(e);
  const parts = [];
  const add = function (x) {
    const s = x && (x.code || x.message || String(x));
    if (s && msg.indexOf(String(s)) === -1 && parts.indexOf(String(s)) === -1) parts.push(String(s));
  };
  if (e) add(e.code ? e : null);
  let c = e && e.cause, depth = 0;
  while (c && depth < 3) {
    add(c);
    c = c.cause;
    depth++;
  }
  return parts.length ? msg + " (" + parts.join(" / ") + ")" : msg;
}

async function fetchToken() {
  if (mock()) return { value: "mock-token", exp: Date.now() + 30 * 60 * 1000 };
  const id = process.env.GIGACHAT_CLIENT_ID || "";
  const secret = process.env.GIGACHAT_CLIENT_SECRET || "";
  if (!id || !secret) throw new Error("не заданы GIGACHAT_CLIENT_ID и GIGACHAT_CLIENT_SECRET");
  const auth = Buffer.from(id + ":" + secret).toString("base64");
  let r;
  try {
    r = await request(OAUTH_URL, {
      method: "POST",
      headers: {
        Authorization: "Basic " + auth,
        RqUID: cryptoRandomUuid(),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: "scope=" + encodeURIComponent(SCOPE),
      timeout: TIMEOUT_MS
    });
  } catch (e) {
    throw new Error("OAuth: сеть недоступна — " + errorText(e));
  }
  const text = r.text;
  if (r.status < 200 || r.status >= 300) throw new Error("OAuth " + r.status + ": " + text.slice(0, 300));
  let j;
  try { j = JSON.parse(text); } catch (e) { throw new Error("OAuth: ответ не JSON"); }
  if (!j.access_token) throw new Error("OAuth: нет access_token");
  const ttl = Number(j.expires_at || 0) ? Number(j.expires_at) - Date.now() : 30 * 60 * 1000;
  return { value: j.access_token, exp: Date.now() + Math.max(60000, ttl - 60000) };
}

async function getToken() {
  if (token.value && Date.now() < token.exp) return token.value;
  if (!tokenPromise) {
    tokenPromise = fetchToken().then(function (t) {
      token = t;
      tokenPromise = null;
      return t.value;
    }).catch(function (e) {
      tokenPromise = null;
      throw e;
    });
  }
  return tokenPromise;
}

function cryptoRandomUuid() {
  /* RqUID — обязательный заголовок OAuth. crypto.randomUUID есть в Node 19+,
     но прокси должен работать и на 18, поэтому собираем вручную. */
  const c = require("crypto");
  if (c.randomUUID) return c.randomUUID();
  const b = c.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
}

/* --- сборка запроса -------------------------------------------------------
   Модель получает:
   - описание ситуации (обрезанное до 2000 знаков — этого хватает для фабулы);
   - квалификацию, которую выбрал локальный движок;
   - закрытый перечень норм с их реальными названиями.
   Требования в системном сообщении намеренно жёсткие: короткий пересказ,
   никаких новых статей, никаких санкций «по памяти», обязательные id из
   списка. Всё, что модель нарушит, отсеет проверка на клиенте. */
const SYSTEM = [
  "Ты — помощник по российскому праву. Тебе дают описание ситуации, квалификацию,",
  "которую уже определила программа, и закрытый перечень норм с их названиями.",
  "",
  "Правила:",
  "1. Объясни ситуацию простыми словами: 3–6 предложений, без канцелярита.",
  "2. Ссылайся ТОЛЬКО на нормы из перечня. Не называй другие статьи, кодексы и номера.",
  "3. Не выдумывай санкции, сроки и суммы, если их нет в перечне.",
  "4. Если данных не хватает — скажи, чего именно не хватает, и какой документ это покажет.",
  "5. Не давай советов «обойти закон» и не оценивай, виновен ли человек.",
  "6. Верни строго JSON без пояснений вокруг:",
  '   {"plain": "объяснение", "cite": ["id нормы из перечня", "…"]}',
  "   В cite — от 1 до 4 id, ровно те, на которые ты сослался в тексте."
].join("\n");

function buildMessages(body) {
  const text = String(body.text || "").slice(0, 2000);
  const qual = String(body.qual || "").slice(0, 400);
  const norms = Array.isArray(body.norms) ? body.norms.slice(0, 8) : [];
  const list = norms.map(function (n) {
    return "- id: " + String(n.id).slice(0, 40) +
      " · " + String(n.code || "").slice(0, 60) +
      " ст. " + String(n.num || "").slice(0, 20) +
      " «" + String(n.title || "").slice(0, 200) + "»";
  }).join("\n");
  const user = [
    "Ситуация: " + text,
    qual ? "Квалификация, выбранная программой: " + qual : "Квалификация программой не выбрана.",
    "Перечень норм (только на них можно ссылаться):",
    list || "(перечень пуст — тогда объясни общий порядок действий без ссылок на статьи и верни пустой cite)"
  ].join("\n");
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: user }
  ];
}

async function ask(body) {
  const messages = buildMessages(body || {});
  if (mock()) return mockAnswer(body || {});

  const t = await getToken();
  let r;
  try {
    r = await request(API_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + t,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        messages: messages,
        temperature: 0.2,
        max_tokens: 700
      }),
      timeout: TIMEOUT_MS
    });
  } catch (e) {
    throw new Error("GigaChat: сеть недоступна — " + errorText(e));
  }
  const raw = r.text;
  if (r.status < 200 || r.status >= 300) {
    const e = new Error("GigaChat " + r.status + ": " + raw.slice(0, 300));
    e.status = r.status === 401 ? 502 : r.status;
    throw e;
  }
  let j;
  try { j = JSON.parse(raw); } catch (e) { throw new Error("GigaChat: ответ не JSON"); }
  const content = j && j.choices && j.choices[0] && j.choices[0].message
    ? String(j.choices[0].message.content || "") : "";
  return parseAnswer(content, body || {});
}

/* Разбор ответа модели. Модель просят вернуть JSON, но она может обернуть его
   в ```json … ``` или добавить фразу до/после — берём первую сбалансированную
   фигурную скобку и пробуем распарсить. Если не вышло — считаем весь текст
   объяснением без ссылок (лучше честный текст без цитат, чем пустота). */
function parseAnswer(content, body) {
  const raw = String(content || "").trim();
  let plain = raw, cite = [];
  const start = raw.indexOf("{");
  if (start !== -1) {
    const end = matchBrace(raw, start);
    if (end !== -1) {
      const block = raw.slice(start, end + 1);
      try {
        const j = JSON.parse(block);
        if (j && typeof j.plain === "string") plain = j.plain;
        if (j && Array.isArray(j.cite)) cite = j.cite;
      } catch (e) {
        /* Модель иногда отдаёт почти-JSON без кавычек: «… {cite: tk236}».
           Такой хвост — служебный, в тексте объяснения он не нужен. Убираем его,
           только если в блоке нет plain: иначе можно потерять сам ответ. */
        const hasPlain = /["']?plain["']?\s*:/.test(block);
        const hasCite = /["']?cite["']?\s*:/.test(block);
        if (!hasPlain && hasCite) {
          plain = (raw.slice(0, start) + " " + raw.slice(end + 1)).replace(/\s+/g, " ").trim();
          cite = block.replace(/^[^:]*:/, "").replace(/[\[\]{}"']/g, " ")
            .split(/[,\s]+/).filter(Boolean);
        }
      }
    }
  }
  const allowed = {};
  (Array.isArray(body.norms) ? body.norms : []).forEach(function (n) { allowed[String(n.id)] = 1; });
  /* Фильтр по перечню делается и здесь, и на клиенте: прокси не должен
     возвращать id, которых ему не давали, даже если модель их придумала. */
  cite = cite.map(function (x) { return String(x || "").trim(); })
    .filter(function (x) { return allowed[x]; })
    .filter(function (x, i, a) { return a.indexOf(x) === i; })
    .slice(0, 4);
  return { plain: plain.replace(/\s+/g, " ").trim().slice(0, 1600), cite: cite };
}

function matchBrace(s, i) {
  let depth = 0, inStr = false, esc = false;
  for (let k = i; k < s.length; k++) {
    const ch = s[k];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (!depth) return k; }
  }
  return -1;
}

/* Ответ без сети — для проверки прокси и для локальной разработки:
   `GIGACHAT_MOCK=1 node proxy/server.js`. Форма ответа та же. */
function mockAnswer(body) {
  const norms = Array.isArray(body.norms) ? body.norms : [];
  const first = norms[0] || {};
  return {
    plain: "Ситуация разобрана по нормам, которые подобрал сайт. " +
      "Главная норма — " + (first.code || "—") + ", ст. " + (first.num || "—") + " «" + (first.title || "—") + "». " +
      "Проверьте, что обстоятельства совпадают с её условиями, и посмотрите порядок действий в разборе ниже. " +
      "(Это тестовый ответ: GIGACHAT_MOCK=1, обращения к GigaChat не было.)",
    cite: norms.slice(0, 2).map(function (n) { return String(n.id); })
  };
}

module.exports = { ask: ask, parseAnswer: parseAnswer, buildMessages: buildMessages, getToken: getToken, mock: mock, errorText: errorText };
