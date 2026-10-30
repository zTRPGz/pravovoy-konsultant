/* ============================================================================
   Правовой консультант :: сплошной аудит данных
   ----------------------------------------------------------------------------
   Проверяет, что при сборке НИЧЕГО не потерялось и не перепуталось:

     A. Источник (vendor/ruslaw/*.json) -> индекс (data/index.js)
        — число статей, номера, названия, главы, пропуски нумерации.
     B. Структура индекса
        — дубли ID, пустые поля, корректность «наследования» глав.
     C. Полные тексты (data/full/*.js)
        — файл есть у каждого источника, записей столько же, поля совпадают.
     D. Полнотекстовый индекс (data/ft/*.js)
        — каждая статья проиндексирована, позиции не выходят за границы.
     E. Справочные слои
        — аннотации, статусы, сроки, памятки, разборы, перекрёстные ссылки.
     G. Заголовки глав (независимая проверка, без parse.js)
        — каждый класс заголовков (арабские/римские главы, разделы) должен
          попасть в индекс; иначе целая глава потеряна.
     F. Метаданные
        — реестр, снимок актуальности, реквизиты.

   Запуск:  node tools/audit.js
   Код возврата 1, если есть ошибки (не замечания).
   ============================================================================ */
"use strict";

const fs = require("fs");
const path = require("path");
const parse = require("./lib/parse.js");
const textlib = require("./lib/text.js");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "vendor", "ruslaw");
const DATA = path.join(ROOT, "data");
const FULL_DIR = path.join(DATA, "full");
const FT_DIR = path.join(DATA, "ft");

/* Есть ли сырые выгрузки источников. Каталог vendor/ в git не хранится: он
   появляется после ночной сборки (выгрузки качаются) и на машине, где
   прогоняли `npm run fetch`. Проверки A (источник ↔ индекс) и G (главы)
   сверяют базу с первоисточником — без выгрузок их не с чем сверять, и они
   пропускаются. Остальные проверки от выгрузок не зависят: структура индекса,
   полные тексты, полнотекстовый индекс, справочные слои, метаданные. */
const HAVE_VENDOR = fs.existsSync(path.join(SRC, "konst.json"));

const errors = [];
const notes = [];
const known = [];          /* сработавшие известные расхождения (baseline) */
const knownHit = {};       /* ключ «id/вид» -> true, чтобы заметить устаревшие записи */
const ok = (m) => console.log("  OK   " + m);
const warn = (m) => { notes.push(m); console.log("  !    " + m); };
const bad = (m) => { errors.push(m); console.log("  ОШИБКА " + m); };
const head = (t) => console.log("\n" + t);

/* ------------------------------------------------- известные расхождения
   Расхождения «источник ↔ индекс», которые лежат в САМОМ источнике
   (vendor/ruslaw): портал отдаёт оглавление иначе, чем текст, либо правки
   внесены заплаткой и меняют нумерацию глав. При сборке ничего не теряется —
   это не наша ошибка, и ночная приёмка не должна из-за них падать. Держим
   список явным: он и есть «baseline». Если запись перестала срабатывать,
   audit сообщает об этом замечанием — список не зарастает. */
/* Известных расхождений сейчас нет: сверка идёт по app_id, и позиции
   источника совпадают с индексом. Список оставлен на случай, если
   расхождение появится в самом источнике и его нельзя будет исправить
   немедленно — тогда запись сюда переносит ошибку в замечания. */
const KNOWN_SRC = {};

/* Ошибка по конкретному источнику: известные виды расхождений уходят в
   замечания, всё остальное — в ошибки. */
function badSrc(c, kind, msg) {
  if ((KNOWN_SRC[c.id] || []).indexOf(kind) !== -1) {
    knownHit[c.id + "/" + kind] = true;
    known.push(msg);
    console.log("  ИЗВЕСТНО " + msg);
    return;
  }
  bad(msg);
}

/* ---------------------------------------------------------------- загрузка */

function loadJSON(f) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return null; } }

/* Все файлы-источники: набор данных + заплатки + отдельные списки.
   Ключ — raw.name (он же записан в реестре как dataset).
   Законы «О внесении изменений» / «О поправках» — это акты, вносящие
   правки в базовые законы; их содержимое уже слито в базовый акт через
   патч (vendor/ruslaw/patch/), поэтому как самостоятельные источники они
   в реестре не числятся. Чтобы не шуметь ложными срабатываниями, такие
   файлы из аудита источников исключаем. */
