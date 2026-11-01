/* =========================================================================
   Правовой консультант :: устойчивая выдача идентификаторов документов
   -------------------------------------------------------------------------
   Зачем. Идентификатор постановления Пленума — «plenum<номер>-<год>». Один
   номер в одном году встречается дважды: базовый акт и акт, вносящий в него
   изменения. Второму достаётся суффикс «-2». Раньше порядок выдачи суффикса
   повторял порядок строк в каталоге sudact.ru, и любая перестановка каталога
   (новый документ выше списка, страница не загрузилась в прогон) меняла
   значения: «plenum8-2014» начинал означать другой акт. Молча, без единой
   красной проверки. При этом в git лежит не только текст, но и ссылки на
   него: сохранённые читателем #/article/plenum8-2014-5, лента изменений и
   снимок актуальности указывают на идентификатор — после перенумерации они
   ведут в чужой документ.

   Что делает модуль. Собирает документы по базовому идентификатору и решает
   коллизию двумя правилами:
     1. прежний владелец голого идентификатора остаётся им — так ссылки не
        меняются от прогона к прогону;
     2. дальше документы упорядочены по слагу, то есть результат не зависит
        от порядка обхода каталога.
   ========================================================================= */
"use strict";

/* docs    — разобранные документы, у каждого есть app_id (базовый) и slug.
   prevIds — карта «прежний идентификатор -> slug» из прошлой выгрузки.
   Возвращает тот же массив docs с присвоенными уникальными app_id. */

/* Слаг везде сравниваем по хвосту адреса: в выгрузки это «law/<адрес>»,
   а в реестре — полный https-url, и сверять их напрямую нельзя. */
function slugTail(slug) {
  return String(slug || "").replace(/\/+$/, "").split("/").pop();
}

function assignStableIds(docs, prevIds) {
  const prev = prevIds || {};
  const groups = Object.create(null);
  docs.forEach(function (d) {
    const base = String(d.app_id || "");
    (groups[base] || (groups[base] = [])).push(d);
  });

  Object.keys(groups).forEach(function (base) {
    const g = groups[base];
    const holder = slugTail(prev[base]);
    g.sort(function (a, b) {
      /* прежний владелец голого id — первый; остальные — по слагу */
      const ka = slugTail(a.slug) === holder ? 0 : 1;
      const kb = slugTail(b.slug) === holder ? 0 : 1;
      if (ka !== kb) return ka - kb;
      return slugTail(a.slug) < slugTail(b.slug) ? -1 : slugTail(a.slug) > slugTail(b.slug) ? 1 : 0;
    });
    g.forEach(function (d, i) { d.app_id = i === 0 ? base : base + "-" + (i + 1); });
  });
  return docs;
}

/* Карта «идентификатор -> slug» из записей прошлой выгрузки. */
function idToSlug(list) {
  const map = Object.create(null);
  (list || []).forEach(function (d) { if (d && d.app_id && d.slug) map[d.app_id] = slugTail(d.slug); });
  return map;
}

module.exports = { assignStableIds: assignStableIds, idToSlug: idToSlug, slugTail: slugTail };
