#!/usr/bin/env node
/* Сборка каталога публикации — dist/.

   Зачем отдельный шаг. Приложение статическое и лежит в корне репозитория,
   но в корне же лежит и служебное: tools/ (исходники сборщика), .github/
   (ночная сборка), vendor/ (сырые выгрузки), node_modules/, документация.
   Если отдавать на хостинг корень целиком, всё это станет публично
   доступным по прямым ссылкам, а у Cloudflare Pages ещё и попадёт в
   лимит 20 000 файлов. Поэтому наружу уходит только собранный минимум:

     index.html  app.js  styles.css  favicon.svg  sw.js  robots.txt  data/**

   Плюс сюда же кладутся правила кеширования (_headers) и .nojekyll.

   Каталог dist/ в git не хранится (.gitignore): это производная от data/,
   её собирает хостинг при каждом деплое — либо локально перед выгрузкой.

   Запуск:  node tools/build-dist.js        (npm run dist)
*/

"use strict";

const fs = require("fs");
const path = require("path");
const applyCodeStamp = require("./lib/code-stamp.js").applyCodeStamp;

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "dist");

/* Что уходит на хостинг. Всё остальное в корне — служебное. */
const FILES = ["index.html", "app.js", "styles.css", "favicon.svg", "sw.js", "robots.txt"];
const DIRS = ["data"];

/* Лимиты Cloudflare Pages (бесплатный план) — по ним же ориентируемся и на
   других хостингах: 25 MiB на файл и 20 000 файлов. Превышение не роняет
   сборку (хостинг может быть и другим), но о нём нужно сказать вслух. */
const LIMIT_FILE_BYTES = 25 * 1024 * 1024;
const LIMIT_FILES = 20000;

/* ---------- правила кеширования -------------------------------------------
   Единственный источник — vercel.json: те же правила уже описаны там и
   проверяются в tools/verify-data.js. Держать второй список в этом файле
   означало бы рано или поздно получить расхождение: на Vercel кеш один,
   на Cloudflare другой. Поэтому конвертируем.

   Разница в синтаксисе путей:
     Vercel     /data/full/(.*)     →  Cloudflare  /data/full/*
     Vercel     /(.*)               →  Cloudflare  /*
   Правило со скобочной группой-исключением (SPA-фолбэк) пропускаем: у нас
   hash-роутинг, серверных маршрутов нет, и такой шаблон в _headers смысла
   не имеет.                                                               */

function headersFromVercel() {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
  const rows = (cfg.headers || []).filter(function (r) {
    return r.source && r.source.indexOf("(?") === -1 && r.headers && r.headers.length;
  });

  const toCfPath = function (src) {
    return src === "/" ? "/" : src.replace(/\(\.\*\)/g, "*");
  };

  /* В _headers правила применяются сверху вниз, и при совпадении путей
     побеждает последнее. Общее /* ставим первым, частные — после него. */
  const general = rows.filter(function (r) { return toCfPath(r.source) === "/*"; });
  const specific = rows.filter(function (r) { return toCfPath(r.source) !== "/*"; });

  const out = [];
  general.concat(specific).forEach(function (r) {
    out.push(toCfPath(r.source));
    r.headers.forEach(function (h) { out.push("  " + h.key + ": " + h.value); });
    out.push("");
  });
  return out.join("\n").replace(/\n+$/, "") + "\n";
}

/* ---------- сборка -------------------------------------------------------- */

function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  FILES.forEach(function (f) {
    const src = path.join(ROOT, f);
    if (!fs.existsSync(src)) {
      console.error("Нет обязательного файла: " + f);
      process.exit(1);
    }
    fs.copyFileSync(src, path.join(OUT, f));
  });

  DIRS.forEach(function (d) {
    const src = path.join(ROOT, d);
    if (!fs.existsSync(src)) {
      console.error("Нет обязательного каталога: " + d);
      process.exit(1);
    }
    fs.cpSync(src, path.join(OUT, d), { recursive: true });
  });

  fs.writeFileSync(path.join(OUT, "_headers"), headersFromVercel(), "utf8");

  /* Jekyll (GitHub Pages) пропускает файлы, начинающиеся с подчёркивания,
     — без этого _headers не доехал бы до сайта. На Cloudflare Pages файл
     безвреден. */
  fs.writeFileSync(path.join(OUT, ".nojekyll"), "", "utf8");

  /* ---------- отпечаток кода ------------------------------------------------
     Последним шагом, когда dist/ уже собран: отпечаток читает готовые файлы
     и подставляет себя и в app.js, и в data/version.json. Без него правка в
     app.js не меняла бы ни отпечаток базы, ни метку её сборки — и открытая
     вкладка не узнала бы, что код на хостинге уже другой. Подробности —
     tools/lib/code-stamp.js. */
  const code = applyCodeStamp(OUT);

  /* ---------- отчёт ---------- */
  const sizes = [];
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else sizes.push({ rel: path.relative(OUT, p), size: fs.statSync(p).size });
    });
  })(OUT);

  const total = sizes.reduce(function (s, f) { return s + f.size; }, 0);
  sizes.sort(function (a, b) { return b.size - a.size; });

  console.log("Каталог публикации: dist/");
  console.log("  файлов: " + sizes.length + " · объём: " + (total / 1048576).toFixed(1) + " МБ");
  console.log("  крупнейшие: " + sizes.slice(0, 3).map(function (f) {
    return f.rel + " (" + (f.size / 1048576).toFixed(1) + " МБ)";
  }).join(", "));
  console.log("  правила кеширования: dist/_headers");
  console.log("  отпечаток кода сборки: " + code);

  const tooBig = sizes.filter(function (f) { return f.size > LIMIT_FILE_BYTES; });
  if (tooBig.length) {
    console.warn("  ВНИМАНИЕ: " + tooBig.length + " файл(ов) больше 25 МБ — " +
      "Cloudflare Pages их не примет (крупнейший: " + tooBig[0].rel + ")");
  }
  if (sizes.length > LIMIT_FILES) {
    console.warn("  ВНИМАНИЕ: файлов больше " + LIMIT_FILES + " — бесплатный Cloudflare Pages не примет");
  }
  if (!tooBig.length && sizes.length <= LIMIT_FILES) {
    console.log("  лимиты Cloudflare Pages (25 МБ/файл, 20 000 файлов): соблюдены с запасом");
  }
}

/* При запуске как программы — собираем. При подключении из проверок
   (tools/verify-data.js) — только отдаём список файлов и правила кеша,
   чтобы их можно было проверить без выгрузки ста мегабайт на диск. */
if (require.main === module) main();

module.exports = { FILES: FILES, DIRS: DIRS, headersFromVercel: headersFromVercel, main: main };
