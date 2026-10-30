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
const TIMEOUT_MS = Number(process.env.GIGACHAT_TIMEOUT_MS || 35000);

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
   - закрытый перечень норм с их реальными названиями и короткими выдержками.
   Требования в системном сообщении намеренно жёсткие: разбор по каждой норме,
   никаких новых статей, никаких санкций «по памяти», обязательные id из
   списка. Всё, что модель нарушит, отсеет проверка на клиенте. */
const SYSTEM = [
  "Ты — помощник по российскому праву. Тебе дают описание ситуации, квалификацию,",
  "которую уже определила программа, план действий с сайта и закрытый перечень норм",
  "с названиями и короткими выдержками.",
  "",
  "Формат ответа — четыре блока, каждый начинается с отдельной строки-заголовка,",
  "между блоками пустая строка. Без нумерации и без markdown.",
  "Заголовки пиши ровно так, без двоеточий и добавок: «Коротко», «Что говорят нормы»,",
  "«Что делать», «Чего не хватает». Не пиши «готовые нормы», «нормы» или «шаги».",
  "Коротко",
  "2–3 предложения: что происходит с точки зрения права и какая норма здесь главная.",
  "Что говорят нормы",
  "Разбор каждой нормы из перечня: что она устанавливает, как применяется именно",
  "к этой ситуации и что из этого следует. По 2–3 предложения на норму, не по одной",
  "строке. Каждый абзац начинай с номера статьи и кодекса: «Статья 13 Федерального",
  "закона «О полиции» …», «Статья 27.2 КоАП РФ …». Не заменяй номер общим описанием",
  "закона. Если норма вспомогательная, объясни, для чего она нужна.",
  "Что делать",
  "Пошаговый порядок: куда обращаться, в какой последовательности действовать, какие",
  "документы и доказательства собрать. Опирайся на план сайта, но пересказывай его",
  "своими словами и привязывай шаги к нормам. Каждый шаг — с новой строки, без",
  "нумерации и маркеров.",
  "Чего не хватает",
  "Каких фактов, документов или сроков не хватает для точного вывода и что изменится,",
  "когда они появятся. Если всё ясно — одно предложение о том, что проверить перед подачей.",
  "",
  "Всего 10–16 предложений, не меньше 1100 знаков и не больше 2000.",
  "Последняя строка — обязательно CITE: id1, id2 (1–4 id из перечня через запятую).",
  "id используй только в строке CITE; в тексте — только номера и названия кодексов,",
  "например «статья 13 Федерального закона «О полиции»».",
  "Не начинай абзацы с id вида fz3pol-13 и не дублируй id в скобках.",
  "Не выводи JSON, markdown, список норм и строки вида «id: …».",
  "",
  "Правила:",
  "1. Пиши простыми словами, но по существу: не пересказывай описание и не отделывайся",
  "   общими фразами. Краткий ответ в 3–4 предложения не подходит.",
  "2. Если после названия нормы дана выдержка, опирайся на неё, но не переписывай дословно.",
  "   Если выдержка обрывается, не додумывай её содержание. Не переворачивай правила",
  "   выдержки: когда сказано, что причинитель освобождается, доказав отсутствие вины,",
  "   так и передай — не пиши, что вину должен доказать потерпевший.",
  "3. Ссылайся ТОЛЬКО на нормы из перечня. Не называй другие статьи, кодексы и номера.",
  "4. Не выдумывай санкции, сроки и суммы, если их нет в перечне или в плане сайта.",
  "   Если срок или размер неизвестен, так и скажи.",
  "5. Различай проверенное и предположение: «по перечню следует» и «возможно, потребуется».",
  "6. Не упоминай программу, сайт, план или перечень: пиши так, будто сам разобрал ситуацию.",
  "   Вместо «пункт 3 плана» просто повтори само действие.",
  "7. Не давай советов «обойти закон» и не оценивай, виновен ли человек.",
  "8. Не называй номера статей, которых нет в перечне, даже если они кажутся",
  "   подходящими. Если нужного правила в перечне нет — напиши, что этот вопрос",
  "   нужно проверить отдельно, без номера статьи."
].join("\n");

