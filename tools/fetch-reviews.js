#!/usr/bin/env node
/* ============================================================================
   Правовой консультант :: загрузка обзоров судебной практики ВС РФ

   Источник — sudact.ru, раздел /vsrf/presidium/ (каталог) и /law/<slug>/ (текст).
   Раздел называется «Президиум Верховного Суда Российской Федерации» и содержит
   то, чем судебная практика живёт на самом деле:

     • обзоры судебной практики ВС РФ — ежеквартальные, N 1–4 за год;
     • тематические обзоры ВС РФ — по отдельным категориям дел;
     • обзоры по отдельным вопросам судебной практики;
     • постановления Президиума ВС РФ, которыми эти обзоры утверждены.

   Постановления Пленума берутся отдельно (tools/fetch-plenums.js, раздел
   /vsrf/plenum/): Пленум разъясняет, Президиум обобщает практику — это разные
   виды актов, и в приложении они тоже разделены.

   ---------------------------------------------------------------------------
   Почему не все документы раздела попадают в набор

   Часть документов на источнике свёрстана как ДЕРЕВО подстраниц: сама страница
   содержит только шапку, а текст разложен по узлам («Президиум», «Судебная
   коллегия по гражданским делам», её подразделы и так далее), у каждого узла
   своя нумерация пунктов, и она то продолжается через узлы, то начинается
   заново с единицы. Собрать из такого дерева один документ, не перепутав
   номера пунктов, нельзя, а ссылка на пункт с неверным номером в правовом
   справочнике хуже, чем отсутствие документа. Поэтому такие документы
   пропускаются: в наборе только те, чей текст целиком лежит на одной странице
   и нумеруется самой страницей. Сколько пропущено — печатается в отчёте.

   Но пропуск — не повод выбрасывать уже загруженное: если документ был в
   прошлом наборе (vendor/ruslaw/reviews.json), его текст остаётся как есть.
   Иначе смена вёрстки на портале выглядела бы как исчезновение обзора из
   приложения — а он в базе есть, и ссылка на источник у него рабочая.
   Совсем новый документ, свёрстанный деревом, в набор не попадает: собрать
   его нечем.

   ---------------------------------------------------------------------------
   Результат: vendor/ruslaw/reviews.json — форма, совместимая с plenums.json
   (kind «review», режим разбора «plain» в tools/build-data.js).

   Запуск:
     node tools/fetch-reviews.js --list     только каталог, без текстов
     node tools/fetch-reviews.js --probe 3  первые 3 документа + разбор
     node tools/fetch-reviews.js            полная загрузка
     node tools/fetch-reviews.js --force    перекачать уже загруженное
     node tools/fetch-reviews.js --check    сравнить загруженное с живым каталогом
   ============================================================================ */
"use strict";

const fs = require("fs");
const path = require("path");
const P = require("./fetch-plenums.js");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "vendor", "ruslaw");
const OUT = path.join(SRC, "reviews.json");
const LIST_URL = P.BASE + "/vsrf/presidium/";
const CATALOGUE = "/vsrf/presidium/";
const MAX_PAGES = 12;   // предохранитель от бесконечной пагинации

const argv = process.argv.slice(2);
const FLAG_LIST = argv.indexOf("--list") !== -1;
const FLAG_CHECK = argv.indexOf("--check") !== -1;
const probeIdx = argv.indexOf("--probe");
const PROBE = probeIdx !== -1 ? parseInt(argv[probeIdx + 1] || "3", 10) : 0;

/* ---------------------------------------------------------------- каталог */

/* Внутри ссылки каталога встречаются угловые скобки как часть названия —
   «<Ответ на вопрос о применении судами законодательства …>». Настоящие теги
   в разметке каталога только <b>, <i> и <br/>: отличаем их от скобок по
   следующему/предыдущему символу, иначе название целиком пропало бы. */
