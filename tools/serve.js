/* =========================================================================
   Правовой консультант :: локальный сервер для просмотра
   -------------------------------------------------------------------------
   Приложение работает и с file://, но некоторые вещи удобнее проверить по
   HTTP: заголовки кеширования, относительные пути, поведение роутера на
   реальном origin. Этот мини-сервер отдаёт папку проекта как есть.

   Запуск:  node tools/serve.js [порт] [каталог]   (по умолчанию 8080, корень)
            node tools/serve.js 8123 dist         — посмотреть ровно то,
                                                    что уедет на хостинг

   Переменная окружения SERVE_CACHE=pages повторяет поведение GitHub Pages:
   всё отдаётся с max-age=600 и без возможности задать свои заголовки. Нужна,
   чтобы проверять автообновление в тех же условиях, что у читателя, —
   на Pages файлы данных могут прийти из кеша браузера:

            SERVE_CACHE=pages node tools/serve.js 8123 dist
   ========================================================================= */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", process.argv[3] || ".");
const PORT = Number(process.argv[2]) || 8080;
/* GitHub Pages не даёт задавать заголовки кеширования: любой файл живёт
   10 минут. Включается переменной окружения — см. заголовок файла. */
const PAGES_CACHE = process.env.SERVE_CACHE === "pages";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8"
};

const server = http.createServer(function (req, res) {
  var url = decodeURIComponent((req.url || "/").split("?")[0]);
  if (url === "/" || url.endsWith("/")) url += "index.html";
  /* путь выше корня не отдаём */
  var file = path.normalize(path.join(ROOT, url));
  if (file.indexOf(ROOT) !== 0) { res.writeHead(403); res.end("Нет доступа"); return; }

  fs.readFile(file, function (err, buf) {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Не найдено: " + url); return; }
    var ext = path.extname(file).toLowerCase();
    var long = /^\/data\/(full|ft)\//.test(url);
    res.writeHead(200, {
      "Content-Type": TYPES[ext] || "application/octet-stream",
      /* те же правила, что в vercel.json: тяжёлые тексты кешируются недолго
         и обновляются в фоне, а данные верхнего уровня перепроверяются всегда.
         В режиме pages — как на GitHub Pages: единые 10 минут на всё. */
      "Cache-Control": PAGES_CACHE ? "public, max-age=600"
        : (long ? "public, max-age=600, stale-while-revalidate=86400" : "no-cache"),
      "X-Content-Type-Options": "nosniff"
    });
    res.end(buf);
  });
});

server.listen(PORT, function () {
  console.log("Правовой консультант — http://localhost:" + PORT + "/");
  console.log("Остановить: Ctrl+C");
});