function buildMessages(body) {
  const text = String(body.text || "").slice(0, 2000);
  const qual = String(body.qual || "").slice(0, 400);
  const lead = String(body.lead || "").replace(/\s+/g, " ").trim().slice(0, 500);
  const steps = (Array.isArray(body.steps) ? body.steps : []).slice(0, 6)
    .map(function (s) {
      return String(s || "").replace(/\s+/g, " ").trim().slice(0, 220);
    }).filter(Boolean);
  const norms = Array.isArray(body.norms) ? body.norms.slice(0, 8) : [];
  const list = norms.map(function (n) {
    const gist = String(n.gist || "").replace(/\s+/g, " ").trim().slice(0, 320);
    return "- id: " + String(n.id).slice(0, 40) +
      " · " + String(n.code || "").slice(0, 60) +
      " ст. " + String(n.num || "").slice(0, 20) +
      " «" + String(n.title || "").slice(0, 200) + "»" +
      (gist ? " — " + gist : "");
  }).join("\n");
  const parts = [
    "Ситуация: " + text,
    qual ? "Квалификация, выбранная программой: " + qual : "Квалификация программой не выбрана."
  ];
  if (lead) parts.push("Краткий вывод сайта (проверьте его по нормам): " + lead);
  if (steps.length) {
    parts.push("План действий, который построил сайт (подсказка, перескажи своими словами):");
    parts.push(steps.map(function (s, i) { return (i + 1) + ". " + s; }).join("\n"));
  }
  parts.push("Перечень норм (только на них можно ссылаться):");
  parts.push(list || "(перечень пуст — тогда объясни общий порядок действий без ссылок на статьи и оставь строку CITE пустой)");
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: parts.join("\n") }
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
        max_tokens: 1600
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
  /* Основной формат — текст и последняя строка «CITE: …». Он переживает
     переводы строк внутри абзацев, на которых ломался JSON. Модель иногда
     приписывает CITE к последнему предложению — поэтому ищем его не только
     с начала строки. */
  const cm = raw.match(/\s*CITE[ \t]*:[ \t]*([^\n]*)[ \t]*$/i);
  if (cm) {
    cite = cm[1].split(/[,\s]+/)
      .map(function (x) { return x.replace(/[\[\]{}"'`]+/g, "").replace(/[.,;:]+$/, ""); })
      .filter(Boolean);
    plain = raw.slice(0, cm.index).trim();
  } else {
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
  }
  const allowed = {};
  (Array.isArray(body.norms) ? body.norms : []).forEach(function (n) { allowed[String(n.id)] = 1; });
  /* Фильтр по перечню делается и здесь, и на клиенте: прокси не должен
     возвращать id, которых ему не давали, даже если модель их придумала. */
  cite = cite.map(function (x) { return String(x || "").trim(); })
    .filter(function (x) { return allowed[x]; })
    .filter(function (x, i, a) { return a.indexOf(x) === i; })
    .slice(0, 4);
  /* Модель иногда копирует формат перечня и вставляет строки «id: …» —
     это служебная разметка, в объяснении ей не место. */
  plain = plain.split("\n").filter(function (line) {
    return !/^\s*(?:[-•*]\s*)?id\s*:\s*\S+\s*$/i.test(line);
  }).join("\n");

  /* Заголовки блоков модель называет по-своему («ГОТОВЫЕ НОРМЫ», «ЧТО
     ДЕЛАТЬ:»). Приводим их к одному виду: браузер выделяет ровно эти четыре
     строки, иначе ответ снова читается сплошным полотном. */
  const CANON = [
    [/^коротко\s*:?$/i, "Коротко"],
    [/^(?:готовые\s+)?нормы\s*:?$/i, "Что говорят нормы"],
    [/^что\s+говорят\s+нормы\s*:?$/i, "Что говорят нормы"],
    [/^что\s+делать\s*:?$/i, "Что делать"],
    [/^(?:порядок\s+действий|как\s+действовать)\s*:?$/i, "Что делать"],
    [/^чего\s+не\s+хватает\s*:?$/i, "Чего не хватает"],
    [/^чего\s+недостаёт\s*:?$/i, "Чего не хватает"]
  ];
  plain = plain.split("\n").map(function (line) {
    const t = line.trim();
    for (let i = 0; i < CANON.length; i++) {
      if (CANON[i][0].test(t)) return CANON[i][1];
    }
    return line;
  }).join("\n");

  /* id в скобках по тексту — тоже служебная разметка: модель иногда
     повторяет их из перечня. Убираем только id, которые ей действительно
     давали, чтобы не задеть случайные числа. */
  const givenIds = (Array.isArray(body.norms) ? body.norms : [])
    .map(function (n) { return String((n && n.id) || "").trim(); })
    .filter(Boolean);
  givenIds.forEach(function (id) {
    const escId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    /* «fz3pol-13 (ФЗ о полиции ст. 13)» — модель иногда ставит id перед
       пояснением. Оставляем пояснение, id убираем. */
    plain = plain.replace(new RegExp("(^|[^\\w-])" + escId + "\\s*\\(([^)\\n]{1,160})\\)", "gi"), "$1$2");
    plain = plain.replace(new RegExp("\\(\\s*(?:id\\s*:\\s*)?" + escId + "\\s*\\)", "gi"), "");
    /* Одиночный id в начале абзаца или после запятой, вместе с двоеточием. */
    plain = plain.replace(new RegExp("(^|[^\\w-])" + escId + "(?=$|[^\\w-])(?:\\s*[:–—-])?[ \\t]*", "gi"), "$1");
  });
  /* Скобки, в которых были только перечисленные id, после удаления остаются
     пустыми или «(, )» — убираем их целиком. */
  plain = plain.replace(/\(\s*[,;:\s]*\)/g, "");
  plain = plain.replace(/^[ \t]*[,;:][ \t]*/gm, "");
  plain = plain.replace(/(^|\n)[ \t]*и[ \t]+(?=\S)/g, "$1");
  plain = plain.replace(/\(\s*\)/g, "").replace(/[ \t]+([.,;:])/g, "$1");
  /* Если модель забыла строку CITE, но называла нормы в тексте — это и есть
     её ссылки. id брали мы сами, поэтому такие ссылки безопасны. */
  if (!cite.length) {
    cite = givenIds.filter(function (id) {
      const escId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp("(^|[^\\w-])" + escId + "(?=$|[^\\w-])", "i").test(raw);
    }).slice(0, 4);
  }
  /* Последний резерв: модель называет «статья 13 … О полиции», но не выводит
     CITE. Сопоставляем номер статьи с кодексом в пределах одного абзаца —
     перечень закрытый, поэтому ссылка всё равно ведёт только на нормы сайта. */
  if (!cite.length) cite = citeFromText(plain, body);

  /* Абзацы сохраняем: длинное объяснение одним полотном читать тяжело.
     Внутри строк лишние пробелы схлопываем, пустые строки — не больше одной. */
  plain = plain.replace(/[ \t]+/g, " ").replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n").trim().slice(0, 3200);
  return { plain: plain, cite: cite };
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

/* Резервные ссылки: ищем в тексте номер статьи рядом с упоминанием кодекса.
   Сравниваем не слово целиком, а первые буквы основы: «Конституции» и
   «Конституция» дают одну основу «конст», «полиции» — «полиц». */
const STOP_WORDS = {
  "федеральный": 1, "федерального": 1, "закон": 1, "закона": 1, "россии": 1,
  "российской": 1, "федерации": 1, "кодекс": 1, "кодекса": 1, "рф": 1, "фз": 1
};

function citeFromText(text, body) {
  const norms = Array.isArray(body && body.norms) ? body.norms : [];
  const blocks = String(text || "").split(/\n+/);
  const out = [];
  norms.forEach(function (n) {
    const num = String(n.num || "").trim();
    if (!num) return;
    const escNum = num.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const numRe = new RegExp("(^|[^0-9.])" + escNum + "(?=$|[^0-9.])");
    const words = (String(n.code || "") + " " + String(n.title || ""))
      .toLowerCase().match(/[а-яёa-z]{4,}/g) || [];
    const stems = words.filter(function (w) { return !STOP_WORDS[w]; })
      .map(function (w) { return w.slice(0, 5); });
    const hit = blocks.some(function (b) {
      if (!numRe.test(b)) return false;
      if (!stems.length) return true;
      const low = b.toLowerCase();
      return stems.some(function (s) { return low.indexOf(s) !== -1; });
    });
    if (hit) out.push(String(n.id));
  });
  return out.filter(function (x, i, a) { return a.indexOf(x) === i; }).slice(0, 4);
}

module.exports = { ask: ask, parseAnswer: parseAnswer, buildMessages: buildMessages, getToken: getToken, mock: mock, errorText: errorText };
