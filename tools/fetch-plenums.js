#!/usr/bin/env node
/* ============================================================================
   Правовой консультант :: загрузка постановлений Пленума Верховного Суда РФ

   Источник — sudact.ru: раздел /vsrf/plenum/ (каталог) и /law/<slug>/ (текст).
   Официальный сайт ВС РФ отдаёт раздел «Пленум» только через /api/, закрытый
   в robots.txt, а на портале actual.pravo.gov.ru постановлений Пленума нет
   вовсе (attrsearch по слову «Пленум» даёт 0 совпадений) — проверено.

   Каталог: 4 страницы, ~100 постановлений. Тексты актов не охраняются
   авторским правом (п. 6 ст. 1259 ГК РФ).

   Результат: vendor/ruslaw/plenums.json — форма, совместимая с decrees.json
   (kind «plenum», режим разбора «plain» в tools/build-data.js).

   Запуск:
     node tools/fetch-plenums.js --list        только каталог, без текстов
     node tools/fetch-plenums.js --probe 3     первые 3 документа + разбор нумерации
     node tools/fetch-plenums.js               полная загрузка
     node tools/fetch-plenums.js --force       перекачать уже загруженное
     node tools/fetch-plenums.js --check       проверка актуальности: сравнить
                                               загруженные редакции с живым каталогом

   Проверка актуальности. Из браузера сайт-источник недоступен: sudact.ru не
   отдаёт заголовок Access-Control-Allow-Origin, поэтому запрос со страницы,
   открытой по file://, блокируется. Поэтому актуальность Пленумов проверяется
   этой командой (код возврата 1, если что-то изменилось), а в приложении у
   каждого постановления показана дата редакции и ссылка на источник.
   ============================================================================ */
"use strict";

const fs = require("fs");
const path = require("path");
const { htmlToParagraphs, decodeEntities } = require("./fetch-extra");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "vendor", "ruslaw");
const OUT = path.join(SRC, "plenums.json");
const CACHE = path.join(ROOT, ".tmp-probe", "plenum-cache");

const BASE = "https://sudact.ru";
const LIST_URL = BASE + "/vsrf/plenum/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const GAP = 1500;      // мс между запросами — вежливая нагрузка на сайт
const MAX_PAGES = 12;  // предохранитель от бесконечной пагинации

const argv = process.argv.slice(2);
const FLAG_LIST = argv.indexOf("--list") !== -1;
const FLAG_FORCE = argv.indexOf("--force") !== -1;
const FLAG_CHECK = argv.indexOf("--check") !== -1;
const probeIdx = argv.indexOf("--probe");
const PROBE = probeIdx !== -1 ? parseInt(argv[probeIdx + 1] || "3", 10) : 0;

/* ---------------------------------------------------------------- сеть */

let lastReq = 0;
async function get(url, tries) {
  tries = tries || 3;
  for (let a = 0; a < tries; a++) {
    const wait = GAP - (Date.now() - lastReq);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastReq = Date.now();
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, "Accept-Language": "ru-RU,ru;q=0.9" }
      });
      if (res.status === 404) return { status: 404, html: "" };
      if (!res.ok) throw new Error("HTTP " + res.status);
      return { status: res.status, html: await res.text() };
    } catch (e) {
      if (a === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 2500 * (a + 1)));
    }
  }
}

function cachePath(name) {
  return path.join(CACHE, name.replace(/[^a-z0-9.-]+/gi, "_").slice(0, 120) + ".html");
}
async function getCached(url, name, noCache) {
  fs.mkdirSync(CACHE, { recursive: true });
  const f = cachePath(name);
  if (!noCache && !FLAG_FORCE && fs.existsSync(f)) return fs.readFileSync(f, "utf8");
  const r = await get(url);
  if (r.status !== 404) fs.writeFileSync(f, r.html, "utf8");
  return r.status === 404 ? "" : r.html;
}

/* ---------------------------------------------------------------- каталог */

/* Строка каталога:
   «Постановление Пленума Верховного Суда РФ от 27.12.2002 N 29 (редакция от
    16.06.2026) "О судебной практике по делам о краже, грабеже и разбое"»
   Название в каталоге может быть усечено многоточием — полное берём из <h1>
   самой страницы документа. */
const ROW = /Постановление\s+Пленума\s+Верховного\s+Суда\s+РФ\s+от\s+(\d{2}\.\d{2}\.\d{4})\s+N\s+([0-9]+(?:-[А-Яа-я]+)?)\s*(?:\(редакция\s+от\s+(\d{2}\.\d{2}\.\d{4})\))?\s*([\s\S]*)$/;