const AMEND_RE = /^(о внесении изменений|о поправк|о внесении|о дополнении|о признании утративш)/i;
function collectSources() {
  const byName = {};
  const byKey = {};
  const add = (raw, file) => {
    if (raw && raw.name && Array.isArray(raw.articles) && !AMEND_RE.test(String(raw.name))) {
      /* Названия повторяются: 1032-I и 565-ФЗ называются одинаково
         «О занятости населения…», 62-ФЗ и 138-ФЗ — «О гражданстве…».
         Поэтому ключ по app_id точнее имени; имя остаётся запасным. */
      const entry = { raw, file };
      if (raw.app_id) byKey[raw.app_id] = entry;
      if (!byName[raw.name]) byName[raw.name] = entry;
    }
  };
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach((f) => {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.json$/.test(f)) add(loadJSON(p), p);
    });
  };
  walk(SRC);
  ["fkz.json", "laws-extra.json", "decrees.json", "ukazy.json"].forEach((f) => {
    const l = loadJSON(path.join(SRC, f));
    if (Array.isArray(l)) l.forEach((raw) => add(raw, f));
  });
  add(loadJSON(path.join(SRC, "konst.json")), "konst.json");
  /* Постановления Пленума ВС РФ: в byName не кладём — проверка глав рассчитана
     на маркеры «ГЛАВА N» кодексов, а у Пленумов главы другие. Для сверки
     «источник → индекс» они нужны по ключу, равному id источника в реестре. */
  const pl = loadJSON(path.join(SRC, "plenums.json"));
  if (Array.isArray(pl)) pl.forEach((raw) => { byKey[raw.app_id] = { raw: raw, file: "plenums.json" }; });
  /* Обзоры судебной практики и постановления Президиума ВС РФ — по той же
     причине: главы у них римские («I. Общие вопросы»), маркеров «ГЛАВА N» нет. */
  const rv = loadJSON(path.join(SRC, "reviews.json"));
  if (Array.isArray(rv)) rv.forEach((raw) => { byKey[raw.app_id] = { raw: raw, file: "reviews.json" }; });
  return { byName: byName, byKey: byKey };
}

/* Режим разбора ровно такой, как в tools/build-data.js */
function modeOf(kind) {
  return (kind === "constitution" || kind === "fkz" || kind === "decree" || kind === "ukaz" ||
    kind === "plenum" || kind === "review")
    ? "plain" : "articles";
}

/* Целые «мажорные» номера статей: 159.1 -> 159.
   Принимает либо записи источника ({n}), либо строки индекса ([code,n,t,g]). */
function majors(list) {
  const out = [];
  list.forEach((a) => {
    const num = Array.isArray(a) ? a[1] : (a && a.n);
    const m = /^(\d+)/.exec(String(num));
    if (m) out.push(parseInt(m[1], 10));
  });
  return out;
}

function gapList(nums) {
  const uniq = Array.from(new Set(nums)).sort((a, b) => a - b);
  if (!uniq.length) return { gaps: [], from: 0, to: 0 };
  const gaps = [];
  for (let v = uniq[0]; v <= uniq[uniq.length - 1]; v++) if (uniq.indexOf(v) === -1) gaps.push(v);
  return { gaps, from: uniq[0], to: uniq[uniq.length - 1] };
}

/* --------------------------------------------------- A. источник -> индекс */

