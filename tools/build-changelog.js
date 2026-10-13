/* =========================================================================
   Правовой консультант :: сборщик ленты изменений
   -------------------------------------------------------------------------
   Сравнивает только что собранные данные (tools/build-data.js) с предыдущим
   снимком и записывает ленту изменений для вкладки «Новое»:

     data/changelog.js         — window.RF_CHANGELOG = { built_at, entries: [...] }
                                 (грузится приложением из index.html)
     tools/state/snapshot.json — внутренний снимок для следующего сравнения;
                                 в браузер не попадает, но лежит в git, чтобы
                                 ночная сборка сравнивала с предыдущим днём

   На дату проверки пишется одна запись на документ:

     { d:"2026-10-12",              дата проверки (МСК)
       s:"nk2", a:"НК РФ ч. II",    id и короткое название источника
       k:"law",                     вид акта
       red:"2026-10-01",            сменилась дата редакции (ISO)
       add:["3","12"],              номера новых статей
       chg:["88"],                  номера изменившихся статей
       del:["45"],                  номера исчезнувших статей
       rep:["nk2-45"],              id норм, утративших силу
       res:["nk2-88"],              id норм, снова действующих
       fresh:1 | -1 }               документ добавлен / убран целиком

   Изменение статьи определяется по хешу названия, своей даты редакции и
   текста. Глава намеренно не входит в хеш: иначе переименование главы дало бы
   «изменение» всех её статей и лента превратилась бы в шум.

   Дата записи — дата проверки (UTC+3), а не дата редакции: пользователь
   читает «11.10.2026 найдены изменения». Дата редакции, если она сменилась,
   показывается отдельно (red).

   Запуск:  node tools/build-changelog.js
   ========================================================================= */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data");
const FULL = path.join(DATA, "full");
const STATE_DIR = path.join(__dirname, "state");
const SNAP = path.join(STATE_DIR, "snapshot.json");
const OUT = path.join(DATA, "changelog.js");

/* Лента не должна расти бесконечно: держим последние 15 дней, но не больше
   400 записей. Обе границы считаются от самой свежей записи. */
const KEEP_DAYS = 15;
const KEEP_MAX = 400;

/* Порядок записей внутри одной даты: чем важнее для пользователя, тем выше.
   Одинаковый вес сортируется по названию источника. */
const KIND_W = { "doc-new": 0, red: 1, art: 2, st: 3, "doc-del": 4 };

/* Вес записи для сортировки внутри даты. */
function kindWeight(e) {
  if (e.fresh === 1) return KIND_W["doc-new"];
  if (e.fresh === -1) return KIND_W["doc-del"];
  if (e.red) return KIND_W.red;
  if (e.rep || e.res) return KIND_W.st;
  return KIND_W.art;
}

/* Дата в московском поясе: сборка идёт на сервере в UTC, а читатель ждёт
   «сегодня» по своему календарю. */
function isoDay() {
  return new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
}

/* Номера статей: "9" перед "12", "12.8" после "12.4". */
function cmpNum(x, y) {
  const ax = String(x).split("."), ay = String(y).split(".");
  for (let i = 0; i < Math.max(ax.length, ay.length); i++) {
    const nx = Number(ax[i] === undefined ? -1 : ax[i]);
    const ny = Number(ay[i] === undefined ? -1 : ay[i]);
    if (nx !== ny) return nx - ny;
  }
  return x < y ? -1 : x > y ? 1 : 0;
}

function loadData() {
  global.window = global;
  require(path.join(DATA, "registry.js"));
  require(path.join(DATA, "index.js"));
  require(path.join(DATA, "status.js"));
  require(path.join(DATA, "freshness.js"));
  return {
    codes: global.RF_CODES || [],
    idx: global.RF_IDX || [],
    status: global.RF_STATUS || {},
    fresh: global.RF_FRESH || {}
  };
}

/* Снимок: { built_at, docs:{id:{red,arts,a,k}}, arts:{id:hash}, status:{id:[st,act,date]} } */
function loadSnapshot() {
  if (!fs.existsSync(SNAP)) return null;
  try {
    const s = JSON.parse(fs.readFileSync(SNAP, "utf8"));
    if (!s || typeof s !== "object" || !s.docs || !s.arts) return null;
    return s;
  } catch (e) {
    console.log("Снимок не читается (" + e.message + ") — считаем сборку первой.");
    return null;
  }
}

