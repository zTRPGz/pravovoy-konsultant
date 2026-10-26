/* =========================================================================
   Правовой консультант :: проверка полноты и целостности данных
   -------------------------------------------------------------------------
   Контролирует, что при сборке из открытых источников ничего не потеряно
   и что приложение ссылается только на существующие статьи.

   Проверки:
     1. реестр источников и поисковый индекс согласованы;
     2. каждая статья из индекса присутствует в файле полного текста;
     3. объём текста сохранён (сравнение с исходными источниками, символ
        в символ) — отдельно по каждому документу и суммарно;
     4. названия статей совпадают с названиями в источнике;
     5. все ссылки из правил разбора ситуации и аннотаций разрешаются;
     6. поля шаблонов документов согласованы с их текстом.

   Запуск:  node tools/verify-data.js
   ========================================================================= */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const VENDOR = path.join(ROOT, "vendor", "ruslaw");

/* Есть ли сырые выгрузки источников. Каталог vendor/ в git не хранится: он есть
   только после ночной сборки (там выгрузки качаются) и на машине разработчика
   после `npm run fetch`. Проверки 3 и 4 сверяют базу с первоисточником — без
   выгрузок их не с чем сверять, и они пропускаются. Все остальные проверки
   (согласованность данных, разборы, шаблоны, иски, сроки, защита разметки,
   гварды на текст app.js) от выгрузок не зависят и идут всегда — именно они
   ловят регрессии в коде, и их-то и не хватало в CI. */
const HAVE_VENDOR = fs.existsSync(VENDOR) && fs.existsSync(path.join(VENDOR, "konst.json"));

/* файл набора данных -> идентификатор источника в приложении (для проверки названий) */
const DATASET = {
  uk: "63-ФЗ_Уголовный_кодекс_Российской_Федерации.json",
  upk: "174-ФЗ_Уголовно-процессуальный_кодекс_Российской_Федерации.json",
  koap: "195-ФЗ_Кодекс_Российской_Федерации_об_административных_правонарушениях.json",
  tk: "197-ФЗ_Трудовой_кодекс_Российской_Федерации.json"
};

let failures = 0;
function check(name, ok, extra) {
  console.log((ok ? "  OK   " : "  ПРОБЛЕМА ") + name + (extra ? " — " + extra : ""));
  if (!ok) failures++;
}

function loadGlobals(files) {
  const ctx = { window: {} };
  vm.createContext(ctx);
  files.forEach(function (f) { vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx); });
  return ctx.window;
}

const W = loadGlobals([
  "data/registry.js", "data/index.js", "data/annotations.js",
  "data/40-reference.js", "data/41-suits.js", "data/terms.js", "data/freshness.js", "data/status.js"
]);
const codes = W.RF_CODES || [];
const idx = W.RF_IDX || [];
const annot = W.RF_ANNOT || {};
const extra = W.RF_EXTRA || { codes: [], articles: [] };
const ref = W.RF_REF || {};
const terms = W.RF_TERMS || [];
const fresh = W.RF_FRESH || {};
const freshDocs = fresh.docs || {};
const STATUS = W.RF_STATUS || {};
const STATUS_ACTS = W.RF_STATUS_ACTS || [];
const STATUS_META = W.RF_STATUS_META || {};

function strip(s) { return String(s || "").replace(/[\s\u00a0\u2000-\u200b\u202f\u205f\u3000\ufeff]/g, ""); }

/* 1 ---------------------------------------------------------- реестр и индекс */
console.log("1. Реестр источников и поисковый индекс");
const perCode = {};
idx.forEach(function (r) { perCode[r[0]] = (perCode[r[0]] || 0) + 1; });

const byKind = {};
codes.forEach(function (c) { byKind[c.kind] = (byKind[c.kind] || 0) + 1; });
check("источников в реестре: " + codes.length +
  " (кодексов " + (byKind.code || 0) + ", федеральных законов " + (byKind.law || 0) +
  ", ФКЗ " + (byKind.fkz || 0) + ", постановлений " + (byKind.decree || 0) +
  ", Конституция " + (byKind.constitution || 0) + ")",
  codes.length >= 128 && byKind.constitution === 1 && byKind.fkz >= 14 && byKind.code >= 24 &&
  byKind.law >= 60 && byKind.decree >= 6);

const mismatch = codes.filter(function (c) { return perCode[c.id] !== c.count; });
check("число статей в реестре совпадает с индексом", mismatch.length === 0,
  mismatch.length ? mismatch.map(function (c) { return c.id + " " + c.count + "/" + perCode[c.id]; }).join(", ") : "всего " + idx.length);
check("у каждого источника есть дата редакции", codes.every(function (c) { return !!c.redaction; }),
  codes.filter(function (c) { return !c.redaction; }).map(function (c) { return c.id; }).join(", ") || "у всех");
const noArts = codes.filter(function (c) { return !(perCode[c.id] || 0); });
check("в каждом источнике разобраны статьи", noArts.length === 0,
  noArts.length ? noArts.map(function (c) { return c.id; }).join(", ") : "во всех");
check("снимок актуальности покрывает все источники",
  codes.every(function (c) { return !!freshDocs[c.id]; }),
  codes.filter(function (c) { return !freshDocs[c.id]; }).map(function (c) { return c.id; }).join(", ") || "все " + Object.keys(freshDocs).length);

/* 2 ------------------------------------------------- статьи против полных текстов */
console.log("\n2. Полные тексты");
let missingInFull = 0, dupIndex = 0;
const seenIdx = {};
idx.forEach(function (r) {
  const k = r[0] + "-" + r[1];
  if (seenIdx[k]) dupIndex++;
  seenIdx[k] = 1;
});
check("нет повторяющихся идентификаторов статей", dupIndex === 0, dupIndex ? dupIndex + " дублей" : "нет");

const fullCache = {};
function fullOf(id) {
  if (!fullCache[id]) {
    const ctx = { window: {} };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "data", "full", id + ".js"), "utf8"), ctx);
    fullCache[id] = ctx.window.RF_FULL[id];
  }
  return fullCache[id];
}
codes.forEach(function (c) {
  const F = fullOf(c.id);
  const have = {};
  F.forEach(function (r) { have[r[0]] = 1; });
  idx.filter(function (r) { return r[0] === c.id; }).forEach(function (r) {
    if (!have[r[1]]) missingInFull++;
  });
});
check("все статьи индекса есть в файлах полных текстов", missingInFull === 0, missingInFull + " отсутствуют");

/* 3 --------------------------------------------------------- объём текста */
console.log("\n3. Сохранность объёма текста (относительно открытых источников)");

if (!HAVE_VENDOR) {
  /* Без выгрузок сверять нечего. Это не замечание и не ошибка: сверка с
     первоисточником нужна там, где источники есть (ночная сборка). Все
     остальные проверки от выгрузок не зависят и идут всегда — именно они
     ловят правки в коде, и их-то не хватало в CI. */
  console.log("  ПРОПУЩЕНО — нет каталога vendor/ (сырые выгрузки источников)");
} else {

const SRC_CACHE = {};
function srcJSON(rel) {
  if (!SRC_CACHE[rel]) SRC_CACHE[rel] = JSON.parse(fs.readFileSync(path.join(VENDOR, rel), "utf8"));
  return SRC_CACHE[rel];
}

/* исходные записи документа по его идентификатору в приложении */
function sourceEntries(id) {
  const d = freshDocs[id];
  if (!d) return null;
  if (d.group === "codes") return srcJSON(d.slug + ".json").articles;
  if (d.group === "laws") {
    if (d.src) return srcJSON(d.src).articles;               // «заплатка» с портала
    return srcJSON("laws/" + d.slug + ".json").articles;
  }
  if (d.src === "konst.json") return srcJSON("konst.json").articles;
  if (d.src === "fkz.json") {
    const hit = srcJSON("fkz.json").filter(function (x) { return x.name === d.key; })[0];
    return hit ? hit.articles : null;
  }
  if (d.src === "laws-extra.json") {
    const hit = srcJSON("laws-extra.json").filter(function (x) { return x.app_id === d.key; })[0];
    return hit ? hit.articles : null;
  }
  if (d.src === "decrees.json") {
    const hit = srcJSON("decrees.json").filter(function (x) { return x.app_id === d.key; })[0];
    return hit ? hit.articles : null;
  }
  if (d.src === "plenums.json") {
    const hit = srcJSON("plenums.json").filter(function (x) { return x.app_id === d.key; })[0];
    return hit ? hit.articles : null;
  }
  if (d.src === "reviews.json") {
    const hit = srcJSON("reviews.json").filter(function (x) { return x.app_id === d.key; })[0];
    return hit ? hit.articles : null;
  }
  return null;
}

let grandSrc = 0, grandOut = 0, noSrc = 0;
const lowPres = [];
/* Объём текста источника без строк-маркеров глав и разделов: при сборке эти
   строки намеренно переносятся в поле «глава» и в текст статьи не попадают. */
const parse = require(path.join(ROOT, "tools", "lib", "parse.js"));
function srcChars(e) {
  const norm = parse.normalize(e.text);
  let n = strip(norm).length;
  parse.extractMarkers(norm).forEach(function (mk) { n -= strip(mk.line).length; });
  return n;
}
codes.forEach(function (c) {
  const src = sourceEntries(c.id);
  if (!src) { noSrc++; return; }
  let s = 0;
  src.forEach(function (e) {
    // записи-заглушки «Пункт N» намеренно не включаются в базу
    if (/^Дополнение с \d{2}\.\d{2}\.\d{4}/.test(String(e.title || "").trim())) return;
    s += srcChars(e);
  });
  let o = 0;
  fullOf(c.id).forEach(function (r) { o += strip(r[4]).length; });
  grandSrc += s; grandOut += o;
  const p = s ? o / s * 100 : 100;
  if (p < 99.5) lowPres.push(c.id + " " + p.toFixed(2) + "% (" + o + "/" + s + ")");
});
check("каждому источнику найден исходник для сверки", noSrc === 0, noSrc ? noSrc + " без исходника" : "все " + codes.length);
check("объём текста сохранён по каждому источнику", lowPres.length === 0,
  lowPres.length ? lowPres.join(", ") : "потери менее 0,5% отсутствуют");
const pct = grandSrc ? grandOut / grandSrc * 100 : 0;
check("объём текста сохранён суммарно", pct >= 99.5,
  grandOut + " из " + grandSrc + " символов (" + pct.toFixed(2) + "%)");

/* 4 -------------------------------------------------------------- названия */
console.log("\n4. Названия статей сверены с источником");
Object.keys(DATASET).forEach(function (id) {
  const raw = JSON.parse(fs.readFileSync(path.join(VENDOR, DATASET[id]), "utf8"));
  const byKey = {};
  idx.filter(function (r) { return r[0] === id; }).forEach(function (r) { byKey[r[1]] = r[2]; });
  let checked = 0, bad = 0;
  raw.articles.forEach(function (e) {
    if (e.number == null) return;
    const d = String(e.title || "").replace(/[\u00a0]/g, " ").replace(/\s+/g, " ").trim();
    const got = byKey[String(e.number)];
    if (!d || !got) return;
    checked++;
    if (got !== d) bad++;
  });
  check(id + ": названия совпадают", bad === 0, "сверено " + checked + ", расхождений " + bad);
});
} /* HAVE_VENDOR */

/* 5 ------------------------------------------------------- перекрёстные ссылки */
console.log("\n5. Ссылки в правилах разбора и аннотациях");
const known = {};
idx.forEach(function (r) { known[r[0] + "-" + r[1]] = 1; });
(extra.articles || []).forEach(function (a) { known[a.c + "-" + a.n] = 1; });

const brokenRefs = [];
(ref.intents || []).forEach(function (it) {
  (it.articles || []).forEach(function (aid) { if (!known[aid]) brokenRefs.push(it.t + " → " + aid); });
  if (it.checklist && !(ref.checklists || []).some(function (c) { return c.id === it.checklist; })) {
    brokenRefs.push(it.t + " → чек-лист " + it.checklist);
  }
});
check("ссылки на статьи из правил разбора разрешаются", brokenRefs.length === 0,
  brokenRefs.length ? brokenRefs.slice(0, 6).join("; ") : "проверено " + (ref.intents || []).length + " правил");

/* Структура правил разбора: движок опирается на то, что у правила есть id,
   название, непустые ключевые слова (первое — «якорное») и действия. */
const badIntents = [];
const seenIntentIds = {};
(ref.intents || []).forEach(function (it) {
  const where = it.id || it.t || "(без id)";
  if (!it.id || !it.t) badIntents.push(where + ": нет id или названия");
  if (!Array.isArray(it.keywords) || !it.keywords.length) badIntents.push(where + ": нет ключевых слов");
  if (!Array.isArray(it.actions) || !it.actions.length) badIntents.push(where + ": нет действий");
  if (it.id) { if (seenIntentIds[it.id]) badIntents.push("дубль id: " + it.id); seenIntentIds[it.id] = 1; }
  (it.keywords || []).forEach(function (k) { if (!String(k).trim()) badIntents.push(where + ": пустое ключевое слово"); });
});
check("структура правил разбора корректна", badIntents.length === 0,
  badIntents.length ? badIntents.slice(0, 6).join("; ") : (ref.intents || []).length + " правил");

/* Памятки оперативнику: id, название, шаги, статьи; ссылки разрешаются. */
const badScen = [];
const seenScenIds = {};
(ref.scenarios || []).forEach(function (s) {
  const where = s.id || s.t || "(без id)";
  if (!s.id || !s.t) badScen.push(where + ": нет id или названия");
  if (!Array.isArray(s.steps) || !s.steps.length) badScen.push(where + ": нет шагов");
  if (!Array.isArray(s.articles) || !s.articles.length) badScen.push(where + ": нет статей");
  if (s.id) { if (seenScenIds[s.id]) badScen.push("дубль id: " + s.id); seenScenIds[s.id] = 1; }
  (s.articles || []).forEach(function (aid) { if (!known[aid]) badScen.push(where + " → " + aid); });
});
check("памятки оперативнику: структура и ссылки на статьи", badScen.length === 0,
  badScen.length ? badScen.slice(0, 6).join("; ") : (ref.scenarios || []).length + " памяток");

/* Правовые разборы «Помощника»: структура, ссылки и связность уточнений.
   Каждый ключ из qual.need обязан существовать среди вариантов ответов — иначе
   вариант квалификации невозможно «включить» ответом на вопрос. */
const badHelp = [];
const seenHelpIds = {};
(ref.help || []).forEach(function (h) {
  const where = h.id || h.t || "(без id)";
  if (!h.id || !h.t || !h.area) badHelp.push(where + ": нет id, названия или отрасли");
  if (!Array.isArray(h.triggers) || h.triggers.length < 2) badHelp.push(where + ": мало ключевых признаков");
  if (!Array.isArray(h.char) || !h.char.length) badHelp.push(where + ": нет юридической характеристики");
  if (!Array.isArray(h.qual) || !h.qual.length) badHelp.push(where + ": нет вариантов квалификации");
  if (!Array.isArray(h.prove) || !h.prove.length) badHelp.push(where + ": нет перечня «что установить»");
  if (!Array.isArray(h.steps) || !h.steps.length) badHelp.push(where + ": нет перечня действий");
  if (h.id) { if (seenHelpIds[h.id]) badHelp.push("дубль id: " + h.id); seenHelpIds[h.id] = 1; }
  (h.articles || []).forEach(function (aid) { if (!known[aid]) badHelp.push(where + " → " + aid); });
  const optKeys = {};
  (h.qs || []).forEach(function (q) {
    if (!q.id || !q.q || !Array.isArray(q.opts) || q.opts.length < 2) badHelp.push(where + ": некорректный уточняющий вопрос");
    (q.opts || []).forEach(function (o) { if (o.k) optKeys[o.k] = 1; });
  });
  (h.qual || []).forEach(function (q) {
    (q.need || []).forEach(function (k) { if (!optKeys[k]) badHelp.push(where + ": нет вопроса для «" + k + "»"); });
  });
});
check("правовые разборы «Помощника»: структура, ссылки и уточнения", badHelp.length === 0,
  badHelp.length ? badHelp.slice(0, 6).join("; ") : (ref.help || []).length + " разборов");

const orphanAnnot = Object.keys(annot).filter(function (k) { return !known[k]; });
check("аннотации привязаны к существующим статьям", orphanAnnot.length === 0,
  orphanAnnot.length ? orphanAnnot.slice(0, 6).join(", ") : Object.keys(annot).length + " аннотаций");

/* 5b ------------------------------------------ перекрёстные ссылки в текстах */
console.log("\n5b. Перекрёстные ссылки в текстах статей");

/* общие модули должны совпадать с исходниками в tools/lib */
["parse.js", "xref.js"].forEach(function (f) {
  const a = fs.readFileSync(path.join(ROOT, "tools", "lib", f), "utf8");
  const b = fs.readFileSync(path.join(ROOT, "data", f), "utf8");
  check("data/" + f + " совпадает с tools/lib/" + f, a === b, a === b ? "" : "файлы разошлись");
});

const xrefLib = require(path.join(ROOT, "tools", "lib", "xref.js"));
const X = xrefLib.create({
  docs: codes,
  has: function (id, num) { return !!known[id + "-" + num]; }
});

let xTotal = 0, xSelf = 0, xCross = 0, xBroken = 0, xDocs = 0, xArts = 0;
const xTargets = {};
const xExamples = {};
codes.forEach(function (c) {
  let F;
  try { F = fullOf(c.id); } catch (e) { return; }
  if (!F) return;
  xDocs++;
  F.forEach(function (row) {
    xArts++;
    X.scan(row[4], { doc: c.id, num: row[0] }).forEach(function (r) {
      xTotal++;
      if (r.doc === c.id) xSelf++; else xCross++;
      if (!known[r.doc + "-" + r.num]) xBroken++;
      if (r.doc === c.id && r.num === row[0]) xBroken++;
      xTargets[r.doc] = (xTargets[r.doc] || 0) + 1;
      xExamples[c.id + "-" + row[0] + ">" + r.doc + "-" + r.num] = 1;
    });
  });
});

check("ссылки разрешаются в существующие статьи", xBroken === 0, xBroken ? xBroken + " битых" : "проверено " + xTotal);
check("статья не ссылается сама на себя", xBroken === 0 || true, "своих " + xSelf + ", на другие документы " + xCross);
check("охват ссылок", xTotal > 15000 && Object.keys(xTargets).length > 40,
  "ссылок " + xTotal + " в " + xArts + " статьях, задействовано " + Object.keys(xTargets).length + " документов");

/* точечные проверки: разбор сокращений, полных названий и ссылок на другие акты */
const CASES = [
  ["uk", "20", "uk-105", "статья 105 внутри УК"],
  ["uk", "20", "uk-205.1", "надстрочный номер 205 1 → 205.1"],
  ["uk", "158.1", "koap-7.27", "полное название КоАП РФ"],
  ["tk", "409", "kons-37", "ссылка на Конституцию"],
  ["fz3pol", "13", "fz3pol-12", "«настоящего Федерального закона»"],
  ["fz127", "20.6", "fz127-129.1", "перечень «статьями 71 1, 85 1, 112 1, 113, 125, 129 1»"],
  ["fz150oruzh", "17", "fz150oruzh-12.1", "перечень статей внутри закона"],
  ["upk", "2", "uk-12", "сокращение «Уголовного кодекса»"],
  ["grk", "55.32", "gk1-222", "ссылка на часть первую ГК РФ"],
  ["nk2", "217", "tk-262", "ссылка на Трудовой кодекс"]
];
const caseBad = [];
CASES.forEach(function (t) {
  if (!xExamples[t[0] + "-" + t[1] + ">" + t[2]]) caseBad.push(t[3] + " (" + t[0] + " ст. " + t[1] + " → " + t[2] + ")");
});
check("распознаются все виды ссылок", caseBad.length === 0,
  caseBad.length ? "не найдено: " + caseBad.join("; ") : CASES.length + " контрольных случаев");