function auditSourceToIndex() {
  head("A. Источник -> индекс");
  if (!HAVE_VENDOR) {
    console.log("  ПРОПУЩЕНО — нет каталога vendor/ (сырые выгрузки источников): сверять с первоисточником нечего");
    return;
  }
  const CODES = global.RF_CODES;
  const IDX = global.RF_IDX;
  const collected = collectSources();
  const byName = collected.byName, byKey = collected.byKey;
  const srcOf = (c) => byKey[c.id] || byName[c.dataset];

  const idxByCode = {};
  IDX.forEach((r) => { (idxByCode[r[0]] = idxByCode[r[0]] || []).push(r); });

  let checked = 0, countBad = 0, fieldBad = 0, chapterBad = 0, gapBad = 0, noSrc = 0;
  const noSrcList = [];

  CODES.forEach((c) => {
    const rows = idxByCode[c.id] || [];
    const src = srcOf(c);
    if (!src) { noSrc++; noSrcList.push(c.id + " «" + String(c.dataset).slice(0, 50) + "»"); return; }
    checked++;

    const res = parse.parseDoc(src.raw, { mode: modeOf(c.kind), chaptersInText: c.kind === "ukaz" });
    parse.dedupeNumbers(res.arts);
    const arts = res.arts;

    /* 1. количество */
    if (arts.length !== rows.length) {
      countBad++;
      badSrc(c, "count", c.short + ": в источнике " + arts.length + " записей, в индексе " + rows.length +
        " (расхождение " + (rows.length - arts.length) + ")");
    }
    if (typeof c.count === "number" && c.count !== rows.length) {
      badSrc(c, "registry-count", c.short + ": в реестре count=" + c.count + ", в индексе " + rows.length);
    }

    /* 2. номера и названия — по позициям */
    let diffs = 0, firstDiff = "";
    for (let i = 0; i < Math.min(arts.length, rows.length); i++) {
      const a = arts[i], r = rows[i];
      if (String(a.n) !== String(r[1]) || String(a.t) !== String(r[2])) {
        diffs++;
        if (!firstDiff) firstDiff = "поз. " + (i + 1) + ": источник «" + a.n + " / " + String(a.t).slice(0, 40) + "» vs индекс «" + r[1] + " / " + String(r[2]).slice(0, 40) + "»";
      }
    }
    if (diffs) { fieldBad++; badSrc(c, "fields", c.short + ": расхождений по позициям — " + diffs + " (" + firstDiff + ")"); }

    /* 3. главы: восстанавливаем наследование как это делает app.js и сверяем с источником */
    const last = {};
    let chDiff = 0, chSample = "";
    rows.forEach((r, i) => {
      let g;
      if (r[3] === "~") g = "";
      else if (r[3]) { g = r[3]; last[r[0]] = r[3]; }
      else g = (last[r[0]] !== undefined ? last[r[0]] : "");
      const want = (arts[i] && arts[i].g) || "";
      if (g !== want) { chDiff++; if (!chSample) chSample = "поз. " + (i + 1) + ": «" + String(g).slice(0, 40) + "» vs «" + String(want).slice(0, 40) + "»"; }
    });
    if (chDiff) { chapterBad++; badSrc(c, "chapters", c.short + ": глав не совпало — " + chDiff + " (" + chSample + ")"); }

    /* 4. пропуски нумерации: должны быть такими же, как в источнике */
    const gs = gapList(majors(arts)), gi = gapList(majors(rows));
    if (gs.gaps.join(",") !== gi.gaps.join(",")) {
      gapBad++;
      badSrc(c, "gaps", c.short + ": пропуски нумерации не совпадают с источником (источник " + gs.gaps.length + ", индекс " + gi.gaps.length + ")");
    }
  });

  if (noSrc) bad("не найден исходный файл у источников: " + noSrc + " (" + noSrcList.slice(0, 5).join("; ") + ")");
  if (!countBad && !fieldBad && !chapterBad && !gapBad) ok("источник и индекс совпадают полностью — " + checked + " источников, статьи/названия/главы/пропуски");
  if (known.length) ok("известных расхождений источника и индекса: " + known.length + " (baseline KNOWN_SRC — расхождение в самом источнике, потерь при сборке нет)");

  /* Список известных расхождений не должен зарастать: если запись больше не
     срабатывает, источник починили (или правку откатили) — её надо убрать. */
  const staleKnown = [];
  Object.keys(KNOWN_SRC).forEach((id) => {
    KNOWN_SRC[id].forEach((kind) => { if (!knownHit[id + "/" + kind]) staleKnown.push(id + "/" + kind); });
  });
  if (staleKnown.length) warn("известное расхождение больше не воспроизводится — уберите из KNOWN_SRC: " + staleKnown.join(", "));

  /* файлы набора данных, не попавшие в реестр */
  const used = {};
  CODES.forEach((c) => { used[c.dataset] = 1; });
  const unused = Object.keys(byName).filter((n) => !used[n]);
  if (unused.length) warn("файлов в vendor/ruslaw вне реестра: " + unused.length + " (" + unused.slice(0, 3).map((s) => "«" + s.slice(0, 55) + "»").join("; ") + ")");
}

/* --------------------------------------------------- B. структура индекса */