function hashArt(n, t, red, text) {
  return crypto.createHash("sha1")
    .update(n + "\u0001" + t + "\u0001" + red + "\u0001" + text, "utf8")
    .digest("hex").slice(0, 10);
}

/* ------------------------------------------------------- текущее состояние */

function buildState(d) {
  const byId = {};
  d.codes.forEach(function (c) { byId[c.id] = c; });

  const docs = {}, arts = {}, status = {};
  d.codes.forEach(function (c) { docs[c.id] = { red: c.redaction || "", arts: 0, a: c.short || "", k: c.kind || "code" }; });
  d.idx.forEach(function (r) { arts[r[0] + "-" + r[1]] = ""; });
  Object.keys(d.status).forEach(function (id) { status[id] = d.status[id]; });

  /* хеши текстов: грузим по очереди и сразу освобождаем память.
     require.resolve важен при символических ссылках: без него ключ кеша
     остаётся от настоящего пути и удалить его не получится. */
  let noFull = 0;
  d.codes.forEach(function (c) {
    const file = path.join(FULL, c.id + ".js");
    if (!fs.existsSync(file)) { noFull++; return; }
    let real;
    try { real = require.resolve(file); } catch (e) { noFull++; return; }
    require(file);
    const F = global.RF_FULL ? global.RF_FULL[c.id] : null;
    if (!Array.isArray(F)) { noFull++; return; }
    F.forEach(function (a) {
      const id = c.id + "-" + a[0];
      if (!(id in arts)) return;
      arts[id] = hashArt(a[0], a[1] || "", a[3] || "", a[4] || "");
    });
    docs[c.id].arts = F.length;
    if (global.RF_FULL) delete global.RF_FULL[c.id];
    delete require.cache[real];
  });
  if (noFull) console.log("Предупреждение: без полного текста " + noFull + " источников — их статьи сравнивались только по названию.");

  return { docs: docs, arts: arts, status: status };
}

/* ----------------------------------------------------------------- сравнение */