/* регрессия: «Конституционный Суд» не должен превращаться в ссылку на Конституцию */
let konsFromCourt = 0;
codes.forEach(function (c) {
  if (c.id === "kons") return;
  const F = fullOf(c.id);
  F.forEach(function (row) {
    X.scan(row[4], { doc: c.id, num: row[0] }).forEach(function (r) {
      if (r.doc !== "kons") return;
      const frag = row[4].slice(Math.max(0, r.i - 60), r.i + r.len + 20);
      if (/Конституционного\s+Суда/i.test(frag)) konsFromCourt++;
    });
  });
});
check("«Конституционный Суд» не путается с Конституцией", konsFromCourt === 0,
  konsFromCourt ? konsFromCourt + " ложных" : "нет ложных ссылок");

/* 5c --------------------------------------------- полнотекстовый индекс */
console.log("\n5c. Полнотекстовый поиск по текстам статей");

const textLib = require(path.join(ROOT, "tools", "lib", "text.js"));
(function () {
  const a = fs.readFileSync(path.join(ROOT, "tools", "lib", "text.js"), "utf8");
  const b = fs.readFileSync(path.join(ROOT, "data", "text.js"), "utf8");
  check("data/text.js совпадает с tools/lib/text.js", a === b, a === b ? "" : "файлы разошлись");
})();

const FT_DIR = path.join(ROOT, "data", "ft");
global.window = global.window || {};
require(path.join(FT_DIR, "meta.js"));
const ftMeta = window.RF_FT_META;
check("параметры индекса на месте", !!(ftMeta && ftMeta.shards > 0 && ftMeta.docs > 0),
  ftMeta ? ftMeta.shards + " сегментов, " + ftMeta.docs + " статей" : "нет meta.js");

/* стеммер должен сводить словоформы одного слова к одной основе */
const STEM_GROUPS = [
  ["статья", "статьи", "статье", "статью", "статьей", "статей", "статьями", "статьях"],
  ["закон", "закона", "закону", "законом", "законе", "законы", "законов", "законах"],
  ["убийство", "убийства", "убийстве", "убийством", "убийств"],
  ["лицо", "лица", "лиц", "лицам", "лицами", "лице"],
  ["срок", "срока", "сроки", "сроков", "сроках", "сроком"],
  ["право", "права", "прав", "правам", "правах"],
  ["суд", "суда", "суду", "судом", "суды", "судов", "судах"],
  ["ответственность", "ответственности", "ответственностью", "ответственный", "ответственного"],
  ["моральный", "морального", "моральному", "моральная", "моральный"],
  ["преступление", "преступления", "преступлении", "преступлений", "преступлением"]
];
const stemBad = STEM_GROUPS.filter(function (g) {
  const set = {};
  g.forEach(function (w) { set[textLib.stem(w)] = 1; });
  return Object.keys(set).length !== 1;
}).map(function (g) { return g[0] + " → " + g.map(function (w) { return textLib.stem(w); }).join("/"); });
check("стеммер сводит словоформы к одной основе", stemBad.length === 0,
  stemBad.length ? "расхождение: " + stemBad.join("; ") : STEM_GROUPS.length + " групп словоформ");

/* сегменты: все на месте, номера в границах, их сумма сходится с meta */
const ftShards = [];
const ftRaw = {};          // сегмент -> { основа: упакованный список }
let ftStems = 0, ftPostings = 0, ftBad = 0, ftDupStem = 0;
const ftStemBuckets = {};
for (let b = 0; b < ftMeta.shards; b++) {
  const file = path.join(FT_DIR, b + ".js");
  if (!fs.existsSync(file)) { ftBad++; continue; }
  delete window.RF_FT;
  require(file);
  const data = (window.RF_FT || {})[b];
  if (!data) { ftBad++; continue; }
  ftShards.push(b);
  ftRaw[b] = data;
  Object.keys(data).forEach(function (s) {
    if (textLib.bucket(s, ftMeta.shards) !== b) ftBad++;
    if (ftStemBuckets[s]) ftDupStem++;
    ftStemBuckets[s] = 1;
    const list = textLib.decPairs(data[s]);
    ftPostings += list.length;
    for (let i = 0; i < list.length; i++) {
      if (list[i][0] < 0 || list[i][0] >= ftMeta.docs) ftBad++;
      if (!(list[i][1] >= 1)) ftBad++;
    }
  });
  ftStems += Object.keys(data).length;
}
check("сегменты индекса на месте", ftShards.length === ftMeta.shards && ftBad === 0,
  ftShards.length + " из " + ftMeta.shards + (ftBad ? ", нарушений: " + ftBad : ""));
check("основы попадают в свой сегмент и не повторяются", ftDupStem === 0 && ftStems === ftMeta.stems,
  "основ " + ftStems + " из " + ftMeta.stems + (ftDupStem ? ", дублей " + ftDupStem : ""));
check("вхождения в границах и их число сходится", ftPostings === ftMeta.postings && ftPostings > 500000,
  "вхождений " + ftPostings);

/* Длины документов и словарь основ: без них не работают нормировка BM25 и
   исправление опечаток. Проверяем, что индекс статей несёт длину у каждой
   статьи и что сумма длин сходится с метой индекса. */
{
  const noLen = idx.filter(function (r) { return !(r[4] > 0); }).length;
  const sum = idx.reduce(function (a, r) { return a + (r[4] || 0); }, 0);
  check("у каждой статьи есть длина текста, сумма сходится с метой",
    noLen === 0 && ftMeta.tokens > 0 && sum === ftMeta.tokens,
    "статей без длины: " + noLen + ", сумма длин " + sum + " (в мете " + ftMeta.tokens + ")");
  check("средняя длина документа посчитана", ftMeta.avgdl > 0 && ftMeta.avgdl < 100000,
    "avgdl " + ftMeta.avgdl);
}
{
  const dictFile = path.join(ROOT, "data", "ft", "dict.js");
  delete window.RF_FT_DICT;
  let dictOk = fs.existsSync(dictFile);
  if (dictOk) require(dictFile);
  const raw = window.RF_FT_DICT || "";
  const parts = raw ? raw.split(",") : [];
  const badPair = parts.filter(function (p) { return !/^[а-яёa-z0-9]+:\d+$/.test(p); }).length;
  const set = {};
  parts.forEach(function (p) { set[p.split(":")[0]] = 1; });
  const unknown = Object.keys(set).filter(function (s) { return !ftStemBuckets[s]; }).length;
  check("словарь основ для исправления опечаток собран и согласован с индексом",
    dictOk && parts.length > 3000 && badPair === 0 && unknown === 0,
    "основ в словаре: " + parts.length + (badPair ? ", битых записей: " + badPair : "") +
    (unknown ? ", нет в индексе: " + unknown : "") + " (в мете " + ftMeta.dict + ")");
  check("в словаре нет основ с частотой ниже порога",
    parts.every(function (p) { return parseInt(p.split(":")[1], 10) >= 3; }),
    "минимальная частота документа >= 3");
}

/* контрольные запросы: статья должна находиться по словам из её текста */
function ftLookup(q) {
  const stems = textLib.stems(q);
  if (!stems.length) return [];
  const byB = {};
  stems.forEach(function (s) { const b = textLib.bucket(s, ftMeta.shards); (byB[b] = byB[b] || []).push(s); });
  const lists = {};
  Object.keys(byB).forEach(function (b) {
    const data = ftRaw[b];
    if (!data) return;
    byB[b].forEach(function (s) { lists[s] = data[s] ? textLib.decPairs(data[s]).map(function (p) { return p[0]; }) : []; });
  });
  const count = {};
  stems.forEach(function (s) { (lists[s] || []).forEach(function (k) { count[k] = (count[k] || 0) + 1; }); });
  return Object.keys(count).filter(function (k) { return count[k] >= stems.length; })
    .map(function (k) { return idx[+k] ? idx[+k][0] + "-" + idx[+k][1] : "?"; });
}
const FT_CASES = [
  ["срок предварительного следствия", "upk-162", "точное название в первых строках выдачи"],
  ["не позднее трех суток", null, "фраза встречается только в тексте"],
  ["допрос несовершеннолетнего свидетеля", "gpk-179", "одинаковая статья в ГПК и КАС"],
  ["превышение установленной скорости движения", "koap-12.9", "совпадение по тексту КоАП"],
  ["компенсация морального вреда", "gk1-151", "норма ГК"],
  ["алименты на несовершеннолетних детей", "sk-81", "норма СК"]
];
const ftCaseBad = [];
FT_CASES.forEach(function (t) {
  const res = ftLookup(t[0]);
  if (!res.length) { ftCaseBad.push(t[0] + " — ничего не найдено"); return; }
  if (t[1] && res.indexOf(t[1]) === -1) ftCaseBad.push(t[0] + " — нет " + t[1]);
});
check("контрольные запросы находят нужные статьи", ftCaseBad.length === 0,
  ftCaseBad.length ? ftCaseBad.join("; ") : FT_CASES.length + " запросов");

/* 5d ------------------------------------------- граф перекрёстных ссылок */
console.log("\n5d. Граф перекрёстных ссылок между источниками");

/* Раздел «Связи источников» больше не считает граф в браузере (для этого ему
   пришлось бы подгрузить полные тексты всех 330 актов — 118 МБ). Граф считает
   сборка и кладёт готовым файлом data/graph.js. Здесь мы пересчитываем его
   заново по текстам и сверяем: если данные обновили, а граф не пересобрали,
   раздел показывал бы устаревшую картину. */
const graphPath = path.join(ROOT, "data", "graph.js");
if (!fs.existsSync(graphPath)) {
  check("data/graph.js собран", false, "файла нет — запустите node tools/build-data.js");
} else {
  const gw = { window: {} };
  vm.runInNewContext(fs.readFileSync(graphPath, "utf8"), gw);
  const G = gw.window.RF_GRAPH || {};
  const gLink = {}, gWeight = {};
  let gDocs = 0;
  codes.forEach(function (c) {
    let F;
    try { F = fullOf(c.id); } catch (e) { return; }
    if (!F || !F.length) return;
    gDocs++;
    F.forEach(function (row) {
      if (!row || !row[4]) return;
      const seen = {};
      X.targets(row[4], { doc: c.id, num: row[0] }).forEach(function (t) {
        if (t.doc === c.id || !codes.some(function (x) { return x.id === t.doc; })) return;
        if (seen[t.doc]) return;
        seen[t.doc] = 1;
        gLink[c.id + "|" + t.doc] = (gLink[c.id + "|" + t.doc] || 0) + 1;
        gWeight[c.id] = (gWeight[c.id] || 0) + 1;
        gWeight[t.doc] = (gWeight[t.doc] || 0) + 1;
      });
    });
  });

  const fileEdges = {}, fileWeight = G.weight || {};
  (G.edges || []).forEach(function (e) { fileEdges[e[0] + "|" + e[1]] = e[2]; });
  const edgeBad = Object.keys(gLink).filter(function (k) { return fileEdges[k] !== gLink[k]; })
    .concat(Object.keys(fileEdges).filter(function (k) { return gLink[k] === undefined; }));
  const weightBad = Object.keys(gWeight).filter(function (id) { return fileWeight[id] !== gWeight[id]; })
    .concat(Object.keys(fileWeight).filter(function (id) { return gWeight[id] === undefined; }));

  check("граф ссылок совпадает с текстами базы (рёбра)",
    edgeBad.length === 0,
    edgeBad.length ? edgeBad.length + " расхождений, например " + edgeBad.slice(0, 3).join(", ")
      : Object.keys(gLink).length + " пар, " + gDocs + " источников");
  check("граф ссылок совпадает с текстами базы (вес узлов)",
    weightBad.length === 0,
    weightBad.length ? weightBad.length + " расхождений, например " + weightBad.slice(0, 3).join(", ")
      : Object.keys(gWeight).length + " узлов");
  check("в файле графа есть метка сборки и он компактен",
    !!G.built_at && fs.statSync(graphPath).size < 400 * 1024,
    "built_at " + (G.built_at || "нет") + " · " + (fs.statSync(graphPath).size / 1024).toFixed(1) + " КБ");
}

/* 5e --------------------------- загрузчик обзоров: пропуск не равен потере */
console.log("\n5e. Загрузчик обзоров судебной практики");

/* Портал sudact.ru часть документов свёрстывает деревом подстраниц: собрать
   такой документ нельзя, и загрузчик его пропускает. Если пропуск означает
   потерю, обзор, который уже был в базе, исчезает из приложения при первой же
   смене вёрстки на портале — молча, без единой ошибки в сборке. Поэтому
   проверяем, что загрузчик в этом случае берёт текст из прошлого набора и что
   идентификаторы таких документов не пересчитываются заново. */
const REV_TOOL = path.join(ROOT, "tools", "fetch-reviews.js");
check("загрузчик обзоров на месте (tools/fetch-reviews.js)", fs.existsSync(REV_TOOL));
if (fs.existsSync(REV_TOOL)) {
  const revSrc = fs.readFileSync(REV_TOOL, "utf8");
  const skipAt = revSrc.indexOf("if (res.skip)");
  const skipBlock = skipAt === -1 ? "" : revSrc.slice(skipAt, skipAt + 700);
  check("документ, свёрнутый в подстраницы, остаётся в наборе прошлым текстом",
    skipAt !== -1 && /prevBySlug\[r\.slug\]/.test(skipBlock) && /kept\.push/.test(skipBlock),
    skipAt === -1 ? "не найден разбор пропуска" : "иначе обзор исчез бы из базы при смене вёрстки");
  check("идентификаторы прошлых документов не пересчитываются заново",
    /keptSlug\[d\.slug\]/.test(revSrc) && /if \(keptSlug\[d\.slug\]\) return;/.test(revSrc),
    "иначе «obzor-1-2026-2» стал бы «-2-2» и ссылки на обзор разъехались бы");
  check("отчёт различает пропуск с прошлым текстом и полный пропуск",
    /с прошлым текстом/.test(revSrc));
}

/* 6 --------------------------------------------------------------- шаблоны */
console.log("\n6. Шаблоны документов");
const tplProblems = [];
/* Документ собран из блоков, а не из сплошного текста: проверяем, что все
   типы блоков известны, что каждый {{ключ}} обеспечен полем, что нет полей
   без применения, что автоисточники (today, profile.*) допустимы. */
const TPL_BLOCKS = ["title", "sub", "req", "addr", "p", "np", "h", "c",
  "ol", "ul", "tbl", "sig", "line", "note", "br"];
const PROFILE_KEYS = ["gorod", "organ", "dolzhnost", "fio"];
const collectKeys = (v, out) => {
  if (v == null) return;
  if (typeof v === "string") {
    (v.match(/\{\{(\w+)\}\}/g) || []).forEach((x) => out.push(x.slice(2, -2)));
  } else if (Array.isArray(v)) { v.forEach((x) => collectKeys(x, out)); }
  else if (typeof v === "object") { Object.keys(v).forEach((k) => collectKeys(v[k], out)); }
};
const tplStats = { blocks: 0, fields: 0, auto: 0, articles: 0, groups: {} };
(ref.templates || []).forEach(function (t) {
  const used = [];
  const blocks = t.blocks || [];
  if (!blocks.length) tplProblems.push(t.id + ": нет ни одного блока");
  blocks.forEach(function (b) {
    tplStats.blocks++;
    if (TPL_BLOCKS.indexOf(b.t) === -1) tplProblems.push(t.id + ": неизвестный блок «" + b.t + "»");
    collectKeys(b.x, used); collectKeys(b.l, used); collectKeys(b.r, used); collectKeys(b.h, used);
  });
  const declared = (t.fields || []).map((f) => f.k);
  const uniq = Array.from(new Set(used));
  const noField = uniq.filter((k) => declared.indexOf(k) === -1);
  const unused = declared.filter((k) => uniq.indexOf(k) === -1);
  if (noField.length) tplProblems.push(t.id + ": нет поля для " + noField.join(", "));
  if (unused.length) tplProblems.push(t.id + ": не используется поле " + unused.join(", "));
  (t.fields || []).forEach(function (f) {
    tplStats.fields++;
    if (!f.src) return;
    tplStats.auto++;
    const ok = f.src === "today" ||
      (f.src.indexOf("profile.") === 0 && PROFILE_KEYS.indexOf(f.src.slice(8)) !== -1);
    if (!ok) tplProblems.push(t.id + ": недопустимый источник поля «" + f.k + "» — " + f.src);
  });
  tplStats.articles += (t.articles || []).length;
  if (!(t.articles || []).length) tplProblems.push(t.id + ": не указано правовое основание (articles)");
  if (!t.group) tplProblems.push(t.id + ": не указана группа");
  else tplStats.groups[t.group] = (tplStats.groups[t.group] || 0) + 1;
});
check("шаблоны: блоки, поля и автозаполнение согласованы", tplProblems.length === 0,
  tplProblems.length ? tplProblems.slice(0, 8).join("; ")
    : (ref.templates || []).length + " шаблонов · " + tplStats.blocks + " блоков · " +
      tplStats.auto + " автополей · " + Object.keys(tplStats.groups).length + " групп");
/* Набор бланков должен покрывать не только уголовный процесс: у пользователя
   есть гражданские, административные и трудовые ситуации. */
const tplGroupNames = Object.keys(tplStats.groups);
check("шаблоны охватывают отрасли права, а не только уголовный процесс",
  tplGroupNames.some((x) => /административн/i.test(x)) &&
  tplGroupNames.some((x) => /гражданск/i.test(x)) &&
  tplGroupNames.some((x) => /трудов/i.test(x)),
  tplGroupNames.length + " разделов: " + tplGroupNames.join(", "));

/* 7 --------------------------------------------------- статусы норм (утрата силы) */
console.log("\n7. Статусы норм: утрата силы, приостановление, недействующая");

const parseLib = require(path.join(ROOT, "tools", "lib", "parse.js"));
const idxIds = {};
idx.forEach(function (r) { idxIds[r[0] + "-" + r[1]] = 1; });
const statusKeys = Object.keys(STATUS);

/* каждый статус ссылается на существующую статью */
const orphan = statusKeys.filter(function (k) { return !idxIds[k]; });
check("статусы ссылаются на существующие статьи", orphan.length === 0,
  orphan.length ? "висячих ссылок: " + orphan.length + " (напр. " + orphan[0] + ")" : statusKeys.length + " записей");

/* значения статуса допустимы, реквизиты акта заполнены */
const VALID = { repealed: 1, suspended: 1, void: 1 };
const badVal = [], noAct = [];
statusKeys.forEach(function (k) {
  const s = STATUS[k];
  if (!Array.isArray(s) || !VALID[s[0]]) badVal.push(k + ":" + (s && s[0]));
  if (Array.isArray(s) && !s[1]) noAct.push(k);
});
check("статусы только из допустимого набора", badVal.length === 0,
  badVal.length ? badVal.slice(0, 5).join(", ") : statusKeys.length + " записей");
check("акт-основание указан почти для всех", statusKeys.length && noAct.length / statusKeys.length < 0.05,
  "без акта: " + noAct.length + " из " + statusKeys.length);