function auditIndexStructure() {
  head("B. Структура индекса");
  const IDX = global.RF_IDX;
  const CODES = global.RF_CODES;

  let badShape = 0, emptyT = 0, emptyN = 0, longT = 0, badLen = 0;
  IDX.forEach((r) => {
    /* Пятое поле — длина текста статьи в основах слов; без неё не работает
       нормировка BM25 в полнотекстовом поиске. */
    if (!Array.isArray(r) || r.length !== 5) { badShape++; return; }
    if (typeof r[0] !== "string" || !r[0] || typeof r[3] !== "string") badShape++;
    if (!(typeof r[4] === "number" && r[4] > 0)) badLen++;
    if (!r[1]) emptyN++;
    if (!r[2]) emptyT++;
    if (String(r[2]).length > 170) longT++;
  });
  if (badShape) bad("записей неверного формата: " + badShape); else ok("формат записей корректен — " + IDX.length);
  if (badLen) bad("записей без длины текста: " + badLen); else ok("у всех записей есть длина текста");
  if (emptyN) bad("записей без номера: " + emptyN);
  if (emptyT) bad("записей без названия: " + emptyT); else ok("пустых названий нет");
  if (longT) warn("названий длиннее 170 знаков: " + longT + " (это первое предложение статьи, не ошибка)");

  const seen = {};
  let dup = 0, dupSample = "";
  IDX.forEach((r) => { const k = r[0] + "-" + r[1]; if (seen[k]) { dup++; if (!dupSample) dupSample = k; } else seen[k] = 1; });
  if (dup) bad("дублирующихся ID статей: " + dup + " (напр. " + dupSample + ")"); else ok("ID статей уникальны — " + IDX.length);

  /* маркер "~" (главы нет) — допустим только там, где главы нет у самого источника */
  const tilde = IDX.filter((r) => r[3] === "~");
  ok("маркер «главы нет» встречается " + tilde.length + " раз" + (tilde.length ? " (" + tilde.slice(0, 3).map((r) => r[0] + "-" + r[1]).join(", ") + ")" : ""));

  /* первая запись источника: "" означает «главы нет» — это нормально */
  let leadEmpty = 0;
  const perCode = {};
  IDX.forEach((r) => { if (!perCode[r[0]]) perCode[r[0]] = []; perCode[r[0]].push(r); });
  Object.keys(perCode).forEach((id) => { let i = 0; while (i < perCode[id].length && perCode[id][i][3] === "") { leadEmpty++; i++; } });
  console.log("         записей до первой главы (преамбула и т. п.): " + leadEmpty);

  const noCh = CODES.filter((c) => !IDX.some((r) => r[0] === c.id && r[3] && r[3] !== "~" && r[3] !== ""));
  console.log("         источников без глав: " + noCh.length + " из " + CODES.length + " (короткие законы — норма)");

  /* Короткие акты Пленума — это изменяющие постановления и акты о дне начала
     деятельности судов; для них 1–8 пунктов нормально, в общее замечание не
     включаем, но показываем отдельной строкой. Обзоры судебной практики —
     тем более: у обзора сплошного изложения единица цитирования одна. */
  const isShortByNature = (c) => c.kind === "plenum" || c.kind === "review";
  const small = CODES.map((c) => ({ c, n: (perCode[c.id] || []).length }))
    .filter((x) => x.n < 10 && !isShortByNature(x.c));
  if (small.length) warn("источников с менее чем 10 статьями: " + small.map((x) => x.c.short + "=" + x.n).join(", "));
  else ok("нет источников с подозрительно малым числом статей");
  const smallPl = CODES.filter((c) => c.kind === "plenum" && (perCode[c.id] || []).length < 10).length;
  console.log("         постановлений Пленума с менее чем 10 пунктами: " + smallPl + " (изменяющие акты — норма)");
  const rvAll = CODES.filter((c) => c.kind === "review");
  const rvOne = rvAll.filter((c) => (perCode[c.id] || []).length === 1).length;
  console.log("         обзоров судебной практики: " + rvAll.length +
    ", из них одним документом (сплошное изложение без нумерации): " + rvOne);
}

/* --------------------------------------------------- C. полные тексты */

