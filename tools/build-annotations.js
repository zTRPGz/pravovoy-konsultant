/* =========================================================================
   Правовой консультант :: сборщик справочных аннотаций
   -------------------------------------------------------------------------
   Переносит рукописные аннотации (ключевые слова, справочное содержание,
   санкция, практические заметки) из архивных файлов
   vendor/legacy-annotations/*.js в единый файл data/annotations.js.

   Аннотации хранятся отдельно от официальных текстов: официальный текст
   статьи подгружается из data/full/<код>.js, а аннотация — это справочный
   слой приложения.

   Идентификаторы кодов в архивных файлах не совпадают с текущим реестром,
   поэтому выполняется пересчёт:
     uk, upk, koap, tk              — без изменений
     gk  -> gk1 | gk2 | gk3 | gk4   по номеру статьи
     nk  -> nk1 | nk2               по номеру статьи
     proc gpk-N | kas-N | apk-N  ->  gpk-N | kas-N | apk-N
     kons-N                         -> kons-N  (Конституция РФ, полный текст)
     fz-<группа>-N                  -> <id закона>-N по таблице LAW_BY_GROUP
     прочее                         -> RF_EXTRA (источники без полного текста)

   Запуск:  node tools/build-annotations.js
   ========================================================================= */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "vendor", "legacy-annotations");
const OUT = path.join(ROOT, "data", "annotations.js");

const FILES = [
  "legacy-00-codes.js",
  "legacy-10-uk-a.js",
  "legacy-11-uk-b.js",
  "legacy-20-upk-a.js",
  "legacy-21-upk-b.js",
  "legacy-30-other.js"
];

/* Архивная группа федеральных законов -> идентификатор в реестре приложения.
   Полные тексты этих законов включены в базу (data/full/<id>.js). */
const LAW_BY_GROUP = {
  "полиция": "fz3pol",
  "ord": "fz144ord",
  "prok": "fz2202prok",
  "obr": "fz59obr",
  "pdn": "fz152",
  "adv": "fz63adv",
  "siz": "fz103siz",
  "dakt": "fz128dakt",
  "isp": "fz229"
};

/* Заглушка-приёмник: архивные файлы вызывают L.add(...) */
const L = {
  codes: [],
  articles: [],
  codeById: function (id) { return this.codes.filter(function (c) { return c.id === id; })[0] || null; },
  add: function (c, n, t, g, k, s, p, x) {
    this.articles.push({ c: c, n: n, t: t, g: g || "", k: k || "", s: s || "", p: p || "", x: x || "" });
  }
};

FILES.forEach(function (f) {
  const file = path.join(SRC, f);
  if (!fs.existsSync(file)) { console.warn("нет файла: " + f); return; }
  new Function("L", "window", fs.readFileSync(file, "utf8"))(L, { RF_LAWS: L });
});

/* Границы частей ГК РФ по номерам статей */
function gkPart(num) {
  const n = parseFloat(num);
  if (isNaN(n)) return null;
  if (n <= 453) return "gk1";
  if (n <= 1109) return "gk2";
  if (n <= 1225) return "gk3";
  return "gk4";
}

const ANNOT = {};   // "код-номер" -> { k, s, p, x, t }
const extra = {};   // код -> массив записей без полного текста
const unmapped = [];

/* Архивная запись «fz-<группа>-<номер>» -> «<id закона>-<номер>» */
function mapLawAnnotation(n) {
  const m = /^([a-zа-яё]+)-(.+)$/i.exec(String(n));
  if (!m) return null;
  const id = LAW_BY_GROUP[m[1].toLowerCase()];
  return id ? { id: id, num: m[2] } : null;
}

L.articles.forEach(function (a) {
  let id = null, num = a.n;

  if (a.c === "uk" || a.c === "upk" || a.c === "koap" || a.c === "tk") {
    id = a.c;
  } else if (a.c === "gk") {
    id = gkPart(a.n);
  } else if (a.c === "nk") {
    const x = parseFloat(a.n);
    id = (!isNaN(x) && x <= 145) ? "nk1" : "nk2";
  } else if (a.c === "proc") {
    const m = /^(gpk|kas|apk)-(.+)$/.exec(a.n);
    if (m) { id = m[1]; num = m[2]; }
  } else if (a.c === "kons") {
    id = "kons";                       // Конституция РФ — полный текст в базе
  } else if (a.c === "fz") {
    const m = mapLawAnnotation(a.n);   // федеральный закон -> его id в реестре
    if (m) { id = m.id; num = m.num; }
  }

  if (id) {
    ANNOT[id + "-" + num] = { k: a.k, s: a.s, p: a.p, x: a.x, t: a.t };
  } else if (a.c === "fz" || a.c === "kons") {
    (extra[a.c] = extra[a.c] || []).push(a);
  } else {
    unmapped.push(a.c + "-" + a.n);
  }
});

const extraCodes = L.codes.filter(function (c) { return extra[c.id]; });
const extraFlat = [];
Object.keys(extra).forEach(function (k) { extra[k].forEach(function (a) { extraFlat.push(a); }); });

fs.writeFileSync(OUT,
  "/* Правовой консультант :: слой справочных аннотаций.\n" +
  "   Ключевые слова, справочное содержание, санкции и практические заметки.\n" +
  "   Официальный текст статьи подгружается отдельно из data/full/<код>.js.\n" +
  "   Сформирован автоматически: tools/build-annotations.js */\n" +
  "window.RF_ANNOT=" + JSON.stringify(ANNOT) + ";\n\n" +
  "/* Источники без полного текста в открытом наборе данных:\n" +
  "   Конституция РФ и федеральные законы. Доступны только аннотации. */\n" +
  "window.RF_EXTRA={codes:" + JSON.stringify(extraCodes) + ",articles:" + JSON.stringify(extraFlat) + "};\n",
  "utf8");

const per = {};
Object.keys(ANNOT).forEach(function (k) {
  const c = k.split("-")[0];
  per[c] = (per[c] || 0) + 1;
});

console.log("Аннотаций перенесено: " + Object.keys(ANNOT).length);
console.log("По источникам: " + JSON.stringify(per));
console.log("Источники без полного текста: " + extraCodes.map(function (c) { return c.id + "=" + extra[c.id].length; }).join(" "));
if (unmapped.length) console.log("Не удалось сопоставить: " + unmapped.length + " (" + unmapped.slice(0, 10).join(", ") + ")");
console.log("Записано: data/annotations.js (" + (fs.statSync(OUT).size / 1024).toFixed(1) + " КБ)");
