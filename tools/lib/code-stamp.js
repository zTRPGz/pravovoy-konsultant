/* =========================================================================
   Правовой консультант :: отпечаток кода сборки
   -------------------------------------------------------------------------
   Зачем. data/version.json несёт отпечаток содержимого data/ (поле digest).
   По нему открытая вкладка понимает, что база пересобралась, и предлагает
   обновиться. Но правка в app.js, styles.css или index.html данные не
   меняет: digest и метка времени остаются прежними, уведомление не
   появляется — и посетитель до десяти минут работает со старым скриптом.
   GitHub Pages не даёт задать свои заголовки кеширования: и разметка, и
   стили, и скрипт уходят с max-age=600. Отсюда жалобы «правки не доехали».

   Что делает модуль. Считает sha1 по оболочке сайта (index.html, app.js,
   styles.css) и подставляет отпечаток в двух местах одной сборки:
     • app.js        — в константу BUILD_CODE (приложение читает её о себе);
     • version.json  — в поле code (серверная сторона для сравнения).
   Значение самого отпечатка и метки времени при подсчёте обнуляются:
   иначе отпечаток менялся бы от собственной подстановки и от каждого
   прогона сборки, а уведомление висело бы на экране всегда.

   Почему в app.js, а не в разметке. Скрипт читает отпечаток у самого себя:
   если браузер отдал из кеша старый app.js, он честно скажет, что старый, —
   ложных срабатываний не будет. Снимок из index.html мог бы разойтись с
   фактически выполненным кодом (разметка из кеша, скрипт из сети).

   Подстановка идёт только в каталог публикации (dist/) — см.
   tools/build-dist.js. В исходнике app.js константа пустая, поэтому
   локальный запуск ничего не сравнивает и уведомление не показывает.
   ========================================================================= */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/* Оболочка сайта: то, что читатель получает как «приложение», в отличие от
   data/ — содержимого базы. Порядок фиксирован: отпечаток не должен
   зависеть от порядка обхода каталога. */
const CODE_FILES = ["index.html", "app.js", "styles.css"];

/* Отпечаток — это и есть результат, поэтому своё же значение из подсчёта
   вырезаем. Шаблон намеренно узкий: подставляется ровно одна строка. */
const STAMP_RE = /(BUILD_CODE\s*=\s*")[0-9a-f]*(")/;

/* Один и тот же файл на Windows и в Linux должен давать один отпечаток,
   поэтому переводы строк приводим к LF. */
function normalize(rel, buf) {
  let s = buf.toString("utf8").replace(/\r\n/g, "\n");
  if (rel === "app.js") s = s.replace(STAMP_RE, "$1$2");
  return s;
}

/* Отпечаток кода в каталоге dir (корень репозитория или dist/). */
function codeStamp(dir) {
  const h = crypto.createHash("sha1");
  CODE_FILES.forEach(function (f) {
    h.update(f);
    h.update("\0");
    h.update(normalize(f, fs.readFileSync(path.join(dir, f))));
    h.update("\0");
  });
  return h.digest("hex").slice(0, 16);
}

/* Подстановка отпечатка в готовый каталог публикации: и в app.js (чтобы
   приложение знало свой отпечаток), и в data/version.json (чтобы было с чем
   сравнить). Возвращает подставленный отпечаток. */
function applyCodeStamp(dir) {
  const appPath = path.join(dir, "app.js");
  const code = codeStamp(dir);

  const src = fs.readFileSync(appPath, "utf8");
  const patched = src.replace(STAMP_RE, "$1" + code + "$2");
  if (patched === src && !new RegExp('BUILD_CODE\\s*=\\s*"' + code + '"').test(src)) {
    throw new Error("не найдена константа BUILD_CODE в " + appPath);
  }
  fs.writeFileSync(appPath, patched, "utf8");

  const verPath = path.join(dir, "data", "version.json");
  if (fs.existsSync(verPath)) {
    const ver = JSON.parse(fs.readFileSync(verPath, "utf8"));
    ver.code = code;
    fs.writeFileSync(verPath, JSON.stringify(ver) + "\n", "utf8");
  }
  return code;
}

module.exports = {
  CODE_FILES: CODE_FILES,
  codeStamp: codeStamp,
  applyCodeStamp: applyCodeStamp
};