function auditFull() {
  head("C. Полные тексты (data/full/*.js)");
  const IDX = global.RF_IDX;
  const CODES = global.RF_CODES;

  const idxByCode = {};
  IDX.forEach((r, i) => { (idxByCode[r[0]] = idxByCode[r[0]] || []).push({ r, i }); });

  const PLENUM_IDS = {};
  CODES.forEach((c) => {
    /* У постановлений Пленума и обзоров судебной практики дата редакции одна
       на весь акт — она в реестре, а не в тексте каждого пункта. */
    if (c.kind === "plenum" || c.kind === "review") PLENUM_IDS[c.id] = 1;
  });

  const ids = fs.readdirSync(FULL_DIR).filter((f) => /\.js$/.test(f)).map((f) => f.replace(/\.js$/, ""));
  const missing = CODES.filter((c) => ids.indexOf(c.id) === -1);
  if (missing.length) bad("нет файла полного текста у источников: " + missing.map((c) => c.id).join(", "));
  const extra = ids.filter((id) => !CODES.some((c) => c.id === id));
  if (extra.length) warn("файлы полного текста без источника в реестре: " + extra.join(", "));

  let totalEntries = 0, mismatch = 0, fieldDiff = 0, emptyText = 0, noRed = 0;
  const samples = [];
  ids.forEach((id) => {
    const rows = idxByCode[id] || [];
    if (!rows.length) return;
    global.RF_FULL = {};
    const p = path.join(FULL_DIR, id + ".js");
    try { delete require.cache[require.resolve(p)]; } catch (e) {}
    try { require(p); } catch (e) { bad("не читается " + id + ".js: " + e.message); return; }
    const full = global.RF_FULL[id];
    if (!Array.isArray(full)) { bad(id + ".js: RF_FULL[" + id + "] не массив"); return; }
    totalEntries += full.length;
    if (full.length !== rows.length) {
      mismatch++;
      bad(id + ": в индексе " + rows.length + " статей, в полном тексте " + full.length);
    }
    for (let k = 0; k < Math.min(full.length, rows.length); k++) {
      const e = full[k], r = rows[k].r;
      if (!Array.isArray(e) || e.length !== 5) { fieldDiff++; if (samples.length < 3) samples.push(id + "[" + k + "]: не 5 полей"); continue; }
      if (String(e[0]) !== String(r[1])) { fieldDiff++; if (samples.length < 3) samples.push(id + "[" + k + "]: номер " + e[0] + " vs " + r[1]); }
      if (String(e[1]) !== String(r[2])) { fieldDiff++; if (samples.length < 3) samples.push(id + "[" + k + "]: название не совпало"); }
      if (!e[4] || !String(e[4]).trim()) emptyText++;
      /* Дата редакции в тексте нормы — приём кодексов («в редакции Федерального
         закона …»). У постановлений Пленума таких пометок нет: редакция одна на
         весь акт, она хранится в реестре. Поэтому их в счёт не берём. */
      if (!e[3] && !PLENUM_IDS[id]) noRed++;
    }
  });
  if (fieldDiff) bad("расхождений полей индекс/полный текст: " + fieldDiff + " (" + samples.join("; ") + ")");
  else if (!mismatch) ok("полные тексты совпадают с индексом — " + ids.length + " файлов, " + totalEntries + " статей");
  if (emptyText) bad("статей с пустым текстом: " + emptyText); else ok("пустых текстов нет");
  if (noRed) warn("статей без даты редакции: " + noRed);
}

/* --------------------------------------------------- D. полнотекстовый индекс */