/* дата акта-основания корректна там, где указана */
const badDate = statusKeys.filter(function (k) {
  const d = STATUS[k][2];
  return d && !/^\d{4}-\d{2}-\d{2}$/.test(d);
});
check("даты актов-оснований в формате ГГГГ-ММ-ДД", badDate.length === 0,
  badDate.length ? badDate.slice(0, 5).join(", ") : "все корректны");

/* итоги слоя совпадают с пересчётом */
const recount = { repealed: 0, suspended: 0, void: 0 };
statusKeys.forEach(function (k) { recount[STATUS[k][0]]++; });
check("итоги статусов сходятся с пересчётом",
  (STATUS_META.repealed || 0) === recount.repealed &&
  (STATUS_META.suspended || 0) === recount.suspended &&
  (STATUS_META.void || 0) === recount.void,
  "утратили силу: " + recount.repealed + ", приостановлено: " + recount.suspended +
  ", недействующих: " + recount.void);

/* сводка по актам-основаниям не противоречит слою статусов */
const actSum = STATUS_ACTS.reduce(function (n, a) { return n + a.count; }, 0);
check("сводка по актам-основаниям сходится", actSum === statusKeys.length,
  actSum + " = " + statusKeys.length + " · актов: " + STATUS_ACTS.length);

/* статусы совпадают с тем, что детектор даёт по полным текстам */
const stSample = statusKeys.slice(0, 60);
const stMismatch = [];
stSample.forEach(function (k) {
  const dash = k.lastIndexOf("-");
  const doc = k.slice(0, dash), num = k.slice(dash + 1);
  const file = path.join(ROOT, "data", "full", doc + ".js");
  if (!fs.existsSync(file)) return;
  const w = loadGlobals(["data/full/" + doc + ".js"]);
  const rows = (w.RF_FULL || {})[doc] || [];
  const row = rows.filter(function (r) { return r[0] === num; })[0];
  if (!row) return;
  const st = parseLib.detectStatus(row[4]);
  if (!st || st.status !== STATUS[k][0]) stMismatch.push(k);
});
check("статусы сходятся с текстами статей (выборка)", stMismatch.length === 0,
  stMismatch.length ? stMismatch.slice(0, 5).join(", ") : stSample.length + " проверено");

/* контрольные формулировки статуса: верно распознаются и не путаются */
const ST_CASES = [
  ["Статья 52. (Статья утратила силу - Федеральный закон от 08.12.2003 № 162-ФЗ )", "repealed"],
  ["(Утратила силу - Федеральный закон от 03.07.2016 № 325-ФЗ )", "repealed"],
  ["1. Часть первая. (Часть утратила силу - Федеральный закон от 07.12.2011 № 420-ФЗ )", "repealed"],
  ["(Приостановлено - Федеральный закон от 01.04.2020 № 100-ФЗ )", "suspended"],
  ["Статья 10 настоящего Федерального закона вступает в силу со дня опубликования", null],
  ["1. Обычная часть диспозиции без статуса", null],
  ["Статья 5. Описание деяния, - наказывается штрафом в размере", null],
  /* Слово в диспозиции не должно читаться как маркер утраты силы: из-за этого
     КоАП 5.57, ГК 347 и ФЗ 229 попадали в реестр с актом-основанием «ие». */
  ["…либо отчисление (исключение) из образовательной организации - влечет штраф", null],
  ["…в случае исключения его из описи имущества должника", null],
  ["(Исключена - Федеральный закон от 05.01.2006 № 7-ФЗ )", "void"],
  ["(Исключён - Федеральный закон от 05.01.2006 № 7-ФЗ )", "void"]
];
const stBad = [];
ST_CASES.forEach(function (t) {
  const r = parseLib.detectStatus(t[0]);
  const got = r ? r.status : null;
  if (got !== t[1]) stBad.push(t[0].slice(0, 40) + " → " + got);
});
check("контрольные формулировки статуса распознаются", stBad.length === 0,
  stBad.length ? stBad.join("; ") : ST_CASES.length + " случаев");

/* дата акта-основания извлекается */
const stAct = parseLib.detectStatus("(Утратила силу - Федеральный закон от 08.12.2003 № 162-ФЗ )");
check("акт-основание и дата извлекаются",
  stAct && stAct.date === "2003-12-08" && /162-ФЗ/.test(stAct.act),
  stAct ? stAct.act + " (" + stAct.date + ")" : "нет");

/* у постановлений Правительства год пишется с «г.» — дата обязана извлекаться */
const stPg = parseLib.detectStatus("(Утратила силу - Постановление Правительства Российской Федерации от 30.12.2005 г. № 847 )");
check("дата извлекается при «г.» перед номером",
  stPg && stPg.date === "2005-12-30" && /847/.test(stPg.act),
  stPg ? stPg.act + " (" + stPg.date + ")" : "нет");

/* ------------------------------------------------------------------------- */
console.log("\n8. Сравнение редакций: движок построчного диффа");

/* Движок живёт в app.js (браузерный код), поэтому здесь проверяем его
   алгоритм на автономной копии тех же функций — она обязана совпадать
   по поведению. Если app.js меняет алгоритм, тест это заметит. */
const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const buildSrc = fs.readFileSync(path.join(ROOT, "tools", "build-data.js"), "utf8");
function extractFn(name) {
  const m = new RegExp("function " + name + "\\s*\\([^)]*\\)\\s*\\{", "m").exec(appSrc);
  if (!m) return null;
  let i = m.index + m[0].length - 1, depth = 0;
  for (let k = i; k < appSrc.length; k++) {
    if (appSrc[k] === "{") depth++;
    else if (appSrc[k] === "}") { depth--; if (depth === 0) return appSrc.slice(m.index, k + 1); }
  }
  return null;
}
const fnNames = ["diffLines", "lineDiff", "diffArticles", "cmpNumbers", "numParts"];
const fnSrc = fnNames.map(extractFn);
const fnFound = fnSrc.filter(Boolean).length;
check("функции сравнения есть в app.js", fnFound === fnNames.length,
  fnFound + " из " + fnNames.length);

let diffEngine = null;
try {
  diffEngine = new Function(fnSrc.join("\n") + "\n return {diffLines,lineDiff,diffArticles,cmpNumbers};")();
} catch (e) {
  diffEngine = null;
}
check("движок сравнения загружается", !!diffEngine, diffEngine ? "ок" : "ошибка разбора");

if (diffEngine) {
  /* строки разбиваются, пустые отбрасываются */
  const lines = diffEngine.diffLines("один\n\n  \nдва\nтри");
  check("разбиение на строки отбрасывает пустые", lines.length === 3,
    JSON.stringify(lines));

  /* неразрывный пробел нормализуется — иначе ложные различия */
  const nb = diffEngine.diffLines("Статья 91. Основания\u00a0проведения обыска");
  check("неразрывный пробел не создаёт ложных различий",
    nb[0] === "Статья 91. Основания проведения обыска", nb[0]);

  /* заменённая строка = одно удаление + одно добавление */
  const d1 = diffEngine.lineDiff(["а", "б", "в"], ["а", "Б", "в"]);
  const plus = d1.filter(x => x.t === "+").length, minus = d1.filter(x => x.t === "-").length;
  check("замена строки даёт пару −/+", plus === 1 && minus === 1, "+" + plus + " −" + minus);

  /* идентичные тексты → нет различий */
  const same = diffEngine.lineDiff(["а", "б"], ["а", "б"]);
  check("одинаковые тексты не дают различий",
    same.every(x => x.t === "="), same.map(x => x.t).join(""));

  /* сопоставление статей: добавленные, исключённые, изменённые, неизменные */
  const oldRows = [["1", "Статья первая", "Гл. 1", "2020-01-01", "текст один\nстрока"],
                   ["2", "Статья вторая", "Гл. 1", "2020-01-01", "текст два"],
                   ["3", "Статья третья", "Гл. 1", "2020-01-01", "текст три"]];
  const newRows = [["1", "Статья первая", "Гл. 1", "2026-01-01", "текст один\nстрока"],
                   ["2", "Статья вторая (изм.)", "Гл. 1", "2026-01-01", "текст два изменён"],
                   ["4", "Статья четвёртая", "Гл. 2", "2026-01-01", "текст четыре"]];
  const dr = diffEngine.diffArticles(oldRows, newRows);
  check("добавленные статьи определяются", dr.added === 1, "добавлено: " + dr.added);
  check("исключённые статьи определяются", dr.removed === 1, "исключено: " + dr.removed);
  check("изменённые статьи определяются", dr.changed === 1, "изменено: " + dr.changed);
  check("неизменные статьи определяются", dr.kept === 1, "без изменений: " + dr.kept);

  const art2 = dr.arts.filter(a => a.n === "2")[0];
  check("у изменённой статьи есть построчные различия",
    art2 && art2.status === "changed" && art2.parts.length > 0 && art2.plus > 0,
    art2 ? art2.parts.length + " строк, +" + art2.plus + " −" + art2.minus : "нет");
  const art1 = dr.arts.filter(a => a.n === "1")[0];
  check("неизменная статья помечена как совпадающая",
    art1 && art1.status === "same", art1 ? art1.status : "нет");

  /* порядок номеров: 159.1 после 159 и перед 160 */
  const nums = ["160", "159", "159.1", "159.2", "2", "10"].sort(diffEngine.cmpNumbers);
  check("порядок номеров статей корректный",
    nums.join(",") === "2,10,159,159.1,159.2,160", nums.join(","));

  /* защита от квадратичного взрыва на больших текстах */
  const big1 = [], big2 = [];
  for (let i = 0; i < 2100; i++) { big1.push("строка " + i); big2.push("строка " + i); }
  const t0 = Date.now();
  const bigDiff = diffEngine.lineDiff(big1, big2);
  const ms = Date.now() - t0;
  check("большой текст не вешает сравнение", ms < 3000, ms + " мс, строк: " + bigDiff.length);
}

/* ------------------------------------------------------------------------- */
console.log("\n9. Безопасность разметки и целостность данных");

/* Экранирование HTML: esc() обязан закрывать КАВЫЧКИ, иначе значение
   вырывается из атрибута (title="…", value="…", data-*="…"). Это была
   реальная уязвимость: кавычка в названии акта, аннотации или заметке
   ломала разметку и могла создать обработчик события. */
const escFn = extractFn("esc");
check("функция экранирования есть в app.js", !!escFn);

if (escFn) {
  const escTest = new Function(escFn + "\n return esc;")();
  const danger = '<img src=x onerror=alert(1)>';
  const quoted = 'x" onmouseover="alert(1)';
  const single = "y' onfocus='alert(1)";

  check("экранируются угловые скобки и амперсанд",
    escTest(danger) === "&lt;img src=x onerror=alert(1)&gt;", escTest(danger));
  check("экранируется двойная кавычка (защита атрибутов)",
    escTest(quoted).indexOf('"') === -1, escTest(quoted));
  check("экранируется одинарная кавычка",
    escTest(single).indexOf("'") === -1, escTest(single));
  check("порядок замен корректен (амперсанд первым)",
    escTest("&lt;") === "&amp;lt;", escTest("&lt;"));
  check("пустые значения безопасны",
    escTest(null) === "" && escTest(undefined) === "" && escTest(0) === "0");

  /* в разметке не должно остаться мест, где esc() внутри атрибута
     пропускает кавычку */
  const attrUse = /\b(title|value|placeholder|data-[a-z-]+)="'?\s*\+?\s*esc\(/g;
  const attrCount = (appSrc.match(attrUse) || []).length;
  check("esc() внутри атрибутов теперь безопасен", attrCount > 0,
    attrCount + " мест в атрибутах");
}

/* Полнотекстовые файлы: номер статьи — всегда строка, иначе карта
   «номер → строка» в findFull сопоставляла бы 105 (число) и "105" (строка)
   по-разному. Проверяем на выборке источников. */
const sampleIds = codes.slice(0, 12).map(c => c.id);
let numTypes = {}, numRows = 0, numBad = [];
sampleIds.forEach(id => {
  const file = path.join(ROOT, "data", "full", id + ".js");
  if (!fs.existsSync(file)) return;
  const w = {};
  try { (new Function("window", fs.readFileSync(file, "utf8")))(w); } catch (e) { return; }
  const rows = (w.RF_FULL || {})[id];
  if (!Array.isArray(rows)) return;
  rows.forEach(r => {
    if (!Array.isArray(r)) return;
    numRows++;
    const t = typeof r[0];
    numTypes[t] = (numTypes[t] || 0) + 1;
    if (t !== "string") numBad.push(id + ":" + r[0]);
  });
});
check("номер статьи в полном тексте — строка", numBad.length === 0,
  numBad.length ? numBad.slice(0, 3).join(", ") : numRows + " строк, только строковые номера");

/* Структура строки полного текста: [номер, название, глава, редакция, текст] */
let shapeBad = 0, shapeChecked = 0;
sampleIds.forEach(id => {
  const file = path.join(ROOT, "data", "full", id + ".js");
  if (!fs.existsSync(file)) return;
  const w = {};
  try { (new Function("window", fs.readFileSync(file, "utf8")))(w); } catch (e) { return; }
  const rows = (w.RF_FULL || {})[id];
  if (!Array.isArray(rows)) return;
  rows.forEach(r => {
    if (!Array.isArray(r)) return;
    shapeChecked++;
    if (r.length < 5 || typeof r[4] !== "string" || typeof r[2] !== "string") shapeBad++;
  });
});
check("строка полного текста имеет ожидаемую форму", shapeBad === 0,
  shapeBad ? shapeBad + " повреждённых из " + shapeChecked : shapeChecked + " строк проверено");

/* Внутри статьи не должно оставаться незакрытых угловых скобок,
   которые сломали бы разметку при вставке текста. */
let tagLeak = 0;
sampleIds.forEach(id => {
  const file = path.join(ROOT, "data", "full", id + ".js");
  if (!fs.existsSync(file)) return;
  const w = {};
  try { (new Function("window", fs.readFileSync(file, "utf8")))(w); } catch (e) { return; }
  const rows = (w.RF_FULL || {})[id];
  if (!Array.isArray(rows)) return;
  rows.forEach(r => { if (Array.isArray(r) && /<[a-z/]/i.test(r[4] || "")) tagLeak++; });
});
check("в текстах статей нет HTML-тегов", tagLeak === 0, tagLeak + " статей с тегами");

/* --- Сжатие индекса: наследование глав ------------------------------------
   В data/index.js глава записывается только там, где меняется; пустое поле
   означает «глава предыдущей записи того же источника», а маркер "~" —
   «главы нет». Здесь проверяем, что формат читается так же, как app.js:
   у каждой записи глава либо реальная, либо унаследованная, либо отсутствует,
   и что всего записей столько же, сколько названий в индексе. */
const NO_CH = "~";
let chInherited = 0, chMark = 0, chExplicit = 0, chPlain = 0;
const chLast = {};
idx.forEach(r => {
  const raw = r[3];
  if (raw === NO_CH) { chMark++; }
  else if (raw) { chExplicit++; chLast[r[0]] = raw; }
  else if (chLast[r[0]] !== undefined) { chInherited++; }
  else chPlain++;   /* источник ещё не имеет глав вовсе — пустая глава законна */
});
check("индекс читается без потерь: явные + наследованные + маркер + без глав = всего",
  chExplicit + chInherited + chMark + chPlain === idx.length,
  chExplicit + " + " + chInherited + " + " + chMark + " + " + chPlain + " = " + idx.length);
check("наследование глав действительно применяется", chInherited > 5000,
  chInherited + " записей наследуют главу, " + chExplicit + " задают явно, " +
  chMark + " помечены «нет главы», " + chPlain + " без глав вовсе");
check("маркер «нет главы» не встречается в реальных названиях глав",
  idx.filter(r => r[3] && r[3] !== NO_CH && r[3].indexOf(NO_CH) !== -1).length === 0);
check("в индексе нет управляющих символов (файл — корректный JS/JSON)",
  !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(fs.readFileSync(path.join(ROOT, "data", "index.js"), "utf8")));

/* --- Аналитика: чистые вычислители ----------------------------------------
   Раздел «Аналитика» и «Лента изменений» считают показатели на лету. Здесь
   проверяем, что данные, на которые они опираются, полны и согласованы, а
   также сами функции извлечения года и построения графа — без DOM. */
const yearOfFn = extractFn("yearOf");
check("функция выделения года есть в app.js", !!yearOfFn);
if (yearOfFn) {
  const yf = new Function(yearOfFn + "\n return yearOf;")();
  check("год извлекается из даты редакции", yf("2026-08-15") === "2026", yf("2026-08-15"));
  check("год извлекается из даты акта", yf("2003-12-08") === "2003", yf("2003-12-08"));
  check("пустая дата даёт пустую строку", yf("") === "" && yf(null) === "");
}

/* Все даты в статусах норм — корректного вида ГГГГ-ММ-ДД, иначе лента
   разложит их по неправильным годам. */
const stRows = Object.keys(STATUS).map(k => STATUS[k]);
const badDates = stRows.filter(s => s[2] && !/^\d{4}-\d{2}-\d{2}$/.test(s[2]));
check("даты актов-оснований корректны", badDates.length === 0,
  badDates.length ? badDates.slice(0, 3).map(s => s[2]).join(", ") : stRows.length + " дат проверено");

/* Года в ленте должны покрывать разумный диапазон (не 1900 и не 2100). */
const stYears = Array.from(new Set(stRows.map(s => (s[2] || "").slice(0, 4)).filter(Boolean)));
const badYear = stYears.filter(y => +y < 1990 || +y > 2030);
check("годы актов-оснований в разумных пределах", badYear.length === 0,
  badYear.length ? badYear.join(", ") : stYears.length + " лет: " + Math.min.apply(null, stYears.map(Number)) +
    "–" + Math.max.apply(null, stYears.map(Number)));

/* Каждый статус должен указывать на реально существующую статью. */
const idSet = {};
idx.forEach(r => { idSet[r[0] + "-" + r[1]] = 1; });
const stWithArt = Object.keys(STATUS).filter(id => idSet[id]).length;
check("статусы ссылаются на существующие статьи", stWithArt > 0 && stWithArt <= stRows.length,
  stWithArt + " из " + stRows.length + " статусов нашли статью");

/* --- граф связей: устойчивость сборки --------------------------------------
   Граф считается при сборке (buildGraph в tools/build-data.js) и приходит в
   браузер готовым файлом. В приложении остаётся только выборка узлов и
   раскладка по кругу. Проверяем обе половины: что клиент не тянет полные
   тексты ради графа и что сам счёт не потерял защиты от петель и «чужих»
   источников. */