function diff(d, snap, st, day) {
  const byId = {};
  d.codes.forEach(function (c) { byId[c.id] = c; });
  const entries = [];
  const numOf = function (id) { return id.slice(id.lastIndexOf("-") + 1); };
  const srcOf = function (id) { return id.slice(0, id.lastIndexOf("-")); };

  function entry(src, extra) {
    const c = byId[src];
    const e = {
      d: day, s: src, a: (c && (c.short || c.full)) || (snap.docs[src] && snap.docs[src].a) || src,
      k: (c && c.kind) || (snap.docs[src] && snap.docs[src].k) || "code"
    };
    Object.keys(extra || {}).forEach(function (k) { e[k] = extra[k]; });
    /* пустые списки не пишем — экономим байты */
    ["add", "chg", "del", "rep", "res"].forEach(function (k) {
      if (e[k] && !e[k].length) delete e[k];
    });
    return e;
  }

  /* --- документы целиком --- */
  Object.keys(st.docs).forEach(function (id) {
    if (snap.docs[id]) return;
    entries.push(entry(id, { fresh: 1, arts: st.docs[id].arts }));
  });
  Object.keys(snap.docs).forEach(function (id) {
    if (st.docs[id]) return;
    entries.push(entry(id, { fresh: -1 }));
  });

  /* --- сменилась дата редакции --- */
  Object.keys(st.docs).forEach(function (id) {
    const old = snap.docs[id];
    if (!old || old.red === st.docs[id].red) return;
    entries.push(entry(id, { red: st.docs[id].red, redFrom: old.red || "", arts: st.docs[id].arts }));
  });

  /* --- статьи: добавились, изменились, исчезли --- */
  const perDoc = {};
  function bucket(src) {
    if (!perDoc[src]) perDoc[src] = { add: [], chg: [], del: [] };
    return perDoc[src];
  }
  Object.keys(st.arts).forEach(function (id) {
    const src = srcOf(id);
    if (!(id in snap.arts)) bucket(src).add.push(numOf(id));
    else if (snap.arts[id] !== st.arts[id]) bucket(src).chg.push(numOf(id));
  });
  Object.keys(snap.arts).forEach(function (id) {
    if (id in st.arts) return;
    const src = srcOf(id);
    if (!st.docs[src]) return;
    bucket(src).del.push(numOf(id));
  });
  Object.keys(perDoc).forEach(function (src) {
    if (!st.docs[src]) return;
    const p = perDoc[src];
    entries.push(entry(src, {
      add: p.add.sort(cmpNum), chg: p.chg.sort(cmpNum), del: p.del.sort(cmpNum),
      arts: st.docs[src].arts
    }));
  });

  /* --- статусы норм: утрата силы и восстановление ---
     Статус нормы есть только у нормативных актов: у постановлений Пленума и
     обзоров судебной практики он не определяется (см. tools/build-data.js), а в
     старых снимках мусорные записи ещё лежат. Их не показываем ни как
     «утратили силу», ни как «снова действуют» — иначе правка разбора выглядела
     бы в ленте как восстановление силы пункта Пленума. */
  const NO_STATUS_KIND = { plenum: 1, review: 1 };
  const stIgnored = function (id) {
    const src = srcOf(id);
    const k = (byId[src] && byId[src].kind) || (snap.docs[src] && snap.docs[src].k);
    return !!NO_STATUS_KIND[k];
  };
  const stDoc = {};
  function stBuck(src) {
    if (!stDoc[src]) stDoc[src] = { rep: [], res: [] };
    return stDoc[src];
  }
  Object.keys(st.status).forEach(function (id) {
    if (snap.status[id]) return;                       /* был и остался */
    if (stIgnored(id)) return;
    stBuck(srcOf(id)).rep.push(id);
  });
  Object.keys(snap.status).forEach(function (id) {
    if (st.status[id]) return;                         /* пропал — снова действует */
    if (stIgnored(id)) return;
    const src = srcOf(id);
    if (!st.docs[src]) return;
    stBuck(src).res.push(id);
  });
  Object.keys(stDoc).forEach(function (src) {
    if (!st.docs[src]) return;
    entries.push(entry(src, {
      rep: stDoc[src].rep.sort(cmpNum), res: stDoc[src].res.sort(cmpNum),
      arts: st.docs[src].arts
    }));
  });

  /* записи без содержания не нужны */
  return entries.filter(function (e) {
    return e.fresh || e.red || (e.add && e.add.length) || (e.chg && e.chg.length) ||
      (e.del && e.del.length) || (e.rep && e.rep.length) || (e.res && e.res.length);
  }).sort(function (a, b) {
    const wa = kindWeight(a), wb = kindWeight(b);
    if (wa !== wb) return wa - wb;
    return a.a < b.a ? -1 : a.a > b.a ? 1 : 0;
  });
}

/* ------------------------------------------------------------- прошлая лента */

function loadChangelog() {
  if (!fs.existsSync(OUT)) return [];
  try {
    global.window.RF_CHANGELOG = undefined;
    require(OUT);
    const c = global.RF_CHANGELOG;
    return (c && Array.isArray(c.entries)) ? c.entries.slice() : [];
  } catch (e) {
    console.log("Прежняя лента не читается (" + e.message + ") — начинаем ленту заново.");
    return [];
  }
}

/* Один документ может измениться дважды за дату (ручной и плановый запуск) —
   склеиваем записи, иначе в ленте будут дубли. */
function mergeEntry(a, b) {
  const out = {};
  Object.keys(a).forEach(function (k) { out[k] = a[k]; });
  Object.keys(b).forEach(function (k) {
    const v = b[k];
    if (Array.isArray(v)) {
      out[k] = (Array.isArray(out[k]) ? out[k].concat(v) : v).filter(function (x, i, arr) {
        return arr.indexOf(x) === i;
      });
      if (k === "add" || k === "chg" || k === "del") out[k].sort(cmpNum);
    } else if (out[k] === undefined || (k === "red" && v > out[k]) || (k === "arts" && v > (out[k] || 0))) {
      out[k] = v;
    }
  });
  return out;
}

/* Лента всегда отсортирована «свежие сверху»; внутри даты порядок задаётся
   важностью события (см. KIND_W в diff) — он уже сохранён в порядке склейки. */