function auditFt() {
  head("D. Полнотекстовый индекс (data/ft/*.js)");
  global.RF_FT = {};
  require(path.join(FT_DIR, "meta.js"));
  const meta = global.RF_FT_META;
  if (!meta) { bad("нет RF_FT_META"); return; }
  console.log("         сегментов " + meta.shards + ", документов " + meta.docs + ", основ " + meta.stems + ", вхождений " + meta.postings);

  if (meta.docs !== global.RF_IDX.length) bad("в мете " + meta.docs + " документов, в индексе " + global.RF_IDX.length);
  else ok("число документов совпадает с индексом");

  const shardFiles = fs.readdirSync(FT_DIR).filter((f) => /^\d+\.js$/.test(f));
  if (shardFiles.length !== meta.shards) bad("файлов сегментов " + shardFiles.length + ", в мете " + meta.shards);
  else ok("все сегменты на месте — " + shardFiles.length);

  shardFiles.forEach((f) => require(path.join(FT_DIR, f)));
  const shards = global.RF_FT || {};
  const covered = new Uint8Array(global.RF_IDX.length);
  let postings = 0, outOfRange = 0, emptyStem = 0, badStem = 0, stems = 0, badShard = 0, badTf = 0;

  /* постинги хранятся в сжатом виде (дельта-кодирование по основанию 36,
     частота слова — через «~») — раскодируем тем же модулем, что и приложение */
  Object.keys(shards).forEach((key) => {
    const data = shards[key];
    if (!data || typeof data !== "object") { badShard++; return; }
    Object.keys(data).forEach((stem) => {
      if (!stem) { emptyStem++; return; }
      stems++;
      if (!/^[а-яёa-z0-9]+$/.test(stem)) badStem++;
      let arr;
      try { arr = textlib.decPairs(data[stem]); } catch (e) { badShard++; return; }
      if (!Array.isArray(arr)) return;
      postings += arr.length;
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i][0], tf = arr[i][1];
        if (p < 0 || p >= covered.length) { outOfRange++; continue; }
        if (!(tf >= 1) || tf > 100000) { badTf++; continue; }
        covered[p] = 1;
      }
    });
  });
  if (badShard) bad("сегментов полнотекстового индекса не удалось прочитать: " + badShard);
  if (emptyStem) bad("пустых основ в полнотекстовом индексе: " + emptyStem);
  if (badStem) warn("основ с необычными символами: " + badStem);
  if (badTf) bad("частот слова вне разумных пределов: " + badTf);
  if (outOfRange) bad("ссылок за границы индекса: " + outOfRange); else ok("все ссылки полнотекстового индекса в границах");
  if (stems !== meta.stems) warn("основ в файлах " + stems + ", в мете " + meta.stems); else ok("число основ совпадает с метой — " + stems);
  if (postings !== meta.postings) warn("пар «слово-статья» в файлах " + postings + ", в мете " + meta.postings); else ok("число пар «слово-статья» совпадает с метой — " + postings);

  /* Длины документов нужны BM25: по ним считается нормировка. Если сумма
     длин в индексе статей разойдётся с meta.tokens, вес документов поедет,
     а выдача перестанет быть предсказуемой. */
  const lenSum = global.RF_IDX.reduce((s, r) => s + (r[4] || 0), 0);
  const noLen = global.RF_IDX.filter((r) => !(r[4] > 0)).length;
  if (noLen) bad("статей без длины текста в индексе: " + noLen);
  else ok("у всех статей есть длина текста для нормировки BM25");
  if (meta.tokens && lenSum !== meta.tokens) bad("сумма длин " + lenSum + ", в мете tokens " + meta.tokens);
  else ok("сумма длин текстов совпадает с метой — " + lenSum);

  let notCovered = 0, firstNot = "";
  for (let i = 0; i < covered.length; i++) {
    if (!covered[i]) { notCovered++; if (!firstNot) firstNot = global.RF_IDX[i][0] + "-" + global.RF_IDX[i][1]; }
  }
  if (notCovered) bad("статей, не попавших в полнотекстовый индекс: " + notCovered + " (напр. " + firstNot + ")");
  else ok("все статьи проиндексированы для поиска по тексту");
}

/* --------------------------------------------------- E. справочные слои */