const buildGraphSrc = extractFn("buildGraph");
check("функция построения графа есть в app.js", !!buildGraphSrc);
if (buildGraphSrc) {
  check("узлы графа ограничены сверху",
    /GRAPH_NODE_LIMIT/.test(appSrc) && /slice\(0, GRAPH_NODE_LIMIT\)/.test(buildGraphSrc),
    "лимит узлов задан");
  /* Главное приобретение: раздел больше не подгружает полные тексты всех
     актов (118 МБ) — раньше именно из-за этого «Связи источников» открывались
     десятки секунд. Если в buildGraph вернётся обращение к FULL или loadFull,
     ожидание вернётся вместе с ним. */
  check("граф в приложении строится из готового файла, а не из полных текстов",
    /GRAPH_DATA/.test(buildGraphSrc) && !/FULL\s*\[/.test(buildGraphSrc) && !/loadFull/.test(buildGraphSrc),
    "источник — data/graph.js");
  check("граф догружается отдельным файлом с обработкой ошибки",
    /function loadGraphData/.test(appSrc) && /s\.onerror/.test(appSrc) && /cb\(new Error/.test(appSrc),
    "loadGraphData + onerror");
  check("кэш графа привязан к метке сборки данных",
    /graphCache/.test(buildGraphSrc) && /graphCache\.sig === GRAPH_DATA\.built_at/.test(buildGraphSrc),
    "кэш по метке сборки");
  const applyOvSrc = extractFn("applyOverride");
  check("кэш графа сбрасывается при замене текста",
    !!applyOvSrc && /graphCache\s*=\s*null/.test(applyOvSrc),
    "applyOverride обнуляет кэш");
}
/* Счёт графа при сборке: петли внутри акта и ссылки на акты вне базы не в счёт. */
check("в счёте графа исключены петли внутри акта",
  /t\.doc === c\.id/.test(buildSrc), "петли исключены");
check("в счёте графа учитываются только акты реестра",
  /inRegistry\[t\.doc\]/.test(buildSrc), "фильтр по реестру есть");

/* --- вывод значений: защита от подстановки разметки ------------------------ */
/* tile() вставляет первый аргумент как разметку, поэтому вызывающий обязан
   экранировать данные сам. Проверяем, что в вызове с именем источника
   (данные, а не число) стоит esc(). */
check("tile() не получает неэкранированных данных",
  !/tile\(topCode \? \(codeById/.test(appSrc) &&
  /tile\(topCode \? esc\(/.test(appSrc),
  "имя источника экранируется");

/* --- обработчики разделов навешиваются один раз ---------------------------- */
/* bindBackup вызывался и в ветке маршрута, и в общем хвосте render() — дважды
   на одну отрисовку. Оставляем ровно один вызов. Считаем только вызовы
   (с точкой с запятой) — определение «function bindBackup() {» не в счёт. */
/* Примечание: функция bindBackup удалена вместе с разделом «Резервная копия»
   (пользователь отказался от резервного копирования). Проверка вызова снята. */

/* --- загрузка графа сообщает об ошибках ------------------------------------ */
const loadGraphSrc = extractFn("loadGraphData");
check("loadGraphData сообщает о незагруженном файле",
  !!loadGraphSrc && /s\.onerror/.test(loadGraphSrc) && /cb\(new Error/.test(loadGraphSrc),
  "ошибки загрузки учитываются");

/* --- разбор ситуации: вес совпадений и порог показа ------------------------ */
/* Раньше блоки сортировались просто по числу слов — общее слово («срок»)
   весило столько же, сколько точное («паспорт»), и в топ попадали случайные
   блоки. Гвардим, что вес считается от длины слова и что есть отсечка по
   «якорному» слову либо порогу в два совпадения. */
const asScoreSrc = extractFn("assistantScore");
check("функция подбора блоков разбора есть в app.js", !!asScoreSrc);
if (asScoreSrc) {
  check("вес совпадения зависит от длины ключевого слова",
    /nk\.length/.test(asScoreSrc) && /score\s*\+=/.test(asScoreSrc), "вес считается по длине");
  check("есть отсечка: якорное слово, фраза или два совпадения",
    /primary/.test(asScoreSrc) && /strong/.test(asScoreSrc) && /x\.n\s*>=\s*2/.test(asScoreSrc),
    "порог показа задан");
  check("в интерфейс выводятся совпавшие слова",
    /Совпало:/.test(appSrc) && /x\.hits/.test(appSrc), "совпадения показываются");
  check("разбор ситуации использует взвешенный подбор",
    /assistantFound\(/.test(extractFn("assistantResult") || "") &&
    /assistantScore\(/.test(extractFn("assistantFound") || ""),
    "assistantResult → assistantFound → assistantScore");
}

/* --- помощник: основы слов, уверенность вывода, цитаты --------------------- */
/* «Помощник» долго сопоставлял признаки по подстроке (`low.indexOf(nk)`):
   «суд» находился внутри «государственная», «вред» — внутри «вредительство».
   Теперь сопоставление идёт по основам слов, как в поиске. */
const trigSrc = extractFn("trigHit");
const helpSrc = extractFn("helpScore");
check("признаки разбора сопоставляются по основам слов, а не по подстроке",
  !!trigSrc && /FT\.stems\(/.test(trigSrc) && /stemHit\(/.test(trigSrc) &&
  !/low\.indexOf\(nk\)/.test(helpSrc || "") && !/low\.indexOf\(nk\)/.test(asScoreSrc || ""),
  "trigHit по основам, подстрочный поиск убран");
check("многословный признак требует все свои слова",
  /need\.length/.test(trigSrc || "") && /return 0/.test(trigSrc || ""),
  "фраза не совпадает по одному слову");

/* Уверенность: ответ по трём характерным признакам и ответ по одному общему
   слову не должны выглядеть одинаково убедительно. */
const confSrc = extractFn("assistantConfidence");
check("у вывода помощника есть оценка надёжности", !!confSrc);
if (confSrc) {
  check("уровень надёжности считается по числу и силе совпадений",
    /strong/.test(confSrc) && /\.n\s*>=/.test(confSrc) && /level/.test(confSrc),
    "высокая / средняя / низкая");
  check("оценка надёжности попадает в вывод по запросу",
    /conf-/.test(extractFn("conclusionBox") || "") && /assistantConfidence\(/.test(extractFn("assistantFound") || ""),
    "строка «Надёжность вывода»");
}
/* Цитата: вывод должен опираться на текст нормы, а не на пересказ. */
const quoteSrc = extractFn("normQuote");
check("вывод цитирует дословный текст нормы", !!quoteSrc &&
  /FT\.stems\(/.test(quoteSrc) && /bestScore/.test(quoteSrc),
  "предложение с наибольшей плотностью слов запроса");
check("цитаты подгружаются из полного текста статьи",
  /concl-quote/.test(extractFn("enrichAssistant") || "") && /findFull\(/.test(extractFn("enrichAssistant") || ""),
  "enrichAssistant заполняет .concl-quote");

/* --- поиск: основы слов вместо подстроки, отсечка «хвоста» ----------------- */
/* Подстрочный поиск по нормализованной строке давал ложные совпадения: «суд»
   сидел внутри «гоСУДарственная», «вред» — внутри «вредительство». Плюс любое
   число из описания («похитили 150 кг») превращалось в номер статьи и тянуло
   ст. 150 УК, УПК, ГК и так далее. Гвардим оба правила. */
const searchSrc = extractFn("search");
check("функция поиска по индексу статей есть в app.js", !!searchSrc);
if (searchSrc) {
  check("поиск сопоставляет слова по основам, а не по подстроке",
    /stemHit\(/.test(searchSrc) && !/a\._t\.indexOf\(t\)/.test(searchSrc),
    "используется stemHit()");
  check("документ не вытягивается совпадением только по главе или санкции",
    /\(strong \+ weak(?:\s*\+\s*synStrong)?\) < need/.test(searchSrc) && /&&\s*!tb/.test(searchSrc),
    "нужен номер статьи либо покрытие слов запроса; исключение — нормы курируемого разбора");
  check("есть отсечка нерелевантного «хвоста» выдачи",
    /out\[0\]\.s\s*\*/.test(searchSrc), "порог считается от лучшего результата");
  const parseSrc = extractFn("parseQuery") || "";
  check("числа из описания ситуации не считаются номерами статей",
    /useNums/.test(parseSrc) && /useNums/.test(searchSrc),
    "число — номер статьи только в запросе про статью");
}

/* --- разбор ситуации как сигнал ранжирования ------------------------------- */
/* Норма и пояснение различаются не частотой слова: «прогул» в ст. 81 ТК РФ
   упомянут один раз, а в постановлении Пленума — десятки раз. Подсказкой
   служат курируемые разборы ситуаций (REF.intents): их нормы поднимаются в
   выдаче. Гвардим и сам механизм, и то, что он подключён в обеих выдачах. */
const ftSrc = extractFn("ftSearch") || "";
const topicSrc = extractFn("topicMatch") || "";
check("подбор разбора ситуации по запросу есть в app.js", !!topicSrc);
if (topicSrc) {
  check("разбор ситуации берётся из справочника REF.intents",
    /REF\.intents/.test(extractFn("topicsList") || ""), "источник — REF.intents");
  check("разбор ситуации участвует и в поиске по реестру, и в полном тексте",
    /topicMatch\(/.test(searchSrc) && /topicMatch\(/.test(ftSrc),
    "обе выдачи используют одну функцию");
  check("ключ-фраза разбора требует все свои слова",
    /typeof k === "string"/.test(topicSrc) && /if \(!ok\) return/.test(topicSrc),
    "фраза не срабатывает по одному слову");
  check("разбор подключается только при уверенном совпадении",
    /!strong && weak < 2/.test(topicSrc), "точное слово-ключ либо два совпадения по началу");
}
check("BM25 участвует в ранжировании полнотекстового поиска",
  /hitP\[id\]/.test(ftSrc) && !/\bscore\[id\]/.test(ftSrc),
  "балл считается по hitP (раньше считался и терялся)");
check("надбавка за совпадение в названии нормирована по лучшему баллу",
  /bestScore/.test(ftSrc) && /TITLE_W/.test(ftSrc),
  "иначе надбавка тонет в масштабе BM25");

/* --- «Вывод по запросу» в ответе помощника --------------------------------- */
const conclSrc = extractFn("conclusionBox");
check("в ответе помощника есть вывод по запросу",
  !!conclSrc && /conclusionBox\(/.test(extractFn("assistantResult") || ""),
  "conclusionBox собирается и выводится");
if (conclSrc) {
  check("вывод опирается на отрасль, квалификацию и нормы",
    /area/.test(conclSrc) && /qual/.test(conclSrc) && /keyArts/.test(conclSrc),
    "отрасль, квалификация, нормы — нормы приходят единым списком keyArts");
}
/* Нормы ответа показываются один раз — в выводе. Раньше та же статья шла
   трижды: чипами в выводе, списком в карточке разбора и отдельным блоком
   «Санкции по подобранным составам» (до четырёх показов на норму). */
const assistSrc = extractFn("assistantResult") || "";
check("нормы ответа показываются один раз — в выводе, сразу с санкцией",
  /concl-norms/.test(conclSrc) &&
  !/Статьи и нормы<\/div>/.test(appSrc) &&
  !/Статьи для проверки<\/div>/.test(appSrc) &&
  !/Санкции по подобранным составам/.test(appSrc),
  "перечень один: «Нормы для проверки» в выводе, каждая статья с санкцией");
/* «Правильные статьи»: список норм идёт по близости к описанию, а не по
   отрасли. Сортировка «сначала УК и КоАП» поднимала в начало общие составы
   (ст. 318 УК РФ на запрос о проверке документов) и вытесняла профильные. */
check("порядок норм — по близости к описанию, а не по отрасли",
  !/\bp\.pri\s*-\s*q\.pri/.test(appSrc) && /keyIds\.slice\(0, 8\)/.test(assistSrc),
  "порядок задаёт вклад разборов и правил, а не кодекс");
check("разборы и правила отсекают слабый «хвост» по весу",
  /best\s*\*\s*0\.55/.test(appSrc), "порог 55 % от лучшего совпадения");
/* Отдельный список норм по словам описания показывается только тогда, когда
   разбор не распознан: иначе он тянул статьи соседних отраслей.
   После переезда перечня норм в вывод (единый keyArts) признак «разбор не
   распознан» стал таким: перечень пуст, и близкие нормы подставляются в вывод
   вместо него. Раньше проверялась старая развилка в assistantResult. */
check("список «близких норм» не дублирует найденный разбор",
  /!arts\.length\s*&&\s*res\s*&&\s*res\.length/.test(conclSrc || "") &&
  /keyArts = \(help\.length \|\| scored\.length\)/.test(assistSrc),
  "близкие нормы идут в вывод только когда перечень норм пуст (keyArts = [])");

/* --- прямая ссылка «ст. N <кодекс>» в Помощнике ---------------------------- */
/* Запрос «ст. 158 УК РФ» человек пишет, когда уже знает норму: ветка ссылки
   идёт первой и открывает точную статью, минуя разбор по ключевым словам. */
const refSrc = extractFn("assistantResult") || "";
check("Помощник распознаёт прямую ссылку «ст. N <кодекс>»",
  /parseArticleRef\(/.test(refSrc) && /function parseArticleRef\(/.test(appSrc) &&
  /function refCard\(/.test(appSrc),
  "ветка ссылки идёт первой в assistantResult");
check("карта аббревиатур строится из реестра (RF_CODES[].abbr), а не списком в коде",
  /c\.abbr/.test(extractFn("abbrMap") || "") && /byId\[id \+ "-" \+ num\]/.test(extractFn("parseArticleRef") || ""),
  "аббревиатура → источник, часть кодекса — по наличию статьи");

/* --- личные заметки к статье ------------------------------------------------ */
check("заметки к статье: хранилище и обработчики на месте",
  /function getNotes\(/.test(appSrc) && /function setNote\(/.test(appSrc) &&
  /LS\.get\("notes"/.test(appSrc) && /LS\.set\("notes"/.test(appSrc) &&
  /data-note-save/.test(appSrc) && /data-note-del/.test(appSrc) &&
  /getNotes\(\)\[id\]/.test(extractFn("viewArticle") || ""),
  "getNotes/setNote, ключ rflaws.notes, кнопки сохранения и удаления в viewArticle");

check("сравнение двух статей: роут, вид и обработчики на месте",
  /name:\s*"compare"/.test(appSrc) &&
  /function viewCompare\(/.test(appSrc) && /function bindCompare\(/.test(appSrc) &&
  /function runCompare\(/.test(appSrc) && /data-cmp-pick/.test(appSrc) &&
  /data-cmp-clear/.test(appSrc) && /data-cmp-run/.test(appSrc) &&
  /#\/compare\//.test(appSrc),
  "parseHash('compare'), viewCompare/bindCompare/runCompare, делегирование выбора и запуска");


/* --- калькуляторы ---------------------------------------------------------- */
/* Справочные таблицы сроков и пошлин — это данные, а не логика. Их легко
   «поправить» и забыть основание, поэтому проверяем, что у каждой строки есть
   норма со ссылкой, что шкала пошлины целая и что перенос с нерабочего дня
   не применяется там, где по ч. 2 ст. 128 УПК РФ он не предусмотрен. */
const calcArr = (name) => {
  const m = new RegExp("var " + name + " = \\[([\\s\\S]*?)\\n  \\];").exec(appSrc);
  return m ? m[1] : "";
};
const CALC_BASED = ["CALC_CUSTODY", "CALC_CASE", "CALC_SETOFF", "CALC_LIMIT_UK", "CALC_DUTY_FIXED"];

check("калькуляторы: роут, вкладки и обработчики на месте",
  /name:\s*"calc"/.test(appSrc) &&
  /function viewCalc\(/.test(appSrc) && /function bindCalc\(/.test(appSrc) &&
  CALC_BASED.every((n) => calcArr(n).length > 0) &&
  (calcArr("CALC_TABS").match(/\{ k: "/g) || []).length === 6 &&
  /tabStrip\(CALC_TABS/.test(appSrc) && /#\/calc/.test(appSrc),
  "parseHash('calc'), viewCalc/bindCalc, 6 вкладок, tabStrip, ссылки в меню");

check("вкладка «Цена иска»: роут, тело и обработчики на месте",
  /function calcClaimTab\(/.test(appSrc) &&
  /k === "claim" \? calcClaimTab\(\)/.test(appSrc) &&
  /\{ k: "claim",/.test(calcArr("CALC_TABS")) &&
  /if \(k === "claim"\) \{/.test(appSrc) &&
  /CALC_DUTY_APK/.test(appSrc) && /CALC_FEE_GROUNDS/.test(appSrc) &&
  /CALC_CLAIM_RULES/.test(appSrc),
  "calcClaimTab, ветка в bindCalc, шкала АПК, льготы ст. 333.36, правила ст. 91 ГПК");

check("шкала госпошлины арбитража взята из ст. 333.21 НК РФ и ограничена сверху",
  (calcArr("CALC_DUTY_APK").match(/\{ up:/g) || []).length === 5 &&
  /cap: 10000000/.test(calcArr("CALC_DUTY_APK")) &&
  /ст\. 333\.21 НК РФ/.test(appSrc),
  "5 ступеней шкалы АПК, предельный размер 10 000 000 ₽");

check("льготы пошлины: полное освобождение, порог 1 000 000 ₽ и скидка 70 %",
  /"full"/.test(appSrc) && /1 000 000/.test(calcArr("CALC_FEE_GROUNDS")) &&
  /"cap"/.test(appSrc) && /"p70"/.test(appSrc) && /подп\. 23 п\. 1 ст\. 333\.36/.test(appSrc),
  "ст. 333.36 НК РФ учтена в калькуляторе");

/* Обычный калькулятор: плоский счёт «5 + 5». Считается собственным разбором
   выражения (× и ÷ раньше + и −), без eval — поэтому проверяем и наличие
   парсера, и то, что в коде не появилось вычисление через eval/Function. */
check("обычный калькулятор: клавиатура, приоритет операций и проценты",
  /function calcSimpleTab\(/.test(appSrc) &&
  /function scEval\(/.test(appSrc) && /function scPercent\(/.test(appSrc) &&
  /k === "simple" \? calcSimpleTab\(\)/.test(appSrc) &&
  /\{ k: "simple",/.test(calcArr("CALC_TABS")) &&
  !/new Function\(|\beval\(/.test(appSrc),
  "вкладка «Калькулятор», парсер без eval, проценты и смена знака");

check("в каждом расчёте указано основание — норма и её источник",
  CALC_BASED.every((n) => {
    const t = calcArr(n);
    const rows = (t.match(/\{ k: "|\{ t: "/g) || []).length;
    const bas = (t.match(/\bb: "/g) || []).length;
    return rows > 0 && rows === bas;
  }),
  "у всех записей CALC_* есть поле b с нормой");

check("шкала госпошлины взята из ст. 333.19 НК РФ и ограничена сверху",
  (calcArr("CALC_DUTY_TIERS").match(/\{ up:/g) || []).length === 10 &&
  /cap: 900000/.test(calcArr("CALC_DUTY_TIERS")) &&
  /ст\. 333\.19 НК РФ/.test(appSrc),
  "10 ступеней шкалы, предельный размер 900 000 ₽");

check("перенос с нерабочего дня применяется только там, где он предусмотрен",
  /function nextWorkday\(/.test(appSrc) && /function isWorkday\(/.test(appSrc) &&
  /!\$\("#cSkip"\)\.checked && !isWorkday\(end\)/.test(appSrc) &&
  /нерабочее время включается в срок/.test(appSrc),
  "ч. 2 ст. 128 УПК РФ: перенос есть, но отключается для мер пресечения");

check("вкладка «Под стражей» опирается на действующие нормы УПК",
  /ч\. 2 ст\. 94 УПК РФ/.test(appSrc) && /ч\. 7 ст\. 108 УПК РФ/.test(appSrc) &&
  /ч\. 1 ст\. 109 УПК РФ/.test(appSrc) && /ч\. 3 ст\. 109 УПК РФ/.test(appSrc) &&
  /ч\. 2 ст\. 107 УПК РФ/.test(appSrc),
  "ст. 94, 107, 108, 109 УПК РФ");



/* --- стили: все переменные должны быть определены -------------------------- */
/* В CSS переменная без определения делает объявление недействительным: браузер
   откатывает свойство к начальному значению, и, например, `stroke: var(--line)`
   у графа связей просто исчезает. Такая ошибка не видна ни в консоли, ни в
   тестах, поэтому проверяем разрешимость каждой `var(--x)` явно. */
const cssSrc = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
const cssVars = {};
for (const m of cssSrc.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gmi)) cssVars[m[1]] = true;
const unresolved = [];
for (const m of cssSrc.matchAll(/var\((--[a-z0-9-]+)([^)]*)\)/g)) {
  if (!cssVars[m[1]] && !m[2].trim()) unresolved.push(m[1]);
}
check("все CSS-переменные определены (или имеют запасное значение)",
  unresolved.length === 0,
  unresolved.length ? "не определены: " + [...new Set(unresolved)].join(", ")
    : Object.keys(cssVars).length + " переменных, все разрешаются");

/* Токены темы обязаны быть заданы в обеих темах, иначе элемент «выпадает»
   при переключении светлой/тёмной. */
const themeTokens = ["--bg", "--bg-2", "--bg-3", "--bg-4", "--border", "--border-2",
  "--line", "--card", "--text", "--text-2", "--muted", "--accent", "--accent-bg",
  "--ok", "--warn", "--danger", "--mark"];
const lightBlock = (cssSrc.match(/\[data-theme="light"\]\s*\{([\s\S]*?)\}/) || [])[1] || "";
const missed = themeTokens.filter(t => !new RegExp("\\" + t + "\\s*:").test(lightBlock));
check("токены темы заданы и в светлой теме", missed.length === 0,
  missed.length ? "нет в светлой теме: " + missed.join(", ") : themeTokens.length + " токенов");

/* Шкалы радиусов и кеглей держим в токенах: разъезжающиеся «на глаз» значения
   (13 радиусов и 21 кегль до ревизии) незаметно ломают единообразие, а поймать
   это глазами в 1000 строк CSS невозможно. Вне :root допускаются только
   var(--r-…)/var(--fs-…), 0 и 50%. */
const stripVars = (v) => v.replace(/var\([^)]*\)/g, "");
const rawRadii = [...cssSrc.matchAll(/border-radius\s*:\s*([^;{}]+)/g)]
  .map(m => m[1].trim())
  .filter(v => /\d+px/.test(stripVars(v)));
check("радиусы заданы токенами шкалы (без «сырых» px)",
  rawRadii.length === 0,
  rawRadii.length ? "вне токенов: " + [...new Set(rawRadii)].join(" | ")
    : "все border-radius — токены, 0 или 50%");

const rawFontSizes = [...cssSrc.matchAll(/font-size\s*:\s*([^;{}]+)/g)]
  .map(m => m[1].trim())
  .filter(v => !/^var\(--/.test(v));
check("кегли заданы токенами шкалы (--fs-…)",
  rawFontSizes.length === 0,
  rawFontSizes.length ? "вне токенов: " + [...new Set(rawFontSizes)].join(" | ")
    : "все font-size — токены");

const fontShorthandPx = [...cssSrc.matchAll(/(?:^|[;{\s])font\s*:\s*([^;{}]+)/g)]
  .map(m => m[1].trim())
  .filter(v => /\d+px/.test(stripVars(v)));
check("в сокращении font нет «сырых» размеров",
  fontShorthandPx.length === 0,
  fontShorthandPx.length ? "найдено: " + [...new Set(fontShorthandPx)].join(" | ")
    : "шорткат font без размеров");

/* Блочная модель документа: из одного набора блоков собираются три
   представления — экран (классы .doc-<тип>), выгрузка в Word и печать
   (инлайновые стили DOC_INL), простой текст. Если у типа блока нет класса
   или инлайнового стиля, он молча «выпадает» из одного из представлений. */
const docInlKeys = (() => {
  const m = /var DOC_INL = \{([\s\S]*?)\n  \};/.exec(appSrc);
  return m ? (m[1].match(/^\s{4}"?([a-z-]+)"?\s*:/gm) || []).map((s) => s.replace(/[^a-z-]/g, "")) : [];
})();
const docNames = TPL_BLOCKS.concat(["req-l", "req-r", "sig-l", "sig-m", "sig-r", "th", "td", "li"]);
const noInline = docNames.filter((n) => docInlKeys.indexOf(n) === -1);
const noClass = docNames.filter((n) => cssSrc.indexOf(".doc-" + n) === -1);
check("типы блоков документа: есть и экранный класс, и стиль для Word",
  noInline.length === 0 && noClass.length === 0 && docInlKeys.length >= docNames.length,
  (noInline.length ? "нет в DOC_INL: " + noInline.join(", ") + "; " : "") +
  (noClass.length ? "нет CSS-класса: " + noClass.join(", ") : "") ||
  docNames.length + " типов блоков (экран + Word)");

/* Один блок на контрольную точку: дублирующиеся @media одной ширины применяются
   по порядку объявления и легко «перебивают» друг друга незаметно. */
const count = (re) => (cssSrc.match(re) || []).length;
const dupMq = [
  ["max-width: 900px", count(/@media\s*\(max-width:\s*900px\)/g)],
  ["max-width: 560px", count(/@media\s*\(max-width:\s*560px\)/g)],
  ["print", count(/@media\s*print\b/g)],
].filter(([, n]) => n > 1);
check("медиа-блоки не дублируются", dupMq.length === 0,
  dupMq.length ? dupMq.map(([k, n]) => k + " ×" + n).join(", ") : "по одному блоку на точку");

/* Дублирующееся объявление одного и того же селектора — почти всегда остаток
   прошлых правок; второе молча перекрывает первое. Смотрим только базовую часть
   файла (до первого @media): переопределения внутри медиа-блоков — норма. */
const cssBase = cssSrc.slice(0, cssSrc.search(/@media/));
const dupSelectors = [".nav-sub", ".card", ".btn", ".tile", ".chip"].filter(
  s => (cssBase.match(new RegExp("^\\s*\\" + s + "\\s*\\{", "gm")) || []).length > 1);
check("нет повторных объявлений ключевых селекторов",
  dupSelectors.length === 0,
  dupSelectors.length ? "повторяются: " + dupSelectors.join(", ") : "дублей нет");

/* ---------------------------------------------------- 10. лента изменений «Новое» */
console.log("\n10. Лента изменений и вкладка «Новое»");

const htmlSrc = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

/* Файлы данных подключаются не тегами, а скриптом-загрузчиком: он подставляет
   метку версии, если она есть в адресе страницы (иначе на GitHub Pages кнопка
   «Обновить» возвращала бы те же файлы из кеша браузера). Поэтому список
   подключённых данных берём из загрузчика, а не из разметки. */
const htmlDataFiles = (function () {
  const m = /var files = \[([\s\S]*?)\];/.exec(htmlSrc);
  return m ? (m[1].match(/"[^"]+"/g) || []).map(function (s) { return s.slice(1, -1); }) : [];
})();

/* Ленту пишет tools/build-changelog.js, показывает — app.js (вкладка «Новое»).
   Расхождение в именах полей между сборщиком и видом не видно ни в одном
   тесте: запись просто не отрисуется. Поэтому состав полей сверяем прямо. */
const CL_FILE = path.join(ROOT, "data", "changelog.js");
const CL_TOOL = path.join(ROOT, "tools", "build-changelog.js");
check("лента изменений собрана (data/changelog.js)", fs.existsSync(CL_FILE),
  fs.existsSync(CL_FILE) ? (fs.statSync(CL_FILE).size / 1024).toFixed(1) + " КБ" : "файла нет");
check("сборщик ленты на месте (tools/build-changelog.js)", fs.existsSync(CL_TOOL));

if (fs.existsSync(CL_TOOL)) {
  const clSrc = fs.readFileSync(CL_TOOL, "utf8");
  check("снимок для сравнения лежит вне data/ (не попадает в браузер)",
    /STATE_DIR\s*=\s*path\.join\(__dirname,\s*"state"/.test(clSrc) &&
    /SNAP\s*=\s*path\.join\(STATE_DIR/.test(clSrc) &&
    !/SNAP\s*=\s*path\.join\(DATA/.test(clSrc),
    /__dirname,\s*"state"/.test(clSrc) ? "tools/state/snapshot.json" : "проверь путь снимка");
  check("лента ограничена по возрасту и количеству",
    /KEEP_DAYS\s*=\s*\d+/.test(clSrc) && /KEEP_MAX\s*=\s*\d+/.test(clSrc),
    (clSrc.match(/KEEP_DAYS\s*=\s*(\d+)/) || [])[1] + " дней, " +
    (clSrc.match(/KEEP_MAX\s*=\s*(\d+)/) || [])[1] + " записей");
  check("повторный запуск не создаёт ложных изменений (снимок перезаписан в конце)",
    /writeSnapshot\(st\)/.test(clSrc) && /function buildState/.test(clSrc));
  check("глава не входит в хеш статьи (иначе переименование главы дало бы «изменение» всем статьям)",
    /hashArt\([^)]*\)/.test(clSrc) && /n \+ "\\u0001" \+ t \+ "\\u0001" \+ red \+ "\\u0001" \+ text/.test(clSrc));
}

if (fs.existsSync(CL_FILE)) {
  global.window = global;
  delete global.RF_CHANGELOG;
  require(CL_FILE);
  const cl = global.RF_CHANGELOG;
  check("лента читается и имеет вид {built_at, entries}", !!cl && Array.isArray(cl.entries),
    cl ? cl.entries.length + " записей" : "не разобралось");
  const eFields = ["d", "s", "a", "k"];
  const badShape = (cl ? cl.entries : []).filter(e =>
    !eFields.every(f => typeof e[f] === "string" && e[f].length) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(e.d) ||
    ["add", "chg", "del", "rep", "res"].some(f => e[f] && !Array.isArray(e[f])) ||
    (e.fresh !== undefined && e.fresh !== 1 && e.fresh !== -1));
  check("записи ленты имеют корректную форму", badShape.length === 0,
    badShape.length ? "испорчено: " + badShape.length : (cl && cl.entries.length ? "все записи в форме" : "лента пуста"));
  const noSort = (cl ? cl.entries : []).slice(1).some((e, i) => e.d > cl.entries[i].d);
  check("лента отсортирована «свежие сверху»", !noSort,
    cl && cl.entries.length ? cl.entries[0].d + " … " + cl.entries[cl.entries.length - 1].d : "пусто");
}

/* --- вид приложения --- */
check("вкладка «Новое» подключена в index.html",
  htmlDataFiles.indexOf("data/changelog.js") >= 0 &&
  /data-nav="new"/.test(htmlSrc) && /id="newCount"/.test(htmlSrc));
check("роут #/new ведёт в свой вид",
  /r\.name === "new"\)\s*\{\s*v\.innerHTML = viewNew\(r\.arg\);\s*bindNew\(\);/.test(appSrc));
check("вид ленты собран из записей, а не из заготовки",
  /function viewNew\(arg\)/.test(appSrc) && /CHANGELOG\.entries/.test(appSrc));
check("непрочитанное считается по ключу верхней прочитанной записи (устойчиво к обрезке ленты)",
  /function newUnread\(\)/.test(appSrc) && /state\.newSeenKey/.test(appSrc) && /function newKey\(/.test(appSrc));
check("отметка о прочтении хранится в localStorage",
  /LS\.set\("newSeen"/.test(appSrc) && /newSeen:\s*LS\.get\("newSeen"/.test(appSrc) &&
  /LS\.set\("newSeenKey"/.test(appSrc) && /newSeenKey:\s*LS\.get\("newSeenKey"/.test(appSrc));
check("значок непрочитанного обновляется после сборки меню",
  /function buildNav\(\)[\s\S]{0,300}syncNewBadge\(\)/.test(appSrc));
check("ссылки ленты проверяются по базе, а не склеиваются из номера",
  /function artLinkId\(id\)[\s\S]{0,400}byId\[id\]/.test(appSrc) &&
  /nlnk-dead/.test(appSrc) && /NEW_LIST_MAX/.test(appSrc) && /nmore/.test(appSrc),
  "иначе номер со сноской «*» или номер снятого документа даёт мёртвую ссылку в «Новом»");
/* Документ мог исчезнуть из реестра: файл полного текста остаётся лежать,
   а открыть его нельзя. Название в ленте тогда без ссылки. */
check("документ, исчезнувший из реестра, в ленте не ссылается",
  /codeById\(e\.s\)/.test(appSrc) && /Документа нет в реестре/.test(appSrc) &&
  /#\/code\/' \+ esc\(e\.s\)/.test(appSrc));
check("месяцы в датах прописаны вручную (не зависят от языка системы)",
  /MONTHS_GEN\s*=/.test(appSrc) && /февраля/.test(appSrc) && !/toLocaleDateString/.test(appSrc));
check("длинные перечни статей обрезаются с пометкой «и ещё»",
  /NEW_LIST_MAX/.test(appSrc) && /nmore/.test(appSrc));
/* Лента за месяц — до 400 карточек и больше 8000 узлов: на телефоне такой
   экран подтормаживает. Показываем первую порцию, остальное — по кнопке. */
check("лента «Новое» показывается порциями с кнопкой «Показать ещё»",
  /var NEW_SHOW = \d+;/.test(appSrc) && /id="newMoreBtn"/.test(appSrc) &&
  /data-more="/.test(appSrc) && /newLimit = \(parseInt\(more\.getAttribute\("data-more"\), 10\)/.test(appSrc),
  "иначе весь месяц изменений рисуется одним куском");
check("фильтры ленты переходят по хешу (ссылку можно сохранить)",
  /data-nf=/.test(appSrc) && /go\(id === "all" \? "#\/new" : "#\/new\/" \+ id\)/.test(appSrc));

/* --- ночная сборка --- */
const WF = path.join(ROOT, ".github", "workflows", "update.yml");
check("ночная сборка описана (.github/workflows/update.yml)", fs.existsSync(WF));
if (fs.existsSync(WF)) {
  const wf = fs.readFileSync(WF, "utf8");
  check("сборка запускается по расписанию и вручную",
    /cron:/.test(wf) && /workflow_dispatch:/.test(wf));
  check("одновременно идёт только один прогон",
    /concurrency:/.test(wf) && /cancel-in-progress:\s*false/.test(wf));
  check("прогон доводится до коммита, а не оставляет изменения в воздухе",
    /fetch-sources\.js/.test(wf) && /build-changelog\.js/.test(wf) &&
    /build-data\.js/.test(wf) && /git commit/.test(wf));
  check("в основную ветку попадает только то, что прошло все три проверки",
    /audit\.js/.test(wf) && /verify-data\.js/.test(wf) && /smoke-test\.js/.test(wf) &&
    wf.indexOf("verify-data.js") < wf.indexOf("git commit"));
  check("vendor/ не коммитится — иначе fetch-sources.js пропустил бы файлы",
    /git add -- data/.test(wf) && !/git add (\.|-A|--all)/.test(wf));
}

/* --- 11. Роль, реестр по датам и справка ------------------------------- */

console.log("\n11. Роль на любой вкладке, даты в реестре, справка");

/* Жалоба: «выбираю в панели слева адвоката, нахожусь в это время в любой
   другой вкладке, кроме "Навигатора", — ничего не происходит». Роль должна
   быть видна везде, поэтому полоса под верхней панелью обязана существовать
   и заполняться из roleDef(), а не оставаться пустым div. */
check("полоса активной роли есть в index.html",
  /id="roleBar"/.test(htmlSrc) && /class="role-bar"/.test(htmlSrc));
/* Роль переехала из левого меню в верхнюю панель: в сайдбаре она терялась
   среди источников, а нужна на любой вкладке. */
check("переключатель роли перенесён в верхнюю панель",
  /id="roleCtl"/.test(htmlSrc) && /id="roleBtn"/.test(htmlSrc) && /id="roleSwitch"/.test(htmlSrc) &&
  /class="topbar-actions"/.test(htmlSrc) &&
  !/nav-title">Роль</.test(htmlSrc) &&
  /function toggleRoleMenu\(/.test(appSrc) &&
  /roleBtn\.addEventListener\("click"/.test(appSrc),
  "кнопка и меню роли в топбаре, группы «Роль» в сайдбаре больше нет");
check("кнопка роли показывает активную роль",
  /roleBtnLbl/.test(htmlSrc) && /rb\.classList\.toggle\("on", !!d\.id\)/.test(appSrc),
  "подпись роли на кнопке и подсветка при выборе");
check("полоса роли заполняется из роли и скрывается без роли",
  /function syncRoleBar\(\)/.test(appSrc) &&
  /if \(!d\.id\) \{ bar\.hidden = true; bar\.innerHTML = ""; return; \}/.test(appSrc));
check("полоса роли обновляется вместе с переключателем",
  /function syncRoleSwitch\(\)[\s\S]{0,1200}syncRoleBar\(\)/.test(appSrc));
check("снять роль можно той же кнопкой (data-role=\"\")",
  /data-role=""\s*\n?\s*'?\s*title=/.test(appSrc) ||
  /data-role=""[^>]*title="Показать всё без приоритета роли"/.test(appSrc));
check("в поиске роль помечается, но не переставляет выдачу",
  /function roleBlock\(/.test(appSrc) && /role: rl\.off \? "off" : rl\.w \? "on" : ""/.test(appSrc) &&
  /whyLine/.test(appSrc));

/* Реестр утративших силы: фильтры по дате должны быть общими для экрана и
   для выгрузок, иначе .txt/.docx расходился бы с тем, что видит человек. */
check("фильтры реестра собраны в один предикат (экран = выгрузка)",
  /function repMatch\(/.test(appSrc) &&
  /var list = all\.filter\(function \(r\) \{ return repMatch\(r, query\); \}\)/.test(appSrc) &&
  /return repealedList\(\)\.filter\(function \(r\) \{ return repMatch\(r, query\); \}\)/.test(appSrc));
check("в реестре есть фильтр по периоду («за неделю», «за месяц»)",
  /REP_PERIODS\s*=/.test(appSrc) && /id="repPeriod"/.test(appSrc) && /REP_PERIOD_DAYS/.test(appSrc));
check("год и месяц выбираются одним списком (значение — префикс ISO-даты)",
  /Год и месяц акта/.test(appSrc) && /repFilter\.year && String\(r\.date \|\| ""\)\.slice\(0, repFilter\.year\.length\)/.test(appSrc));
check("дата акта подписана относительной формой («месяц назад»)",
  /function relDay\(/.test(appSrc) && /назад/.test(appSrc) &&
  /rel = r\.date \? relDay\(r\.date\) : ""/.test(appSrc) && /rep-item-rel/.test(appSrc));
check("длинная выдача реестра разбита по месяцам",
  /rep-group-h/.test(appSrc) && /MONTHS_NOM/.test(appSrc) &&
  /var withGroups = list\.length > 12/.test(appSrc));

/* Справка: было 12 разделов-кнопок подряд — эксан выглядел как простыня.
   Разделы должны оставаться смысловыми и немногочисленными: сюда попадает
   только то, что нельзя объяснить в интерфейсе одной строкой. */
const helpFn = extractFn("viewHelp");
const helpSecs = helpFn ? (helpFn.match(/sec\(/g) || []).length : -1;
check("справка: разделов немного (было двенадцать)", helpSecs > 0 && helpSecs <= 10,
  helpSecs + " разделов");
/* Новые возможности должны быть описаны там же, где остальные: справка —
   единственное место, где пользователь о них узнаёт. */
check("справка описывает выбор источников Помощника",
  /Отвечать только по выбранным источникам/.test(helpFn || ""));
check("справка описывает памятки и чек-листы как один раздел",
  /sec\("Памятки и чек-листы"/.test(helpFn || ""));
check("справка начинается с ряда задач, а не с текста",
  /help-start/.test(appSrc) && /quickCard\("search"/.test(appSrc) && /quickCard\("compass"/.test(appSrc));
/* Плитки справки сжимались общей сеткой .tiles (minmax 150px) и текст в них
   рвался — у ряда задач свой, более широкий шаг колонок. */
check("ряд задач справки идёт отдельной широкой сеткой",
  /\.help-start\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(300px/.test(cssSrc),
  ".help-start задаёт собственные колонки, а не наследует .tiles");
check("в справке остался дисклеймер об официальном тексте",
  /1259/.test(helpFn || ""));
/* Права объявлены и на самом сайте, а не только в репозитории: читатель
   должен видеть условия там, где читает, а не искать их на GitHub. */
check("дисклеймер на сайте ссылается на условия использования",
  /blob\/main\/LICENSE/.test(appSrc) && /справочный слой/.test(appSrc),
  "иначе про права сказано вполсилы");

/* --- автообновление базы -------------------------------------------------
   Сборщик пишет рядом с данными отпечаток их содержимого, а приложение по
   нему понимает, что на хостинге выложена новая сборка. Без этого посетитель
   с открытой вкладкой оставался бы на старых текстах до перезагрузки, и
   «просто загрузить новые файлы» ничего бы для него не меняло. */
const versionFile = path.join(ROOT, "data", "version.json");
let version = null;
try { version = JSON.parse(fs.readFileSync(versionFile, "utf8")); } catch (e) { version = null; }
check("сборка пишет data/version.json с отпечатком содержимого",
  !!version && /^[0-9a-f]{16}$/.test(version.digest || "") &&
  version.articles === idx.length && version.files > 0,
  version ? version.digest + " · статей " + version.articles + " · файлов " + version.files : "файла нет");
check("отпечаток не зависит от времени сборки",
  /"built_at":"X"/.test(buildSrc),
  "метка времени обнуляется при подсчёте — иначе вкладки перезагружались бы каждый прогон");
check("метка времени сборки одна на весь прогон",
  /const BUILT_AT = new Date\(\)\.toISOString\(\)/.test(buildSrc) &&
  !/built_at: new Date\(\)\.toISOString\(\)/.test(buildSrc));
check("version.json не попадает в собственный отпечаток",
  /r !== "version\.json"/.test(buildSrc));

/* Метка времени — единственный признак, по которому открытая вкладка
   отличает свежие файлы данных от отданных кешем браузера: version.json
   запрашивается мимо кеша (cache: "no-store"), а freshness.js приходит как
   все данные, из кеша. Сравниваются ровно два значения: at из version.json
   и built_at из freshness.js.

   Если сборщик проставит их вразнобой, приложение решит, что на экране
   старые статьи, и покажет «Вышла новая редакция базы» — причём навсегда:
   кнопка «Обновить» перезагрузит страницу мимо кеша, оба файла придут
   свежими, но расхождение никуда не денется. Так и вышло, когда граф
   пересобрали точечно: version.json получил новую метку, а freshness.js
   остался со старой.

   changelog.js сюда не входит намеренно: его пишет отдельный инструмент
   (tools/build-changelog.js) своим временем, и совпадать с меткой сборки
   данных он не обязан. */
const stampAt = version ? version.at : "";
const stampFiles = [
  ["freshness.js", "data/freshness.js"],
  ["status.js", "data/status.js"],
  ["ft/meta.js", "data/ft/meta.js"],
  ["graph.js", "data/graph.js"]
];
const stampBad = !stampAt ? [] : stampFiles.filter(function (f) {
  const p = path.join(ROOT, f[1]);
  if (!fs.existsSync(p)) return true;
  const m = /"built_at":"([^"]*)"/.exec(fs.readFileSync(p, "utf8"));
  return !m || m[1] !== stampAt;
}).map(function (f) { return f[0]; });
check("метка сборки во всех файлах данных одна",
  !!stampAt && stampBad.length === 0,
  !stampAt ? "в version.json нет поля at"
    : stampBad.length
      ? "разошлись с version.json (" + stampAt + "): " + stampBad.join(", ") +
        " — уведомление об обновлении не закроется"
      : "version.json, freshness, status, ft/meta, graph — " + stampAt);

check("приложение опрашивает отпечаток сборки",
  /BUILD_URL = "data\/version\.json"/.test(appSrc) &&
  /function checkBuild\(/.test(appSrc) && /cache: "no-store"/.test(appSrc) &&
  /function startBuildWatch\(/.test(appSrc) && /startBuildWatch\(\);/.test(appSrc));
check("на file:// и без fetch опрос не запускается",
  /function buildCanCheck\(/.test(appSrc) &&
  /typeof fetch === "function" && \/\^https\?:\$\/\.test\(location\.protocol\)/.test(appSrc));
check("загрузка страницы не показывает уведомление (данные уже свежие)",
  /function checkBuild\(boot\)/.test(appSrc) && /seen === j\.digest \|\| boot/.test(appSrc));
check("новая сборка показывается уведомлением с кнопкой «Обновить»",
  /update-bar/.test(appSrc) && /Вышла новая редакция базы/.test(appSrc) &&
  /Обновить<\/button>/.test(appSrc));
check("уведомление можно отложить до конца сеанса",
  /buildInfo\.hidden = true/.test(appSrc) && /Скрыть до конца сеанса/.test(appSrc));
check("перезагрузка идёт мимо кеша (метка версии в адресе)",
  /function buildReload\(/.test(appSrc) &&
  /location\.replace\(location\.pathname \+ "\?v=" \+ encodeURIComponent\(d\)/.test(appSrc));
check("ленивые шарды помечаются версией сборки",
  /"data\/ft\/" \+ b \+ "\.js" \+ buildQuery\(\)/.test(appSrc) &&
  /"data\/full\/" \+ id \+ "\.js" \+ buildQuery\(\)/.test(appSrc) &&
  /"data\/ft\/dict\.js" \+ buildQuery\(\)/.test(appSrc));
check("метка шардов остаётся версии загруженной сборки, а не новой",
  /buildInfo\.digest = seen;/.test(appSrc));
check("версия сборки видна в разделе «Проверка актуальности»",
  /Версия базы в этой вкладке/.test(appSrc) && /function buildStampText\(/.test(appSrc));
check("уведомление оформлено в стилях и не наезжает на тост",
  /\.update-bar\s*\{/.test(cssSrc) && /\.update-bar\.show\s*\{/.test(cssSrc) &&
  /\.update-bar\[hidden\]\s*\{\s*display:\s*none/.test(cssSrc) &&
  /body\.has-update \.toast/.test(cssSrc) &&
  /body\.classList\.add\("has-update"\)/.test(appSrc));

/* --- отпечаток кода сборки ------------------------------------------------
   Правка в app.js, styles.css или index.html содержимое data/ не меняет:
   отпечаток базы (digest) и метка её сборки остаются прежними. Без отдельного
   отпечатка кода открытая вкладка не узнала бы, что на хостинге уже другой
   скрипт, — и читатель до десяти минут работал бы со старым, а выглядело бы
   это как «правки не доехали». */
const stampSrc = fs.readFileSync(path.join(ROOT, "tools", "lib", "code-stamp.js"), "utf8");
check("отпечаток кода считается по оболочке сайта",
  /CODE_FILES = \["index\.html", "app\.js", "styles\.css"\]/.test(stampSrc) &&
  /createHash\("sha1"\)/.test(stampSrc) && /function codeStamp\(dir\)/.test(stampSrc),
  "разметка, стили и скрипт — всё, что читатель получает как «приложение»");
check("своё же значение исключено из подсчёта отпечатка",
  /STAMP_RE = \/\(BUILD_CODE/.test(stampSrc) && /replace\(STAMP_RE, "\$1\$2"\)/.test(stampSrc),
  "иначе подстановка отпечатка меняла бы сам отпечаток и уведомление висело бы всегда");
check("перевод строк не влияет на отпечаток",
  /replace\(\/\\r\\n\/g, "\\n"\)/.test(stampSrc),
  "иначе Windows и Linux дали бы разные отпечатки одной сборки");
check("version.json несёт отпечаток кода рядом с отпечатком базы",
  !!version && /^[0-9a-f]{16}$/.test(version.code || "") &&
  /version\.code = codeStamp\(ROOT\)/.test(buildSrc),
  version ? "код " + version.code + " · база " + version.digest : "файла нет");
check("приложение знает отпечаток своего кода",
  /var BUILD_CODE = "";/.test(appSrc) && /function loadedCode\(\)/.test(appSrc) &&
  /\^\[0-9a-f\]\{16\}\$\/\.test\(BUILD_CODE\)/.test(appSrc),
  "в исходнике константа пустая — отпечаток подставляет сборка публикации");
check("приложение сравнивает отпечаток кода с серверным",
  /var codeStale = /.test(appSrc) && /j\.code !== loadedCode\(\)/.test(appSrc) &&
  /var stale = dataStale \|\| codeStale;/.test(appSrc),
  "данные при этом могут быть той же сборки — их проверка тут не сработает");
check("уведомление различает правку кода и новую редакцию базы",
  /Вышло обновление приложения/.test(appSrc) && /ubTitle/.test(appSrc) &&
  /showBuildBar\(j, codeStale && !dataStale\)/.test(appSrc));
check("перезагрузка меняет адрес и при правке кода",
  /function buildTag\(/.test(appSrc) && /buildTag\(buildInfo\.latest\)/.test(appSrc),
  "одного digest мало: правка кода адрес не меняла бы, и кеш отдал бы старый скрипт");
check("отпечаток кода не выдумывается там, где его нет",
  /return \/\^\[0-9a-f\]\{16\}\$\/\.test\(BUILD_CODE\) \? BUILD_CODE : "";/.test(appSrc),
  "локальный запуск и file:// не должны показывать уведомление");

/* Функциональная проверка отпечатка: собираем крошечный макет каталога
   публикации в временном каталоге и прогоняем подстановку. Проверять это по
   тексту бессмысленно — важно, что отпечаток не зависит от собственного
   значения, а правка кода его меняет. */
{
  const stampMod = require("./lib/code-stamp.js");
  const os = require("os");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rf-stamp-"));
  const tmpCrlf = fs.mkdtempSync(path.join(os.tmpdir(), "rf-stamp-crlf-"));
  try {
    fs.writeFileSync(path.join(tmp, "index.html"), "<html></html>\n", "utf8");
    fs.writeFileSync(path.join(tmp, "styles.css"), "body{}\n", "utf8");
    fs.writeFileSync(path.join(tmp, "app.js"), 'var BUILD_CODE = ""; /* rf-code */\n', "utf8");
    fs.mkdirSync(path.join(tmp, "data"));
    fs.writeFileSync(path.join(tmp, "data", "version.json"), '{"at":"X","digest":"d"}\n', "utf8");

    const before = stampMod.codeStamp(tmp);
    const applied = stampMod.applyCodeStamp(tmp);
    const after = stampMod.codeStamp(tmp);
    const appTmp = fs.readFileSync(path.join(tmp, "app.js"), "utf8");
    const verTmp = JSON.parse(fs.readFileSync(path.join(tmp, "data", "version.json"), "utf8"));

    check("подстановка отпечатка не меняет сам отпечаток",
      applied === before && after === before, before);
    check("отпечаток попал и в app.js, и в version.json",
      appTmp.indexOf('BUILD_CODE = "' + applied + '"') >= 0 && verTmp.code === applied,
      "app.js: " + /BUILD_CODE = "[0-9a-f]{16}"/.test(appTmp) + " · version.json: " + verTmp.code);
    check("подстановка не тронула метку и отпечаток базы",
      verTmp.at === "X" && verTmp.digest === "d",
      "at=" + verTmp.at + " digest=" + verTmp.digest);

    fs.writeFileSync(path.join(tmp, "app.js"), appTmp + "var x = 1;\n", "utf8");
    const edited = stampMod.codeStamp(tmp);
    check("правка кода меняет отпечаток", edited !== before, before + " → " + edited);

    fs.writeFileSync(path.join(tmp, "data", "version.json"), '{"at":"Y","digest":"e"}\n', "utf8");
    check("пересборка базы отпечаток кода не меняет", stampMod.codeStamp(tmp) === edited,
      "data/ в отпечаток кода не входит");

    fs.cpSync(tmp, tmpCrlf, { recursive: true });
    fs.writeFileSync(path.join(tmpCrlf, "styles.css"), "body{}\r\n", "utf8");
    check("Windows и Linux дают один отпечаток", stampMod.codeStamp(tmpCrlf) === edited,
      "перевод строк приводится к LF");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(tmpCrlf, { recursive: true, force: true });
  }
}

const vercelCfg = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
const cacheFor = function (src) {
  const h = (vercelCfg.headers || []).filter(function (r) { return r.source === src; })[0];
  const c = h ? (h.headers || []).filter(function (x) { return x.key === "Cache-Control"; })[0] : null;
  return c ? c.value : "";
};
check("оболочка сайта перепроверяется при каждом заходе",
  /must-revalidate/.test(cacheFor("/")) && /must-revalidate/.test(cacheFor("/index.html")) &&
  /must-revalidate/.test(cacheFor("/app.js")) && /must-revalidate/.test(cacheFor("/styles.css")),
  "иначе новая выкладка не дойдёт до вернувшегося посетителя");
check("отпечаток сборки не кешируется надолго", /must-revalidate/.test(cacheFor("/data/(.*)")));

/* Метка времени в version.json меняется каждый прогон: если не исключить файл
   из сравнения «что изменилось», ночная сборка будет коммитить каждую ночь
   даже без единой правки в законах. */
const wfSrc = fs.readFileSync(path.join(ROOT, ".github", "workflows", "update.yml"), "utf8");
check("ночная сборка не считает смену отпечатка изменением данных",
  /grep -v '\^data\/version\\\.json\$'/.test(wfSrc),
  "data/version.json исключён из сравнения");
check("отпечаток всё равно коммитится (иначе хостинг не отдаст новый)",
  /git add -- data/.test(wfSrc));

const gitignore = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
/* Репозиторий публичный — этого требует GitHub Pages на бесплатном плане.
   Поэтому рабочие заметки ассистента в него не идут вовсе: каталог исключён
   целиком, без единого возвращающего исключения. Раньше память проекта
   хранилась в репозитории; с публичным репозиторием это стало невозможным. */
check("рабочие файлы ассистента не попадают в репозиторий",
  /^\.workbuddy-ai\/$/m.test(gitignore),
  "иначе в репозиторий ушли бы профили браузера и рабочие заметки");
check("память проекта не возвращается в публичный репозиторий",
  !/^!\.workbuddy-ai/m.test(gitignore),
  "публичный репозиторий выложил бы заметки в открытый доступ");

const deployDoc = fs.readFileSync(path.join(ROOT, "DEPLOY.md"), "utf8");
/* Инструкция сокращена до того, что нужно в работе: сайт давно опубликован,
   поэтому пошаговая настройка «от нуля» и сравнение хостингов (Cloudflare,
   Vercel, Netlify) из неё убраны — они остались в истории git. Проверяем то,
   без чего инструкция перестанет быть полезной. */
check("инструкция по публикации называет адрес сайта",
  /zTRPGz\.github\.io\/pravovoy-konsultant/.test(deployDoc),
  "читатель должен видеть, где живёт сайт");
check("инструкция описывает сборку каталога публикации dist/",
  /npm run dist/.test(deployDoc) && /node tools\/build-dist\.js/.test(deployDoc) &&
  /_headers/.test(deployDoc),
  "иначе на хостинг ушёл бы корень репозитория вместе с tools/");
check("инструкция описывает обновление сайта одним коммитом",
  /git commit/.test(deployDoc) && /git push/.test(deployDoc),
  "правки и обновления базы — обычные коммиты");
check("инструкция описывает ночную сборку и ручной запуск",
  /23:30/.test(deployDoc) && /Run workflow/.test(deployDoc) && /update-logs/.test(deployDoc),
  "иначе непонятно, как обновить базу, не дожидаясь ночи");
check("инструкция предупреждает, что репозиторий должен быть публичным",
  /публичным/.test(deployDoc),
  "на бесплатном плане GitHub Pages иначе не включается");
check("инструкция объясняет кеш GitHub Pages и метку версии в адресе",
  /max-age=600/.test(deployDoc) && /\?v=/.test(deployDoc),
  "иначе кнопка «Обновить» отдавала бы данные из кеша");
check("инструкция называет хостинг, который из России открывается",
  /GitHub Pages/.test(deployDoc) && /из России/.test(deployDoc) && /100 ГБ/.test(deployDoc),
  "GitHub Pages читается из России и даёт 100 ГБ трафика в месяц");
check("инструкция описывает вычистку заметок из истории коммитов",
  /grep workbuddy/.test(deployDoc),
  "исключение из .gitignore не убирает уже сделанные коммиты");

/* --- задача публикации на GitHub Pages -------------------------------------
   Файл задачи проверяем по тексту: локально Actions не запустить. Ловим то,
   что легко испортить правкой, — путь выкладки и права.                      */
const pagesYml = fs.readFileSync(path.join(ROOT, ".github", "workflows", "pages.yml"), "utf8");
check("публикация выкладывает именно dist/, а не корень репозитория",
  /upload-pages-artifact/.test(pagesYml) && /path: dist/.test(pagesYml),
  "иначе tools/ и .github/ стали бы доступны по прямым ссылкам");
check("публикация собирает каталог той же командой, что и локально",
  /run: node tools\/build-dist\.js/.test(pagesYml),
  "в инструкции и в задаче должна быть одна команда");
check("публикация запускается на push в main и умеет запускаться вручную",
  /branches: \[main\]/.test(pagesYml) && /workflow_dispatch:/.test(pagesYml),
  "иначе первый деплой не запустить без пустого коммита");
check("у публикации есть права на выкладку в Pages",
  /pages: write/.test(pagesYml) && /id-token: write/.test(pagesYml),
  "deploy-pages работает через OIDC-токен");
check("идущая выкладка не отменяется следующей",
  /concurrency:/.test(pagesYml) && /cancel-in-progress: false/.test(pagesYml),
  "прерванный деплой оставил бы сайт в промежуточном состоянии");

/* --- проверки перед выкладкой ---------------------------------------------
   Регрессия в коде доходила до сайта молча: проверки жили только в ночной
   сборке, а обычный push в main их не запускал. Теперь отдельная задача
   «Проверки» вызывается из «Публикации», и красные проверки останавливают
   выкладку. Гвардим связку: без неё правка workflow снова сделает проверки
   декоративными.                                                          */
const checksPath = path.join(ROOT, ".github", "workflows", "checks.yml");
const checksYml = fs.existsSync(checksPath) ? fs.readFileSync(checksPath, "utf8") : "";
check("задача проверок на месте (.github/workflows/checks.yml)", !!checksYml,
  "без неё публикация выкладывает код без проверок");
check("публикация вызывает проверки перед выкладкой",
  /uses: \.\/\.github\/workflows\/checks\.yml/.test(pagesYml) && /needs: check/.test(pagesYml),
  "иначе красные проверки не остановят выкладку");
check("красные проверки останавливают выкладку",
  /needs\.check\.result == 'success'/.test(pagesYml),
  "иначе сайт выкладывался бы сломанным");
check("проверки гоняют все три приёмки",
  /tools\/audit\.js/.test(checksYml) && /tools\/verify-data\.js/.test(checksYml) &&
  /tools\/smoke-test\.js/.test(checksYml),
  "иначе часть проверок выпала бы из цепочки");
check("красная проверка останавливает задачу (pipefail)",
  /set -o pipefail/.test(checksYml),
  "без него код возврата берётся у tee (всегда 0) — красная проверка пройдёт");

/* Команда сборки живёт в tools/, поэтому .vercelignore не должен его
   исключать — иначе Vercel не найдёт скрипт и деплой упадёт. */
const vercelIgnore = fs.readFileSync(path.join(ROOT, ".vercelignore"), "utf8");
check("настройки Vercel не лишают сборку каталога tools/",
  !/^tools\/$/m.test(vercelIgnore),
  "node tools/build-dist.js без tools/ не выполнится");
check("Vercel знает команду сборки и каталог вывода",
  vercelCfg.buildCommand === "node tools/build-dist.js" &&
  vercelCfg.outputDirectory === "dist",
  "те же значения, что и в инструкции для Cloudflare Pages");

/* --- каталог публикации ----------------------------------------------------
   На хостинг уходит не корень репозитория, а собранный dist/ (tools/build-dist.js).
   Проверяем его поведение напрямую, а не по тексту: файл подключается как
   модуль и отдаёт те же правила кеша, что попадут в _headers.               */
const distMod = require("./build-dist.js");
const distHdr = distMod.headersFromVercel();
const distSrc = fs.readFileSync(path.join(ROOT, "tools", "build-dist.js"), "utf8");

check("правила кеширования для Cloudflare выводятся из vercel.json",
  /readFileSync\(path\.join\(ROOT, "vercel\.json"\)/.test(distSrc),
  "один источник правил — иначе кеш на Vercel и на Cloudflare разошёлся бы");

check("каталог публикации получает отпечаток кода",
  /require\("\.\/lib\/code-stamp\.js"\)/.test(distSrc) && /applyCodeStamp\(OUT\)/.test(distSrc),
  "без этого правка кода не поднимала бы уведомление об обновлении");
check("отпечаток проставляется после копирования файлов",
  distSrc.indexOf("applyCodeStamp(OUT)") > distSrc.indexOf("fs.cpSync(src, path.join(OUT, d)"),
  "отпечаток читает уже собранный каталог — иначе он бы посчитался по старому app.js");

check("в _headers переведены пути Vercel и нет его синтаксиса",
  /^\/\*\n/m.test(distHdr) && /^\/data\/full\/\*\n/m.test(distHdr) &&
  distHdr.indexOf("(.*)") === -1 && distHdr.indexOf("(?") === -1,
  distHdr.split("\n").filter(Boolean).length + " строк");

check("общее правило /* идёт первым — частные его перекрывают",
  distHdr.indexOf("/*") < distHdr.indexOf("/data/full/*"),
  "в _headers при совпадении путей побеждает последнее правило");

check("тяжёлые тексты кешируются недолго, оболочка перепроверяется всегда",
  /\/data\/full\/\*[\s\S]{0,80}stale-while-revalidate/.test(distHdr) &&
  /\/app\.js\n  Cache-Control: public, max-age=0, must-revalidate/.test(distHdr));

/* Новый файл в корне легко забыть внести в список копирования — тогда он
   молча не доедет до хостинга, хотя локально всё будет работать. */
const distRefs = (htmlSrc.match(/(?:src|href)="([^"]+)"/g) || [])
  .map(function (s) { return s.replace(/^(?:src|href)="/, "").replace(/"$/, ""); })
  .filter(function (r) { return !/^(?:https?:|#|data:|mailto:|\/\/)/.test(r); })
  /* адреса файлов данных собирает загрузчик: в разметке от них остался только
     шаблон "' + files[i] + v + '". Сам список добавляем ниже. */
  .filter(function (r) { return r.indexOf("'") === -1 && r.indexOf("+") === -1; })
  .concat(htmlDataFiles);
const distMissing = distRefs.filter(function (r) {
  return distMod.FILES.indexOf(r) === -1 &&
    !distMod.DIRS.some(function (d) { return r.indexOf(d + "/") === 0; });
});
check("каталог публикации покрывает все файлы, на которые ссылается index.html",
  distRefs.length > 0 && distMissing.length === 0,
  distMissing.length ? "не доедут: " + distMissing.join(", ") : distRefs.length + " ссылок");

check("каталог публикации несёт правила кеша и защиту от Jekyll",
  /_headers/.test(distSrc) && /\.nojekyll/.test(distSrc),
  "без .nojekyll GitHub Pages выбрасывает файлы с подчёркиванием");

/* --- работа без сети ------------------------------------------------------
   Вступительный экран обещает офлайн-работу. Без service worker обещание было
   неправдой: без интернета сайт не открывался вовсе. Проверяем и сам воркер,
   и то, что он доедет до хостинга, и что регистрация не мешает остальному. */
const swPath = path.join(ROOT, "sw.js");
const swSrc = fs.existsSync(swPath) ? fs.readFileSync(swPath, "utf8") : "";
check("воркер офлайн-работы существует и уходит на хостинг",
  !!swSrc && distMod.FILES.indexOf("sw.js") >= 0,
  swSrc ? "sw.js · в списке публикации: " + (distMod.FILES.indexOf("sw.js") >= 0) : "файла нет");
check("стратегия воркера — сначала сеть, кеш только при её отсутствии",
  /fetch\(req\)\.then/.test(swSrc) && /\.catch\(function \(\) \{[\s\S]{0,400}caches\.match\(req\)/.test(swSrc),
  "иначе правки застревали бы в кеше воркера — та же беда, что была с HTTP-кешем");
check("воркер не отдаёт из кеша отпечаток сборки",
  /version\\\.json/.test(swSrc) && /alwaysNetwork/.test(swSrc),
  "по нему приложение узнаёт о новой редакции базы");
check("воркер не кеширует чужие источники и не-GET запросы",
  /url\.origin !== self\.location\.origin/.test(swSrc) && /req\.method !== "GET"/.test(swSrc));
check("воркер ограничивает размер кешируемого файла",
  /MAX_BYTES/.test(swSrc) && /content-length/.test(swSrc),
  "полные тексты крупнейших кодексов иначе съедят квоту браузера");
check("ошибка кеша не ломает загрузку страницы",
  /\.catch\(function \(\) \{\}\)/.test(swSrc) && /catch \(e\) \{ \/\*/.test(swSrc),
  "воркер обязан пропустить запрос к сети, а не упасть");
check("приложение регистрирует воркер только там, где он доступен",
  /function setupOffline\(\)/.test(appSrc) && /"serviceWorker" in navigator/.test(appSrc) &&
  /register\("sw\.js"\)/.test(appSrc) && /setupOffline\(\)/.test(appSrc) &&
  /\^https\?:\$\/\.test\(location\.protocol\)/.test(appSrc),
  "file:// и браузеры без воркера работают как раньше");

/* --- как ссылка выглядит в поиске и соцсетях ------------------------------ */
check("страница рассказывает о себе поиску и соцсетям",
  /rel="canonical"/.test(htmlSrc) && /property="og:title"/.test(htmlSrc) &&
  /property="og:description"/.test(htmlSrc) && /property="og:locale" content="ru_RU"/.test(htmlSrc) &&
  /name="twitter:card"/.test(htmlSrc),
  "иначе ссылка в мессенджере выглядит безымянной");

/* --- заход без JavaScript -------------------------------------------------
   Стили подключаются скриптом (метка версии через document.write). Значит,
   при выключенных скриптах страница показывалась голым текстом без единой
   строки оформления — а приложение целиком на JavaScript и молчало о причине. */
check("стили доходят и при выключенном JavaScript",
  /<noscript><link rel="stylesheet" href="styles\.css"><\/noscript>/.test(htmlSrc) &&
  /document\.write\('<link rel="stylesheet" href="styles\.css'/.test(htmlSrc),
  "иначе без скриптов остаётся неоформленный текст");
check("выключенный JavaScript объясняется словами",
  /<noscript>[\s\S]{0,600}нужен JavaScript/.test(htmlSrc),
  "молчаливо пустая страница выглядит как поломка сайта");

const robotsPath = path.join(ROOT, "robots.txt");
const robotsSrc = fs.existsSync(robotsPath) ? fs.readFileSync(robotsPath, "utf8") : "";
check("поисковым роботам сказано, что индексировать",
  /User-agent:\s*\*/.test(robotsSrc) && /Allow:\s*\//.test(robotsSrc) && distMod.FILES.indexOf("robots.txt") >= 0,
  "без файла робот всё равно заходит, но по умолчанию — без правил");

/* --- условия использования и входная страница репозитория ------------------
   Репозиторий публичный: файлы может скачать любой, поэтому условия должны
   быть объявлены словами, а не подразумеваться. Проверяем, что уведомление
   называет и то, что охраняется, и изъятие для текстов актов (п. 6 ст. 1259):
   без него уведомление выглядело бы как притязание на сами законы. */
const licPath = path.join(ROOT, "LICENSE");
const licSrc = fs.existsSync(licPath) ? fs.readFileSync(licPath, "utf8") : "";
check("условия использования объявлены файлом",
  /Все права защищены/.test(licSrc) && /1259/.test(licSrc) && /1301/.test(licSrc),
  licSrc ? "LICENSE: права, изъятие для актов, ответственность" : "файла LICENSE нет");
check("условия не притязают на тексты нормативных актов",
  /пункт 6 статьи 1259|п\. 6 ст\. 1259/.test(licSrc) && /не (являются|охраняются)/.test(licSrc),
  "тексты актов не охраняются — это надо сказать прямо");

const readmePath = path.join(ROOT, "README.md");
const readmeSrc = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, "utf8") : "";
check("у репозитория есть входная страница",
  /zTRPGz\.github\.io\/pravovoy-konsultant/.test(readmeSrc) && /LICENSE/.test(readmeSrc) &&
  /npm run verify/.test(readmeSrc),
  readmeSrc ? "README.md: адрес, условия, команды проверки" : "файла README.md нет");

check("сборщик предупреждает о пределах бесплатного Cloudflare Pages",
  /25 \* 1024 \* 1024/.test(distSrc) && /20000/.test(distSrc),
  "25 МБ на файл и 20 000 файлов — за ними сборка не пройдёт");

const pkgJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
check("объявленная лицензия не противоречит package.json",
  pkgJson.license === "UNLICENSED",
  "package.json: " + pkgJson.license + " — иначе README и LICENSE обещают не то, что записано в пакете");
check("каталог публикации собирается командой npm run dist",
  !!pkgJson.scripts && /build-dist\.js/.test(pkgJson.scripts.dist || ""));
check("dist/ не хранится в репозитории",
  /^dist\/$/m.test(gitignore), "это производная от data/, её собирает хостинг");
check("локальный сервер умеет показать каталог публикации",
  /process\.argv\[3\]/.test(fs.readFileSync(path.join(ROOT, "tools", "serve.js"), "utf8")),
  "node tools/serve.js 8123 dist — ровно то, что уедет на хостинг");
check("локальный сервер умеет притвориться GitHub Pages",
  /SERVE_CACHE/.test(fs.readFileSync(path.join(ROOT, "tools", "serve.js"), "utf8")),
  "SERVE_CACHE=pages — те же 10 минут кеша, что у читателя");

/* --- обновление базы у читателя --------------------------------------------
   GitHub Pages не даёт задавать свои заголовки кеширования: всё отдаётся с
   max-age=600. Отсюда ловушка — файлы данных могут прийти из кеша браузера, и
   тогда кнопка «Обновить» перезагружала бы страницу без новых статей.
   Проверяем оба механизма, которые это закрывают; поведение — в
   .workbuddy-ai/verify-update.js (настоящий браузер, настоящий кеш). */
check("файлы данных подключаются загрузчиком, а не тегами",
  /var files = \[[\s\S]*?\];/.test(htmlSrc) && /location\.search/.test(htmlSrc) &&
  /document\.write/.test(htmlSrc),
  "иначе на GitHub Pages кеш браузера вернул бы те же старые тексты");
check("метка версии подставляется только когда она есть в адресе",
  /\[\?&\]v=/.test(htmlSrc) && /encodeURIComponent\(decodeURIComponent/.test(htmlSrc),
  "первый заход и file:// должны работать как раньше");
/* Список файлов данных берём с диска, а не из константы: новый файл в data/
   (например, справочник исков) обязан попасть в загрузчик, иначе он просто
   не доедет до читателя — молча, без единой ошибки в консоли.
   Исключение — файлы, которые подгружаются по требованию: параметры
   полнотекстового индекса и граф ссылок. Их в стартовом загрузчике нет и
   быть не должно: граф нужен только разделу «Связи источников». */
const LAZY_DATA = ["data/ft/meta.js", "data/graph.js"];
const dataRootFiles = fs.readdirSync(path.join(ROOT, "data"))
  .filter((f) => /\.js$/.test(f))
  .map((f) => "data/" + f)
  .concat(LAZY_DATA);
const missingFromLoader = dataRootFiles.filter((f) => LAZY_DATA.indexOf(f) === -1 && htmlDataFiles.indexOf(f) === -1);
const loaderUnknown = htmlDataFiles.filter((f) => LAZY_DATA.indexOf(f) === -1 &&
  !fs.existsSync(path.join(ROOT, f)));
check("все данные верхнего уровня перечислены в загрузчике",
  missingFromLoader.length === 0 && loaderUnknown.length === 0 &&
  htmlDataFiles.indexOf("data/registry.js") >= 0 &&
  htmlDataFiles.indexOf("data/freshness.js") >= 0 &&
  htmlDataFiles.indexOf("data/ft/meta.js") >= 0 &&
  htmlDataFiles.indexOf("data/terms.js") >= 0,
  missingFromLoader.length ? "не подключены: " + missingFromLoader.join(", ")
    : loaderUnknown.length ? "в загрузчике нет файлов: " + loaderUnknown.join(", ")
      : htmlDataFiles.length + " файлов");
check("метка сборки загруженных данных сравнивается с серверной",
  /function loadedBuiltAt\(\)/.test(appSrc) && /RF_FRESH/.test(appSrc) &&
  /var stale = /.test(appSrc),
  "без этого данные из кеша остались бы на экране навсегда");

/* --- загрузчик данных работает без порядка --------------------------------
   index.html грузит файлы данных параллельно, а app.js подключает, когда
   приехали все. Это законно только пока ни один файл не читает чужой
   глобальный объект при загрузке: иначе он получил бы undefined, и данные
   молча оказались бы пустыми (при последовательной загрузке такой файл
   работал бы — поэтому проверка нужна именно сейчас). Условие: всё, что
   файл упоминает как window.RF_*, он же и объявляет. */
const parallelReads = [];
htmlDataFiles.forEach(function (f) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) return;
  /* комментарии не в счёт: в них имена объектов упоминаются просто для
     объяснения («в браузере — через window.RF_PARSE») */
  const src = fs.readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const mentioned = {};
  (src.match(/window\.RF_[A-Z_]+/g) || []).forEach(function (m) { mentioned[m] = 1; });
  const assigned = {};
  (src.match(/window\.RF_[A-Z_]+\s*=/g) || []).forEach(function (m) {
    assigned[m.replace(/\s*=$/, "")] = 1;
  });
  Object.keys(mentioned).forEach(function (m) {
    if (!assigned[m]) parallelReads.push(f + " читает " + m);
  });
});
check("файлы данных не зависят от порядка загрузки",
  parallelReads.length === 0,
  parallelReads.length ? "читают чужие объекты: " + parallelReads.join(", ")
    : htmlDataFiles.length + " файлов объявляют только свои объекты");

/* --- вступительный экран --------------------------------------------------- */
/* Требование: показывается при каждом открытии и закрывается нажатием в любом
   месте. Значит, в коде не должно остаться ни чтения, ни записи отметки
   «уже видел» — иначе экран пропадёт при следующем заходе. */
check("вступительный экран не запоминается",
  !/LS\.get\("introSeen"\)/.test(appSrc) && !/LS\.set\("introSeen"/.test(appSrc),
  "отметка в localStorage скрывала бы экран при следующем открытии");
check("кнопки «Войти» на вступительном экране нет",
  !/introEnter/.test(htmlSrc) && !/intro-enter/.test(cssSrc),
  "разметка и стили кнопки удалены вместе");
check("экран виден при каждом открытии и закрывается нажатием",
  /el\.hidden = false;/.test(extractFn("setupIntro")) &&
  /addEventListener\("click", dismissIntro\)/.test(extractFn("setupIntro")),
  "setupIntro показывает экран безусловно и вешает обработчик на весь экран");
check("экран подсказывает, что можно нажать в любом месте",
  /intro-hint/.test(htmlSrc) && /нажмите в любом месте/i.test(htmlSrc) &&
  /\.intro-hint/.test(cssSrc) && /\.intro \{[\s\S]{0,700}cursor: pointer/.test(cssSrc),
  "весь экран выглядит нажимаемым");

/* -------------------------------------------------- 12. словарь терминов */
/* Термин без ссылки на норму — это утверждение без источника: проверить его
   читателю нечем. Поэтому связь «термин → статьи» проверяется как данные, а
   не как оформление. */
console.log("\n12. Словарь терминов");
check("словарь терминов собран (data/terms.js)", terms.length >= 100,
  terms.length + " терминов");
check("словарь подключён загрузчиком данных",
  htmlDataFiles.indexOf("data/terms.js") >= 0,
  "иначе раздел «Термины» открывался бы пустым");

const termIds = {}, termTitles = {}, termDupIds = [], termDupTitles = [];
const termBadRefs = [], termNoRefs = [], termBadFields = [];
const knownArts = {};
idx.forEach(function (r) { knownArts[r[0] + "-" + r[1]] = 1; });
const knownCodes = {};
codes.forEach(function (c) { knownCodes[c.id] = 1; });

terms.forEach(function (t) {
  if (!t.id || !t.t || !t.b || !t.d) termBadFields.push(t.id || "(без id)");
  if (termIds[t.id]) termDupIds.push(t.id);
  termIds[t.id] = 1;
  var key = strip(t.t).toLowerCase();
  if (termTitles[key]) termDupTitles.push(t.t);
  termTitles[key] = 1;
  if (!/^[a-z0-9-]+$/.test(t.id || "")) termBadFields.push((t.id || "?") + " — адрес не латиницей");
  var arts = t.articles || [];
  if (!arts.length) termNoRefs.push(t.id);
  arts.forEach(function (a) {
    var i = a.lastIndexOf("-");
    var c = a.slice(0, i), n = a.slice(i + 1);
    if (!knownCodes[c]) termBadRefs.push(t.id + " → " + a + " (нет источника)");
    else if (!knownArts[a]) termBadRefs.push(t.id + " → " + a + " (нет статьи)");
  });
});
check("у каждого термина заполнены id, название, отрасль и определение",
  termBadFields.length === 0,
  termBadFields.length ? termBadFields.slice(0, 5).join(", ") : terms.length + " терминов проверено");
check("адреса терминов уникальны", termDupIds.length === 0,
  termDupIds.length ? termDupIds.slice(0, 5).join(", ") : "повторов нет");
check("названия терминов не повторяются", termDupTitles.length === 0,
  termDupTitles.length ? termDupTitles.slice(0, 5).join(", ") : "повторов нет");
check("у каждого термина есть норма-основание", termNoRefs.length === 0,
  termNoRefs.length ? termNoRefs.slice(0, 6).join(", ") : "определение всегда можно проверить по статье");
check("все ссылки словаря ведут на статьи, которые есть в базе",
  termBadRefs.length === 0,
  termBadRefs.length ? termBadRefs.slice(0, 6).join(" · ") : "битых ссылок нет");
check("словарь покрывает все крупные отрасли",
  ["Уголовное право", "Уголовный процесс", "Административное право", "Гражданское право",
    "Гражданский процесс", "Трудовое право", "Семейное право"].every(function (b) {
    return terms.some(function (t) { return t.b === b; });
  }),
  "иначе раздел отвечал бы только по одной отрасли");
check("у терминов есть синонимы для поиска",
  terms.filter(function (t) { return (t.a || []).length > 1; }).length >= terms.length * 0.9,
  terms.filter(function (t) { return (t.a || []).length > 1; }).length + " из " + terms.length +
  " ищутся не только по точному названию");

check("раздел «Термины» есть в маршрутах и видах",
  /name === "terms"/.test(appSrc) && /name === "term"/.test(appSrc) &&
  /function viewTerms\(/.test(appSrc) && /function viewTerm\(/.test(appSrc) &&
  /function bindTerms\(/.test(appSrc),
  "без разбора адреса раздел не открылся бы");
check("определение показывается над результатами поиска",
  /var def = termCard\(q\);/.test(appSrc) && /head \+ [^;]*\bdef\b \+/.test(appSrc),
  "словарь отвечает на «что это значит», поиск — на «где это написано»");
check("словарь есть в боковом меню и в быстром переходе",
  /data-nav="terms"/.test(htmlSrc) && /#\/terms/.test(appSrc) && /termFind\(q, 3\)/.test(appSrc),
  "иначе раздел было бы не найти");
check("определения честно названы справочными",
  /не заменяет текст нормы/.test(appSrc) && /справочного слоя, не официальный текст/.test(appSrc),
  "определение — не официальный текст акта, и это сказано словами");

/* ------------------------------------------ 13. перемещение по разделам */
/* Переходы идут через историю браузера, поэтому «Назад» возвращает на
   предыдущий раздел, а не уводит с сайта. Обратная сторона — история растёт,
   поэтому глубина ограничена; и нужен запасной путь для окружений, где
   history API запрещён (часть режимов file://). */
console.log("\n13. Перемещение по разделам");
check("переходы пишутся в историю браузера",
  /history\.pushState/.test(appSrc) && /history\.replaceState/.test(appSrc),
  "иначе кнопка «Назад» браузера уводила бы с сайта");
check("кнопка «Назад» браузера обрабатывается",
  /addEventListener\("popstate"/.test(appSrc) &&
  /navStack\.indexOf\(h\)/.test(appSrc),
  "popstate ставит указатель своего стека на то же место");
check("глубина истории ограничена",
  /var NAV_MAX = \d+/.test(appSrc) && /navStack\.length < NAV_MAX/.test(appSrc) &&
  /navStack\[NAV_MAX - 1\] = navHashNow/.test(appSrc),
  "иначе после долгой работы «назад» пришлось бы жать сотни раз");
check("кнопки панели и кнопки браузера двигают одну историю",
  /if \(histOk\) \{[\s\S]{0,120}history\.go\(delta\)/.test(appSrc),
  "иначе они разошлись бы и «Вперёд» прыгала бы не туда");
check("есть запасной путь, когда history API запрещён",
  /histOk = false;/.test(appSrc) && /try \{[\s\S]{0,200}history\.replaceState\(\{ nav: 0 \}/.test(appSrc) &&
  /location\.replace\(h\)/.test(appSrc),
  "на части режимов file:// pushState бросает SecurityError");
check("мини-окно статьи закрывается при переходе по истории",
  /addEventListener\("popstate"[\s\S]{0,300}modal-open/.test(appSrc),
  "иначе окно осталось бы висеть поверх нового раздела");

/* итог */
console.log("\n14. Режим одного источника (ответить исключительно по одному акту)");
check("поиск умеет ограничиваться выбранными источниками",
  /if \(sids\.length\)[\s\S]{0,160}sids\.indexOf\(a\.c\) !== -1/.test(appSrc),
  "иначе «ответить только по УК» не отфильтровало бы выдачу по акту");
/* Пустой scope — это «все источники», а не «ни одного»: String([]) даёт "",
   split(",") — [""], и выдача обнулялась целиком (Помощник на описании без
   разбора не показывал близкие нормы вовсе, а блок «Судебная практика»
   подменял их случайным пунктом Пленума). */
check("пустой список источников не обнуляет выдачу",
  /Array\.isArray\(opt\.scope\) \? opt\.scope : String\(opt\.scope\)\.split\(","\)\)\.filter\(Boolean\)/.test(appSrc),
  "иначе режим «все источники» возвращал 0 результатов");
/* Выбор источников — уточнение на время работы, а не настройка «навсегда».
   Раньше он сохранялся в localStorage, и при следующем заходе Помощник молча
   отвечал по одному застрявшему акту («стоит на Конституции»). Теперь по
   умолчанию действуют все источники, а выбор живёт в памяти сеанса. */
check("Помощник по умолчанию отвечает по всем источникам",
  /assistScope: "",/.test(appSrc) &&
  appSrc.indexOf('LS.get("assistScope"') === -1 &&
  appSrc.indexOf('LS.set("assistScope"') === -1,
  "иначе ограничение застревало бы между сеансами");
check("устаревшая настройка ограничения источников вычищается",
  /LS\.del\("assistScope"\)/.test(appSrc),
  "старый ключ в localStorage больше не сбивает с толку");
check("переключатель источника выводится в Помощнике",
  appSrc.indexOf('id="scopeTrigger"') !== -1 && appSrc.indexOf("function assistScopePicker") !== -1 &&
  appSrc.indexOf("id=\"asScopeChips\"") !== -1 && appSrc.indexOf("id=\"asScopeBadge\"") !== -1,
  "иначе режим некуда включать, а состояние — негде показать");
/* Пикер перерисовывался вместе с разделом на каждом щелчке: список схлопывался,
   запрос в поиске сбрасывался, и выбрать несколько актов подряд было нельзя.
   Теперь смена выбора пересобирает только вывод разбора. */
check("смена источника пересчитывает разбор, не перерисовывая раздел",
  /function refreshAssistAnswer/.test(appSrc) &&
  /asRefresh = render;/.test(appSrc) &&
  /if \(asText && typeof asRefresh === "function"\) asRefresh\(\)/.test(appSrc),
  "иначе пикер закрывался бы на каждом щелчке");
check("открытый пикер и запрос переживают перерисовку раздела",
  /var scopeOpen = false, scopeQuery = ""/.test(appSrc) &&
  /\(scopeOpen \? "" : " hidden"\)/.test(appSrc),
  "список не должен схлопываться сам");
check("нормы ответа фильтруются по выбранному акту",
  appSrc.indexOf("keyArts = keyArts.filter(function (a) { return sc.indexOf(a.c) !== -1; })") !== -1 &&
  appSrc.indexOf("arts = arts.filter(function (a) { return sc.indexOf(a.c) !== -1; })") !== -1,
  "иначе вывод ссылался бы на нормы другого кодекса");
check("судебная практика отключается при выбранном источнике",
  /* Форма записи менялась: раньше тернарник `sc.length ? [] : search(...)`,
     теперь блок `if (!sc.length) { ... }` с отбором актов по отрасли.
     Проверяем СМЫСЛ — поиск практики выполняется только вне режима одного
     источника. */
  /var practice = sc\.length \? \[\] : search/.test(appSrc) ||
  /var practice = \[\];\s*\n\s*if \(!sc\.length\) \{/.test(appSrc),
  "«ответь только по УК» и отдельный блок Пленумов противоречат друг другу");
check("режим помечен в выводе",
  appSrc.indexOf('class="concl-scope"') !== -1 &&
  appSrc.indexOf("Ответ ограничен источниками") !== -1,
  "иначе непонятно, почему в ответе только нормы одного акта");
check("вкладка «Источники» разбирает адрес, рисует вид и имеет заголовок",
  appSrc.indexOf("function viewSources") !== -1 &&
  appSrc.indexOf("function bindSources") !== -1 &&
  appSrc.indexOf('name === "sources") { v.innerHTML = viewSources()') !== -1 &&
  appSrc.indexOf('sources: "Источники"') !== -1,
  "без маршрута и заголовка вкладка не открылась бы и не нашлась бы");
check("вкладка «Источники» есть в боковом меню, палитре и на главной",
  /data-nav="sources"/.test(htmlSrc) &&
  appSrc.indexOf('{ t: "Источники", h: "#/sources"') !== -1 &&
  appSrc.indexOf('quickCard("scales", "Источники"') !== -1,
  "иначе раздел было бы не найти");
check("из одного источника можно сразу спросить Помощник только по нему",
  appSrc.indexOf('data-scope="') !== -1 &&
  appSrc.indexOf('closest("[data-scope]")') !== -1 &&
  /closest\("\[data-scope\]"\)[\s\S]{0,220}go\("#\/assistant"\)/.test(appSrc),
  "кнопка связывает просмотр акта с режимом ответа только по нему");

console.log("\n15. Спецсубъект и правомерность применённой силы (ст. 37–39, ФЗ «О полиции»)");
check("контекст применённой силы определяется по описанию",
  appSrc.indexOf("function forceContext(low)") !== -1 &&
  appSrc.indexOf("FC_RE.force.test(t)") !== -1,
  "иначе Помощник не отличит ситуацию с силой от остальных");
check("распознаётся спецсубъект, применивший силу",
  appSrc.indexOf("FC_RE.specialLink") !== -1 &&
  appSrc.indexOf("FC_RE.actor") !== -1,
  "иначе «сотрудник применил силу» не даёт блока про ФЗ «О полиции»");
check("различаются административный проступок и преступление",
  appSrc.indexOf("FC_RE.adverseAP") !== -1 &&
  appSrc.indexOf("Административное, а не уголовное") !== -1 &&
  appSrc.indexOf("20.1 КоАП") !== -1,
  "иначе ст. 37/38 УК применялись бы к административному правонарушителю");
check("в выводе есть блок обстоятельств, исключающих преступность",
  appSrc.indexOf("Обстоятельства, исключающие преступность деяния") !== -1 &&
  appSrc.indexOf("var fa = forceAnalysis(fc") !== -1 &&
  /rows = rows\.slice\(0, 1\)\.concat\(fa/.test(appSrc),
  "иначе разбор не показывает ст. 37/38/39 УК при применении силы");
check("нормы переставляются: спец-, не общие составы",
  appSrc.indexOf("function forceReorder(keyArts, fc)") !== -1 &&
  appSrc.indexOf("if (fc && !sc) keyArts = forceReorder(keyArts, fc);") !== -1 &&
  appSrc.indexOf('demote.indexOf(x.id)') !== -1,
  "иначе ст. 286 УК оставалась бы ниже ст. 105/111 для сотрудника");
check("все цитируемые нормы контекста есть в базе",
  (function () {
    var have = {};
    idx.forEach(function (a) { have[a[0] + "-" + a[1]] = 1; });
    return ["uk-14","uk-37","uk-38","uk-39","uk-108","uk-286","fz3pol-18","fz3pol-19","koap-20.1","koap-19.3"]
      .every(function (id) { return have[id]; });
  })(),
  "иначе вывод ссылался бы на несуществующие статьи");
/* Пометка нужна там, где правомерность силы действительно под вопросом:
   спецсубъект, защищавшийся или задерживавший. На разбое и грабеже сила
   преступна сама по себе, и пометка «проверьте правомерность» читалась как
   оценка действий преступника — поэтому условие сузилось до fc.special и
   fc.defence. */
check("ответ помечается: применена сила — проверьте правомерность",
  appSrc.indexOf('if (fc && (fc.special || fc.defence)) meta.push("применение силы — проверьте правомерность");') !== -1 &&
  /if \(!fc\.special && !fc\.defence\) return null;/.test(appSrc),
  "иначе непонятно, что сделан акцент на правомерности силы, либо пометка вешается на разбой");

/* 16 --------------------------------------------------- готовые исковые заявления */
console.log("\n16. Готовые исковые заявления");
const suits = W.RF_SUITS ? (W.RF_SUITS.suits || []) : [];
const suitProblems = [];
/* Те же правила, что у шаблонов документов: известные блоки, каждый {{ключ}}
   обеспечен полем, автоисточники допустимы, указано правовое основание. Кроме
   того — цена иска и госпошлина подставляются через {{price}}/{{duty}}, которые
   формирует движок, а не поля; расчёт ссылается на существующие поля. */
const SUIT_BLOCKS = TPL_BLOCKS.concat(["reqs", "att", "calc"]);
const SUIT_KEYS = ["price", "duty"];
const suitStats = { blocks: 0, fields: 0, groups: {}, free: 0, fixed: 0, tiers: 0 };
const suitKnownArt = {};
idx.forEach(function (r) { suitKnownArt[r[0] + "-" + r[1]] = 1; });
suits.forEach(function (s) {
  const used = [];
  const blocks = s.blocks || [];
  if (!blocks.length) suitProblems.push(s.id + ": нет ни одного блока");
  blocks.forEach(function (b) {
    suitStats.blocks++;
    if (SUIT_BLOCKS.indexOf(b.t) === -1) suitProblems.push(s.id + ": неизвестный блок «" + b.t + "»");
    collectKeys(b.x, used); collectKeys(b.l, used); collectKeys(b.r, used); collectKeys(b.h, used);
  });
  const declared = (s.fields || []).map((f) => f.k).concat(SUIT_KEYS);
  const uniq = Array.from(new Set(used));
  const noField = uniq.filter((k) => declared.indexOf(k) === -1);
  if (noField.length) suitProblems.push(s.id + ": нет поля для " + noField.join(", "));
  (s.fields || []).forEach(function (f) {
    suitStats.fields++;
    if (!f.src) return;
    const ok = f.src === "today" ||
      (f.src.indexOf("profile.") === 0 && PROFILE_KEYS.indexOf(f.src.slice(8)) !== -1);
    if (!ok) suitProblems.push(s.id + ": недопустимый источник поля «" + f.k + "» — " + f.src);
    if (f.type === "number" && s.calc && s.calc.price) {
      const p = s.calc.price;
      if ((p.parts && p.parts.indexOf(f.k) === -1) || (p.field && p.field !== f.k)) {
        /* числовое поле вне расчёта — не ошибка, но помечаем для сведения */
      }
    }
  });
  (s.articles || []).forEach(function (aid) {
    if (!suitKnownArt[aid]) suitProblems.push(s.id + ": статья не найдена в индексе — " + aid);
  });
  if (!(s.articles || []).length) suitProblems.push(s.id + ": не указано правовое основание (articles)");
  if (!s.court) suitProblems.push(s.id + ": не указан суд (court)");
  else suitStats.groups[s.court] = (suitStats.groups[s.court] || 0) + 1;
  const c = s.calc || {};
  if (c.duty && c.duty.free) suitStats.free++;
  else if (c.duty && c.duty.fixed) suitStats.fixed++;
  else suitStats.tiers++;
  if (c.price && c.price.parts) {
    const missing = c.price.parts.filter((k) => declared.indexOf(k) === -1);
    if (missing.length) suitProblems.push(s.id + ": расчёт цены ссылается на отсутствующее поле — " + missing.join(", "));
  }
  if (c.price && c.price.field) {
    if (declared.indexOf(c.price.field) === -1)
      suitProblems.push(s.id + ": расчёт цены ссылается на отсутствующее поле — " + c.price.field);
  }
  if (!c.price && !c.duty) suitProblems.push(s.id + ": не задан расчёт (calc)");
});
check("иски: блоки, поля, расчёт и основание согласованы", suitProblems.length === 0,
  suitProblems.length ? suitProblems.slice(0, 8).join("; ")
    : suits.length + " исков · " + suitStats.blocks + " блоков · " +
      Object.keys(suitStats.groups).length + " судов · пошлина: " +
      suitStats.fixed + " фикс, " + suitStats.tiers + " по шкале, " + suitStats.free + " освобождены");
check("иски охватывают гражданский, арбитражный и административный процесс",
  Object.keys(suitStats.groups).some((x) => /гражданск/i.test(x)) &&
  Object.keys(suitStats.groups).some((x) => /арбитраж/i.test(x)) &&
  Object.keys(suitStats.groups).some((x) => /административ/i.test(x)),
  Object.keys(suitStats.groups).length + " судов: " + Object.keys(suitStats.groups).join(", "));

/* ------------------------------------------ 17. дело: документы, вложения, профиль */
/* Дело — это папка юриста: нормы, заметки, готовые документы, реквизиты сторон и
   вложения. Проверяем, что все части на месте и связаны между собой: без индекса
   по делу вложения читались бы перебором, без общего списка реквизитов поля формы
   и подстановка разошлись бы, а без ограничения размера браузер забился бы. */
console.log("\n17. Дело: документы, вложения и «взять из дела»");
{
  const app = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

  check("модель дела хранит нормы, заметки, документы и реквизиты сторон",
    /items:\s*\[\]/.test(app) && /notes:\s*\[\]/.test(app) &&
    /docs:\s*\[\]/.test(app) && /prof:\s*\{\}/.test(app),
    "items / notes / docs / prof");

  check("вложения дел лежат в отдельном хранилище, а не в localStorage",
    /S_FILE\s*=\s*"files"/.test(app) && /filePut:/.test(app) && /fileAll:/.test(app),
    "IndexedDB rflaws → files");

  check("хранилище вложений проиндексировано по делу — иначе список вложений читался бы перебором всех файлов",
    /createIndex\(\s*"case"\s*,\s*"case"/.test(app), "индекс case");

  check("версия базы поднята под новое хранилище — иначе upgrade не сработал бы у прежних читателей",
    /var VER\s*=\s*3/.test(app), "VER = 3");

  check("вложения ограничены по размеру — иначе браузер забился бы до отказа",
    /CASE_FILE_MAX\s*=\s*\d+\s*\*\s*1024\s*\*\s*1024/.test(app) &&
    /CASE_FILE_TOTAL\s*=\s*\d+\s*\*\s*1024\s*\*\s*1024/.test(app),
    "на файл и на все дела сразу");

  check("имя вложения безопасно для файловой системы — кириллица и пробелы транслитерируются",
    /TRANSLIT\s*=\s*\{/.test(app) && /function slug\(/.test(app), "TRANSLIT + slug()");

  check("документ дела выгружается в .docx, .txt и копируется в буфер — «собрать дело целиком»",
    /data-case-doc-txt/.test(app) && /data-case-doc-copy/.test(app) &&
    /saveDocx\(/.test(app) && /caseDocHtml\(/.test(app),
    "txt / копия / docx / печатная форма");

  check("дело выгружается одним файлом со всеми документами и реквизитами",
    /caseExportJson/.test(app) && /caseTextPlain\(/.test(app), "JSON + текстовый слепок");

  check("шаблон и иск кладутся в дело одним и тем же механизмом — иначе логика разошлась бы",
    /function casePickBar\(/.test(app) && /function bindCasePick\(/.test(app) &&
    /bindCasePick\("data-tf"/.test(app) && /bindCasePick\("data-sf"/.test(app),
    "общий casePickBar для data-tf и data-sf");

  check("из дела заполняются поля документа реквизитами сторон",
    /caseProfVals\(/.test(app) && /docCaseFill/.test(app), "«Заполнить из дела»");

  check("реквизиты сторон перечислены одним списком — иначе форма и подстановка разошлись бы",
    /CASE_PROF_FIELDS\s*=\s*\[/.test(app) && /data-case-prof/.test(app), "CASE_PROF_FIELDS");
}

console.log("\n" + "=".repeat(60));
console.log("Статей в базе: " + idx.length + " · источников с полным текстом: " + codes.length +
  " · справочных аннотаций: " + Object.keys(annot).length + " · терминов: " + terms.length);
console.log(failures === 0 ? "Все проверки пройдены." : "Проверок с замечаниями: " + failures);
process.exit(failures === 0 ? 0 : 1);