function parseList(html) {
  const out = [];
  const re = /<a\s+href="(\/law\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const slug = m[1].replace(/^\//, "").replace(/\/$/, "");
    const text = decodeEntities(
      m[2].replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
    ).replace(/[^\S\n]+/g, " ").replace(/\n+/g, "\n").trim();
    const r = ROW.exec(text);
    if (!r) continue;
    out.push({
      slug: slug,
      url: BASE + "/" + slug + "/",
      adopted: r[1],
      number: r[2],
      redaction: r[3] || "",
      title_short: r[4].replace(/^["«„]/, "").replace(/["»“]\s*…?$/, "").trim()
    });
  }
  return out;
}

/* Документы, которых нет в каталоге sudact.ru, хотя их страницы открываются.
   Постановление № 15 от 16.05.2017 (административный надзор) уже разобрано в
   базе — 52 пункта, — но строки в /vsrf/plenum/ нет. Без этого списка ночная
   сборка, перезаписывая plenums.json по каталогу, молча выбросила бы акт. */
const KNOWN = [
  {
    slug: "law/postanovlenie-plenuma-verkhovnogo-suda-rf-ot-16052017_2",
    url: BASE + "/law/postanovlenie-plenuma-verkhovnogo-suda-rf-ot-16052017_2/",
    adopted: "16.05.2017",
    number: "15",
    redaction: "22.12.2022",
    title_short: "О некоторых вопросах, возникающих при рассмотрении судами дел " +
      "об административном надзоре за лицами, освобожденными из мест лишения свободы"
  }
];

async function loadCatalogue(noCache) {
  const seen = Object.create(null);
  const all = [];
  for (let p = 1; p <= MAX_PAGES; p++) {
    const url = p === 1 ? LIST_URL : LIST_URL + "?page=" + p;
    const html = await getCached(url, "list-p" + p, noCache);
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
  KNOWN.forEach((r) => {
    if (seen[r.slug]) return;
    seen[r.slug] = 1;
    all.push(r);
    process.stdout.write("  вне каталога: " + r.adopted + " № " + r.number + "\n");
  });
  return all;
}

/* ------------------------------------------------- проверка актуальности

   Сравниваем загруженный набор с живым каталогом по адресу документа:
   • появилась новая редакция  → редакция в каталоге новее загруженной;
   • исчез из каталога         → постановление, вероятно, утратило силу;
   • новое постановление       → есть в каталоге, нет в наборе.
   Код возврата 1, если расхождения найдены. */

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

  const outdated = [], gone = [], fresh = [], same = [];
  live.forEach((r) => {
    const s = bySlug[r.slug];
    if (!s) { fresh.push(r); return; }
    const oldRed = s.redaction_date || s.adopted || "";
    const newRed = r.redaction || r.adopted || "";
    if (newRed > oldRed) outdated.push({ r: r, was: oldRed, now: newRed });
    else same.push(r);
  });
  stored.forEach((d) => { if (!liveSlugs[d.slug]) gone.push(d); });

  const line = (r) => r.adopted + " № " + r.number + (r.redaction ? " (ред. " + r.redaction + ")" : "") +
    "  " + (r.title_short || "").slice(0, 70);

  if (outdated.length) {
    console.log("Новая редакция (" + outdated.length + "):");
    outdated.forEach((o) => console.log("  " + line(o.r) + "\n      было: " + o.was + " → стало: " + o.now));
  }
  if (gone.length) {
    console.log("\nНет в каталоге — возможно, утратили силу (" + gone.length + "):");
    gone.forEach((d) => console.log("  " + d.adopted + " № " + d.number + "  " + (d.name || "").slice(0, 70)));
  }
  if (fresh.length) {
    console.log("\nНовые постановления (" + fresh.length + "):");
    fresh.forEach((r) => console.log("  " + line(r)));
  }
  if (!outdated.length && !gone.length && !fresh.length) {
    console.log("Расхождений нет: набор соответствует каталогу (" + same.length + " документов).");
  } else {
    console.log("\nИтого: обновить " + outdated.length + ", утратило силу " + gone.length +
      ", новых " + fresh.length + ". Запустите без --check, чтобы перекачать набор.");
    process.exitCode = 1;
  }
}

/* ---------------------------------------------------------------- документ */