function auditRefs() {
  head("E. Справочные слои и ссылки");
  const valid = {};
  global.RF_IDX.forEach((r) => { valid[r[0] + "-" + r[1]] = 1; });

  const checkIds = (label, ids) => {
    const badOnes = Array.from(new Set(ids.filter((id) => id && !valid[id])));
    if (badOnes.length) bad(label + ": ссылки на несуществующие статьи — " + badOnes.length + " (" + badOnes.slice(0, 6).join(", ") + ")");
    else ok(label + ": все ссылки живые (" + ids.length + ")");
  };

  require(path.join(DATA, "annotations.js"));
  const annot = global.RF_ANNOT || {};
  const annotIds = Object.keys(annot);
  checkIds("аннотации", annotIds);

  require(path.join(DATA, "status.js"));
  checkIds("статусы", Object.keys(global.RF_STATUS || {}));

  require(path.join(DATA, "40-reference.js"));
  const REF = global.RF_REF || {};
  const refIds = [];
  (REF.deadlines || []).forEach((d) => (d.articles || []).forEach((a) => refIds.push(a)));
  (REF.help || []).forEach((h) => (h.articles || []).forEach((a) => refIds.push(a)));
  (REF.intents || []).forEach((h) => (h.articles || []).forEach((a) => refIds.push(a)));
  (REF.scenarios || []).forEach((h) => (h.articles || []).forEach((a) => refIds.push(a)));
  (REF.checklists || []).forEach((h) => (h.articles || []).forEach((a) => refIds.push(a)));
  (REF.templates || []).forEach((h) => (h.articles || []).forEach((a) => refIds.push(a)));
  checkIds("справочник (сроки, памятки, чек-листы, разборы, шаблоны)", refIds);

  let needBad = 0, needSample = "";
  (REF.help || []).forEach((h) => {
    const keys = {};
    (h.qs || []).forEach((q) => (q.opts || []).forEach((o) => { keys[o.k] = 1; }));
    (h.qual || []).forEach((q) => (q.need || []).forEach((k) => { if (!keys[k]) { needBad++; if (!needSample) needSample = h.id + " -> " + k; } }));
  });
  if (needBad) bad("разборы: условия ссылаются на несуществующие варианты ответов — " + needBad + " (" + needSample + ")");
  else ok("разборы: условия согласованы с вариантами ответов (" + (REF.help || []).length + ")");

  const noArts = (REF.help || []).filter((h) => !(h.articles || []).length);
  if (noArts.length) bad("разборы без статей: " + noArts.map((h) => h.id).join(", ")); else ok("у каждого разбора есть статьи");

  const dupIds = {};
  let refDup = 0;
  ["help", "intents", "scenarios", "checklists", "deadlines", "templates"].forEach((k) => {
    (REF[k] || []).forEach((x) => { if (x.id) { if (dupIds[k + ":" + x.id]) refDup++; else dupIds[k + ":" + x.id] = 1; } });
  });
  if (refDup) bad("дублирующиеся id в справочнике: " + refDup); else ok("id справочника уникальны");

  if (fs.existsSync(path.join(DATA, "xref.js"))) {
    require(path.join(DATA, "xref.js"));
    const xr = global.RF_XREF;
    if (xr) {
      const xIds = [];
      const walk = (o, depth) => {
        if (!o || typeof o !== "object" || depth > 4) return;
        Object.keys(o).forEach((k) => {
          const v = o[k];
          if (typeof v === "string" && /^[a-z0-9]+-\d/.test(v)) xIds.push(v);
          else if (Array.isArray(v)) v.forEach((x) => { if (typeof x === "string" && /^[a-z0-9]+-\d/.test(x)) xIds.push(x); });
          else if (v && typeof v === "object") walk(v, depth + 1);
        });
      };
      walk(xr, 0);
      if (xIds.length) checkIds("перекрёстные ссылки", xIds);
      else console.log("         перекрёстные ссылки вычисляются на месте (данных для сверки нет)");
    }
  }
}

/* --------------------------------------------------- G. главы: источник -> индекс
   Отдельная независимая проверка (собственные регулярки, БЕЗ parse.js).
   Ловит регресс класса «целая глава исчезла»: заголовок главы/раздела есть в
   тексте источника, но не распознан и не попал в индекс. Так ломались главы,
   написанные: 1) в другом регистре («Глава 5.» вместо «ГЛАВА 5.»);
   2) римскими цифрами («ГЛАВА I.» вместо «ГЛАВА 5.»). Проверяем по классам:
   арабские главы, римские главы, разделы. */

function auditChapters() {
  head("G. Заголовки глав в источнике -> главы в индексе");
  if (!HAVE_VENDOR) {
    console.log("  ПРОПУЩЕНО — нет каталога vendor/ (сырые выгрузки источников)");
    return;
  }
  const CODES = global.RF_CODES, IDX = global.RF_IDX;
  const collected = collectSources();
  const byName = collected.byName, byKey = collected.byKey;
  const idxByCode = {};
  IDX.forEach((r) => { (idxByCode[r[0]] = idxByCode[r[0]] || []).push(r); });

  const RAW_ARAB = /^(?:ГЛАВА|Глава|глава)\s+\d/;
  const RAW_ROMAN = /^(?:ГЛАВА|Глава|глава)\s+[IVXLC]+(?=\s|$|\.)/;
  /* Заголовок раздела — «РАЗДЕЛ II.» / «Раздел III. ФУНКЦИИ…»: после номера
     стоит точка. Без неё строка почти всегда не заголовок, а ссылка внутри
     текста статьи («раздел II Указа Президиума Верховного Совета РСФСР…»),
     и такая ссылка давала ложную ошибку «раздел есть в источнике, а в
     индексе его нет» (ФЗ № 120 о профилактике безнадзорности). */
  const RAW_RZ = /^(?:РАЗДЕЛ|Раздел|раздел)\s+[IVXLC]+\s*\./;
  /* В индексе на статью хранится ОДНА группа: глава, если она есть, иначе
     раздел. Поэтому раздел как группа обязателен только там, где глав нет. */
  const IDX_ARAB = /^глава\s+\d/i;
  const IDX_ROMAN = /^глава\s+[IVXLC]/i;
  const IDX_RZ = /^раздел\s+[IVXLC]/i;

  let checked = 0, badCnt = 0;
  const allIdxCh = new Set();
  CODES.forEach((c) => {
    const src = byKey[c.id] || byName[c.dataset];
    if (!src) return;
    checked++;
    const rows = idxByCode[c.id] || [];
    const chIdx = new Set();
    rows.forEach((r) => { if (r[3] && r[3] !== "~") chIdx.add(r[3]); });
    chIdx.forEach((g) => allIdxCh.add(g));

    let iArab = 0, iRoman = 0, iRz = 0;
    chIdx.forEach((g) => {
      if (IDX_ARAB.test(g)) iArab++;
      else if (IDX_ROMAN.test(g)) iRoman++;
      else if (IDX_RZ.test(g)) iRz++;
    });

    let rArab = 0, rRoman = 0, rRz = 0;
    src.raw.articles.forEach((a) => String(a.text || "").split("\n").forEach((l) => {
      const s = l.trim();
      if (RAW_ARAB.test(s)) rArab++;
      else if (RAW_ROMAN.test(s)) rRoman++;
      if (RAW_RZ.test(s)) rRz++;
    }));

    const miss = [];
    if (rArab && !iArab) miss.push("арабские главы (в источнике " + rArab + ")");
    if (rRoman && !iRoman) miss.push("римские главы (в источнике " + rRoman + ")");
    if (!rArab && !rRoman && rRz && !iRz) miss.push("разделы (в источнике " + rRz + ")");
    if (miss.length) { badCnt++; bad(c.short + ": заголовки есть в источнике, но глав в индексе нет — " + miss.join(", ")); }
  });
  if (!badCnt) ok("все заголовки глав и разделов источника попали в индекс — " + checked + " источников, " + allIdxCh.size + " различных глав");
}

