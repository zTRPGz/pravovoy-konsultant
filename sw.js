/* =========================================================================
   Правовой консультант :: работа без сети
   -------------------------------------------------------------------------
   Вступительный экран обещает работу офлайн, но без service worker это было
   неправдой: без интернета браузер не мог открыть сайт вовсе.

   Стратегий две, и выбор зависит от адреса:

     • адрес с меткой версии (?v=<отпечаток сборки>) — содержимое по нему
       уже не изменится, поэтому сначала кеш, сеть только при промахе.
       Это и ускоряет повторные открытия, и делает их возможными без сети;

     • адрес без метки — сначала сеть, кеш только при её отсутствии.
       Иначе правка, выложенная под тем же адресом, «застряла» бы в кеше
       воркера — та же беда, что была с HTTP-кешем GitHub Pages.

   data/version.json не кешируется никогда: по нему приложение узнаёт о новой
   сборке, и ответ из кеша сломал бы это.

   Чего воркер ещё не делает:
     • не кеширует ответы не своего источника и не-GET запросы;
     • не кеширует ответы тяжелее MAX_BYTES — иначе хранилище упирается
       в квоту браузера. Лимит обязан быть выше САМОГО БОЛЬШОГО файла базы:
       data/full/nk2.js — около 9,7 МБ. При прежнем лимите 4 МБ НК РФ ч. 2,
       КоАП и сам поисковый индекс (data/index.js, 5,1 МБ, грузится первым
       экраном) в кеш не попадали, и обещание «работает офлайн» держалось
       только на HTTP-кеше браузера, который может быть вычищен.

   Любая ошибка кеша глушится: воркер не должен ломать загрузку страницы.
   Новый воркер забирает управление сразу (skipWaiting + clientsClaim), а
   старые кеши удаляются при активации.
   ========================================================================= */

"use strict";

/* Имя кеша меняется вместе со сменой стратегии: при активации все прочие
   кеши удаляются, поэтому старые копии прошлых сборок не копятся в хранилище. */
const CACHE = "rf-laws-v2";
/* 12 МБ — с запасом выше крупнейшего файла базы (data/full/nk2.js ≈ 9,7 МБ).
   Ошибки записи глушатся, поэтому слишком большой лимит безопасен: при
   нехватке квоты файл просто не закешируется, загрузка не сломается. */
const MAX_BYTES = 12 * 1024 * 1024;

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

/* Метка версии — отпечаток кода и/или базы (см. buildTag в app.js). Она
   меняется при каждой сборке, поэтому адрес с ней неизменяем. Проверяем
   форму, а не просто наличие ?v=: случайный параметр (рекламный, отладка)
   ничего не обещает, и отдавать по нему старый кеш нельзя. */
function versioned(url) {
  return /^[0-9a-f]{8,}(?:-[0-9a-f]{8,})?$/.test(url.searchParams.get("v") || "");
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

function fromNetwork(req) {
  return fetch(req).then(function (res) {
    if (cacheable(req, res)) put(req, res);
    return res;
  });
}

self.addEventListener("fetch", function (e) {
  const req = e.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;
  if (alwaysNetwork(url)) return;

  e.respondWith(
    (versioned(url)
      /* адрес помечен версией — сохранённая копия заведомо та же самая */
      ? caches.match(req).then(function (hit) { return hit || fromNetwork(req); })
      : fromNetwork(req)
    ).catch(function () {
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