/* Тело документа лежит в <div id="lawchunkbody_…">. Документ разбит на
   несколько «чанков» (страниц), у каждого свой такой блок, поэтому берём всё от
   первого до границы текста. Границы: рекламный блок (footer_adv), правая
   колонка (h-col2-rightmenu) и список судебной практики по документу
   (<h2>реквизиты</h2><ul class="results2">), который к тексту не относится.

   У обзоров судебной практики тело лежит в <div id="law_text_body">, а вместо
   «чанков» стоит навигация «следующая страница» (pagination_l_t) — она тоже
   граница. На страницах постановлений Пленума этого маркера не бывает вовсе
   (проверено на всех загруженных), так что разбор Пленумов не меняется.

   Разбираем не только <p>: в «Регламенте Верховного Суда РФ» заголовки глав
   свёрстаны как <b>1. Общие положения</b><br/> — вне абзаца. Поэтому текст
   берём блоками (htmlToParagraphs), а не выборкой <p>. */
function extractBody(html) {
  const chunk = html.search(/<div id="lawchunkbody_/);
  const textBody = html.search(/<div id="law_text_body"/);
  let s;
  if (chunk >= 0) s = chunk;
  else if (textBody >= 0) s = html.indexOf(">", textBody) + 1;   /* после самого тега */
  else return [];

  const cands = [html.length];
  const add = (i) => { if (i > s) cands.push(i); };
  add(html.indexOf("footer_adv", s));
  add(html.indexOf("h-col2-rightmenu", s));
  add(html.indexOf("pagination_l_t", s));
  const ul = html.indexOf('<ul class="results2"', s);
  if (ul > 0) {
    const h2 = html.lastIndexOf("<h2", ul);
    add(h2 > s ? h2 : ul);
  }
  const e = Math.min.apply(null, cands);
  const region = html.slice(s, e)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "");
  return htmlToParagraphs("<body>" + region + "</body>")
    /* остатки разметки: «-->», оборванные теги, служебные знаки */
    .filter((t) => !/^[<>]/.test(t) && !/-->/.test(t));
}