function anchorText(html) {
  let s = html.replace(/<br\s*\/?>/gi, " ");
  s = s.replace(/<(?![a-zA-Z/])/g, "«").replace(/(?<![a-zA-Z/"])>/g, "»");
  return P.decodeEntities(s.replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function parseList(html) {
  const out = [];
  const re = /<a\s+href="(\/law\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const slug = m[1].replace(/^\//, "").replace(/\/$/, "");
    const text = anchorText(m[2]);
    if (!text) continue;
    out.push({ slug: slug, url: P.BASE + "/" + slug + "/", title: text });
  }
  return out;
}

async function loadCatalogue(noCache) {
  const seen = Object.create(null);
  const all = [];
  for (let p = 1; p <= MAX_PAGES; p++) {
    const url = p === 1 ? LIST_URL : LIST_URL + "?page=" + p;
    const html = await P.getCached(url, "rev-list-p" + p, noCache);
    if (!html) break;
    const rows = parseList(html);
    if (!rows.length) break;
    let fresh = 0;
    rows.forEach((r) => {
      if (seen[r.slug]) return;
      seen[r.slug] = 1;
      all.push(r);
      fresh++;
    });
    process.stdout.write("  стр. " + p + ": " + rows.length + " (" + fresh + " новых)\n");
    if (!fresh) break;
  }
  return all;
}

/* ------------------------------------------------------- реквизиты обзора

   Единого шаблона у раздела нет, встречаются четыре вида записи:

     Постановление Президиума Верховного Суда РФ от 01.07.2026 N 18А/2026 "…"
     "Обзор судебной практики ВС РФ N 3 (2017)" (утв. Президиумом ВС РФ 12.07.2017)
     "Тематический обзор ВС РФ N 13/2026. О судебной практике …" (утв. … от 01.07.2026)
     "Обзор судебной практики по делам о защите прав потребителей" (утв. … 23.10.2024)

   Поэтому дату, номер и «хвост» утверждения вытаскиваем по отдельности, а не
   одним регулярным выражением.

   Главная ловушка: в хвосте «(утв. … от 01.07.2026 N 17А/2026)» стоит номер
   УТВЕРЖДАЮЩЕГО постановления, а свой номер обзора — в самом названии
   («Тематический обзор … N 14/2026»). Поиск номера по всей строке отдавал
   победу чужому номеру, и 21 тематический обзор получал идентификатор
   постановления Президиума. Поэтому название и хвост разбираются раздельно. */

/* Группа в скобках от позиции start до парной закрывающей. Нужна потому, что
   внутри «(утв. …)» встречаются свои скобки и кавычки, и `[^)]*` обрывается
   на первой же из них. */
function parenGroup(s, start) {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") { depth--; if (!depth) return s.slice(start, i + 1); }
  }
  return s.slice(start);
}

/* Убирает все группы «(утв. …)» из строки, не спотыкаясь о вложенные скобки. */
function dropUtv(s) {
  let out = s;
  for (let at = out.search(/\(утв\./i); at >= 0; at = out.search(/\(утв\./i)) {
    const grp = parenGroup(out, at);
    out = out.slice(0, at) + out.slice(at + grp.length);
  }
  return out;
}

/* Разбор заголовка. Принимает СТРОКУ, а не запись каталога: заголовок самой
   страницы (h1) полнее — каталог обрезает длинные названия многоточием и
   вместе с ними теряет хвост «(утв. …)» с датой. Из-за этого 21 документ
   оставался без даты принятия и получал идентификатор из адреса. */
function reviewMeta(title) {
  const t = String(title || "");

  /* Граница названия и служебного хвоста: «(утв. …)» либо «(редакция …)». */
  const cut = t.search(/\s*\((?:утв\.|редакция\b|ред\.)/i);
  const main = cut >= 0 ? t.slice(0, cut) : t;
  const tail = cut >= 0 ? t.slice(cut) : "";

  /* редакция: «(редакция от 29.04.2026)» / «(ред. от 29.04.2026)» */
  const redM = /\((?:редакция|ред\.)\s+от\s+(\d{2}\.\d{2}\.\d{4})\)/i.exec(t);
  const redaction = redM ? redM[1] : "";

  /* дата принятия: первая дата внутри «(утв. …)»; иначе «от DD.MM.YYYY»
     в названии; иначе любая дата. */
  let adopted = "";
  const uwAt = t.search(/\(утв\./i);
  if (uwAt >= 0) {
    const grp = parenGroup(t, uwAt);
    const ds = grp.match(/\d{2}\.\d{2}\.\d{4}/g);
    if (ds) adopted = ds[0];
  }
  if (!adopted) {
    const dM = /\bот\s+(\d{2}\.\d{2}\.\d{4})/.exec(main);
    if (dM) adopted = dM[1];
  }
  if (!adopted) {
    const anyD = /(\d{2}\.\d{2}\.\d{4})/.exec(t);
    adopted = anyD ? anyD[1] : "";
  }

  /* номер: «N 14/2026», «N 18А/2026», «N 3 (2017)», «N 2, 3 (2024)», «N 821».
     Ищем ТОЛЬКО в названии — в хвосте чужой номер утвердившего акта. */
  let number = "";
  let year = "";
  let form = "none";
  const n1 = /\bN\s*(\d+[А-Яа-яA-Za-z]?\/\d{4})/.exec(main);
  const n2 = /\bN\s*(\d+(?:\s*,\s*\d+)*)\s*\((\d{4})\)/.exec(main);
  const n3 = /\bN\s*(\d+(?:\s*,\s*\d+)*[А-Яа-яA-Za-z]?)(?![\d/-])/.exec(main);
  if (n1) { number = n1[1]; year = n1[1].slice(-4); form = "n1"; }
  else if (n2) { number = n2[1]; year = n2[2]; form = "n2"; }
  else if (n3) { number = n3[1]; year = (adopted || "").slice(-4); form = "n3"; }
  else { year = (adopted || "").slice(-4); }

  /* Название без служебных хвостов: «(утв. …)», «(редакция от …)» */
  const name = dropUtv(tail ? main : t)
    .replace(/\s*\((?:редакция|ред\.)\s+от\s+\d{2}\.\d{2}\.\d{4}\)/gi, "")
    .replace(/^["«„]/, "").replace(/["»“]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();

  const thematic = /^Тематическ/i.test(name);
  const presidium = /^Постановление\s+Президиума/i.test(name);

  /* Короткая подпись для списка источников: «Обзор ВС РФ № 3 (2017)».
     У обзоров без номера к названию добавляется год утверждения: в разделе
     пять обзоров «по делам о защите прав потребителей» за разные годы, и без
     года они выглядели бы пятью одинаковыми карточками (audit.js ругается на
     повторяющиеся подписи). */
  let short;
  if (presidium) {
    short = "Президиум ВС РФ" + (number ? " № " + number : "") + (adopted ? " от " + adopted : "");
    /* Без номера два постановления одной даты не различить — добавляем название. */
    if (!number) {
      const t = tailAfterDate(name, adopted);
      if (t) short += " «" + clipTitle(t, 44) + "»";
    }
  } else if (number) {
    /* У формы «N 14/2026» год уже внутри номера, у «N 3 (2017)» и «… N 3» — нет. */
    short = (thematic ? "Тематический обзор" : "Обзор") + " ВС РФ № " +
      (form === "n1" ? number : number + (year ? " (" + year + ")" : ""));
  } else {
    short = clipTitle(name, 52) + (year ? " (" + year + ")" : "");
  }

  return {
    adopted: adopted, redaction: redaction, number: number, year: year, form: form,
    name: name, short: short, thematic: thematic, presidium: presidium
  };
}

/* Идентификатор источника. Собирается из номера и года: «obzor-14-2026»,
   «obzor-3-2017», «obzor-2-3-2024». Если номера нет — из отличительных слов
   названия («obzor-2025-pensionnym-obespecheniem»), и лишь в крайнем случае
   из «хвоста» адреса. Идентификатор должен переживать ночные пересборки:
   иначе лента «Новое» каждый раз показывала бы документ заново добавленным. */

const TRANSLIT = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh",
  щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "iu", я: "ia"
};

function lat(w) {
  return String(w).toLowerCase().replace(/[а-яё]/g, (c) => TRANSLIT[c] === undefined ? c : TRANSLIT[c]);
}

/* Служебные слова названия: без них остаются слова, по которым документ
   узнаётся. Список записан по-русски и переводится тем же TRANSLIT, что и
   названия, — иначе «связанных» (sviazannyh) не совпало бы с написанным
   вручную «sviazannykh», и служебное слово попало бы в идентификатор. */
const ID_STOP = new Set((
  "обзор обзоры обобщение обобщения практики практика судебной судебная суда судами судов " +
  "верховного верховный верховным российской федерации рф по о об и в во на за от для с со при из к ко " +
  "дело делам делах дел вопросам вопросах вопросу вопрос вопросы отдельным отдельные отдельных " +
  "некоторым некоторые связанных связанным связанной связанные связи применением применения " +
  "применении применительно рассмотрению рассмотрения ответ ответы общие им их его ее её " +
  "утверждении утверждению разъяснений разъяснения мерам мерах мер противодействию распространению " +
  "территории новой законодательства постановление постановлением постановления президиума " +
  "президиумом президиум областными равными нижестоящими года году год годы сфере также либо или вправе"
).split(/\s+/).map(lat));

function nameTag(name) {
  const words = String(name || "").toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, " ")
    .split(" ")
    .map(lat)
    .filter((w) => w && !/^\d+$/.test(w) && !ID_STOP.has(w));
  return words.slice(0, 2).join("-").slice(0, 36).replace(/-+$/, "");
}

/* «Хвост» адреса как запасной опознавательный знак. Адреса у источника
   собраны из тех же канцелярских слов («postanovlenie-prezidiuma-verkhovnogo-
   suda-rf-ot-19112025»), поэтому шапку срезаем, суффикс повтора «_1» — тоже,
   а восьмизначную дату разбиваем на «ДД-ММ-ГГГГ», иначе в идентификаторе
   стоит нечитаемое «19112025». */
function slugTag(slug) {
  let t = (slug.split("/").filter(Boolean).pop() || "doc").replace(/_\d+$/, "");
  t = t.replace(/^(postanovlenie|obzor|obobshchenie|otvet|voprosy|vopros)-/, "");
  t = t.replace(/^prezidiuma-verkhovnogo-suda-rf-ot-/, "")
    .replace(/^plenuma-verkhovnogo-suda-rf-ot-/, "")
    .replace(/^-+|-+$/g, "");
  t = t.replace(/(\d{2})(\d{2})(\d{4})/, "$1-$2-$3");
  return t.slice(-34).replace(/^-+/, "");
}

function reviewId(meta, slug) {
  const num = String(meta.number || "").replace(/[Аа]/g, "a")
    .replace(/[^0-9A-Za-z]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  const year = /^\d{4}$/.test(String(meta.year || "")) ? String(meta.year) : "";
  const tag = nameTag(meta.name);
  const pre = meta.presidium ? "prezidium" : "obzor";

  /* Форма записи важнее формы номера: «N 3 (2021)» — это обычный квартальный
     обзор, а «… N 3» без года — коронавирусный обзор 2021 года. Оба дают
     номер «3» и год «2021», но это разные документы, поэтому вторая форма
     дополнительно несёт отличительные слова названия. */
  if (meta.form === "n1") return pre + "-" + num;                  /* год внутри номера */
  if (meta.form === "n2") return pre + "-" + num + (year ? "-" + year : "");
  if (meta.form === "n3") return pre + "-" + num + (year ? "-" + year : "") + (tag ? "-" + tag : "");

  if (year && tag) return pre + "-" + year + "-" + tag;
  if (tag) return pre + "-" + tag;
  /* Название целиком из канцелярских слов («Постановление Президиума … Об
     утверждении разъяснений по отдельным вопросам судебной практики») —
     опознавательный знак берём из адреса. */
  const alt = slugTag(slug);
  return alt ? pre + "-" + alt : pre + "-doc";
}

/* ---------------------------------------------------------------- документ */

/* Пункт обзора. Обзоры устроены не как кодексы: сплошной нумерации «1.», «2.»
   у них нет. Встречаются три вида изложения, и у каждого своя единица
   цитирования:

     1. «Вопрос 1: … / Ответ: …» — обзоры по отдельным вопросам судебной
        практики и ответы на вопросы. Единица — вопрос вместе со своим ответом.
     2. «1.», «2.», … — тематические обзоры, где пункты всё-таки пронумерованы.
        Разбор тот же, что у постановлений Пленума.
     3. Сплошной текст без нумерации (обзоры практики по категориям дел).
        Придумывать ему номера нельзя: выдуманный номер пункта в правовом
        справочнике хуже, чем его отсутствие, а при следующей редакции обзора
        такая нумерация ещё и поехала бы. Такой обзор остаётся одним
        документом — текст сохраняется целиком, поиск по нему работает. */

const Q_RE = /^Вопрос\s*(\d+)?\s*[.:]\s*([\s\S]*)$/i;
const ROMAN = /^([IVXLC]{1,7})\.\s+([А-ЯЁ][^.]{3,110})$/;

function firstSentence(s) {
  const t = String(s || "").trim();
  const m = /^([\s\S]{0,150}?[.!?])(?:\s|$)/.exec(t);
  if (m) return m[1].replace(/\s+/g, " ").trim();
  /* Первое предложение длиннее 150 знаков — обрезаем по границе слова, а не
     посередине: в списке источников это подпись, а не цитата. */
  return clipTitle(t, 160);
}

/* Длинное название обрезаем по границе слова: в карточке оно всё равно не
   помещается, а в индексе длинные названия мешают сверке (audit.js ругается
   на названия длиннее 170 знаков). */
function clipTitle(s, n) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  return t.slice(0, n).replace(/\s+\S*$/, "") + "…";
}

/* Разбор «по вопросам»: каждый «Вопрос N» открывает новую запись, всё до
   следующего вопроса — её текст. Римские разделы («I. Общие вопросы») идут в
   поле «глава», как главы кодексов. */
function questionItems(paras) {
  const items = [];
  const pre = [];
  let chapter = "";
  let cur = null;
  let seq = 0;

  const flushPre = () => {
    if (!pre.length) return;
    /* Второй преамбулы в документе быть не может: шапка одна. Если текст
       оказался вне вопроса уже после того, как записи пошли (так бывает у
       обзоров, где до раздела «Разъяснения по вопросам» идут нумерованные
       пункты), он относится к предыдущей записи, а не к шапке. */
    if (items.length) items[items.length - 1].text += "\n" + pre.join("\n");
    else items.push({ number: null, title: "Преамбула", chapter: "", text: pre.join("\n") });
    pre.length = 0;
  };
  const flushCur = () => { if (cur) { items.push(cur); cur = null; } };

  paras.forEach((t) => {
    const rm = ROMAN.exec(t);
    if (rm) { flushPre(); flushCur(); chapter = t; return; }
    const q = Q_RE.exec(t);
    if (q) {
      flushPre(); flushCur();
      seq++;
      /* Номер вопроса берём из текста, если он там есть: «Вопрос 14». Если
         обзор вопросы не нумерует («Вопрос. …»), берём порядковый — внутри
         самого документа это однозначно. */
      cur = {
        number: q[1] || String(seq),
        title: firstSentence(q[2]) || "Вопрос",
        chapter: chapter,
        text: t
      };
      return;
    }
    if (cur) { cur.text += "\n" + t; return; }
    /* Строка сразу после римского заголовка — это его перенос: на источнике
       заголовок разбит на строки («II. Дополнительные гарантии медицинским и
       иным работникам» / «медицинских организаций»). Дописываем её к главе;
       иначе она всплывала бы отдельной преамбулой посреди документа. */
    if (chapter && t.length < 80 && !/[.!?]$/.test(t)) { chapter += " " + t; return; }
    pre.push(t);
  });
  flushPre(); flushCur();
  return items;
}

/* Разбор сплошного текста: одна запись на весь документ. Заголовок — короткое
   название обзора, чтобы в карточке не стояло служебное «Преамбула». */
function lumpItem(paras, title) {
  const text = paras.join("\n").trim();
  return [{ number: null, title: clipTitle(title, 160) || "Преамбула", chapter: "", text: text }];
}

/* Единица разбора выбирается по самому тексту, а не по названию: «Обзор
   судебной практики … N 3» бывает и обзором с нумерованными пунктами, и
   обзором по вопросам. Порядок такой:

     • вопросов несколько и они преобладают над пунктами — разбираем по
       вопросам (обзоры по отдельным вопросам судебной практики);
     • иначе, если пункты есть, — по пунктам (это большинство обзоров);
     • единственный вопрос — тоже по вопросу («Ответ на вопрос …»);
     • ни того, ни другого — весь документ одной записью.

   Порог «преобладают» нужен из-за обзоров, где нумерованные пункты идут
   первыми, а раздел «Разъяснения по вопросам» — в конце: там вопросов мало,
   а пунктов десятки, и разбор по вопросам потерял бы почти весь документ. */
function reviewItems(paras, title) {
  const q = questionItems(paras);
  const qn = q.filter((x) => x.number !== null).length;
  if (qn >= 2) {
    const nn = P.plenumItems(paras).filter((x) => x.number !== null).length;
    if (qn > nn) return q;
  }
  const num = P.plenumItems(paras);
  if (num.filter((x) => x.number !== null).length >= 2) return num;
  if (qn >= 1) return q;
  return lumpItem(paras, title);
}

const MONTH_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря"];

/* Название постановления Президиума без служебной шапки: «Постановление
   Президиума Верховного Суда РФ от 19.11.2025 "Об исключении …"» →
   «Об исключении …». Нужно для подписи в списке источников. */
function tailAfterDate(name, adopted) {
  let s = String(name || "");
  if (adopted) {
    const i = s.indexOf(adopted);
    if (i >= 0) s = s.slice(i + adopted.length);
  }
  return s.replace(/^[\s,]+/, "").replace(/^[«"<„]+/, "").replace(/[»">“]+$/, "").trim();
}

/* «27.12.2002» → «27 декабря 2002 года» */
function ruDate(d) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(d || ""));
  if (!m) return String(d || "");
  return m[1] + " " + MONTH_GEN[parseInt(m[2], 10) - 1] + " " + m[3] + " года";
}

async function buildOne(row) {
  const html = await P.getCached(row.url, "rev-" + row.slug.replace(/\//g, "_"));

  /* Дерево подстраниц: текста на самой странице нет — пропускаем документ
     целиком (см. заголовок файла). */
  const flat = /id="lawchunkbody_/.test(html) || /id="law_text_body"/.test(html);
  if (!flat) return { skip: "текст разложен по подстраницам" };

  const paras = P.extractBody(html);
  if (!paras.length) return { error: "нет текста: " + row.url };

  const meta = reviewMeta(row.title);

  /* Заголовок страницы полнее каталога: в каталоге длинные названия обрезаны
     многоточием вместе с хвостом «(утв. …)». Поэтому реквизиты берём со
     страницы, а каталог — запасной источник для того, что на странице не
     нашлось (например, у документа вообще нет даты утверждения). */
  const h1 = P.docHeader(html);
  const h1Clean = String(h1 || "")
    .replace(/\s*\((?:редакция|ред\.)\s+от\s+\d{2}\.\d{2}\.\d{4}\)/gi, "")
    .replace(/\s+/g, " ").trim();
  const fromDoc = h1Clean ? reviewMeta(h1Clean) : null;
  const merge = (a, b) => (a && String(a).trim() ? a : (b || ""));
  const use = {
    adopted: merge(fromDoc && fromDoc.adopted, meta.adopted),
    redaction: merge(fromDoc && fromDoc.redaction, meta.redaction),
    number: merge(fromDoc && fromDoc.number, meta.number),
    year: merge(fromDoc && fromDoc.year, meta.year),
    form: fromDoc && fromDoc.form !== "none" ? fromDoc.form : meta.form,
    thematic: (fromDoc && fromDoc.thematic) || meta.thematic,
    presidium: (fromDoc && fromDoc.presidium) || meta.presidium,
    name: h1Clean.length > meta.name.length ? h1Clean : meta.name
  };
  use.short = fromDoc && fromDoc.short ? fromDoc.short : meta.short;

  /* Единица разбора зависит от самого текста, а заголовок для сплошного обзора
     нужен до разбора — поэтому разбираем здесь, а не рядом с чтением тела. */
  const items = reviewItems(paras, use.name);
  if (!items.length) return { error: "не разобрался текст: " + row.url };

  const adopted = use.adopted;
  const redaction = use.redaction || adopted;

  return {
    slug: row.slug,
    app_id: reviewId(use, row.slug),
    number: use.number,
    adopted: adopted,
    redaction_date: redaction,
    name: use.name,
    short: use.short,
    full: use.presidium
      ? use.name
      : "Обзор судебной практики, утверждённый Президиумом Верховного Суда Российской Федерации" +
        (adopted ? " " + ruDate(adopted) : ""),
    organ: "Президиум Верховного Суда Российской Федерации",
    docstate: "Действует",
    branch: "Судебная практика",
    source_url: row.url,
    license: "текст нормативного правового акта; авторским правом не охраняется (п. 6 ст. 1259 ГК РФ)",
    fetched_at: new Date().toISOString(),
    n_articles: items.length,
    articles: items
  };
}

/* ------------------------------------------------- проверка актуальности */

async function checkFreshness() {
  if (!fs.existsSync(OUT)) { console.error("Нет " + path.relative(ROOT, OUT) + " — сначала загрузите данные."); process.exitCode = 1; return; }
  const stored = JSON.parse(fs.readFileSync(OUT, "utf8"));
  console.log("Каталог (живой): " + LIST_URL);
  const live = await loadCatalogue(true);
  console.log("Загружено ранее: " + stored.length + " · в каталоге сейчас: " + live.length + "\n");

  const bySlug = Object.create(null);
  stored.forEach((d) => { bySlug[d.slug] = d; });
  const liveSlugs = Object.create(null);
  live.forEach((r) => { liveSlugs[r.slug] = r; });

  const outdated = [], gone = [], fresh = [], blind = [];
  live.forEach((r) => {
    const s = bySlug[r.slug];
    if (!s) { fresh.push(r); return; }
    const m = reviewMeta(r.title);
    const newRed = m.redaction || m.adopted || "";
    const oldRed = s.redaction_date || s.adopted || "";
    /* Каталог обрезает длинные названия многоточием и вместе с ними теряет
       дату: по такой записи обновление не увидеть. Считаем их отдельно,
       чтобы «расхождений нет» не звучало увереннее, чем есть на самом деле. */
    if (!newRed) { blind.push(r); return; }
    if (newRed > oldRed) outdated.push({ r: r, was: oldRed, now: newRed });
  });
  stored.forEach((d) => { if (!liveSlugs[d.slug]) gone.push(d); });

  const line = (r) => r.adopted + " " + r.title.slice(0, 70);
  if (outdated.length) {
    console.log("Новая редакция (" + outdated.length + "):");
    outdated.forEach((x) => console.log("  " + line(x.r) + "  " + x.was + " → " + x.now));
  }
  if (gone.length) {
    console.log("Пропали из каталога (" + gone.length + "):");
    gone.forEach((d) => console.log("  " + d.app_id + " · " + String(d.name).slice(0, 70)));
  }
  if (fresh.length) {
    console.log("Новые в каталоге (" + fresh.length + "):");
    fresh.forEach((r) => console.log("  " + line(r)));
  }
  if (blind.length) {
    console.log("Не проверено — каталог обрезал название (" + blind.length + "):");
    blind.slice(0, 5).forEach((r) => console.log("  " + r.slug.slice(0, 70)));
    if (blind.length > 5) console.log("  … и ещё " + (blind.length - 5));
  }
  if (!outdated.length && !gone.length && !fresh.length) {
    console.log("Расхождений нет: набор соответствует каталогу (" + stored.length + " документов)" +
      (blind.length ? ", кроме " + blind.length + " с обрезанным названием" : "") + ".");
    return;
  }
  process.exitCode = 1;
}

/* -------------------------------------------------------------------- main */

async function main() {
  if (FLAG_CHECK) { await checkFreshness(); return; }

  console.log("Каталог: " + LIST_URL);
  const rows = await loadCatalogue();
  console.log("Всего документов: " + rows.length);

  if (FLAG_LIST) {
    rows.forEach((r, i) => {
      const m = reviewMeta(r.title);
      console.log(String(i + 1).padStart(3) + ". " + (m.adopted || "—").padEnd(11) +
        (m.number ? "№ " + m.number : "").padEnd(10) + " " +
        reviewId(m, r.slug).padEnd(34) + " " + r.title.slice(0, 80));
    });
    console.log("\nДаты «—» — каталог обрезал длинное название многоточием вместе с «(утв. …)»:\n" +
      "дату и номер возьмёт заголовок самой страницы при полной загрузке.");
    return;
  }

  /* Ранее загруженное: документ, который сегодня не скачался, берём из
     прошлого набора, а не выбрасываем — иначе разовая сетевая ошибка
     выглядела бы как исчезновение обзора из базы. */
  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : [];
  const prevBySlug = Object.create(null);
  prev.forEach((d) => { prevBySlug[d.slug] = d; });

  const take = PROBE ? rows.slice(0, PROBE) : rows;
  const done = [];
  const skipped = [];
  const kept = [];   // пропуск, но прошлый текст на месте — документ не теряем
  const failed = [];
  for (let i = 0; i < take.length; i++) {
    const r = take[i];
    process.stdout.write("[" + (i + 1) + "/" + take.length + "] " + r.slug.slice(0, 56) + " … ");
    let res;
    try {
      res = await buildOne(r);
    } catch (e) {
      res = { error: String(e && e.message || e) };
    }
    if (res.skip) {
      /* Портал перевёл документ на дерево подстраниц — собрать его заново
         нельзя, но и терять уже загруженный текст незачем: в базе он есть,
         проверить его по источнику мы по-прежнему можем по ссылке. Раньше
         такой документ молча выпадал из набора, и обзор исчезал из
         приложения при первой же смене вёрстки на портале. */
      if (prevBySlug[r.slug]) {
        console.log("пропуск, оставлен прошлый текст · " + res.skip);
        kept.push(r);
        done.push(prevBySlug[r.slug]);
        continue;
      }
      console.log("пропуск · " + res.skip);
      skipped.push(r);
      continue;
    }
    if (res.error) {
      if (prevBySlug[r.slug]) {
        console.log("ошибка загрузки, оставлен прошлый текст · " + res.error);
        done.push(prevBySlug[r.slug]);
        continue;
      }
      console.log("ОШИБКА: " + res.error);
      failed.push(r);
      continue;
    }
    console.log("ок · " + res.n_articles + " п. · " + res.name.slice(0, 60));
    done.push(res);
    if (PROBE) {
      const shapes = {};
      res.articles.forEach((a) => {
        const k = a.number == null ? "pre" : (/\(/.test(a.number) ? "N(k)" : (a.number.indexOf(".") !== -1 ? "N.M" : "N"));
        shapes[k] = (shapes[k] || 0) + 1;
      });
      console.log("      нумерация: " + JSON.stringify(shapes));
      console.log("      главы: " + JSON.stringify(Array.from(new Set(res.articles.map((a) => a.chapter).filter(Boolean))).slice(0, 6)));
      console.log("      первые: " + res.articles.slice(0, 3).map((a) => a.number + " → " + String(a.title).slice(0, 60)).join(" | "));
    }
  }

  if (PROBE) return;

  if (!done.length) { console.error("Нечего сохранять."); process.exitCode = 1; return; }

  /* Уникальность идентификаторов: «obzor-<номер>-<год>». Номер и год у двух
     разных документов теоретически могут совпасть — тогда добавляем суффикс.
     Обходим в порядке адреса, чтобы суффиксы не переезжали между прогонами.
     Документы, взятые из прошлого набора, уже разведены прошлым прогоном:
     их id не пересчитываем, иначе «obzor-1-2026-2» стал бы «-2-2». */
  const keptSlug = Object.create(null);
  kept.forEach((r) => { keptSlug[r.slug] = 1; });
  const used = Object.create(null);
  const bySlug = done.slice().sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  bySlug.forEach((d) => {
    if (keptSlug[d.slug]) return;
    let id = d.app_id, k = 2;
    while (used[id]) id = d.app_id + "-" + k++;
    if (id !== d.app_id) console.log("  переименован: " + d.app_id + " → " + id);
    used[id] = 1;
    d.app_id = id;
  });
  /* Прошлые id занимаем после свежих: свежий документ вправе забрать
     «свободный» номер, а прошлый при совпадении получает суффикс. */
  bySlug.forEach((d) => {
    if (!keptSlug[d.slug]) return;
    let id = d.app_id, k = 2;
    while (used[id]) id = d.app_id + "-" + k++;
    if (id !== d.app_id) console.log("  переименован (прошлый текст): " + d.app_id + " → " + id);
    used[id] = 1;
    d.app_id = id;
  });

  /* Уникальность коротких подписей. В разделе пять обзоров «по делам о защите
     прав потребителей» за разные годы и три «о несостоятельности (банкротстве)
     за 2022/2023/2024 год» — без года это были бы одинаковые карточки в списке
     источников (audit.js ругается на повторяющиеся подписи). Год разводит почти
     все; там, где совпал и год, подпись удлиняется, пока не станет различимой. */
  const usedShort = Object.create(null);
  bySlug.forEach((d) => {
    const base = d.short;
    if (!usedShort[base]) { usedShort[base] = 1; return; }
    for (let n = 64; n <= 260; n += 16) {
      const cand = clipTitle(d.name, n) + (d.adopted ? " (" + d.adopted.slice(-4) + ")" : "");
      if (!usedShort[cand]) { usedShort[cand] = 1; d.short = cand; return; }
    }
    let k = 2, cand;
    do { cand = base + " " + k++; } while (usedShort[cand]);
    usedShort[cand] = 1;
    d.short = cand;
  });

  /* Новые обзоры — в начале списка: свежая практика нужнее. */
  done.sort((a, b) => {
    const ka = String(a.adopted || "").split(".").reverse().join("");
    const kb = String(b.adopted || "").split(".").reverse().join("");
    return ka < kb ? 1 : ka > kb ? -1 : 0;
  });

  fs.writeFileSync(OUT, JSON.stringify(done, null, 1) + "\n", "utf8");
  const chars = done.reduce((s, d) => s + d.articles.reduce((x, a) => x + a.text.length, 0), 0);
  console.log("\nЗаписано: " + path.relative(ROOT, OUT));
  console.log("  документов: " + done.length);
  console.log("  пунктов: " + done.reduce((s, d) => s + d.n_articles, 0));
  console.log("  знаков текста: " + chars.toLocaleString("ru-RU"));
  console.log("  пропущено (текст по подстраницам): " + skipped.length +
    (kept.length ? " · из них с прошлым текстом: " + kept.length : ""));
  if (failed.length) console.log("  не скачалось: " + failed.length + " (" + failed.map((r) => r.slug).join(", ") + ")");
  console.log("  каталог раздела: " + P.BASE + CATALOGUE);

  /* Документ, который есть в каталоге, но не попал в набор, — это потеря.
     Ночная сборка идёт на чистой копии репозитория (vendor/ в git не хранится),
     поэтому прошлого текста у неё нет, и разовая сетевая ошибка тихо выкинула бы
     обзор из базы. Лучше упасть и не публиковать ничего, чем опубликовать
     неполную базу. Локально, когда прошлый набор есть, потеря не возникает:
     такой документ берётся из него. */
  if (failed.length && !prev.length) {
    console.error("\nОШИБКА: " + failed.length + " документ(ов) каталога не разобраны, а прошлого " +
      "набора нет — обновление неполное. Повторите запуск.");
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((e) => { console.error("Сбой: " + (e && e.stack || e)); process.exitCode = 1; });
}

module.exports = {
  parseList, reviewMeta, reviewId, buildOne, nameTag, slugTag, reviewItems, questionItems,
  ruDate, LIST_URL, OUT
};
