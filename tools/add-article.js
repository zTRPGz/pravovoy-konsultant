#!/usr/bin/env node
/* ============================================================================
   Правовой консультант :: добавление новых материалов в базу
   ----------------------------------------------------------------------------
   Утилита для подготовки источников перед сборкой. Не правит data/ напрямую —
   пишет в vendor/ruslaw (этот каталог вне git, его пересобирает сборка), а
   полные тексты, индекс и полнотекстовый поиск генерирует `npm run build`.
   Так добавление остаётся консистентным с аудитом и не ломает 32 сегмента FT.

   Режимы:

   1) Добавить статью(и) в СУЩЕСТВУЮЩИЙ источник (кодекс / ФЗ / ФКЗ / постановление):
        node tools/add-article.js --src uk --file articles.json
        node tools/add-article.js --src uk --number 107 \
              --title "Убийство, совершённое в состоянии аффекта" \
              --text "Статья 107. Убийство, совершённое в состоянии аффекта
1. ..."

   2) Создать НОВЫЙ источник (новый ФЗ / ФКЗ / кодекс / постановление):
        node tools/add-article.js --new --id fz-999 --kind law \
              --short "ФЗ «О примере»" --full "Федеральный закон «О примере»" \
              --number 999-ФЗ --branch "Конституционное право" \
              --file articles.json

   Формат articles.json (массив или одиночный объект):
        [ { "number": "107", "title": "…", "text": "Статья 107. …" } ]

   После правки vendor/ruslaw обязательно пересобрать данные:
        npm run build        # перегенерирует data/ (в т.ч. FT-индекс)
   и прогнать приёмку:
        node tools/audit.js && node tools/verify-data.js
   ============================================================================ */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const VENDOR = path.join(ROOT, "vendor", "ruslaw");
const REG = path.join(ROOT, "data", "registry.js");

function die(msg) { console.error("ОШИБКА: " + msg); process.exit(1); }

function walk(dir, out) {
  out = out || [];
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir).forEach((f) => {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.json$/.test(f)) out.push(p);
  });
  return out;
}

function resolveVendorFile(srcId) {
  if (!fs.existsSync(REG)) die("нет data/registry.js");
  const ctx = { window: {} };
  const vm = require("vm");
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(REG, "utf8"), ctx);
  const codes = ctx.window.RF_CODES || [];
  const c = codes.find((x) => x.id === srcId);
  if (!c) die("источник с id='" + srcId + "' не найден в реестре");
  const dataset = c.dataset;
  const files = walk(VENDOR);
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(f, "utf8"));
      if (j && j.name === dataset) return f;
    } catch (e) { /* пропускаем не-JSON */ }
  }
  die("файл vendor/ruslaw для источника '" + srcId + "' (" + dataset + ") не найден");
}

function normArticle(a) {
  if (!a || typeof a.number === "undefined" || !a.title || !a.text)
    die("у статьи должны быть number, title и text");
  return { number: String(a.number), title: String(a.title), text: String(a.text) };
}

function loadArticles(arg) {
  if (!arg && process.argv.indexOf("--file") === -1) return null;
  const file = arg;
  if (!fs.existsSync(file)) die("файл не найден: " + file);
  let data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(data)) data = [data];
  return data.map(normArticle);
}

function addToSource(srcId, articles) {
  const file = resolveVendorFile(srcId);
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  j.articles = Array.isArray(j.articles) ? j.articles : [];
  const have = {};
  j.articles.forEach((a) => { have[String(a.number)] = true; });
  let added = 0;
  articles.forEach((a) => {
    if (have[String(a.number)]) {
      console.log("  пропущено (уже есть): ст. " + a.number);
      return;
    }
    j.articles.push(a);
    have[String(a.number)] = true;
    added++;
  });
  j.articles.sort((x, y) => parseFloat(x.number) - parseFloat(y.number));
  if (typeof j.n_articles === "number") j.n_articles = j.articles.length;
  fs.writeFileSync(file, JSON.stringify(j, null, 2), "utf8");
  console.log("  добавлено в " + path.relative(ROOT, file) + ": " + added +
    " статья(и), всего теперь: " + j.articles.length);
}

function scaffoldNewSource(opts) {
  const { id, kind, short, full, number, branch } = opts;
  if (!id || !kind || !short || !full || !number || !branch)
    die("--new требует --id, --kind, --short, --full, --number, --branch");
  const file = path.join(VENDOR, id + ".json");
  if (fs.existsSync(file)) die("файл уже существует: " + file);
  const j = {
    slug: id, number: number, name: full, docstate: "Действует",
    redaction_date: new Date().toISOString().slice(0, 10), redid: 0,
    hash: "", source_url: "", license: "", fetched_at: new Date().toISOString(),
    n_articles: 0, articles: []
  };
  fs.writeFileSync(file, JSON.stringify(j, null, 2), "utf8");
  console.log("  создан источник: " + path.relative(ROOT, file));
  console.log("  зарегистрируйте его в data/registry.js (RF_CODES) с id='" + id +
    "', kind='" + kind + "', short/branch, как у прочих источников.");
  return file;
}

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--src") o.src = argv[++i];
    else if (a === "--new") o.new = true;
    else if (a === "--id") o.id = argv[++i];
    else if (a === "--kind") o.kind = argv[++i];
    else if (a === "--short") o.short = argv[++i];
    else if (a === "--full") o.full = argv[++i];
    else if (a === "--number") o.number = argv[++i];
    else if (a === "--branch") o.branch = argv[++i];
    else if (a === "--file") o.file = argv[++i];
    else if (a === "--title") o.title = argv[++i];
    else if (a === "--text") o.text = argv[++i];
    else o._.push(a);
  }
  return o;
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.new) {
    scaffoldNewSource(o);
    const arts = o.file ? loadArticles(o.file) : null;
    if (arts && arts.length) {
      console.log("  добавьте статьи в созданный файл (--src " + o.id + " --file …)");
    }
    console.log("\nДалее: npm run build  (затем node tools/audit.js && node tools/verify-data.js)");
    return;
  }
  if (!o.src) die("укажите --src <id источника> или --new");
  let arts = o.file ? loadArticles(o.file) : null;
  if (!arts && o.number && o.title && o.text) arts = [{ number: o.number, title: o.title, text: o.text }];
  if (!arts || !arts.length) die("не заданы статьи: --file <json> или --number/--title/--text");
  console.log("Добавление в источник '" + o.src + "':");
  addToSource(o.src, arts);
  console.log("\nДалее: npm run build  (затем node tools/audit.js && node tools/verify-data.js)");
}

main();