function docHeader(html) {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (!m) return "";
  return decodeEntities(m[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

/* Заголовок h1: «Постановление Пленума Верховного Суда РФ от 27.12.2002 N 29
   (ред. от 16.06.2026) О судебной практике по делам о краже, грабеже и разбое» */
function splitHeader(h1) {
  const r = /^Постановление\s+Пленума\s+Верховного\s+Суда\s+РФ\s+от\s+(\d{2}\.\d{2}\.\d{4})\s+N\s+([0-9]+(?:-[А-Яа-я]+)?)\s*(?:\(ред\.\s+от\s+(\d{2}\.\d{2}\.\d{4})\))?\s*([\s\S]*)$/.exec(h1);
  if (!r) return null;
  return { adopted: r[1], number: r[2], redaction: r[3] || "", title: r[4].trim() };
}

/* ------------------------------------------------- нумерация пунктов Пленума

   Пункты нумеруются «1.», «2.», а при последующих дополнениях — «1(1).»,
   «25(6).»; подпункты — «1.1.». Отдельные акты (Регламент ВС РФ) используют
   нумерацию «глава.пункт» («3.3.1.») с заголовками глав «3. Состав Верховного
   Суда», а также римские разделы «I. Общие положения». */

/* Разделитель пункта — точка: «1.», «1(1).», «1.1.». Скобка «1)» в большинстве
   постановлений означает подпункт внутри пункта, но некоторые изменяющие
   постановления пронумерованы только скобкой (весь список правок идёт как
   «1)», «2)», …). Вид нумерации определяем по первому же нумерованному абзацу
   документа: смешивать их в одном документе нельзя — в изменяющих
   постановлениях подпункты «1)», «2)» относятся к пункту «1.», а не к своим
   номерам. */
const P_DOT = /^(\d+(?:\.\d+)*(?:\(\d+\))?)\.\s+(\S[\s\S]*)$/;
const P_PAR = /^(\d+(?:\.\d+)*(?:\(\d+\))?)\)\s+(\S[\s\S]*)$/;
const P_SECT = /^([IVXLC]{1,7})\.\s+([А-ЯЁ][^.]{3,110})$/;

/* Служебные строки шапки и подписей — не текст постановления. */
const SERVICE = /^(ПЛЕНУМ\s+ВЕРХОВНОГО\s+СУДА|ПОСТАНОВЛЕНИЕ|от\s+\d+\s+[а-яё]+\s+\d{4}\s+г\.)/i;

/* «23. ПЕРЕВОЗКА ГРУЗОВ» — заголовок главы, если следом идут пункты «23.1.».
   Тот же приём, что в paragraphsToItems (tools/fetch-extra.js). */
function isPlenumSection(line, paras, i) {
  const m = P_DOT.exec(line);
  if (!m || m[1].indexOf(".") !== -1) return false;
  if (line.length > 100) return false;
  if (/["«»(]/.test(m[2] || "")) return false;
  for (let k = i + 1; k < Math.min(i + 6, paras.length); k++) {
    const s = paras[k].trim();
    if (!s) continue;
    const nm = /^(\d+)\.\d+/.exec(s);
    return !!nm && nm[1] === m[1];
  }
  return false;
}

/* Вид нумерации пунктов документа: «dot» («1.») или «par» («1)»). */
function itemMode(paras) {
  for (let i = 0; i < paras.length; i++) {
    const t = paras[i];
    if (SERVICE.test(t)) continue;
    if (P_DOT.test(t)) return "dot";
    if (P_PAR.test(t)) return "par";
  }
  return "dot";
}

function plenumItems(paras) {
  const items = [];
  const pre = [];
  let chapter = "";
  let cur = null;
  const mode = itemMode(paras);
  const RE = mode === "par" ? P_PAR : P_DOT;

  const flushPre = () => {
    if (pre.length) {
      items.push({ number: null, title: "Преамбула", chapter: "", text: pre.join("\n") });
      pre.length = 0;
    }
  };

  for (let i = 0; i < paras.length; i++) {
    const t = paras[i];
    if (SERVICE.test(t)) continue;

    if (P_SECT.test(t) && !RE.test(t)) { chapter = t; continue; }
    if (isPlenumSection(t, paras, i)) { chapter = t.replace(/\s+/g, " ").trim(); continue; }

    const m = RE.exec(t);
    if (m) {
      flushPre();
      cur = { number: m[1], title: "", chapter: chapter, text: t };
      items.push(cur);
      continue;
    }
    if (cur) { cur.text += "\n" + t; continue; }
    pre.push(t);
  }
  flushPre();

  // Заголовок пункта — первое предложение текста без номера (как у постановлений
  // Правительства: tools/fetch-extra.js, paragraphsToItems).
  items.forEach((a) => {
    if (a.title) return;
    let first = String(a.text || "").split(/\n/)[0].trim();
    first = first.replace(/^\d+(?:\.\d+)*(?:\(\d+\))?[.)]?\s*/, "");
    let t = first.split(/(?<=[.!?])\s+/)[0] || first;
    if (t.length > 150) t = t.slice(0, 150).replace(/\s+\S*$/, "") + "…";
    a.title = t.replace(/\s*[.\s]+$/, "") || ("Пункт " + a.number);
  });
  return items;
}

/* ---------------------------------------------------------------- сборка */

const MONTH_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря"];

/* «27.12.2002» → «27 декабря 2002 года» */
function ruDate(d) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(d || ""));
  if (!m) return String(d || "");
  return m[1] + " " + MONTH_GEN[parseInt(m[2], 10) - 1] + " " + m[3] + " года";
}

function appId(row) {
  const year = (row.adopted.match(/(\d{4})$/) || [, "0000"])[1];
  return "plenum" + row.number + "-" + year;
}

function cleanTitle(t) {
  return String(t || "").replace(/^["«„]/, "").replace(/["»“]\s*\.?$/, "").replace(/\s+/g, " ").trim();
}

async function buildOne(row) {
  const html = await getCached(row.url, row.slug);
  if (!html) return { error: "не загрузился: " + row.url };
  const paras = extractBody(html);
  if (!paras.length) return { error: "нет текста: " + row.url };
  const h1 = docHeader(html);
  const h = splitHeader(h1);
  const items = plenumItems(paras);
  if (!items.length) return { error: "не разобрался текст: " + row.url };

  const num = (h && h.number) || row.number;
  const adopted = (h && h.adopted) || row.adopted;
  /* Редакция: если каталог указывает «(редакция от …)» — берём её, иначе
     действующей является первоначальная редакция, то есть дата принятия. */
  const redaction = (h && h.redaction) || row.redaction || adopted;
  const title = cleanTitle((h && h.title) || row.title_short);

  return {
    slug: row.slug,
    app_id: appId({ number: num, adopted: adopted }),
    number: num,
    adopted: adopted,
    redaction_date: redaction,
    name: title,
    short: "Пленум ВС РФ № " + num + " от " + adopted,
    full: "Постановление Пленума Верховного Суда Российской Федерации от " +
      ruDate(adopted) + " № " + num,
    organ: "Пленум Верховного Суда Российской Федерации",
    docstate: /внесени[ие]\s+изменени/i.test(title) ? "Изменяющий акт" : "Действует",
    branch: "Судебная практика",
    source_url: row.url,
    license: "текст нормативного правового акта; авторским правом не охраняется (п. 6 ст. 1259 ГК РФ)",
    fetched_at: new Date().toISOString(),
    n_articles: items.length,
    articles: items
  };
}

async function main() {
  if (FLAG_CHECK) { await checkFreshness(); return; }

  console.log("Каталог: " + LIST_URL);
  const rows = await loadCatalogue();
  console.log("Всего постановлений: " + rows.length);

  if (FLAG_LIST) {
    rows.forEach((r, i) => {
      console.log(
        String(i + 1).padStart(3) + ". " + r.adopted + " № " + r.number +
        (r.redaction ? " (ред. " + r.redaction + ")" : "") +
        "  " + r.title_short.slice(0, 90)
      );
    });
    return;
  }

  const take = PROBE ? rows.slice(0, PROBE) : rows;
  const done = [];
  for (let i = 0; i < take.length; i++) {
    const r = take[i];
    process.stdout.write("[" + (i + 1) + "/" + take.length + "] " + r.slug + " … ");
    let res;
    try {
      res = await buildOne(r);
    } catch (e) {
      res = { error: String(e && e.message || e) };
    }
    if (res.error) { console.log("ОШИБКА: " + res.error); continue; }
    console.log("ок · " + res.n_articles + " п. · " + res.name.slice(0, 60));
    done.push(res);
    if (PROBE) {
      const shapes = {};
      res.articles.forEach((a) => {
        const k = a.number == null ? "pre" : (/\(/.test(a.number) ? "N(k)" : (a.number.indexOf(".") !== -1 ? "N.M" : "N"));
        shapes[k] = (shapes[k] || 0) + 1;
      });
      console.log("      нумерация: " + JSON.stringify(shapes));
      console.log("      главы: " + JSON.stringify(Array.from(new Set(res.articles.map((a) => a.chapter).filter(Boolean)))));
      console.log("      первые: " + res.articles.slice(0, 4).map((a) => a.number + " → " + a.title.slice(0, 60)).join(" | "));
      console.log("      последние: " + res.articles.slice(-3).map((a) => a.number + " → " + a.title.slice(0, 60)).join(" | "));
    }
  }

  if (PROBE) return;

  if (!done.length) { console.error("Нечего сохранять."); process.exitCode = 1; return; }

  /* Уникальность идентификаторов: «plenum<номер>-<год>». Один номер в одном
     году теоретически может встретиться дважды — тогда добавляем суффикс. */
  const used = Object.create(null);
  done.forEach((d) => {
    let id = d.app_id, k = 2;
    while (used[id]) id = d.app_id + "-" + k++;
    if (id !== d.app_id) console.log("  переименован: " + d.app_id + " → " + id);
    used[id] = 1;
    d.app_id = id;
  });

  /* Новые постановления — в начале списка: практика последних лет нужнее. */
  done.sort((a, b) => {
    const ka = a.adopted.split(".").reverse().join("");
    const kb = b.adopted.split(".").reverse().join("");
    return ka < kb ? 1 : ka > kb ? -1 : 0;
  });
  fs.writeFileSync(OUT, JSON.stringify(done, null, 1) + "\n", "utf8");
  const chars = done.reduce((s, d) => s + d.articles.reduce((x, a) => x + a.text.length, 0), 0);
  console.log("\nЗаписано: " + path.relative(ROOT, OUT));
  console.log("  постановлений: " + done.length);
  console.log("  пунктов: " + done.reduce((s, d) => s + d.n_articles, 0));
  console.log("  знаков текста: " + chars.toLocaleString("ru-RU"));
}

/* Запуск только при прямом вызове: разборщик страниц sudact.ru переиспользует
   tools/fetch-reviews.js (обзоры судебной практики ВС РФ), и ему нужны
   extractBody / plenumItems / docHeader, а не побочный эффект загрузки. */
if (require.main === module) {
  main().catch((e) => { console.error("Сбой: " + (e && e.stack || e)); process.exitCode = 1; });
}

module.exports = {
  get, getCached, extractBody, docHeader, plenumItems,
  ruDate, cleanTitle, decodeEntities, BASE, UA
};
