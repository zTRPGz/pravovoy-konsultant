/* =========================================================================
   Правовой консультант :: работа без сети
   -------------------------------------------------------------------------
   Вступительный экран обещает работу офлайн, но без service worker это было
   неправдой: без интернета браузер не мог открыть сайт вовсе.

   Стратегия — «сначала сеть, при её отсутствии кеш». Это принципиально:
   пока связь есть, читатель получает ровно то, что лежит на хостинге, и
   никакие правки не «застревают» в кеше. Кеш включается только тогда, когда
   сети нет, — и тогда приложение открывается как обычно.

   Чего воркер не делает:
     • не трогает data/version.json — по нему приложение узнаёт о новой
       сборке, и ответ из кеша сломал бы это;
     • не кеширует ответы не своего источника и не-GET запросы;
     • не кеширует файлы больше 4 МБ (полные тексты крупнейших кодексов) —
       иначе хранилище быстро упирается в квоту браузера.

   Любая ошибка кеша глушится: воркер не должен ломать загрузку страницы.
   Новый воркер забирает управление сразу (skipWaiting + clientsClaim), а
   старые кеши удаляются при активации.
   ========================================================================= */

"use strict";

const CACHE = "rf-laws-v1";
const MAX_BYTES = 4 * 1024 * 1024;

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil((function () {
    return caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () {
      return self.clients.claim();
    }).catch(function () {});
  })());
});

/* Свежесть базы проверяется только по сети: ответ из кеша означал бы, что
   приложение никогда не узнает о новой сборке. */
function alwaysNetwork(url) {
  return /\/version\.json$/.test(url.pathname);
}

function cacheable(req, res) {
  if (!res || !res.ok || res.type !== "basic") return false;
  if (req.method !== "GET") return false;
  const len = parseInt(res.headers.get("content-length") || "0", 10);
  return !(len && len > MAX_BYTES);
}

function put(req, res) {
  try {
    const copy = res.clone();
    caches.open(CACHE).then(function (c) { return c.put(req, copy); }).catch(function () {});
  } catch (e) { /* квота или запрет — не повод ломать загрузку */ }
}

self.addEventListener("fetch", function (e) {
  const req = e.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;
  if (alwaysNetwork(url)) return;

  e.respondWith(
    fetch(req).then(function (res) {
      if (cacheable(req, res)) put(req, res);
      return res;
    }).catch(function () {
      /* сети нет — отдаём то, что успели сохранить */
      return caches.match(req).then(function (hit) {
        if (hit) return hit;
        /* переход по адресу без сети: показываем сохранённую оболочку */
        if (req.mode === "navigate") {
          return caches.match(self.registration.scope + "index.html").then(function (shell) {
            if (shell) return shell;
            return caches.match(self.registration.scope);
          });
        }
        return Response.error();
      });
    })
  );
});