/* --------------------------------------------------- F. метаданные */

function auditMeta() {
  head("F. Метаданные");
  const CODES = global.RF_CODES;

  require(path.join(DATA, "freshness.js"));
  const fdocs = Object.keys((global.RF_FRESH || {}).docs || {});
  if (fdocs.length !== CODES.length) warn("снимок актуальности: " + fdocs.length + " записей на " + CODES.length + " источников");
  else ok("снимок актуальности покрывает все источники");

  let noRed = 0, noUrl = 0, noBranch = 0, noAdopted = 0;
  CODES.forEach((c) => {
    if (!c.redaction) noRed++;
    if (!c.source_url) noUrl++;
    if (!c.branch) noBranch++;
    if (!c.adopted) noAdopted++;
  });
  if (noRed) warn("источников без даты редакции: " + noRed);
  if (noUrl) warn("источников без ссылки на официальный источник: " + noUrl);
  if (noBranch) warn("источников без отрасли: " + noBranch);
  if (noAdopted) warn("источников без даты принятия: " + noAdopted);
  if (!noRed && !noUrl && !noBranch && !noAdopted) ok("реквизиты источников заполнены");

  const byShort = {};
  let dupShort = 0;
  CODES.forEach((c) => { if (byShort[c.short]) dupShort++; else byShort[c.short] = 1; });
  if (dupShort) warn("источников с повторяющимся кратким названием: " + dupShort);

  const kinds = {};
  CODES.forEach((c) => { kinds[c.kind] = (kinds[c.kind] || 0) + 1; });
  console.log("         виды актов: " + Object.keys(kinds).map((k) => k + "=" + kinds[k]).join(", "));
  console.log("         всего статей: " + global.RF_IDX.length);
}

/* --------------------------------------------------- запуск */

console.log("Правовой консультант :: сплошной аудит данных");
console.log("=".repeat(64));

global.window = global;
require(path.join(DATA, "registry.js"));
require(path.join(DATA, "index.js"));

auditSourceToIndex();
auditIndexStructure();
auditFull();
auditFt();
auditRefs();
auditChapters();
auditMeta();

console.log("\n" + "=".repeat(64));
console.log("Ошибок: " + errors.length + " · замечаний: " + notes.length +
  (known.length ? " · известных расхождений: " + known.length : ""));
if (errors.length) { console.log("\nОШИБКИ:"); errors.forEach((e) => console.log("  - " + e)); }
if (notes.length) { console.log("\nЗАМЕЧАНИЯ:"); notes.forEach((n) => console.log("  - " + n)); }
if (known.length) { console.log("\nИЗВЕСТНЫЕ РАСХОЖДЕНИЯ (baseline KNOWN_SRC, не ошибки):"); known.forEach((k) => console.log("  - " + k)); }
if (!errors.length) console.log("\nЦелостность данных подтверждена: потерь статей и глав не найдено.");
process.exit(errors.length ? 1 : 0);