function retain(list) {
  const sorted = list.slice().sort(function (a, b) {
    if (a.d !== b.d) return a.d < b.d ? 1 : -1;
    const wa = kindWeight(a), wb = kindWeight(b);
    if (wa !== wb) return wa - wb;
    return a.a < b.a ? -1 : a.a > b.a ? 1 : 0;
  });
  if (!sorted.length) return sorted;
  const cutoff = new Date(sorted[0].d + "T00:00:00Z");
  const limit = new Date(cutoff.getTime() - KEEP_DAYS * 86400e3).toISOString().slice(0, 10);
  let out = sorted.filter(function (e) { return e.d >= limit; });
  if (out.length > KEEP_MAX) out = out.slice(0, KEEP_MAX);
  return out;
}

/* ------------------------------------------------------------------- запись */

function writeChangelog(entries) {
  fs.writeFileSync(OUT,
    "/* Правовой консультант :: лента изменений для вкладки «Новое».\n" +
    "   Одна запись на документ на дату проверки: сменилась редакция,\n" +
    "   добавились, изменились или исчезли статьи, нормы утратили силу или\n" +
    "   снова действуют. Собирается tools/build-changelog.js. */\n" +
    "window.RF_CHANGELOG=" + JSON.stringify({
      built_at: new Date().toISOString(),
      entries: entries
    }) + ";\n", "utf8");
}

function writeSnapshot(st) {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(SNAP, JSON.stringify({
    built_at: new Date().toISOString(),
    docs: st.docs,
    arts: st.arts,
    status: st.status
  }), "utf8");
}

/* --------------------------------------------------------------------- main */

(function main() {
  const day = isoDay();
  const d = loadData();
  const snap = loadSnapshot();
  const st = buildState(d);

  if (!snap) {
    writeSnapshot(st);
    /* ленту не переписываем: сравнивать не с чем */
    if (!fs.existsSync(OUT)) {
      writeChangelog([]);
      console.log("Первый запуск: снимок создан, лента пуста (сравнивать было не с чем).");
    } else {
      console.log("Первый запуск: снимок создан. Прежняя лента оставлена без изменений.");
    }
    console.log("Источников: " + d.codes.length + " · статей: " + Object.keys(st.arts).length +
      " · норм со статусом: " + Object.keys(st.status).length);
    return;
  }

  const fresh = diff(d, snap, st, day);
  const old = loadChangelog();

  /* новые записи важнее прошлых: идут первыми, но с тем же ключом склеиваются */
  const merged = fresh.concat(old);
  const byKey = {};
  const out = [];
  merged.forEach(function (e) {
    const k = e.d + "\u0001" + e.s;
    const prev = byKey[k];
    if (prev === undefined) { byKey[k] = e; out.push(e); return; }
    const m = mergeEntry(prev, e);
    byKey[k] = m;
    out[out.indexOf(prev)] = m;
  });

  const final = retain(out);
  const total = final.reduce(function (n, e) {
    return n + (e.fresh ? 1 : 0) + (e.red ? 1 : 0) +
      ((e.add && e.add.length) ? 1 : 0) + ((e.chg && e.chg.length) ? 1 : 0) +
      ((e.del && e.del.length) ? 1 : 0) + ((e.rep && e.rep.length) ? 1 : 0) +
      ((e.res && e.res.length) ? 1 : 0);
  }, 0);

  writeChangelog(final);
  writeSnapshot(st);

  console.log("Лента изменений за " + day + ":");
  if (!fresh.length) {
    console.log("  изменений нет");
  } else {
    fresh.forEach(function (e) {
      const bits = [];
      if (e.fresh === 1) bits.push("добавлен в базу");
      if (e.fresh === -1) bits.push("убран из базы");
      if (e.red) bits.push("редакция " + (e.redFrom || "?") + " → " + e.red);
      if (e.add && e.add.length) bits.push("+" + e.add.length);
      if (e.chg && e.chg.length) bits.push("~" + e.chg.length);
      if (e.del && e.del.length) bits.push("−" + e.del.length);
      if (e.rep && e.rep.length) bits.push("утратили силу: " + e.rep.length);
      if (e.res && e.res.length) bits.push("снова действуют: " + e.res.length);
      console.log("  " + e.a + " — " + bits.join(", "));
    });
  }
  console.log("Записей в ленте: " + final.length + " (новых " + fresh.length + "), событий " + total);
  console.log("data/changelog.js — " + (fs.statSync(OUT).size / 1024).toFixed(1) + " КБ");
})();
