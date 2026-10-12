/* =========================================================================
   Правовой консультант :: приложение
   Правовой консультант-помощник для юристов, следователей и госорганов.
   Работает локально, без сервера и без сборки.

   Данные:
     window.RF_CODES   — реестр источников (кодексы, федеральные законы,
                         Конституция, ФКЗ) с датой редакции и ссылкой
     window.RF_IDX     — поисковый индекс всех статей [источник, номер, название, глава]
     window.RF_ANNOT   — справочные аннотации (ключевые слова, санкция, заметки)
     window.RF_EXTRA   — источники без полного текста (если остались)
     window.RF_REF     — сроки, чек-листы, шаблоны, правила разбора ситуации
     window.RF_FULL    — полные тексты, подгружаются по требованию (data/full/*.js)
     window.RF_FRESH   — снимок актуальных редакций для проверки актуальности
     window.RF_PARSE   — общий модуль разбора (data/parse.js), используется при
                         автоматическом обновлении документов

   Отладочный доступ к поиску:
     window.RF_SEARCH  — { parse, search, ft, snippet, opts }
                         Разбор запроса, поиск по реестру, полнотекстовый
                         поиск и вырезка отрывка. Нужен проверкам качества
                         выдачи (tools/search-eval.js) и автоматизации.
   ========================================================================= */
(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ------------------------------------------------------------------ утилиты */

  function norm(s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000\ufeff]/g, " ")
      .replace(/[«»"'`„“”]/g, " ")
      .replace(/[^a-zа-я0-9.\-\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /* Экранирование для HTML.
     Кавычки экранируются обязательно: esc() используется и внутри атрибутов
     (title="…", value="…", data-*="…"), где незакрытая кавычка позволяет
     вырваться из значения. Ранее кавычки не экранировались — это была
     реальная уязвимость: кавычка в названии статьи, аннотации или заметке
     ломала разметку и могла создать обработчик события. */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  /* --------------------------------------------------------------- иконки
     Единый набор линейных иконок (24×24, обводка currentColor). Заменяет
     разнородные эмодзи и типографские значки: у всех элементов интерфейса
     теперь одна визуальная система. Значение — внутренняя разметка SVG. */
  var ICONS = {
    home: '<path d="M3 10.2 12 3l9 7.2V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m15.6 8.4-2 5.2-5.2 2 2-5.2z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.4 2"/>',
    shield: '<path d="M12 3 5 6v5.5c0 4.5 3 7.7 7 9.5 4-1.8 7-5 7-9.5V6z"/><path d="m9.2 12 2 2 3.6-3.8"/>',
    ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
    swap: '<path d="M4 8h13"/><path d="m14 5 3 3-3 3"/><path d="M20 16H7"/><path d="m10 13-3 3 3 3"/>',
    refresh: '<path d="M20.4 11.4a8.4 8.4 0 1 1-2.2-5.6"/><path d="M20.6 3.9v5.3h-5.3"/>',
    columns: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
    activity: '<path d="M3 12h4l2.5-7 4 14 2.5-7H21"/>',
    chart: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4"/><path d="m15.4 6.5-6.8 4"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    checkbox: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m8 12 2.5 2.5L16 9"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    clip: '<path d="M20.5 11.5 12 20a5 5 0 0 1-7-7l8.5-8.5a3.4 3.4 0 0 1 4.8 4.8l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    save: '<path d="M4 6a2 2 0 0 1 2-2h9l5 5v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M8 4v5h6"/><rect x="8" y="13" width="8" height="5" rx="1"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.4 9.2a2.7 2.7 0 0 1 5.3.8c0 1.8-2.7 2.4-2.7 4"/><path d="M12 17.2h.01"/>',
    user: '<circle cx="12" cy="8" r="3.6"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>',
    id: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.2"/><path d="M6 16.2c.7-1.4 1.8-2 3-2s2.3.6 3 2"/><path d="M15 10h3"/><path d="M15 13h3"/>',
    lock: '<rect x="4" y="10.5" width="16" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    inbox: '<path d="M3 13h4l1.5 3h7L17 13h4"/><path d="M5.4 5.2 3 11v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6l-2.4-5.8A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.8 1.2z"/>',
    chat: '<path d="M20 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/>',
    cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.4 12.2a1.6 1.6 0 0 0 1.6 1.3h8.4a1.6 1.6 0 0 0 1.6-1.3L21 7H6"/>',
    phone: '<path d="M21 16.5v2.6a1.8 1.8 0 0 1-2 1.8 17.8 17.8 0 0 1-7.7-2.8 17.5 17.5 0 0 1-5.4-5.4A17.8 17.8 0 0 1 3.1 5a1.8 1.8 0 0 1 1.8-2h2.6a1.8 1.8 0 0 1 1.8 1.5c.1.9.3 1.7.6 2.5a1.8 1.8 0 0 1-.4 1.9l-1.1 1.1a14.4 14.4 0 0 0 5.4 5.4l1.1-1.1a1.8 1.8 0 0 1 1.9-.4c.8.3 1.6.5 2.5.6a1.8 1.8 0 0 1 1.5 1.8z"/>',
    book: '<path d="M4 19.2A2.2 2.2 0 0 1 6.2 17H20"/><path d="M6.2 3H20v18H6.2A2.2 2.2 0 0 1 4 18.8V5.2A2.2 2.2 0 0 1 6.2 3z"/>',
    scales: '<path d="M12 4v16"/><path d="M6 20h12"/><path d="M5 7h14"/><path d="M8.5 7 5.5 13.5h6z"/><path d="M15.5 7l-3 6.5h6z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5"/><path d="M12 19.5V22"/><path d="m4.9 4.9 1.8 1.8"/><path d="m17.3 17.3 1.8 1.8"/><path d="M2 12h2.5"/><path d="M19.5 12H22"/><path d="m4.9 19.1 1.8-1.8"/><path d="m17.3 6.7 1.8-1.8"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
    command: '<path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z"/>',
    dot: '<circle cx="12" cy="12" r="3"/>',
    arrow: '<path d="M5 12h13"/><path d="m13 6 6 6-6 6"/>',
    print: '<path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
    menu: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
    close: '<path d="m6 6 12 12"/><path d="m18 6-12 12"/>',
    up: '<path d="M12 19V5"/><path d="m6 11 6-6 6 6"/>',
    backspace: '<path d="M9.5 5H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9.5L3 12z"/><path d="m12.5 9.5 5 5"/><path d="m17.5 9.5-5 5"/>',
    calculator: '<rect x="5" y="3" width="14" height="18" rx="2"/><rect x="8.2" y="6" width="7.6" height="3" rx="1"/><path d="M8.6 12.4h.01"/><path d="M12 12.4h.01"/><path d="M15.4 12.4h.01"/><path d="M8.6 16h.01"/><path d="M12 16h.01"/><path d="M15.4 16h.01"/>'
  };

  function ic(name, cls) {
    var body = ICONS[name] || ICONS.dot;
    return '<svg class="ic' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" ' +
      'fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      body + "</svg>";
  }

  /* Заполняет элементы с data-ico готовой иконкой (один раз на элемент) */
  function paintIcons(root) {
    $$("[data-ico]", root || document).forEach(function (el) {
      if (el.getAttribute("data-ico-done") === "1") return;
      el.innerHTML = ic(el.getAttribute("data-ico"));
      el.setAttribute("data-ico-done", "1");
    });
  }

  function fmtDate(d) { return pad(d.getDate()) + "." + pad(d.getMonth() + 1) + "." + d.getFullYear(); }
  function fmtDateTime(d) { return fmtDate(d) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function fmtDay(d) {
    var w = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
    return fmtDate(d) + " (" + w[d.getDay()] + ")";
  }

  /* Дата редакции из вида «2026-08-15» -> «15.08.2026» */
  function fmtRed(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
    return m ? m[3] + "." + m[2] + "." + m[1] : (s || "н/д");
  }

  /* Прошло времени с даты: «сегодня», «вчера», «3 дня назад», «на прошлой
     неделе», «месяц назад». Сравнение календарное (день в дне), поэтому
     «месяц назад» — это тот же номер прошлого месяца, а не 30 суток. */
  function relDay(iso) {
    var then = repDate(iso);
    if (!then) return "";
    var now = new Date();
    var a = new Date(then.getFullYear(), then.getMonth(), then.getDate());
    var b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var d = Math.round((b - a) / 86400000);
    if (d <= 0) return "сегодня";
    if (d === 1) return "вчера";
    if (d < 7) return d + " " + plural(d, ["день", "дня", "дней"]) + " назад";
    if (d < 14) return "на прошлой неделе";
    if (d < 30) {
      var w = Math.floor(d / 7);
      return w + " " + plural(w, ["неделю", "недели", "недель"]) + " назад";
    }
    /* месяцы календарно, с поправкой на число: 31.03 → 01.04 ещё «неделю» */
    var mb = now.getFullYear() * 12 + now.getMonth();
    var ma = then.getFullYear() * 12 + then.getMonth();
    var mo = mb - ma - (now.getDate() < then.getDate() ? 1 : 0);
    if (mo < 1) mo = 1;
    if (mo === 12) return "год назад";
    if (mo > 12) {
      var y = Math.floor(mo / 12);
      return y + " " + plural(y, ["год", "года", "лет"]) + " назад";
    }
    return mo + " " + plural(mo, ["месяц", "месяца", "месяцев"]) + " назад";
  }

  function plural(n, forms) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
  }

  /* ------------------------------------------------------------------ модель данных */

  var RAW_CODES = (window.RF_CODES || []).slice();
  var EXTRA = window.RF_EXTRA || { codes: [], articles: [] };
  var ANNOT = window.RF_ANNOT || {};
  var REF = window.RF_REF || {};
  var IDX = window.RF_IDX || [];
  var FRESH = window.RF_FRESH || null;
  var PARSE = window.RF_PARSE || null;
  var XREF_LIB = window.RF_XREF || null;
  var FT = window.RF_TEXT || null;
  var FT_META = window.RF_FT_META || null;

  /* Статусы норм: id статьи -> [статус, акт-основание, дата акта].
     Слой отдельный от индекса: статус есть только у части норм. */
  var STATUS = window.RF_STATUS || {};
  var STATUS_ACTS = window.RF_STATUS_ACTS || [];
  var STATUS_META = window.RF_STATUS_META || { repealed: 0, suspended: 0, void: 0, total: 0 };

  var ST_TITLE = {
    repealed: "Утратила силу",
    suspended: "Приостановлена",
    void: "Признана недействующей"
  };

  /* Лента изменений для вкладки «Новое»: одна запись на документ на дату
     проверки (data/changelog.js, tools/build-changelog.js). В отличие от
     «Проверки актуальности», сеть здесь не нужна: изменения уже зафиксированы
     в собранной базе. */
  var CHANGELOG = window.RF_CHANGELOG || { built_at: null, entries: [] };

  /* Статус статьи по её id. Возвращает {st, act, date, title} либо null. */
  function artStatus(id) {
    var s = STATUS[id];
    if (!s) return null;
    return { st: s[0], act: s[1] || "", date: s[2] || "", title: ST_TITLE[s[0]] || "Недействующая" };
  }

  /* Небольшой значок статуса для списков и результатов поиска */
  function statusBadge(id) {
    var s = artStatus(id);
    if (!s) return "";
    var cls = s.st === "suspended" ? "st-warn" : "st-rep";
    return '<span class="st ' + cls + '" title="' + esc(s.title + (s.act ? ": " + s.act : "")) + '">' +
      esc(s.title) + "</span>";
  }

  /* Развёрнутая плашка статуса для страницы статьи */
  function statusBox(id) {
    var s = artStatus(id);
    if (!s) return "";
    var cls = s.st === "suspended" ? "warn-box" : "repeal-box";
    var extra = s.act
      ? '<div class="small" style="margin-top:6px">Основание: ' + esc(s.act) +
        (s.date ? " от " + fmtRed(s.date) : "") + "</div>"
      : "";
    return '<div class="' + cls + '"><b>' + esc(s.title) + ".</b> " +
      (s.st === "suspended"
        ? "Действие нормы приостановлено — проверьте условия и срок приостановления."
        : s.st === "void"
          ? "Норма признана недействующей — в текущей редакции применению не подлежит."
          : "Норма исключена из действующей редакции — применению не подлежит.") +
      extra +
      '<div class="small muted" style="margin-top:6px">Статус распознан из официального текста статьи. Сверьтесь с официальной публикацией.</div>' +
      "</div>";
  }


  /* Источники с полным текстом. Поле kind: code | law | fkz | constitution */
  var CODES = RAW_CODES.slice();
  var CO = {};
  CODES.forEach(function (c) { CO[c.id] = c; });

  function codeById(id) { return CO[id] || null; }

  /* displayNum: убираем служебный «*» у продублированных номеров */
  function dispNum(n) { return String(n).replace(/\*+$/, ""); }

  var arts = [];       // все статьи (индекс + аннотации + дополнительные источники)
  var byId = {};       // "источник-номер" -> запись
  var byCode = {};     // источник -> массив записей

  function pushArt(a) {
    var id = a.c + "-" + a.n;
    if (byId[id]) return;
    a.id = id;
    a.dn = dispNum(a.n);
    byId[id] = a;
    (byCode[a.c] = byCode[a.c] || []).push(a);
    arts.push(a);
  }

  /* Создание записи статьи: подключение аннотации и поисковых полей */
  function makeArt(c, n, t, g, note) {
    var a = { c: c, n: n, t: t, g: g };
    if (note) a.note = true;
    var an = ANNOT[c + "-" + n];
    if (an) {
      a.k = an.k || ""; a.s = an.s || ""; a.p = an.p || ""; a.x = an.x || "";
      if (!a.t || /^Статья\s/.test(a.t)) a.t = an.t || a.t;
    }
    return searchable(a);
  }

  function searchable(a) {
    a._t = norm(a.t);
    a._k = norm(a.k);
    a._s = norm(a.s);
    a._g = norm(a.g);
    a._n = norm(a.n);
    a._p = norm(a.p);
    a._x = norm(a.x);
    /* Основы слов — чтобы «кража» находила «кражу», а «суд» не находил
       «государственная». Подстрочный поиск по нормализованной строке давал
       именно такие ложные совпадения: «суд» сидел внутри «гоСУДарственная»,
       а «вред» — внутри «вредительство». */
    if (FT) {
      a._T = FT.stems(a.t);
      a._K = FT.stems(a.k);
      a._S = FT.stems(a.s);
      a._G = FT.stems(a.g);
      a._P = FT.stems(a.p);
      a._X = FT.stems(a.x);
    }
    return a;
  }

  /* Основной массив: источники с полным текстом.
     Формат «с наследованием»: у записи пустая глава (r[3] === ""), если её глава
     совпадает с главой предыдущей записи того же источника. Спецмаркер "~"
     означает «у статьи главы нет» (единичный случай: ст. 0.1 в ФКЗ об арбитражных
     судах). Это снимает дублирование названий глав в data/index.js (~0.9 МБ, 29 %
     файла). Если глава непустая — она же становится текущей для последующих
     записей источника; при сборке в r[3] всегда попадает реальная глава, маркер
     или пусто, поэтому восстановление однозначно. */
  var NO_CHAPTER = "~";
  var lastChapter = {};
  IDX.forEach(function (r) {
    var raw = r[3];
    var g;
    if (raw === NO_CHAPTER) g = "";
    else if (raw) { g = raw; lastChapter[r[0]] = raw; }
    else g = (lastChapter[r[0]] !== undefined ? lastChapter[r[0]] : "");
    pushArt(makeArt(r[0], r[1], r[2], g));
  });

  /* Источники без полного текста (если такие остались в RF_EXTRA) */
  (EXTRA.articles || []).forEach(function (a) {
    if (CO[a.c]) return;   // для этого источника уже есть полный текст
    pushArt(makeArt(a.c, a.n, a.t, a.g, true));
  });
  (EXTRA.codes || []).forEach(function (c) {
    if (!CO[c.id]) { CODES.push(c); CO[c.id] = c; }
  });

  /* Перекрёстные ссылки: разрешитель «статья N такого-то кодекса» -> id статьи.
     Создаётся после наполнения byId, чтобы проверять существование статьи. */
  var XREF = XREF_LIB ? XREF_LIB.create({
    docs: CODES,
    has: function (id, num) { return !!byId[id + "-" + num]; }
  }) : null;

  var CODE_ALIASES = {
    "ук": "uk", "укрф": "uk", "уголовный": "uk", "уголовного": "uk", "uk": "uk",
    "упк": "upk", "упкрф": "upk", "upk": "upk",
    "коап": "koap", "коапрф": "koap", "koap": "koap", "административный": "koap",
    "гк": "gk1", "гкрф": "gk1", "gk": "gk1", "гражданский": "gk1",
    "тк": "tk", "ткрф": "tk", "tk": "tk", "трудовой": "tk",
    "нк": "nk1", "нкрф": "nk1", "nk": "nk1", "налоговый": "nk1",
    "гпк": "gpk", "кас": "kas", "апк": "apk",
    "ск": "sk", "семейный": "sk", "жк": "zhk", "жилищный": "zhk",
    "зк": "zk", "земельный": "zk", "грк": "grk", "градостроительный": "grk",
    "бк": "bk", "бюджетный": "bk", "уик": "uik", "лк": "lk", "лесной": "lk",
    "вк": "vk", "водный": "vk", "взк": "vozk", "воздушный": "vozk",
    "ктм": "ktm", "кввт": "kvvt",
    "конституция": "kons", "конституции": "kons", "kons": "kons",
    "фз": "fz", "закон": "fz", "полиции": "fz", "орд": "fz", "прокуратуре": "fz"
  };

  /* Служебные слова, не несущие поисковой нагрузки */
  var STOP = {
    "ст": 1, "стать": 1, "статья": 1, "статьи": 1, "статье": 1, "статью": 1, "статей": 1,
    "стр": 1, "п": 1, "пункт": 1, "ч": 1, "часть": 1, "части": 1, "рф": 1, "россии": 1,
    "и": 1, "в": 1, "на": 1, "по": 1, "для": 1, "или": 1, "не": 1, "с": 1, "к": 1, "о": 1, "об": 1,
    "это": 1, "как": 1, "что": 1, "при": 1, "из": 1, "от": 1, "до": 1, "за": 1, "же": 1
  };

  /* Смысловые связи: основа слова запроса -> близкие по смыслу основы.
     Расширяют поиск, но НЕ подменяют его: синонимы получают меньший вес и не
     дают надбавок за множественные совпадения, поэтому точные слова запроса
     всегда выше. Ключи — основы (как в REF.intents). */
  var SYN = {
    "краж": ["хищен", "тайн", "похищ"],
    "похищ": ["хищен", "краж", "тайное хищение"],
    "хищен": ["краж", "похищ", "растрат", "присвоен"],
    "растрат": ["хищен", "присвоен"],
    "грабеж": ["открытое хищение", "насилие"],
    "разбой": ["нападен", "хищен", "оруж"],
    "мошеннич": ["обман", "злоупотребление доверием", "довери"],
    "вымогательств": ["требование передачи", "угроз"],
    "угон": ["неправомерное завладение", "транспортн"],
    "взятк": ["подкуп", "должностн", "вознагражден", "коррупц"],
    "подкуп": ["взятк", "коррупц"],
    "наркотич": ["психотроп", "сбыт", "хранен", "прекурсор"],
    "психотроп": ["наркотич", "сбыт"],
    "оружие": ["огнестрельн", "боеприпас", "взрывчат", "патрон"],
    "убийств": ["лишение жизни", "смерт", "умышленное причинение смерти"],
    "побо": ["телесн", "насильствен", "истязан"],
    "истязан": ["побо", "телесн"],
    "задержан": ["доставлен", "административн", "подозреваем"],
    "обыск": ["выемк", "изъят", "досмотр", "осмотрен"],
    "досмотр": ["обыск", "изъят", "личный досмотр"],
    "ущерб": ["вред", "убытк", "урон", "уничтожен"],
    "вред": ["ущерб", "здоров"],
    "увольнен": ["расторжен", "трудов", "прогул", "дисциплинарн"],
    "срок": ["давност", "исчислен", "продлен", "процессуальн"],
    "штраф": ["взыскан", "наказан", "административн"],
    "алкогол": ["опьянен", "спиртн", "этилов"],
    "опьянен": ["алкогол", "наркотич", "освидетельствован"],
    "дтп": ["дорожн", "транспортн", "столкновен", "дорожного движения"],
    "полиц": ["сотрудник", "орган внутренних дел", "правоохранительн"],
    "фсб": ["федеральная служба безопасности", "контрразвед", "безопасност"],
    "терроризм": ["террористическ", "экстремизм", "антитеррористическ"],
    "экстремизм": ["терроризм", "ненавист", "розн"],
    "коррупц": ["взятк", "конфликт интерес", "противодействие коррупции"],
    "митинг": ["собрани", "публичное мероприятие", "пикетирован"],
    "иностранец": ["мигрант", "гражданств", "выдворен", "иностранн"],
    "мигрант": ["миграционн", "иностранн", "учет"],
    "тайна": ["государственная тайна", "секрет", "конфиденциальн"],
    "госзащит": ["защита потерпевших", "защита свидетелей", "безопасность"],
    "укрывательств": ["заранее не обещанн", "особо тяжк"],
    "крайняя необходимость": ["необходимая оборона", "обстоятельства исключающие"],
    "оборон": ["крайняя необходимость", "нападени"]
  };

  /* Расширение слов запроса синонимами. Возвращает только те основы, которых
     нет среди исходных слов (без дублей, не длиннее 4 знаков не берём). */
  function expandSyn(words) {
    var seen = {}, out = [];
    words.forEach(function (w) { seen[w] = 1; });
    words.forEach(function (w) {
      Object.keys(SYN).forEach(function (key) {
        if (key.length < 4) return;
        if (w.indexOf(key) !== 0 && key.indexOf(w) !== 0) return;
        SYN[key].forEach(function (s) {
          if (s.length < 4 || seen[s]) return;
          seen[s] = 1; out.push(s);
        });
      });
    });
    return out.slice(0, 12);
  }

  /* ------------------------------------------------- разбор поискового запроса

     Синтаксис (всё необязательное, как в обычных поисковиках):
       "не позднее трех суток"  — точная фраза: слова подряд и в этом порядке
       +обыск                   — слово обязательно (по умолчанию обязательны
                                  все слова, но длинный запрос приложение
                                  ослабляет — «+» запрещает это делать)
       -понятой                 — слово исключается из выдачи
     Номер статьи и кодекс разбираются как раньше: «ст 105 УК», «19.7.10-1 КоАП».

     Кавычки, «+» и «-» вырезаются ДО нормализации: norm() заменяет их на
     пробелы, и после неё отличить оператор от знака уже невозможно. */
  function queryNorm(s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000\ufeff]/g, " ")
      .replace(/[«»„“”`]/g, " ")
      .replace(/[^a-zа-я0-9.\-+"!\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function uniqList(arr) {
    var seen = {}, out = [];
    arr.forEach(function (x) { if (x && !seen[x]) { seen[x] = 1; out.push(x); } });
    return out;
  }

  /* Токены фразы: без стоп-слов и коротких слов, как и обычные слова запроса */
  function phraseTokens(ph) {
    return ph.split(" ").filter(function (w) { return w.length >= 3 && !STOP[w]; });
  }

  function parseQuery(q) {
    var src = queryNorm(q);
    var phrases = [];
    /* фразы вынимаются первыми: внутри кавычек «+» и «-» — обычные символы */
    src = src.replace(/"([^"]*)"/g, function (m, inner) {
      var t = inner.trim();
      if (t) phrases.push(t);
      return " ";
    });
    var tokens = src.split(" ").filter(Boolean);
    var numbers = [], words = [], must = [], not = [], code = null;
    tokens.forEach(function (t) {
      var sign = "";
      if (t.charAt(0) === "+" || t.charAt(0) === "-" || t.charAt(0) === "!") {
        sign = t.charAt(0); t = t.slice(1);
      }
      if (!t) return;
      if (/^\d+(?:[.-]\d+)*$/.test(t)) { if (sign !== "-") numbers.push(t); return; }
      if (CODE_ALIASES[t]) { if (!code && sign !== "-") code = CODE_ALIASES[t]; return; }
      if (t.length < 3) return;
      if (sign === "-") { not.push(t); return; }
      if (STOP[t]) return;
      if (sign === "+") must.push(t);
      words.push(t);
    });
    /* слова фразы обязательны: иначе «"не позднее трех суток"» превратилось бы
       в поиск по «трех» и «суток» по отдельности */
    phrases.forEach(function (ph) {
      phraseTokens(ph).forEach(function (w) { words.push(w); must.push(w); });
    });
    words = uniqList(words);
    must = uniqList(must);
    not = uniqList(not);
    /* Число — это номер статьи только когда запрос и правда про статью:
       «ст 105 УК», «19.7.10-1 КоАП» или одиночное «105». В описании ситуации
       («похитили 150 кг бивня мамонта») числа — не номера: иначе помощник
       выдавал статьи 150 УК, 150 УПК, 150 ГК, 150 ТК и так далее по всему
       реестру, и ответ выглядел случайным. */
    var useNums = numbers.length > 0 && (!!code || (words.length === 0 && !phrases.length));
    return {
      raw: norm(q), tokens: words, must: must, not: not, phrases: phrases,
      numbers: numbers, useNums: useNums, code: code, syn: expandSyn(words)
    };
  }

  /* Совпадение основы запроса с основами документа: точное либо по началу
     слова (чтобы набор «обыс» находил «обыск»), но НЕ по подстроке внутри
     слова. Именно подстрочное совпадение давало «суд» → «государственная»
     и «вред» → «вредительство». */
  function stemHit(list, t) {
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      if (d === t) return true;
      if (t.length >= 4 && d.length >= 4 && (d.indexOf(t) === 0 || t.indexOf(d) === 0)) return true;
    }
    return false;
  }

  /* Совпадение основы в точности. Отделено от stemHit, потому что это разная
     по силе улика: «прогул» и «прогулк» (прогулка) — разные основы, и статья
     «Прогулки осуждённых» не должна обгонять статью, где написано именно
     «прогул». Раньше оба случая весили одинаково. */
  function stemExact(list, t) {
    for (var i = 0; i < list.length; i++) if (list[i] === t) return true;
    return false;
  }

  /* Совпадение только по началу слова — слабее точного */
  function stemPrefix(list, t) {
    if (t.length < 4) return false;
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      if (d === t) continue;
      if (d.length >= 4 && (d.indexOf(t) === 0 || t.indexOf(d) === 0)) return true;
    }
    return false;
  }

  /* Вес поля в поиске по реестру. Номер статьи — точный идентификатор и весит
     на порядок больше остальных полей. Дальше по убыванию: название статьи,
     ключевые слова аннотации, текст аннотации, порядок действий, перекрёстные
     ссылки, глава. Раньше числа были рассыпаны по циклу; теперь собраны в
     одной таблице, и по ней же строится блок «почему совпало». */
  var FIELD_W = { t: 120, k: 70, s: 16, p: 12, x: 6, g: 7 };

  /* Вес статьи для текущей роли — с запоминанием. search() перебирает все
     19 307 статей на каждое нажатие клавиши, а norm() с двумя десятками
     ключевых слов на статью стоил бы десятки лишних миллисекунд.

     ВАЖНО: роль используется только как пометка и для отдельного блока
     «По вашей роли». Она НЕ участвует в балле: замеры на контрольном наборе
     показали, что надбавка за роль роняет MRR с 0.93 до 0.83 и выкидывает
     верную норму из первой пятёрки — для юридического справочника это
     недопустимо. Смотреть ROLE_BOOST/ROLE_DAMP в закомментированном виде. */
  function artRole(a) {
    var r = state.role;
    if (!r) return { w: 0, off: false };
    var c = a._rl || (a._rl = {});
    if (c[r] === undefined) {
      var t = a.t + " " + cite(a);
      c[r] = { w: roleWeight(t), off: roleOff(t) };
    }
    return c[r];
  }

  /* Надбавка за попадание статьи в курируемый разбор ситуации. Больше веса
     названия (120): если человек написал «прогул», норма об увольнении за
     прогул обязана быть первой, даже если само слово есть только в её тексте. */
  var TOPIC_W = 300;

  /* Фраза целиком — по тем полям, которые уже есть в памяти (название, глава,
     ключевые слова, аннотация). Полный текст статьи для этого не нужен: если
     фраза есть только в тексте, её проверит полнотекстовый поиск. */
  function metaPhraseHit(a, ph) {
    return (a._t + " " + a._k + " " + a._s + " " + a._p + " " + a._x + " " + a._g).indexOf(ph) !== -1;
  }

  /* Курируемые разборы ситуаций (REF.intents) — связки «тема → нормы», которые
     готовятся для «Помощника». Здесь они работают как сигнал ранжирования, и
     это единственный сигнал, отличающий норму от пояснения: «прогул» в
     ст. 81 ТК РФ упомянут один раз, а в постановлении Пленума о трудовых
     спорах — десятки раз, поэтому по одной частоте слова комментарий всегда
     обгоняет норму. Разбор подключается только при уверенном совпадении:
     точное слово-ключ либо не меньше двух совпадений по началу слова. */
  var TOPICS = null;
  function topicsList() {
    if (TOPICS) return TOPICS;
    TOPICS = (REF.intents || []).map(function (it) {
      var kw = [];
      (it.keywords || []).forEach(function (k) {
        var list = FT ? FT.stems(String(k)) : [String(k).toLowerCase()];
        if (!list.length) return;
        /* Ключ из одного слова сравнивается как основа, ключ-фраза («судебные
           расходы») — только когда в запросе есть ВСЕ его слова: иначе разбор
           про госпошлину цеплялся бы за любой запрос со словом «расход». */
        kw.push(list.length === 1 ? list[0] : list);
      });
      return { t: it.t, kw: kw, arts: it.articles || [] };
    });
    return TOPICS;
  }

  /* Совпадение основы запроса с основой ключа: точное или по началу слова. */
  function stemLike(ks, w) {
    if (ks === w) return 2;
    if (w.length >= 4 && ks.indexOf(w) === 0) return 1;
    return 0;
  }

  /* Подходящий запросу разбор ситуации: {t: название, w: {id статьи: вес}}.
     Вес убывает от первой нормы разбора к последней — порядок в REF.intents
     не случаен, главная норма всегда стоит первой.
     Разбор выбирается по ПОКРЫТИЮ запроса: сколько разных слов запроса
     объясняет его список ключей. Иначе «государственная пошлина по иску»
     цеплялось бы за разбор про возмещение ущерба — там в ключах есть «иск». */
  function topicMatch(qStems) {
    if (!qStems.length) return null;
    var best = null;
    topicsList().forEach(function (it) {
      var strong = 0, weak = 0, used = {};
      it.kw.forEach(function (k) {
        if (typeof k === "string") {
          qStems.forEach(function (w) {
            if (used[w]) return;
            var h = stemLike(k, w);
            if (h === 2) { used[w] = 1; strong++; }
            else if (h === 1) { used[w] = 1; weak++; }
          });
          return;
        }
        /* Ключ-фраза зачитывается, только если в запросе есть ВСЕ её слова:
           иначе разбор про госпошлину цеплялся бы за любой запрос со словом
           «расход». Каждое слово фразы закрывает своё слово запроса. */
        var cov = [], ok = true;
        k.forEach(function (ks) {
          var m = null;
          qStems.forEach(function (w) { if (!m && stemLike(ks, w)) m = w; });
          if (!m) ok = false; else cov.push(m);
        });
        if (!ok) return;
        cov.forEach(function (w) { if (!used[w]) { used[w] = 1; strong++; } });
      });
      /* Разбор подключается только при уверенном совпадении: хотя бы одно
         точное слово-ключ либо не меньше двух совпадений по началу слова.
         Одного совпадения «по началу» мало — так «обыс» цепляло бы «обыск». */
      if (!strong && weak < 2) return;
      var score = strong * 2 + weak;
      if (!best || score > best.score) best = { t: it.t, arts: it.arts, score: score };
    });
    if (!best) return null;
    var w = {}, n = best.arts.length || 1;
    best.arts.forEach(function (id, i) { if (!(id in w)) w[id] = 1 - i / n; });
    return { t: best.t, w: w };
  }

  /* Поиск по индексу статей (название, ключевые слова, аннотация, глава).
     opt.cut — доля от лучшего результата, ниже которой «хвост» отбрасывается.
     opt.cut = 1 отключает отсечку. opt.skipRepealed — не показывать нормы,
     утратившие силу. */
  function search(q, opt) {
    opt = opt || {};
    var p = parseQuery(q);
    if (!p.tokens.length && !p.numbers.length) return [];

    var pool = arts;
    if (p.code) {
      var sub = byCode[p.code];
      if (sub && sub.length) pool = sub;
    }

    var qStems = FT ? FT.stems(p.tokens.join(" ")) : [];
    var mustStems = FT ? FT.stems(p.must.join(" ")) : [];
    var notStems = FT ? FT.stems(p.not.join(" ")) : [];
    var synStems = FT ? FT.stems(p.syn.join(" ")).filter(function (s) {
      return qStems.indexOf(s) === -1 && notStems.indexOf(s) === -1;
    }) : [];
    /* Сколько слов запроса обязан покрывать документ. Короткий запрос —
       все слова (иначе «получение взятки» тянет «незаконное получение
       кредита»), длинный — не меньше двух (иначе описание ситуации
       не находит ничего). */
    var need = opt.need != null ? opt.need
      : (qStems.length ? (qStems.length <= 2 ? qStems.length : 2) : 0);

    var out = [];
    /* Разбор ситуации ищется по словам запроса и поднимает свои нормы: без
       него «прогул» находит «Прогулки осуждённых», а не ст. 81 ТК РФ. */
    var topic = topicMatch(qStems);
    pool.forEach(function (a) {
      var s = 0, tm = 0, km = 0, strong = 0, weak = 0, numHit = false;
      var tb = (topic && topic.w[a.id]) || 0;
      if (p.useNums) p.numbers.forEach(function (num) {
        if (a.n === num) { s += 1400; numHit = true; }
        else if (a.n.indexOf(num + ".") === 0 || a.n.indexOf(num + "-") === 0) { s += 300; numHit = true; }
        else if (a.n.indexOf(num) === 0) s += 120;
      });
      var AT = a._T || [], AK = a._K || [], AS = a._S || [], AG = a._G || [],
          AP = a._P || [], AX = a._X || [];
      var fields = [];
      var TW = PLENUM[a.c] ? FIELD_W.t * 0.5 : FIELD_W.t;
      /* Точное совпадение основы весит в полную силу и засчитывается в
         покрытие слов запроса; совпадение «по началу слова» — вдвое слабее
         и идёт в отдельный счётчик: оно полезно для недописанных слов
         («обыс» → «обыск»), но как доказательство релевантности слабее. */
      qStems.forEach(function (t) {
        if (stemExact(AT, t)) { s += TW; tm++; strong++; fields.push("названии"); }
        else if (stemPrefix(AT, t)) { s += TW * 0.5; tm++; weak++; }
        if (stemExact(AK, t)) { s += FIELD_W.k; km++; strong++; fields.push("ключевых словах"); }
        else if (stemPrefix(AK, t)) { s += FIELD_W.k * 0.5; km++; weak++; }
        if (stemExact(AS, t)) { s += FIELD_W.s; fields.push("аннотации"); }
        else if (stemPrefix(AS, t)) s += FIELD_W.s * 0.5;
        if (stemExact(AP, t)) s += FIELD_W.p;
        if (stemExact(AX, t)) s += FIELD_W.x;
        if (stemExact(AG, t)) { s += FIELD_W.g; fields.push("главе"); }
        else if (stemPrefix(AG, t)) s += FIELD_W.g * 0.5;
      });
      /* Совпадение только «по началу слова» не попадает ни в одно поле, и
         строка «почему совпало» оставалась без объяснения. Называем причину
         прямо: для «обыскк» → «обыск» это единственная улика. */
      if (!fields.length && weak) fields.push("по началу слова");
      if (tm >= 2) s += 60 * (tm - 1);
      if (km >= 2) s += 80 * (km - 1);
      if (p.tokens.length > 1 && a._t.indexOf(p.tokens.join(" ")) !== -1) s += 130;
      /* синонимы — только мягкая добавка, без надбавок за множественность */
      if (s > 0 && synStems.length) {
        synStems.forEach(function (t) {
          if (stemHit(AT, t)) s += 30;
          else if (stemHit(AS, t)) s += 10;
        });
      }
      /* Совпадение по главе или санкции документ не вытягивает: нужен
         номер статьи либо покрытие слов запроса в названии/ключевых словах.
         Нормы курируемого разбора проходят без этого условия — они попали в
         выдачу по смыслу запроса, а не по буквальному совпадению. */
      if (!numHit && (strong + weak) < need && !tb) return;
      if (s <= 0 && !tb) return;
      /* Явно исключённые слова и обязательные слова — жёсткие фильтры: они
         проверяются по всем доступным полям, включая главу и аннотацию. */
      var allStems = AT.concat(AK, AS, AP, AX, AG);
      if (notStems.length && notStems.some(function (t) { return stemHit(allStems, t); })) return;
      if (mustStems.length && !mustStems.every(function (t) { return stemHit(allStems, t); })) return;
      if (p.phrases.length && !p.phrases.every(function (ph) { return metaPhraseHit(a, ph); })) return;
      if (opt.skipRepealed && STATUS[a.id]) return;
      /* Утратившая силу норма — не ошибка выдачи, но и не то, что нужно
         человеку по умолчанию: показываем, но ниже действующих. */
      if (STATUS[a.id]) s *= 0.6;
      /* Норма важнее разъяснения — та же поправка, что и в полнотекстовом
         поиске: правило записано в статье кодекса, постановление Пленума его
         лишь толкует. */
      if (KIND_W[a.c]) s *= KIND_W[a.c];
      /* Роль НЕ переставляет местами юридически верный ответ: на контрольном
         наборе любая надбавка за роль роняла MRR с 0.93 до 0.83 и выкидывала
         верную норму из первой пятёрки. Поэтому роль остаётся пометкой на
         результате и отдельным блоком под выдачей, а порядок считает только
         релевантность. */
      var rl = artRole(a);
      /* Надбавка за разбор ситуации — после всех понижающих множителей:
         норма из разбора не должна «утратить силу» из-за того, что она в
         постановлении Пленума. */
      if (tb) s += TOPIC_W * tb;
      out.push({ a: a, s: s, cov: strong, num: numHit, why: uniqList(fields),
        topic: tb ? topic.t : "", role: rl.off ? "off" : rl.w ? "on" : "" });
    });
    out.sort(function (x, y) { return y.s - x.s || cmpArticles(x.a, y.a); });
    if (!out.length) return [];
    var cut = out[0].s * (opt.cut == null ? 0.4 : opt.cut);
    return out.filter(function (x) { return x.num || x.s >= cut; });
  }

  var DOC_ORDER = {};
  CODES.forEach(function (c, i) { DOC_ORDER[c.id] = i; });

  function cmpArticles(a, b) {
    var ca = DOC_ORDER[a.c], cb = DOC_ORDER[b.c];
    if (ca === undefined) ca = 9999;
    if (cb === undefined) cb = 9999;
    if (ca !== cb) return ca - cb;
    var pa = String(a.n).split(/[.-]/).map(function (x) { return parseInt(x, 10) || 0; });
    var pb = String(b.n).split(/[.-]/).map(function (x) { return parseInt(x, 10) || 0; });
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
      var x = pa[i] || 0, y = pb[i] || 0;
      if (x !== y) return x - y;
    }
    return String(a.n).localeCompare(String(b.n));
  }

  /* Постановления Пленума ВС РФ цитируются по пунктам, а не по статьям, и
     узнаются по теме разъяснения — номер и дата сами по себе бесполезны.
     Тема хранится в registry.dataset (build-data.js: dataset = raw.name). */
  function isPlenum(c) { return !!c && c.kind === "plenum"; }
  function plenumFull(c) {
    return c.full + (c.dataset ? " «" + c.dataset + "»" : "");
  }
  /* «п. 15» / «пункт 15» / «ст. 158» — единица ссылки зависит от вида акта */
  function unitShort(c, dn) { return isPlenum(c) ? "п. " + dn : "ст. " + dn; }
  function unitLong(c, dn) { return isPlenum(c) ? "пункт " + dn : "статья " + dn; }

  /* Каталог постановлений Пленума на сайте-источнике — по нему видно, какие
     редакции действуют сейчас. Адрес берём из снимка сборки. */
  var PLENUM_CATALOGUE = "https://sudact.ru/vsrf/plenum/";
  function plenumCatalogue() {
    var pm = FRESH && FRESH.plenums;
    return (pm && pm.catalogue) || PLENUM_CATALOGUE;
  }

  /* Карточка состояния постановления Пленума: действует ли, в какой редакции
     и где это проверить. Автоматическая сверка с источником из браузера
     невозможна: sudact.ru не отдаёт заголовок Access-Control-Allow-Origin, и
     запрос со страницы, открытой по file://, блокируется. Поэтому показываем
     дату редакции и даём ссылку на источник — это и есть проверка. */
  function plenumValidityBox(c) {
    var pm = (FRESH && FRESH.plenums) || {};
    var amended = /изменяющ/i.test(c.docstate || "");
    var ok = '<span class="st st-ok">действует</span>';
    var st = amended
      ? '<span class="st st-warn">изменяющий акт</span>'
      : (/утратил/i.test(c.docstate || "") ? '<span class="st st-rep">утратил силу</span>' : ok);
    var red = c.redaction ? fmtRed(c.redaction) : "—";
    var adopted = c.adopted ? fmtRed(c.adopted) : "—";
    var fresh = pm.fetched_at ? fmtDate(new Date(pm.fetched_at)) : "—";
    var note = amended
      ? "Это постановление вносит изменения в ранее принятые разъяснения. Его собственные пункты нумеруют правки; изменённые положения ищите в основной редакции соответствующего постановления."
      : "Разъяснения Пленума обязательны для единообразного применения закона судами. Текст приведён в редакции, действовавшей на дату сверки с источником.";
    return '<div class="validity-box">' +
      '<div class="vb-head">' + st +
        '<span class="vb-date">редакция от ' + esc(red) + "</span>" +
        '<span class="vb-date">принято ' + esc(adopted) + "</span>" +
        '<span class="vb-date">сверено с источником ' + esc(fresh) + "</span>" +
      "</div>" +
      '<div class="small muted" style="margin:6px 0 8px">' + esc(note) + "</div>" +
      '<div class="actions-row" style="margin:0">' +
        (c.source_url ? '<a class="btn btn-sm" href="' + esc(c.source_url) + '" target="_blank" rel="noopener">Открыть текст на sudact.ru ↗</a>' : "") +
        '<a class="btn btn-sm" href="' + esc(plenumCatalogue()) + '" target="_blank" rel="noopener">Все постановления Пленума ↗</a>' +
        '<a class="btn btn-sm" href="#/freshness">Как проверяется актуальность</a>' +
      "</div>" +
    "</div>";
  }

  function cite(a) {
    var c = codeById(a.c);
    if (!c) return a.c.toUpperCase() + " ст. " + a.dn;
    return c.short + ", " + unitShort(c, a.dn);
  }

  /* Полная ссылка с реквизитами акта и датой редакции — для документов и писем */
  function citeFull(a) {
    var c = codeById(a.c);
    if (!c) return a.c + ", статья " + a.dn;
    var head = isPlenum(c) ? plenumFull(c) : c.full;
    var red = c.redaction ? " (ред. от " + fmtRed(c.redaction) + ")" : "";
    return head + red + ", " + unitLong(c, a.dn) + (a.t ? ". " + a.t : "");
  }

  function officialUrl(a) {
    var c = codeById(a.c);
    if (c && c.source_url) return c.source_url;
    return "https://www.consultant.ru/search/?q=" + encodeURIComponent(cite(a));
  }
  function webUrl(a) {
    var c = codeById(a.c);
    return "https://yandex.ru/search/?text=" + encodeURIComponent(
      (c ? (isPlenum(c) ? plenumFull(c) : c.full) : a.c) + " " + unitLong(c, a.dn) + " действующая редакция");
  }

  /* Подсветка совпавших слов. Границы слова обязательны: без них «суд»
     подсвечивался внутри «государственная», и выглядело это как ошибка. */
  function highlight(text, tokens) {
    var h = esc(text);
    if (!tokens || !tokens.length) return h;
    var list = tokens.filter(function (t) { return t.length >= 2; });
    if (!list.length) return h;
    var re = new RegExp("(^|[^a-zа-яё0-9])(" + list.map(escRe).join("|") + ")", "gi");
    return h.replace(re, "$1<mark>$2</mark>");
  }

  function snippet(text, tokens, len) {
    len = len || 190;
    if (!text) return "";
    var low = norm(text), idx = -1;
    for (var i = 0; i < tokens.length; i++) {
      var p = low.indexOf(tokens[i]);
      if (p !== -1 && (idx === -1 || p < idx)) idx = p;
    }
    var start = idx > 60 ? idx - 60 : 0;
    var out = text.slice(start, start + len);
    return (start > 0 ? "…" : "") + out + (start + len < text.length ? "…" : "");
  }

  /* --------------------------------------------------- полнотекстовый поиск */

  var FT_loaded = {};    // сегмент индекса -> true
  var FT_pending = {};   // сегмент -> массив ожидающих

  /* Индекс разбит на сегменты: грузим только те, что нужны для запроса */
  function loadFtShard(b, cb) {
    if (FT_loaded[b]) { cb(null); return; }
    if (FT_pending[b]) { FT_pending[b].push(cb); return; }
    FT_pending[b] = [cb];
    var s = document.createElement("script");
    /* метка версии: после выкладки новой сборки шард должен прийти из сети,
       а не из кеша (у /data/ft он живёт 10 минут) — см. buildQuery() */
    s.src = "data/ft/" + b + ".js" + buildQuery();
    s.onload = function () {
      FT_loaded[b] = true;
      var q = FT_pending[b] || []; delete FT_pending[b];
      q.forEach(function (f) { f(null); });
    };
    s.onerror = function () {
      var q = FT_pending[b] || []; delete FT_pending[b];
      q.forEach(function (f) { f(new Error("сегмент индекса недоступен")); });
    };
    document.head.appendChild(s);
  }

  /* Длины документов: нужны BM25, чтобы короткая статья не проигрывала
     длинной только потому, что в ней меньше слов. Значение лежит в пятом
     поле индекса статей (data/index.js), считается сборщиком. */
  var DOCLEN = (function () {
    var out = new Array(IDX.length);
    for (var i = 0; i < IDX.length; i++) out[i] = IDX[i][4] || 0;
    return out;
  })();

  /* Вес вида акта в полнотекстовой выдаче. Норма важнее разъяснения: правило
     записано в статье кодекса, а постановление Пленума его лишь толкует.
     Без этой поправки однословный запрос («прогул», «неустойка») выдавал
     почти сплошь пункты постановлений — в них слово встречается чаще. */
  var KIND_W = (function () {
    var m = {};
    CODES.forEach(function (c) {
      if (c.kind === "plenum") m[c.id] = 0.7;
      else if (c.kind === "decree") m[c.id] = 0.9;
    });
    return m;
  })();

  /* У постановления Пленума «название пункта» — это его первый абзац, то есть
     обычный текст, а не заголовок. В поиске по реестру он попадал в поле
     «название» и получал полный вес заголовка, из-за чего пункты Пленума
     вытесняли сами нормы. Для них вес этого поля снижается. */
  var PLENUM = (function () {
    var m = {};
    CODES.forEach(function (c) { if (c.kind === "plenum") m[c.id] = 1; });
    return m;
  })();

  /* --------------------------------------- исправление опечаток в запросе */

  var FT_DICT = null, FT_DICT_STATE = 0, FT_DICT_WAIT = [];

  /* Словарь основ (data/ft/dict.js, ~185 КБ) поднимается только тогда, когда
     в запросе встретилось слово, которого нет в индексе. Для обычных запросов
     он не загружается вообще. */
  function loadFtDict(cb) {
    if (FT_DICT) { cb(FT_DICT); return; }
    FT_DICT_WAIT.push(cb);
    if (FT_DICT_STATE) return;
    FT_DICT_STATE = 1;
    var finish = function (obj) {
      FT_DICT = obj; FT_DICT_STATE = 2;
      var w = FT_DICT_WAIT; FT_DICT_WAIT = [];
      w.forEach(function (f) { f(obj); });
    };
    var s = document.createElement("script");
    s.src = "data/ft/dict.js" + buildQuery();
    s.onload = function () {
      var raw = window.RF_FT_DICT || "", map = {}, list = [];
      raw.split(",").forEach(function (p) {
        var i = p.indexOf(":");
        if (i <= 0) return;
        var w = p.slice(0, i);
        map[w] = parseInt(p.slice(i + 1), 10) || 1;
        list.push(w);
      });
      finish({ map: map, list: list });
    };
    s.onerror = function () { finish({ map: {}, list: [] }); };
    document.head.appendChild(s);
  }

  /* Расстояние Дамерау — Левенштейна с ранним выходом. Нужен только ответ
     «дальше двух правок или нет», поэтому счёт прерывается, как только вся
     очередная строка матрицы превысила порог. */
  function editDist2(a, b, max) {
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    if (a === b) return 0;
    var prev2 = null, prev = new Array(lb + 1), cur = new Array(lb + 1), i, j;
    for (j = 0; j <= lb; j++) prev[j] = j;
    for (i = 1; i <= la; i++) {
      cur[0] = i;
      var best = cur[0];
      for (j = 1; j <= lb; j++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        var v = prev[j] + 1;
        if (cur[j - 1] + 1 < v) v = cur[j - 1] + 1;
        if (prev[j - 1] + cost < v) v = prev[j - 1] + cost;
        if (i > 1 && j > 1 && prev2 &&
            a.charCodeAt(i - 1) === b.charCodeAt(j - 2) &&
            a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) {
          if (prev2[j - 2] + 1 < v) v = prev2[j - 2] + 1;
        }
        cur[j] = v;
        if (v < best) best = v;
      }
      if (best > max) return max + 1;
      prev2 = prev; prev = cur; cur = new Array(lb + 1);
    }
    return prev[lb];
  }

  /* Ближайшие основы словаря к слову, которого нет в индексе.
     Сначала пробуем «однокоренные» совпадения по началу слова: стеммер
     намеренно консервативен, и «наркоти» в индексе отсутствует, а
     «наркотик» и «наркотическ» — есть, причём это РАЗНЫЕ основы. Поэтому
     возвращается не одна основа, а до четырёх самых частых однокоренных:
     статья про наркотики использует обе. Только если однокоренных нет —
     ищем опечатки в пределах двух правок. */
  function correctStems(s, dict) {
    if (!dict || !dict.list.length || s.length < 4) return null;
    var c0 = s.charAt(0), i, cand, df;
    var pref = [];
    for (i = 0; i < dict.list.length; i++) {
      cand = dict.list[i];
      if (cand.charAt(0) !== c0 || cand.length < 3) continue;
      if (cand.indexOf(s) === 0 || s.indexOf(cand) === 0) pref.push([cand, dict.map[cand]]);
    }
    if (pref.length) {
      pref.sort(function (a, b) { return b[1] - a[1]; });
      return pref.slice(0, 4).map(function (x) { return x[0]; });
    }
    if (s.length < 5) return null;
    var best = null, bestD = 99, bestDf = -1;
    for (i = 0; i < dict.list.length; i++) {
      cand = dict.list[i];
      if (cand.charAt(0) !== c0) continue;
      if (Math.abs(cand.length - s.length) > 1) continue;
      var d = editDist2(s, cand, 2);
      if (d > 2 || d === 0) continue;
      df = dict.map[cand];
      if (d < bestD || (d === bestD && df > bestDf)) { best = cand; bestD = d; bestDf = df; }
    }
    return best ? [best] : null;
  }

  /* Поиск по полным текстам статей.
     opt: {code, limit, syn, skipRepealed, parsed}
     cb(err, [{a, score, matched, hits}], {corrections, stems, need})

     Ранжирование — BM25. Раньше складывались только idf слов: частота слова
     в статье и её длина не учитывались вовсе, поэтому короткая норма, где
     слово упомянуто вскользь, обгоняла профильную статью с десятком
     повторов. BM25 учитывает и то, и другое. */
  function ftSearch(q, opt, cb) {
    opt = opt || {};
    if (!FT || !FT_META) { cb(new Error("нет индекса"), []); return; }
    var p = opt.parsed || parseQuery(q);
    var nsh = FT_META.shards, total = FT_META.docs || 1, avgdl = FT_META.avgdl || 200;
    /* K1 — насыщение по частоте слова, B — нормализация по длине документа.
       TITLE_W — надбавка за совпадение в названии статьи (в долях от лучшего
       BM25-балла запроса), поэтому её значение не зависит от «масштаба»
       конкретного запроса. */
    var K1 = 1.2, B = 0.45, TITLE_W = 0.55, TOPIC_FT = 0.9;

    var primary = FT.stems(p.tokens.join(" "));
    var mustStems = FT.stems(p.must.join(" "));
    var notStems = FT.stems(p.not.join(" "));
    var phraseStems = p.phrases.map(function (ph) { return { ph: ph, stems: FT.stems(ph) }; })
      .filter(function (x) { return x.stems.length > 1; });
    phraseStems.forEach(function (x) {
      x.stems.forEach(function (s) { if (primary.indexOf(s) === -1) primary.push(s); });
    });
    /* синонимы — вторая волна: расширяют выдачу, но требуются «мягче» */
    var synStems = (opt.syn && opt.syn.length ? FT.stems(opt.syn.join(" ")) : [])
      .filter(function (s) { return primary.indexOf(s) === -1 && notStems.indexOf(s) === -1; });
    if (!primary.length) { cb(null, []); return; }

    var lists = {}, loadedShard = {}, corrections = [];

    function bucketsOf(arr) {
      var by = {}, keys = [];
      arr.forEach(function (s) {
        var b = FT.bucket(s, nsh);
        if (!by[b]) { by[b] = []; keys.push(b); }
        by[b].push(s);
      });
      return { by: by, keys: keys };
    }

    function loadAll(by, keys, done) {
      var left = keys.length;
      if (!left) { done(null); return; }
      var failed = false;
      keys.forEach(function (b) {
        if (loadedShard[b]) { if (--left === 0) done(failed ? new Error("индекс недоступен") : null); return; }
        loadFtShard(b, function (err) {
          if (err) failed = true;
          else {
            loadedShard[b] = 1;
            var data = (window.RF_FT || {})[b] || {};
            by[b].forEach(function (s) { lists[s] = data[s] ? FT.decPairs(data[s]) : []; });
          }
          if (--left === 0) done(failed ? new Error("индекс недоступен") : null);
        });
      });
    }

    var round1 = bucketsOf(primary.concat(synStems));
    loadAll(round1.by, round1.keys, function (err) {
      if (err) { cb(err, []); return; }
      /* Слово запроса, которого нет в индексе ни в одной статье, — почти
         всегда опечатка или неполная словоформа. Поднимаем словарь и
         пробуем один раз исправить; больше одной попытки не делаем. */
      var empty = primary.concat(synStems).filter(function (s) { return !(lists[s] || []).length; });
      if (!empty.length || opt.noFix) { finish(); return; }
      loadFtDict(function (dict) {
        var extra = [];
        empty.forEach(function (s) {
          var fix = correctStems(s, dict);
          if (!fix || !fix.length || (fix.length === 1 && fix[0] === s)) return;
          corrections.push([s, fix]);
          fix.forEach(function (f) { if (lists[f] === undefined && extra.indexOf(f) === -1) extra.push(f); });
        });
        if (!extra.length) { finish(); return; }
        var round2 = bucketsOf(extra);
        loadAll(round2.by, round2.keys, function () { finish(); });
      });
    });

    /* Двоичный поиск статьи в списке вхождений: списки отсортированы по
       номеру статьи, а списки частых слов длиной в десяток тысяч. */
    function hasStem(st, id) {
      var list = lists[st];
      if (!list || !list.length) return false;
      var lo = 0, hi = list.length - 1;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1, v = list[mid][0];
        if (v === id) return true;
        if (v < id) lo = mid + 1; else hi = mid - 1;
      }
      return false;
    }

    function bm25Add(use, weight, hits) {
      use.forEach(function (s) {
        var list = lists[s] || [];
        var df = list.length;
        if (!df) return;
        var idf = Math.log(1 + (total - df + 0.5) / (df + 0.5)) * weight;
        for (var i = 0; i < list.length; i++) {
          var id = list[i][0], tf = list[i][1];
          var dl = DOCLEN[id] || avgdl;
          var w = idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * dl / avgdl));
          hits[id] = (hits[id] || 0) + w;
        }
      });
    }

    function finish() {
      var subst = {};
      corrections.forEach(function (c) { subst[c[0]] = c[1]; });

      /* Группа — это одно слово запроса. Основ в группе может быть несколько:
         слово исправлено («наркоти» → «наркотик» + «наркотическ») или у него
         в индексе несколько однокоренных написаний. Совпадение ЛЮБОЙ основы
         группы закрывает слово целиком — иначе исправленное слово считалось
         бы за два разных и порог покрытия ломался. */
      function groupOf(s) {
        var alt = subst[s];
        return alt && alt.length ? alt.slice() : [s];
      }
      function flat(gs) {
        var o = [];
        gs.forEach(function (g) { g.forEach(function (s) { if (o.indexOf(s) === -1) o.push(s); }); });
        return o;
      }
      function groupHit(g, id) {
        for (var i = 0; i < g.length; i++) if (hasStem(g[i], id)) return true;
        return false;
      }
      function groupCount(gs, id) {
        var n = 0;
        for (var i = 0; i < gs.length; i++) if (groupHit(gs[i], id)) n++;
        return n;
      }

      var groups = primary.map(groupOf);
      var synGroups = synStems.map(groupOf).filter(function (g) {
        return !groups.some(function (x) { return x[0] === g[0]; });
      });
      var mustGroups = mustStems.map(groupOf);
      var notStemsAll = flat(notStems.map(groupOf));

      /* hitP — BM25 по словам запроса, hitS — по синонимам (вес 0.5).
         Раньше здесь была ещё пустая карта score, из которой читался итоговый
         балл: BM25 считался, но в ранжирование не попадал. */
      var hitP = {}, hitS = {};
      bm25Add(flat(groups), 1, hitP);
      bm25Add(flat(synGroups), 0.5, hitS);

      /* Явные операторы и фразы — жёсткие требования, поэтому ослаблять
         «покрытие слов» в их присутствии нельзя. */
      var strict = mustGroups.length > 0 || phraseStems.length > 0;
      var need = groups.length, cand = [], k;
      for (;;) {
        cand = [];
        for (k in hitP) {
          var cid = +k;
          if (strict) {
            if (groups.every(function (g) { return groupHit(g, cid); })) cand.push(cid);
          } else if (groupCount(groups, cid) >= need) cand.push(cid);
        }
        if (cand.length || strict || need <= 1) break;
        need--;
      }

      var useS = false;
      if (!cand.length) {
        for (k in hitS) cand.push(+k);
        useS = cand.length > 0;
      }
      if (!cand.length) { cb(null, [], { corrections: corrections, stems: flat(groups), need: need }); return; }

      var res = [], seen = {}, limit = opt.limit || 60, denom = groups.length || 1;
      var flatGroups = flat(groups);
      /* BM25 не знает, что название нормы для юриста важнее частоты слова в
         пояснениях: «прогул» в ст. 81 ТК РФ упомянут один раз, а в
         постановлении Пленума — десятки раз. Приводим баллы к шкале 0..1 по
         лучшему результату запроса, чтобы надбавка за совпадение в названии
         не зависела от «масштаба» конкретного запроса. */
      var bestScore = 0;
      cand.forEach(function (id) {
        var r = (hitP[id] || 0) + (hitS[id] || 0);
        if (r > bestScore) bestScore = r;
      });
      if (!bestScore) bestScore = 1;
      /* Разбор ситуации — та же подсказка, что и в поиске по реестру: норма,
         где правило записано, важнее пояснения, где оно многократно повторено. */
      var topic = topicMatch(FT.stems(p.tokens.join(" ")));
      cand.forEach(function (id) {
        var row = IDX[id];
        if (!row) return;
        var a = byId[row[0] + "-" + row[1]];
        if (!a) return;
        if (opt.code && a.c !== opt.code) return;
        if (seen[a.id]) return;
        if (notStemsAll.length && notStemsAll.some(function (s) { return hasStem(s, id); })) return;
        if (mustGroups.length && !mustGroups.every(function (g) { return groupHit(g, id); })) return;
        if (phraseStems.length && !phraseStems.every(function (x) {
          return x.stems.every(function (s) { return hasStem(s, id); });
        })) return;
        if (opt.skipRepealed && STATUS[a.id]) return;
        seen[a.id] = 1;
        var hits = useS ? (hitS[id] || 0) : groupCount(groups, id);
        /* надбавка за совпадение в названии статьи или в её главе */
        var ts = a._fts || (a._fts = FT.stems((a.t || "") + " " + (a.g || "")));
        var bon = 0;
        for (var t = 0; t < flatGroups.length; t++) if (ts.indexOf(flatGroups[t]) !== -1) bon++;
        var sc = ((hitP[id] || 0) + (hitS[id] || 0)) / bestScore + TITLE_W * Math.min(bon, 3);
        var tb = (topic && topic.w[a.id]) || 0;
        if (tb) sc += TOPIC_FT * tb;
        /* покрытие слов запроса важно не меньше суммы весов: статья, где есть
           все слова запроса, должна стоять выше статьи с одним редким словом */
        var rank = sc * (0.55 + 0.45 * (hits / denom));
        if (STATUS[a.id]) rank *= 0.6;
        /* Разъяснение Пленума — вспомогательный материал: искать в нём «прогул»
           или «неустойку» законно, но норма, где это правило записано, должна
           стоять выше. Иначе выдача на однословный запрос целиком состояла из
           пунктов постановлений. */
        var kw = KIND_W[a.c];
        if (kw) rank *= kw;
        /* Роль здесь тоже только пометка — почему, см. комментарий в search(). */
        var rl = artRole(a);
        res.push({ a: a, score: rank, matched: hits, syn: useS, hits: hits,
          topic: tb ? topic.t : "", role: rl.off ? "off" : rl.w ? "on" : "" });
      });
      res.sort(function (x, y) { return y.score - x.score || y.matched - x.matched; });
      cb(null, res.slice(0, limit), { corrections: corrections, stems: flatGroups, need: need });
    }
  }

  /* Отрывок текста с наибольшим числом слов запроса (а не первый попавшийся).
     Раньше бралось первое совпадение: в статье про наркотики запрос «сбыт»
     показывал вводную фразу, где слово упомянуто мимоходом. Теперь окно
     длиной len скользит по тексту с шагом в слово, и выбирается то, где
     плотность совпадений выше. */
  function ftSnippet(text, stems, len) {
    len = len || 220;
    if (!text) return "";
    if (!FT || !stems || !stems.length) return text.slice(0, len);
    var re = /[а-яёА-ЯЁ]+/g, m;
    var lim = Math.min(text.length, 200000);
    var pos = [], hits = [];
    while ((m = re.exec(text)) !== null) {
      if (m.index > lim) break;
      pos.push(m.index);
      hits.push(stems.indexOf(FT.stem(m[0].toLowerCase().replace(/ё/g, "е"))) !== -1 ? 1 : 0);
    }
    if (!pos.length) return text.slice(0, len);
    var best = 0, bestScore = -1, j = 0, sum = 0;
    for (var i = 0; i < pos.length; i++) {
      while (j < pos.length && pos[j] - pos[i] < len) { sum += hits[j]; j++; }
      var sc = sum * 1000 - i;   /* при равенстве — самое раннее окно */
      if (sc > bestScore) { bestScore = sc; best = i; }
      sum -= hits[i];
    }
    var start = pos[best] > 70 ? pos[best] - 70 : 0;
    var out = text.slice(start, start + len);
    return (start > 0 ? "…" : "") + out + (start + len < text.length ? "…" : "");
  }

  /* Подсветка всех словоформ запроса в отрывке */
  function highlightStems(text, stems) {
    if (!text) return "";
    if (!FT || !stems || !stems.length) return esc(text);
    var out = "", last = 0, re = /([а-яёА-ЯЁ]+)/g, m;
    while ((m = re.exec(text)) !== null) {
      var st = FT.stem(m[1].toLowerCase().replace(/ё/g, "е"));
      if (stems.indexOf(st) === -1) continue;
      out += esc(text.slice(last, m.index)) + "<mark>" + esc(m[1]) + "</mark>";
      last = m.index + m[1].length;
    }
    return out + esc(text.slice(last));
  }

  /* ------------------------------------------------------------------ полные тексты */

  var FULL = window.RF_FULL || (window.RF_FULL = {});
  var pending = {};

  function hasFull(id) { return !!FULL[id]; }

  function loadFull(id, cb) {
    if (FULL[id]) { cb(null); return; }
    if (pending[id]) { pending[id].push(cb); return; }
    pending[id] = [cb];
    var s = document.createElement("script");
    s.src = "data/full/" + id + ".js" + buildQuery();
    s.onload = function () { var q = pending[id] || []; delete pending[id]; q.forEach(function (f) { f(null); }); };
    s.onerror = function () { var q = pending[id] || []; delete pending[id]; q.forEach(function (f) { f(new Error("load")); }); };
    document.head.appendChild(s);
  }

  /* Поиск статьи в полном тексте.
     Раньше это был линейный перебор: при выгрузке подборки или дела
     findFull вызывался в цикле до 400 раз, каждый раз пробегая массив
     статей (у Налогового кодекса — 538 строк). Теперь карта «номер → строка»
     строится один раз на версию массива и живёт рядом с ним.
     Привязка к самому массиву (через свойство ._idx), а не к id, исключает
     устаревание: если FULL[id] заменили или наполнили позже, карта
     перестроится сама. */
  function findFull(c, n) {
    var F = FULL[c];
    if (!F || !F.length) return null;
    var map = F._idx;
    if (!map || map._len !== F.length) {
      map = {};
      for (var i = 0; i < F.length; i++) {
        var r = F[i];
        if (r && r[0] != null) map[r[0]] = r;
      }
      map._len = F.length;
      F._idx = map;
    }
    return map[n] || null;
  }

  /* ------------------------------------------------------------------ хранилище */

  var LS = {
    get: function (k, d) {
      try { var v = localStorage.getItem("rflaws." + k); return v ? JSON.parse(v) : d; }
      catch (e) { return d; }
    },
    set: function (k, v) {
      try { localStorage.setItem("rflaws." + k, JSON.stringify(v)); } catch (e) {}
    }
  };

  /* личные заметки к статье — { "<id статьи>": "текст" } */
  function getNotes() { return LS.get("notes", {}); }
  function setNote(id, txt) {
    var all = getNotes();
    txt = (txt || "").trim();
    if (txt) all[id] = txt; else delete all[id];
    LS.set("notes", all);
  }

  var state = {
    fav: LS.get("fav", []),
    col: LS.get("col", []),        // подборка: [{ id, note }]
    cases: LS.get("cases", []),    // дела: [{ id, title, desc, created, updated, items:[{id,note}], notes:[{id,text,created}] }]
    hist: LS.get("hist", []),
    theme: LS.get("theme", "dark"),
    read: LS.get("read", { fs: 15, lh: 1.65, w: 0 }),  // настройки чтения текста
    role: LS.get("role", ""),       // роль: "" | sle || adv | gos
    newSeen: LS.get("newSeen", 0),  // сколько верхних записей ленты «Новое» уже показано
    route: { name: "home", arg: null, q: "" }
  };

  /* ------------------------------------------------------------------ роли

     Роль не переписывает данные, а расставляет приоритеты: какие шаблоны и
     чек-листы показывать первыми, какие подсказки давать в разборе ситуации.
     Так набор остаётся расширяемым — новый документ просто попадает в роль
     по совпадению ключевых слов. */

  var ROLES = {
    "": {
      id: "", title: "Без роли", ico: "◇", dat: "Оперативнику",
      note: "Показываются все инструменты без приоритетов.",
      prio: [],                 // ключевые слова, поднимающие элемент наверх
      hide: []                  // ключевые слова для пометки «не по роли»
    },
    oper: {
      id: "oper", title: "Оперативник", ico: "◈", dat: "Оперативнику",
      note: "Приоритет оперативно-розыскным мероприятиям, досмотру, доставлению и памяткам по типовым ситуациям.",
      prio: ["орм", "оперативно-розыскн", "оперативн", "досмотр", "доставлен", "административн",
        "задержан", "опрос", "наведен", "обследован", "проверочн", "закупк", "кусп", "рапорт",
        "сбыт", "изъят", "наблюден", "переговор"],
      hide: ["трудов", "адвокатск"]
    },
    sle: {
      id: "sle", title: "Следователь", ico: "★", dat: "Следователю",
      note: "Приоритет следственным действиям и процессуальным документам.",
      prio: ["возбужд", "задерж", "обвин", "обыск", "осмотр", "допрос", "экспертиз",
        "ходатайств", "страж", "переговор", "срок", "уведомл"],
      hide: ["запрос", "жалоб"]
    },
    adv: {
      id: "adv", title: "Адвокат", ico: "⚖", dat: "Адвокату",
      note: "Приоритет защите: жалобы, запросы, обжалование, сроки.",
      prio: ["жалоб", "запрос", "обжал", "защит", "реабилит", "ущерб", "иск", "срок",
        "осмотр", "экспертиз", "допрос"],
      hide: ["ходатайств о заключении", "возбуждении уголовного дела"]
    },
    gos: {
      id: "gos", title: "Госорган", ico: "▤", dat: "Госоргану",
      note: "Приоритет надзору, срокам и обжалованию решений.",
      prio: ["срок", "обжал", "надзор", "прокур", "ущерб", "иск", "проверк"],
      hide: []
    }
  };

  function roleDef() { return ROLES[state.role] || ROLES[""]; }

  /* Название блока в дательном падеже — «Оперативнику», «Следователю» и т. д.
     Используется в заголовке панели на главной и в группе сайдбара, чтобы
     подпись менялась вместе с ролью. */
  function roleDative() { return roleDef().dat || "Оперативнику"; }

  /* Вес элемента для текущей роли: чем больше, тем выше в списке */
  function roleWeight(text) {
    var d = roleDef();
    if (!d.prio.length) return 0;
    var t = norm(text);
    var w = 0;
    d.prio.forEach(function (k) { if (t.indexOf(k) !== -1) w += 10; });
    return w;
  }

  /* Помечен ли элемент как «не по текущей роли» */
  function roleOff(text) {
    var d = roleDef();
    if (!d.hide.length) return false;
    var t = norm(text);
    var off = false;
    d.hide.forEach(function (k) { if (t.indexOf(k) !== -1) off = true; });
    /* если есть и приоритетное совпадение — приоритет сильнее */
    return off && roleWeight(text) === 0;
  }

  /* Сортировка по роли: приоритетные наверх, «не по роли» вниз */
  function roleSort(list, textOf) {
    if (!state.role) return list;
    var f = textOf || function (x) { return x.t || ""; };
    return list.slice().sort(function (a, b) {
      var wa = roleWeight(f(a)) - (roleOff(f(a)) ? 100 : 0);
      var wb = roleWeight(f(b)) - (roleOff(f(b)) ? 100 : 0);
      return wb - wa;
    });
  }

  function setRole(r) {
    state.role = ROLES[r] ? r : "";
    LS.set("role", state.role);
  }

  function roleLabel(extra) {
    var d = roleDef();
    if (!d.id) return "";
    return d.ico + " " + d.title + (extra ? " · " + extra : "");
  }

  function roleSwitchHtml() {
    return '<div class="role-switch">' +
      '<span class="role-lbl">Роль:</span>' +
      Object.keys(ROLES).map(function (k) {
        var d = ROLES[k];
        return '<button class="role-btn' + (state.role === k ? " on" : "") + '" data-role="' + k +
          '" title="' + esc(d.note) + '">' + esc(d.ico + " " + d.title) + "</button>";
      }).join("") +
      "</div>";
  }

  var roleDelegated = false;
  function bindRoleSwitch() {
    /* делегирование на document — один обработчик на всё приложение, поэтому
       перерисовка view (и статичная кнопка в сайдбаре) не дублирует слушатели */
    if (roleDelegated) return;
    roleDelegated = true;
    document.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var b = t.closest("[data-role]");
      if (!b) return;
      e.preventDefault();
      setRole(b.getAttribute("data-role"));
      var d = roleDef();
      toast(d.id ? "Роль: " + d.title + ". " + d.note : "Роль снята");
      render();
    });
  }

  /* Синхронизирует состояние .on у всех переключателей роли (в сайдбаре и
     на страницах), чтобы активная роль была видна везде после перерисовки.
     Заодно обновляет подписи, зависящие от роли. */
  function syncRoleSwitch() {
    $$("[data-role]").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-role") === state.role);
    });
    /* кнопка в верхней панели: подсветка при активной роли + подпись роли,
       чтобы выбор было видно, не открывая меню */
    var rb = $("#roleBtn"), lbl = $("#roleBtnLbl"), d = roleDef();
    if (rb) {
      rb.classList.toggle("on", !!d.id);
      rb.setAttribute("title", d.id ? "Роль: " + d.title : "Выбрать роль");
      rb.setAttribute("aria-label", d.id
        ? "Роль: " + d.title + ". " + d.note
        : "Роль: под кого работает подсказка");
    }
    if (lbl) {
      lbl.hidden = !d.id;
      lbl.textContent = d.id ? d.title : "";
    }
    syncRoleBar();
  }

  /* Полоса активной роли под верхней панелью.

     Жалоба была такой: «выбираю в панели слева адвоката, нахожусь в это время
     в любой другой вкладке, кроме "Навигатора", — ничего не происходит».
     Причины две, и обе устранены:
       1) роль действительно расставляла приоритеты лишь в трёх представлениях
          (главная, чек-листы, шаблоны) — на остальных вкладках её не было
          видно. Теперь результат поиска помечает роль («по вашей роли» в
          пояснении и отдельный блок под выдачей), а выбор подтверждается
          этой полосой на любой вкладке;
       2) сам выбор никак не подсвечивался вне сайдбара.
     Кнопка «Снять роль» переиспользует data-role="" — её ловит общий
     обработчик bindRoleSwitch, поэтому отдельной привязки не нужно. */
  function syncRoleBar() {
    var bar = $("#roleBar");
    if (!bar) return;
    var d = roleDef();
    if (!d.id) { bar.hidden = true; bar.innerHTML = ""; return; }
    bar.hidden = false;
    bar.innerHTML =
      '<span class="role-bar-ico" aria-hidden="true">' + esc(d.ico) + "</span>" +
      '<span class="role-bar-t">Роль: <b>' + esc(d.title) + "</b></span>" +
      '<span class="role-bar-note">' + esc(d.note) + "</span>" +
      '<button class="btn btn-sm role-bar-off" type="button" data-role="" ' +
        'title="Показать всё без приоритета роли">Снять роль</button>';
  }

  /* Позиция прокрутки статей — чтобы вернуться туда, где остановился */
  var scrollMemo = {};

  /* ------------------------------------------------- настройки чтения текста */

  var READ_LIMITS = { fs: [13, 24], lh: [1.25, 2.2], w: [680, 0] };
  var READ_W_STEP = 60;

  function applyRead() {
    var r = state.read;
    var root = document.documentElement;
    root.style.setProperty("--read-fs", (r.fs || 15) + "px");
    root.style.setProperty("--read-lh", String(r.lh || 1.65));
    /* w = 0 — на всю ширину; иначе ограничение колонки в px */
    root.style.setProperty("--read-w", r.w > 0 ? r.w + "px" : "100%");
    document.body.classList.toggle("read-wide", !!r.w);
    paintReadBtns();
  }

  function setRead(key, delta) {
    var r = state.read;
    if (key === "fs") {
      r.fs = Math.min(READ_LIMITS.fs[1], Math.max(READ_LIMITS.fs[0], (r.fs || 15) + delta));
    } else if (key === "lh") {
      r.lh = Math.round(Math.min(READ_LIMITS.lh[1], Math.max(READ_LIMITS.lh[0], (r.lh || 1.65) + delta)) * 100) / 100;
    } else if (key === "w") {
      /* w: 0 — во всю ширину, иначе сужаем/расширяем колонку шагом */
      var cur = r.w > 0 ? r.w : 1280;
      cur = cur - delta * READ_W_STEP;
      r.w = cur >= 1280 ? 0 : Math.max(READ_LIMITS.w[0], cur);
    }
    LS.set("read", state.read);
    applyRead();
  }

  function paintReadBtns() {
    var r = state.read;
    var fs = $("#readMenu [data-read='fs-']"), fsp = $("#readMenu [data-read='fs+']");
    var wp = $("#readMenu [data-read='w-']"), wm = $("#readMenu [data-read='w+']");
    var lp = $("#readMenu [data-read='lh+']"), lm = $("#readMenu [data-read='lh-']");
    if (fs) fs.disabled = r.fs <= READ_LIMITS.fs[0];
    if (fsp) fsp.disabled = r.fs >= READ_LIMITS.fs[1];
    if (lm) lm.disabled = r.lh <= READ_LIMITS.lh[0];
    if (lp) lp.disabled = r.lh >= READ_LIMITS.lh[1];
    /* «узкая колонка» доступна, пока шире минимума */
    if (wm) wm.disabled = (r.w > 0 && r.w <= READ_LIMITS.w[0]);
    if (wp) wp.disabled = !r.w;
  }

  function toggleReadMenu(force) {
    var m = $("#readMenu"), b = $("#readBtn");
    if (!m || !b) return;
    var open = force != null ? force : m.hasAttribute("hidden");
    if (open) m.removeAttribute("hidden"); else m.setAttribute("hidden", "");
    b.setAttribute("aria-expanded", open ? "true" : "false");
  }

  /* Переключатель роли — в верхней панели: выпадающее меню по кнопке.
     Устроено так же, как меню настроек чтения, чтобы поведение было единым. */
  function toggleRoleMenu(force) {
    var m = $("#roleMenu"), b = $("#roleBtn");
    if (!m || !b) return;
    var open = force != null ? force : m.hasAttribute("hidden");
    if (open) m.removeAttribute("hidden"); else m.setAttribute("hidden", "");
    b.setAttribute("aria-expanded", open ? "true" : "false");
  }

  /* ---------------------------------------------------- мобильное меню */

  /* Сайдбар ведёт себя по-разному в зависимости от ширины окна:
     — узкое окно (<= 900px): панель выезжает поверх содержимого, состояние
       живёт в классе .open и сбрасывается при каждом переходе;
     — широкое окно: панель стоит в потоке, а кнопка-бургер сворачивает её
       (класс .nav-hidden на корне). Этот выбор запоминается в localStorage,
       чтобы пережить перезагрузку. */
  var navHidden = !!LS.get("navHidden", false);

  function wideLayout() { return window.innerWidth > 900; }

  /* Приводит подпись и aria кнопки-бургера к фактическому состоянию панели */
  function applyNav() {
    var wide = wideLayout();
    var app = $("#appRoot");
    if (app) app.classList.toggle("nav-hidden", wide && navHidden);
    var bg = $("#burgerBtn");
    if (bg) {
      var shown = wide ? !navHidden : sidebarIsOpen();
      bg.setAttribute("aria-expanded", shown ? "true" : "false");
      var lbl = shown ? "Скрыть меню" : "Открыть меню";
      bg.setAttribute("aria-label", lbl);
      bg.setAttribute("title", lbl);
    }
  }

  function setSidebar(open) {
    var sb = $("#sidebar"), bd = $("#sideBackdrop");
    if (!sb) return;
    sb.classList.toggle("open", !!open);
    if (bd) bd.classList.toggle("show", !!open);
    applyNav();
    if (open) { var c = $("#sideClose"); if (c) c.focus(); }
  }
  function sidebarIsOpen() { var sb = $("#sidebar"); return !!sb && sb.classList.contains("open"); }


  function isFav(id) { return state.fav.indexOf(id) !== -1; }
  function toggleFav(id) {
    var i = state.fav.indexOf(id);
    if (i === -1) { state.fav.push(id); toast("Добавлено в избранное"); }
    else { state.fav.splice(i, 1); toast("Удалено из избранного"); }
    LS.set("fav", state.fav);
  }

  /* ------------------------------------------------------------- подборка */

  function colIndex(id) {
    for (var i = 0; i < state.col.length; i++) if (state.col[i].id === id) return i;
    return -1;
  }
  function inCol(id) { return colIndex(id) !== -1; }
  function colCount() { return state.col.length; }

  function toggleCol(id) {
    var i = colIndex(id);
    if (i === -1) {
      state.col.push({ id: id, note: "" });
      toast("Добавлено в подборку (" + state.col.length + ")");
    } else {
      state.col.splice(i, 1);
      toast("Убрано из подборки");
    }
    LS.set("col", state.col);
    syncColCount();
  }
  function colRemove(id) {
    var i = colIndex(id);
    if (i !== -1) { state.col.splice(i, 1); LS.set("col", state.col); syncColCount(); }
  }
  function colMove(id, d) {
    var i = colIndex(id), j = i + d;
    if (i === -1 || j < 0 || j >= state.col.length) return;
    var t = state.col[i]; state.col[i] = state.col[j]; state.col[j] = t;
    LS.set("col", state.col);
  }
  function colClear() { state.col = []; LS.set("col", state.col); syncColCount(); }
  function syncColCount() {
    var el = $("#colCount");
    if (el) { el.textContent = state.col.length; el.style.display = state.col.length ? "" : "none"; }
  }
  function colItems() {
    return state.col.map(function (e) {
      return { e: e, a: byId[e.id] || null };
    }).filter(function (x) { return x.a; });
  }

  /* ------------------------------------------------------------------ дела */

  /* Дело — рабочая папка: набор норм с заметками и журнал свободных заметок */
  function caseNewId() {
    return "c" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
  }
  function caseIdx(id) {
    for (var i = 0; i < state.cases.length; i++) if (state.cases[i].id === id) return i;
    return -1;
  }
  function caseById(id) {
    var i = caseIdx(id);
    return i === -1 ? null : state.cases[i];
  }
  function caseSave() { LS.set("cases", state.cases); syncCaseCount(); }

  function caseAdd(title, desc) {
    var c = {
      id: caseNewId(),
      title: String(title || "").trim() || "Дело без названия",
      desc: String(desc || "").trim(),
      created: Date.now(), updated: Date.now(),
      items: [], notes: []
    };
    state.cases.unshift(c);
    caseSave();
    return c;
  }
  function caseRemove(id) {
    var i = caseIdx(id);
    if (i === -1) return;
    state.cases.splice(i, 1);
    caseSave();
  }
  function caseItemIdx(c, aid) {
    for (var i = 0; i < c.items.length; i++) if (c.items[i].id === aid) return i;
    return -1;
  }
  function caseHasItem(id, aid) {
    var c = caseById(id);
    return !!(c && caseItemIdx(c, aid) !== -1);
  }
  function casesWith(aid) {
    return state.cases.filter(function (c) { return caseItemIdx(c, aid) !== -1; });
  }
  /* true — норма добавлена, false — её в деле не было */
  function caseAddItem(id, aid) {
    var c = caseById(id);
    if (!c || !byId[aid]) return false;
    if (caseItemIdx(c, aid) !== -1) return false;
    c.items.push({ id: aid, note: "" });
    c.updated = Date.now();
    caseSave();
    return true;
  }
  function caseDelItem(id, aid) {
    var c = caseById(id);
    if (!c) return;
    var i = caseItemIdx(c, aid);
    if (i === -1) return;
    c.items.splice(i, 1);
    c.updated = Date.now();
    caseSave();
  }
  function caseMoveItem(id, aid, d) {
    var c = caseById(id);
    if (!c) return;
    var i = caseItemIdx(c, aid), j = i + d;
    if (i === -1 || j < 0 || j >= c.items.length) return;
    var t = c.items[i]; c.items[i] = c.items[j]; c.items[j] = t;
    caseSave();
  }
  function caseItems(id) {
    var c = caseById(id);
    if (!c) return [];
    return c.items.map(function (e) { return { e: e, a: byId[e.id] || null }; })
      .filter(function (x) { return x.a; });
  }
  function caseAddNote(id, text) {
    var c = caseById(id);
    if (!c) return;
    text = String(text || "").trim();
    if (!text) return;
    c.notes.unshift({
      id: "n" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36),
      text: text, created: Date.now()
    });
    c.updated = Date.now();
    caseSave();
  }
  function caseDelNote(id, nid) {
    var c = caseById(id);
    if (!c) return;
    c.notes = c.notes.filter(function (n) { return n.id !== nid; });
    c.updated = Date.now();
    caseSave();
  }
  function syncCaseCount() {
    var el = $("#caseCount");
    if (el) { el.textContent = state.cases.length; el.style.display = state.cases.length ? "" : "none"; }
  }

  /* Обновление вида кнопок «В подборку» без перерисовки страницы */
  function paintColBtns(id) {
    var on = inCol(id);
    $$('[data-col-add="' + id.replace(/"/g, '\\"') + '"]').forEach(function (b) {
      if (b.tagName === "BUTTON" && b.classList.contains("ibtn")) {
        b.classList.toggle("on", on);
        b.title = on ? "Убрать из подборки" : "Добавить в подборку";
      } else {
        b.classList.toggle("active", on);
        b.innerHTML = on ? ic("clip") + " В подборке" : ic("clip") + " В подборку";
      }
    });
  }
  function pushHist(q) {
    q = String(q || "").trim();
    if (q.length < 2) return;
    state.hist = [q].concat(state.hist.filter(function (x) { return x !== q; })).slice(0, 25);
    LS.set("hist", state.hist);
  }

  /* ------------------------------------------------------------------ уведомления */

  var toastEl = null, toastTimer = null;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement("div"); toastEl.className = "toast"; document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    requestAnimationFrame(function () { toastEl.classList.add("show"); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 1900);
  }

  function copyText(text, label) {
    var done = function () { toast(label || "Скопировано"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
  }

  function download(filename, content, mime) {
    var type = (mime || "text/plain") + ";charset=utf-8";
    var body = "\ufeff" + content;
    var url = null;
    try {
      url = URL.createObjectURL(new Blob([body], { type: type }));
    } catch (e) {
      /* окружение без Blob/URL — отдаём через data-ссылку */
      url = "data:" + type + "," + encodeURIComponent(body);
    }
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    try { a.click(); } catch (e) {}
    setTimeout(function () {
      try { if (url.indexOf("blob:") === 0) URL.revokeObjectURL(url); } catch (e) {}
      a.remove();
    }, 400);
  }

  /* ------------------------------------------------------------------ .docx
     Word открывает HTML с MIME application/vnd.ms-word и корректно переносит
     структуру (заголовки, абзацы, курсив/жирный). Расширение .docx при этом
     не мешает — файл остаётся валидным HTML внутри контейнера Word. Для
     «настоящего» OOXML нужен ZIP-контейнер; здесь используется проверенный
     путь через HTML-обёртку с декларацией Word, который понимают Word,
     LibreOffice и «МойОфис». */

  function docxWrap(title, innerHtml) {
    return '<html xmlns:o="urn:schemas-microsoft-com:office:office" ' +
      'xmlns:w="urn:schemas-microsoft-com:office:word" ' +
      'xmlns="http://www.w3.org/TR/REC-html40">' +
      '<head><meta charset="utf-8"><title>' + esc(title) + "</title>" +
      "<!--[if gte mso 9]><xml><w:WordDocument>" +
      "<w:View>Print</w:View><w:Zoom>100</w:Zoom>" +
      "</w:WordDocument></xml><![endif]-->" +
      "<style>" +
      "@page{size:A4;margin:2cm 2cm 2cm 2.5cm}" +
      "body{font-family:'Times New Roman',serif;font-size:12pt;line-height:1.35;color:#000}" +
      "h1{font-size:15pt;margin:0 0 4pt;font-weight:bold}" +
      "h2{font-size:13pt;margin:14pt 0 6pt;font-weight:bold}" +
      "h3{font-size:12pt;margin:10pt 0 5pt;font-weight:bold}" +
      "p{margin:0 0 6pt;text-align:justify}" +
      ".m{color:#444;font-size:10pt;margin:0 0 8pt}" +
      "pre{font-family:'Times New Roman',serif;font-size:12pt;white-space:pre-wrap;margin:0 0 6pt}" +
      ".nt{background:#f2f2f2;padding:6pt 8pt;border-left:2pt solid #888;margin:0 0 8pt}" +
      "hr{border:0;border-top:1pt solid #999;margin:12pt 0}" +
      "table{border-collapse:collapse;width:100%}" +
      "td,th{border:1pt solid #999;padding:4pt 6pt;font-size:11pt}" +
      "</style></head><body>" + innerHtml + "</body></html>";
  }

  function saveDocx(filename, title, innerHtml) {
    download(filename, docxWrap(title, innerHtml), "application/vnd.ms-word");
  }

  /* --- цитирование по ГОСТ Р 7.0.100-2018 и юридическому обычаю --- */

  function citeGost(a) {
    var c = codeById(a.c);
    if (!c) return cite(a);
    if (isPlenum(c)) {
      return plenumFull(c) + (c.redaction ? " (ред. от " + fmtRed(c.redaction) + ")" : "") +
        " // Судебные и нормативные акты РФ. URL: " + officialUrl(a) +
        " (дата обращения: " + fmtDate(new Date()) + "). — П. " + a.dn +
        (a.t ? ". " + a.t : "") + ".";
    }
    var red = c.redaction ? " (ред. от " + fmtRed(c.redaction) + ")" : "";
    var num = (c.req || "").replace(/^№\s*/, "");
    var kind = c.kind === "constitution" ? "" : (kindTail(c));
    var head = c.full;
    var tail = num ? " : " + num + kind : "";
    return head + tail + red + " // Официальный интернет-портал правовой информации. URL: " +
      officialUrl(a) + " (дата обращения: " + fmtDate(new Date()) + "). — Ст. " + a.dn +
      (a.t ? ". " + a.t : "") + ".";
  }

  /* «N-ФЗ от ДД.ММ.ГГГГ» и подобное — хвост реквизита для библиографической ссылки */
  function kindTail(c) {
    if (!c.req) return "";
    var m = /от\s+([\d.]+)/.exec(c.req);
    return m ? " от " + m[1] : "";
  }

  /* Короткая юридическая ссылка для документов и писем */
  function citeLegal(a) {
    var c = codeById(a.c);
    if (!c) return cite(a);
    return (isPlenum(c) ? plenumFull(c) : c.full) +
      (c.redaction ? " (ред. от " + fmtRed(c.redaction) + ")" : "") +
      ", " + unitShort(c, a.dn) + (a.t ? " («" + a.t + "»)" : "");
  }

  /* ------------------------------------------------------------------ роутер */

  /* Переход по разделам приложения.

     Один сайт — одна запись в истории. Раньше каждый клик по вкладке делал
     `location.hash = …` и добавлял в историю браузера новую запись: за
     десять разделов накапливалось десять строк, и в истории выглядело так,
     будто сайт открывали десять раз. Теперь переход заменяет текущую запись:
     адрес обновляется (ссылку на раздел по-прежнему можно скопировать и
     сохранить), а в истории остаётся одна строка на визит. Кнопка «Назад»
     уходит с сайта, а не листает вкладки, — это ровно то поведение, которого
     ждёт человек, просидевший на одном сайте.

     Hash-маршрутизация сохранена сознательно: она работает и с file://, и на
     любом статическом хостинге без SPA-перенаправлений. */
  function go(hash) {
    try { location.replace(hash); }
    catch (e) { location.hash = hash; }
  }

  function parseHash() {
    var h = (location.hash || "").replace(/^#\/?/, "");
    var parts = h.split("/");
    var name = parts[0] || "home";
    if (name === "article") return { name: "article", arg: decodeURIComponent(parts[1] || "") };
    if (name === "search") return { name: "search", q: decodeURIComponent(parts.slice(1).join("/") || "") };
    if (name === "repealed") return { name: "repealed", q: decodeURIComponent(parts.slice(1).join("/") || "") };
    if (name === "timeline") return { name: "timeline", arg: parts[1] ? decodeURIComponent(parts[1]) : null };
    if (name === "graph") return { name: "graph", arg: parts[1] || null };
    if (name === "diff") return { name: "diff", arg: parts[1], q: decodeURIComponent(parts.slice(2).join("/") || "") };
    if (name === "compare") return { name: "compare", a: decodeURIComponent(parts[1] || ""), b: decodeURIComponent(parts[2] || "") };
    if (name === "code") return { name: "code", arg: parts[1] };
    if (name === "checklist") return { name: "checklist", arg: parts[1] };
    if (name === "template") return { name: "template", arg: parts[1] };
    if (name === "calc") return { name: "calc", arg: parts[1] || "base" };
    return { name: name, arg: parts[1] || null };
  }

  /* Заголовок вкладки/истории. Без него каждый раздел в истории браузера и в
     списке вкладок выглядел одинаково; с ним — понятно, что это один сайт и
     какой именно раздел открыт. */
  var APP_NAME = "Правовой консультант";
  function setDocTitle(t) {
    document.title = t ? APP_NAME + " · " + t : APP_NAME + " — кодексы, сроки, памятки, шаблоны";
  }
  function routeTitle(r) {
    var t = {
      home: "Навигатор", new: "Новое", assistant: "Помощник", scenarios: "Памятки оперативнику",
      checklists: "Чек-листы", templates: "Шаблоны документов", calc: "Калькуляторы",
      deadlines: "Процессуальные сроки", freshness: "Проверка актуальности", repealed: "Утратившие силу",
      diff: "Сравнение редакций", compare: "Две статьи бок о бок", favorites: "Избранное",
      collection: "Подборка норм", cases: "Дела", timeline: "Лента изменений", stats: "Аналитика",
      graph: "Связи источников", help: "Как пользоваться", search: "Поиск"
    }[r.name];
    if (t !== undefined) {
      if (r.name === "search") return "Поиск" + (r.q ? ": " + r.q : "");
      return t || "";
    }
    if (r.name === "article") {
      var a = byId[r.arg];
      return a ? "ст. " + a.dn + " " + a.t : "Статья";
    }
    if (r.name === "code") {
      var c = codeById(r.arg);
      return c ? c.short : "Источник";
    }
    return "";
  }

  var lastViewName = null;
  function render() {
    /* запомнить позицию на уходящей странице статьи */
    var prev = state.route;
    if (prev && prev.name === "article" && prev.arg) scrollMemo[prev.arg] = window.pageYOffset || 0;

    state.route = parseHash();
    setDocTitle(routeTitle(state.route));
    var v = $("#view");
    var r = state.route;
    setSidebar(false);
    toggleReadMenu(false);
    toggleRoleMenu(false);
    if (r.name === "home") v.innerHTML = viewHome();
    else if (r.name === "search") { v.innerHTML = viewSearch(r.q); afterSearch(r.q); }
    else if (r.name === "article") { v.innerHTML = viewArticle(r.arg); afterArticle(r.arg); }
    else if (r.name === "code") { v.innerHTML = viewCode(r.arg); afterCode(r.arg); }
    else if (r.name === "assistant") v.innerHTML = viewAssistant();
    else if (r.name === "scenarios") v.innerHTML = viewScenarios();
    else if (r.name === "scenario") v.innerHTML = viewScenario(r.arg);
    else if (r.name === "deadlines") v.innerHTML = viewDeadlines();
    else if (r.name === "calc") { v.innerHTML = viewCalc(r.arg); bindCalc(r.arg); }
    else if (r.name === "checklists") v.innerHTML = viewChecklists();
    else if (r.name === "checklist") v.innerHTML = viewChecklist(r.arg);
    else if (r.name === "templates") v.innerHTML = viewTemplates();
    else if (r.name === "template") v.innerHTML = viewTemplate(r.arg);
    else if (r.name === "freshness") v.innerHTML = viewFreshness();
    else if (r.name === "new") { v.innerHTML = viewNew(r.arg); bindNew(); }
    else if (r.name === "favorites") v.innerHTML = viewFavorites();
    else if (r.name === "collection") v.innerHTML = viewCollection();
    else if (r.name === "cases") { v.innerHTML = viewCases(); bindCases(); }
    else if (r.name === "case") { v.innerHTML = viewCase(r.arg); bindCase(r.arg); }
    else if (r.name === "repealed") { v.innerHTML = viewRepealed(); bindRepealed(); }
    else if (r.name === "stats") v.innerHTML = viewStats();
    else if (r.name === "timeline") v.innerHTML = viewTimeline(r.arg);
    else if (r.name === "graph") { v.innerHTML = viewGraph(r.arg); bindGraph(); }
    else if (r.name === "diff") { v.innerHTML = viewDiff(r.arg, r.q); bindDiff(r.arg); }
    else if (r.name === "compare") { v.innerHTML = viewCompare(r.a, r.b); bindCompare(); }
    else if (r.name === "help") v.innerHTML = viewHelp();
    else v.innerHTML = viewHome();

    try { window.scrollTo(0, 0); } catch (e) {}
    markNav();
    a11yNav();
    syncColCount();
    bindRoleSwitch();
    syncRoleSwitch();
    if (r.name === "template") bindTemplate();
    if (r.name === "templates") bindTemplates();
    if (r.name === "deadlines") bindDeadlines();
    if (r.name === "assistant") bindAssistant();
    if (r.name === "freshness") bindFreshness();
    if (r.name === "collection") bindCollection();

    /* Плавная смена раздела. Ключ включает и аргумент маршрута, поэтому
       анимируются и переходы внутри раздела (статья → статья, вкладка
       калькулятора → вкладка), но не перерисовка той же страницы — иначе
       мерцало бы при наборе в поиске и переключении роли. */
    var viewKey = r.name + "|" + (r.arg || "");
    if (lastViewName !== viewKey) {
      lastViewName = viewKey;
      v.classList.remove("view-anim");
      void v.offsetWidth;
      v.classList.add("view-anim");
      staggerIn(v);
    }
  }

  /* Поочерёдное появление карточек раздела — не больше 18 элементов и только
     плитки первого уровня. Длинные списки (сотни строк кодекса) не трогаем:
     анимировать их дорого, а пользы нет. */
  var reduceMotion = false;
  try {
    reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch (e) {}
  function staggerIn(root) {
    if (!root || reduceMotion) return;
    var els = root.querySelectorAll(".help-start > *, .grid-4 > *, .grid-3 > .quick-card, .tiles > *");
    for (var i = 0, n = 0; i < els.length && n < 18; i++, n++) {
      els[i].style.animationDelay = (n * 20) + "ms";
      els[i].classList.add("rise");
    }
  }

  /* Вернуть пользователя туда, где он остановился в статье.
     Позиция восстанавливается только после загрузки полного текста — иначе
     страница ещё короткая и прокрутка упрётся в предел. */
  function restoreScroll(id) {
    var y = scrollMemo[id];
    if (!y) return;
    requestAnimationFrame(function () {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      if (max <= 0) return;
      window.scrollTo(0, Math.min(y, max));
    });
  }

  function markNav() {
    var n = state.route.name;
    $$(".nav-item[data-nav]").forEach(function (el) {
      var k = el.getAttribute("data-nav");
      var on = (k === n) || (k === "code" && n === "code") || (k === "checklists" && n === "checklist") ||
        (k === "templates" && n === "template") || (k === "cases" && n === "case") ||
        (k === "scenarios" && (n === "scenarios" || n === "scenario")) ||
        (k === "diff" && (n === "diff" || n === "compare")) ||
        (k === "stats" && (n === "stats" || n === "timeline" || n === "graph"));
      el.classList.toggle("active", on);
      if (on) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current");
    });
    $$("#codeNav .nav-item").forEach(function (el) {
      var on = n === "code" && el.getAttribute("data-href") === "#/code/" + state.route.arg;
      el.classList.toggle("active", on);
      if (on) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current");
    });
  }

  /* Делает навигационные div-элементы доступными с клавиатуры и для
     скринридеров: role, tabindex, Enter/Space. Вызывается после отрисовки. */
  function a11yNav(root) {
    var scope = root || document;
    $$(".nav-item, .code-card, .chip, .result, .palette-item, .quick-card, .scen-card", scope).forEach(function (el) {
      if (el.getAttribute("data-a11y") === "1") return;
      if (/^(BUTTON|A|INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (!el.hasAttribute("data-go") && !el.hasAttribute("data-href")) return;
      el.setAttribute("data-a11y", "1");
      el.setAttribute("role", "button");
      el.setAttribute("tabindex", "0");
    });
    /* заголовок страницы — для объявления скринридером */
    var h = scope.querySelector ? scope.querySelector("h1") : null;
    if (h && !h.id) h.id = "pageTitle";
  }

  /* ------------------------------------------------------------------ виды */

  function stat(num, lbl, ico, tone) {
    return '<div class="stat' + (tone ? " tone-" + tone : "") + '">' +
      (ico ? '<span class="stat-ico">' + ic(ico) + "</span>" : "") +
      '<div class="stat-num">' + num + '</div><div class="stat-lbl">' + esc(lbl) + "</div></div>";
  }
  function quickCard(iconName, title, sub, href, tone) {
    return '<div class="card quick-card" data-go="' + href + '"' +
      (tone ? ' data-tone="' + tone + '"' : "") + ">" +
      '<span class="qc-ico">' + ic(iconName) + "</span>" +
      '<div class="qc-body"><div class="qc-t">' + esc(title) + "</div>" +
      '<div class="qc-s">' + esc(sub) + "</div></div></div>";
  }

  /* Горизонтальные вкладки разделов: связывают родственные страницы, чтобы
     переключение между ними было в один клик и не засоряло боковое меню. */
  function tabStrip(items, active) {
    return '<nav class="tabs" aria-label="Разделы">' + items.map(function (it) {
      var on = it.k === active;
      return '<div class="tab' + (on ? " on" : "") + '" data-go="' + it.h + '" ' +
        'role="tab" tabindex="0" data-a11y="1" aria-selected="' + (on ? "true" : "false") + '">' +
        (it.ico ? ic(it.ico) : "") + "<span>" + esc(it.t) + "</span>" +
        (it.n != null ? '<span class="tab-n">' + it.n + "</span>" : "") + "</div>";
    }).join("") + "</nav>";
  }

  function codeCard(c) {
    var n = (byCode[c.id] || []).length;
    var upd = updates[c.id];
    return '<div class="code-card" data-go="#/code/' + c.id + '" style="--c:' + c.color + '">' +
      '<div class="cc-short">' + esc(c.short) + "</div>" +
      '<div class="cc-full">' + esc(c.full) + "</div>" +
      '<div class="cc-meta"><span>' + esc(c.req || "") + "</span><span>" + n + " ст.</span></div>" +
      '<div class="cc-red">' + (c.redaction ? "ред. " + fmtRed(c.redaction) : (c.note ? "" : "справочно")) +
        (upd ? '<span class="cc-upd">обновление</span>' : "") + "</div>" +
      "</div>";
  }

  /* Группировка источников по виду акта */
  var KIND_TITLE = {
    constitution: "Конституция",
    code: "Кодексы",
    fkz: "Федеральные конституционные законы",
    law: "Федеральные законы",
    decree: "Постановления Правительства",
    plenum: "Постановления Пленума Верховного Суда РФ"
  };
  var KIND_ORDER = ["constitution", "code", "fkz", "law", "decree", "plenum"];

  /* Свёрнутые группы источников в сайдбаре. Пока пользователь ни разу не
     переключал группы, по умолчанию свёрнуты ВСЕ (а не раскрыты). */
  function navCollapsed() {
    var set = LS.get("collapsedKinds", null);
    if (!set) set = docGroups().map(function (g) { return g.kind; });
    return set;
  }

  function docGroups() {
    var map = {}, out = [];
    CODES.forEach(function (c) {
      var k = c.kind || "code";
      if (!map[k]) { map[k] = { kind: k, title: KIND_TITLE[k] || "Иные акты", items: [] }; out.push(map[k]); }
      map[k].items.push(c);
    });
    out.sort(function (a, b) {
      var ia = KIND_ORDER.indexOf(a.kind), ib = KIND_ORDER.indexOf(b.kind);
      if (ia === -1) ia = 99; if (ib === -1) ib = 99;
      return ia - ib;
    });
    return out;
  }

  function viewHome() {
    var popular = ["upk-91", "upk-92", "upk-182", "upk-108", "upk-109", "upk-144", "uk-158", "uk-159",
                   "uk-228", "uk-290", "uk-105", "uk-264.1", "koap-12.8", "gk1-151", "tk-81"];
    var popList = roleSort(popular.map(function (id) { return byId[id]; }).filter(Boolean), function (a) { return a.t + " " + cite(a); });
    var popCards = popList.map(function (a) {
      var off = state.role && roleOff(a.t + " " + cite(a)) ? " role-off" : "";
      return '<div class="chip' + off + '" data-go="#/article/' + encodeURIComponent(a.id) + '">' + esc(cite(a)) + " · " + esc(a.t) + "</div>";
    }).join("");

    var hist = state.hist.length
      ? '<h2>Недавние запросы</h2><div class="chips">' + state.hist.slice(0, 12).map(function (q) {
          return '<div class="chip" data-go="#/search/' + encodeURIComponent(q) + '">' + esc(q) + "</div>";
        }).join("") + "</div>"
      : "";

    var withText = CODES.filter(function (c) { return !c.note; });
    var nCodes = CODES.filter(function (c) { return (c.kind || "code") === "code"; }).length;
    var nLaws = CODES.filter(function (c) { return c.kind === "law"; }).length;
    var nFkz = CODES.filter(function (c) { return c.kind === "fkz"; }).length;
    var nDec = CODES.filter(function (c) { return c.kind === "decree"; }).length;
    var nPlen = CODES.filter(function (c) { return c.kind === "plenum"; }).length;
    var nUpd = Object.keys(updates).length;

    return '<header class="hero">' +
        "<h1>Правовой консультант-помощник</h1>" +
        '<p class="lead">Полные тексты кодексов, федеральных законов, Конституции, федеральных конституционных законов и постановлений Правительства Российской Федерации в действующей редакции: поиск по статьям, разбор ситуации в «Помощнике», процессуальные сроки, чек-листы следственных действий и шаблоны документов — в одном рабочем окне.</p>' +
      "</header>" +

      '<div class="grid grid-4">' +
        stat(arts.length.toLocaleString("ru-RU"), "статей в базе", "file", 1) +
        stat(withText.length, "источников полностью", "shield", 2) +
        stat((REF.deadlines || []).length, "процессуальных сроков", "clock", 3) +
        stat((REF.scenarios || []).length + (REF.checklists || []).length + (REF.templates || []).length, "памяток, чек-листов и шаблонов", "checkbox", 4) +
      "</div>" +


      '<div class="oper-panel">' +
        '<div class="oper-head">' +
          '<span class="oper-ico">' + ic("shield") + "</span>" +
          '<div class="oper-txt"><div class="oper-t">' + esc(roleDative()) + "</div>" +
          '<div class="oper-s">Типовые ситуации: что проверить, какие статьи применить, что оформить и в какой срок</div></div>' +
          '<div class="btn btn-sm" data-go="#/scenarios">Все памятки →</div>' +
        "</div>" +
        '<div class="chips">' + roleSort((REF.scenarios || []).slice(0, 8), function (s) { return s.t + " " + (s.note || ""); }).map(function (s) {
          var off = state.role && roleOff(s.t + " " + (s.note || "")) ? " role-off" : "";
          return '<div class="chip' + off + '" data-go="#/scenario/' + s.id + '">' + ic(s.ico) + " " + esc(s.t) + "</div>";
        }).join("") + "</div>" +
      "</div>" +

      '<div class="grid grid-3" style="margin-top:16px">' +
        quickCard("search", "Поиск статей", "По номеру, названию или ключевому слову", "#/search/", "blue") +
        quickCard("compass", "Помощник", "Опишите ситуацию или вопрос — разберём состав, квалификацию и порядок действий", "#/assistant", "violet") +
        quickCard("clip", "Подборка норм", colCount() ? "В подборке " + colCount() + " " + plural(colCount(), ["статья", "статьи", "статей"]) : "Рабочий набор статей по делу с выгрузкой", "#/collection", "teal") +
        quickCard("folder", "Дела", state.cases.length ? "Дел заведено: " + state.cases.length + " — нормы, заметки, журнал" : "Папки по делам: нормы с заметками и журнал по делу", "#/cases", "amber") +
        quickCard("swap", "Сравнение", "Редакции источника и две статьи бок о бок", "#/diff", "violet") +
        quickCard("shield", "Проверка актуальности", nUpd ? nUpd + " " + plural(nUpd, ["источник требует", "источника требуют", "источников требуют"]) + " обновления" : "Сверить редакции с официальным источником", "#/freshness", "green") +
        quickCard("ban", "Утратившие силу", (STATUS_META.total || 0) + " " + plural(STATUS_META.total || 0, ["норма утратила силу", "нормы утратили силу", "норм утратили силу"]) + " — реестр", "#/repealed", "slate") +
        quickCard("scales", "Калькуляторы", "Обычный счёт, процессуальные сроки, давность, госпошлина, проценты, сроки под стражей", "#/calc", "amber") +
        quickCard("checkbox", "Чек-листы", "Обязательные элементы следственных действий", "#/checklists", "blue") +
        quickCard("file", "Шаблоны", "Документы по отраслям права с подстановкой данных", "#/templates", "teal") +
        quickCard("star", "Избранное", state.fav.length ? "Сохранено статей: " + state.fav.length : "Статьи, к которым вы вернётесь", "#/favorites", "rose") +
        quickCard("help", "Как пользоваться", "Возможности приложения и приёмы работы с текстами", "#/help", "slate") +
      "</div>" +

      '<h2>Нормативные источники</h2>' +
      '<p class="lead" style="margin-top:-6px">' + nCodes + " " + plural(nCodes, ["кодекс", "кодекса", "кодексов"]) +
        ", " + nLaws + " " + plural(nLaws, ["федеральный закон", "федеральных закона", "федеральных законов"]) +
        ", Конституция Российской Федерации, " + nFkz + " " + plural(nFkz, ["федеральный конституционный закон", "федеральных конституционных закона", "федеральных конституционных законов"]) +
        ", " + nDec + " " + plural(nDec, ["постановление Правительства", "постановления Правительства", "постановлений Правительства"]) +
        (nPlen ? " и " + nPlen + " " + plural(nPlen, ["постановление Пленума ВС РФ", "постановления Пленума ВС РФ", "постановлений Пленума ВС РФ"]) : "") +
        ". Полные тексты подгружаются по требованию.</p>" +
      '<div class="kind-tools">' +
        '<button class="btn btn-sm" data-kinds-all="open">' + ic("plus") + " Развернуть все источники</button>" +
        '<button class="btn btn-sm" data-kinds-all="close">' + ic("minus") + " Свернуть</button>" +
      "</div>" +
      docGroups().map(function (g, i) {
        return '<details class="kind-block"' + (i === 0 ? " open" : "") + ">" +
          '<summary class="kind-title">' + esc(g.title) + '<span class="cnt">' + g.items.length + "</span></summary>" +
          '<div class="grid grid-3">' + g.items.map(codeCard).join("") + "</div></details>";
      }).join("") +

      '<h2>Часто используемые статьи</h2><div class="chips">' + popCards + "</div>" +

      hist +

      '<div class="disclaimer">' +
        "<b>О статусе текстов.</b> Полные тексты получены из открытого набора данных на основе официального портала опубликования правовых актов actual.pravo.gov.ru, а также напрямую с этого портала. " +
        "Тексты правовых актов не являются объектами авторских прав (п. 6 ст. 1259 ГК РФ). " +
        "Дата редакции указана для каждого источника и для каждой статьи отдельно. " +
        "Справочные аннотации, ключевые слова и практические заметки подготовлены для приложения и не являются официальным текстом. " +
        "Для юридически значимых действий сверяйтесь с официальной публикацией и пользуйтесь разделом «Проверка актуальности». Приложение не заменяет консультацию юриста." +
      "</div>";
  }

  /* Настройки выдачи. Живут в памяти вкладки, а не в адресе: при переходе по
     ссылке «поиск» фильтры сбрасываются, и это ожидаемо — иначе ссылка,
     отправленная коллеге, открывалась бы с чужими фильтрами. */
  var searchOpts = { skipRepealed: false, src: "", sort: "rel" };

  /* Какие слова запроса реально совпали в этой статье — для строки
     «почему совпало». Показываем не более четырёх, чтобы не засорять карточку. */
  function matchedWords(a, p) {
    var AT = a._T || [], AK = a._K || [], AS = a._S || [], AP = a._P || [], AX = a._X || [], AG = a._G || [];
    var out = [];
    p.tokens.forEach(function (w) {
      if (out.length >= 4) return;
      var st = FT ? FT.stem(w) : w;
      if (stemHit(AT, st) || stemHit(AK, st) || stemHit(AS, st) ||
          stemHit(AP, st) || stemHit(AX, st) || stemHit(AG, st)) out.push(w);
    });
    return out;
  }

  /* Строка «почему совпало» под карточкой результата. Пользователь видит,
     по какому полю и какими словами статья попала в выдачу, — раньше это
     приходилось угадывать. */
  function whyLine(a, p, x) {
    var parts = [];
    if (x && x.num) parts.push("номер статьи");
    if (x && x.topic) parts.push("разбор ситуации «" + x.topic + "»");
    if (x && x.role === "on") parts.push("по вашей роли");
    else if (x && x.role === "off") parts.push("не по вашей роли");
    if (x && x.why && x.why.length) parts.push(x.why.join(", "));
    if (x && x.syn && !(x.why && x.why.length)) parts.push("близкие по смыслу слова");
    if (!parts.length) parts.push("совпадение в тексте");
    var w = matchedWords(a, p);
    var label = "Совпало: " + parts.join(" · ");
    return '<span class="why">' + esc(label) +
      (w.length ? " — " + esc(w.join(", ")) : "") + "</span>";
  }

  function viewSearch(q) {
    q = q || "";
    if (!q.trim()) {
      return '<h1>Поиск статей</h1>' +
        '<p class="lead">Введите номер статьи, название или слова из её текста — они ищутся и внутри полного текста, а не только в заголовке.</p>' +
        '<div class="card" style="margin-bottom:16px">' +
          "<h3 style=\"margin-top:0\">Что понимает поиск</h3>" +
          '<ul class="list">' +
            "<li><b>Номер статьи и кодекс:</b> «ст 105 УК», «статья 91 УПК», «19.7.10-1 КоАП», «ст 333.19 НК».</li>" +
            "<li><b>Слова из текста:</b> «не позднее трех суток», «сбыт наркотиков» — ищется и внутри полного текста статьи.</li>" +
            "<li><b>Точная фраза:</b> «\"тайное хищение чужого имущества\"» в кавычках — слова подряд и в этом порядке.</li>" +
            "<li><b>Обязательное слово:</b> «+обыск жилище» — слово с плюсом обязано быть в статье.</li>" +
            "<li><b>Исключить слово:</b> «наркотики -сбыт» — статьи со словом после минуса не показываются.</li>" +
          "</ul>" +
          '<p class="small muted" style="margin-bottom:0">Опечатки исправляются автоматически: «наркоти» найдёт «наркотическ», «обыскк» — «обыск».</p>' +
        "</div>" +
        '<div class="chips">' +
          ["ст 105 УК", "статья 91 УПК", "19.7 КоАП", "обыск в жилище", "получение взятки", "сбыт наркотиков",
           "срок предварительного следствия", "контроль переговоров", "моральный вред", "прогул",
           "\"тайное хищение чужого имущества\"", "стража -несовершеннолетних"].map(function (x) {
            return '<div class="chip" data-go="#/search/' + encodeURIComponent(x) + '">' + esc(x) + "</div>";
          }).join("") +
        "</div>";
    }
    var p = parseQuery(q);
    if (p.code && !p.tokens.length && !p.numbers.length) {
      return '<div class="info-box" style="margin-bottom:16px">Запрос распознан как указание на источник — показано его содержание.</div>' +
        viewCode(p.code);
    }
    var all = search(q, { skipRepealed: searchOpts.skipRepealed });
    /* Фильтр по источнику применяем после отсечки «хвоста»: иначе выбор
       источника считался бы от уже урезанного списка и счётчики врали бы. */
    var res = searchOpts.src ? all.filter(function (x) { return x.a.c === searchOpts.src; }) : all;
    if (searchOpts.sort === "src") {
      res = res.slice().sort(function (x, y) { return cmpArticles(x.a, y.a); });
    }
    var c = p.code ? codeById(p.code) : null;

    var counts = {};
    all.forEach(function (x) { counts[x.a.c] = (counts[x.a.c] || 0) + 1; });
    var top = Object.keys(counts).sort(function (x, y) { return counts[y] - counts[x]; }).slice(0, 6);
    var tools = (all.length > 3 || searchOpts.src || searchOpts.skipRepealed || searchOpts.sort !== "rel")
      ? '<div class="search-tools">' +
      '<div class="st-row"><span class="st-lbl">Источник</span><div class="chips">' +
        '<div class="chip' + (searchOpts.src ? "" : " on") + '" data-sfilter="src:">Все (' + all.length + ")</div>" +
        top.map(function (id) {
          var cc = codeById(id);
          return '<div class="chip' + (searchOpts.src === id ? " on" : "") + '" data-sfilter="src:' + esc(id) + '">' +
            esc(cc ? cc.short : id) + " (" + counts[id] + ")</div>";
        }).join("") +
      "</div></div>" +
      '<div class="st-row"><span class="st-lbl">Вид</span><div class="chips">' +
        '<div class="chip' + (searchOpts.skipRepealed ? " on" : "") + '" data-sfilter="repealed">Только действующие</div>' +
        '<div class="chip' + (searchOpts.sort === "src" ? " on" : "") + '" data-sfilter="sort:src">Сначала по источникам</div>' +
        (searchOpts.src || searchOpts.skipRepealed || searchOpts.sort !== "rel"
          ? '<div class="chip" data-sfilter="reset">Сбросить фильтры</div>' : "") +
      "</div></div></div>" : "";

    var head = '<h1>Результаты поиска</h1><p class="lead">Запрос: <b>' + esc(q) + "</b> — найдено " + res.length + " " +
      plural(res.length, ["статья", "статьи", "статей"]) + (c ? " · источник: " + esc(c.short) : "") + "</p>" +
      (p.phrases.length ? '<p class="small muted">Точная фраза: ' + esc(p.phrases.map(function (x) { return "«" + x + "»"; }).join(", ")) + "</p>" : "") +
      (p.must.length ? '<p class="small muted">Обязательные слова: ' + esc(p.must.join(", ")) + "</p>" : "") +
      (p.not.length ? '<p class="small muted">Исключены слова: ' + esc(p.not.join(", ")) + "</p>" : "") +
      (p.syn.length ? '<p class="small muted">Поиск расширен близкими по смыслу словами: ' + esc(p.syn.slice(0, 8).join(", ")) + "</p>" : "") +
      tools;

    if (!res.length) {
      return head + '<div class="empty" id="metaEmpty"><div class="ico">' + ic("search") + '</div>' +
        '<div>' + (searchOpts.src || searchOpts.skipRepealed
          ? "Под выбранные фильтры совпадений нет. Снимите фильтр или измените запрос."
          : "По названиям и аннотациям совпадений нет. Ищем по полным текстам статей…") + "</div></div>" +
        '<div id="ftBlock"></div>';
    }
    var items = res.slice(0, 150).map(function (x) {
      var a = x.a, cc = codeById(a.c) || { short: a.c, color: "#888", branch: "" };
      var snip = a.s ? highlight(snippet(a.s, p.tokens, 200), p.tokens) : "";
      var stb = statusBadge(a.id);
      return '<div class="result' + (stb ? " has-status" : "") + '" data-go="#/article/' + encodeURIComponent(a.id) + '">' +
        '<div class="result-head">' +
          '<span class="badge badge-code" style="border-color:' + cc.color + '44;color:' + cc.color + '">' + esc(cc.short) + "</span>" +
          '<span class="result-num">ст. ' + esc(a.dn) + "</span>" +
          '<span class="result-title">' + highlight(a.t, p.tokens) + "</span>" +
          stb +
          '<button class="ibtn ibtn-col' + (inCol(a.id) ? " on" : "") + '" data-col-add="' + esc(a.id) + '" ' +
            'title="' + (inCol(a.id) ? "Убрать из подборки" : "Добавить в подборку") + '">' + ic("clip") + '</button>' +
        "</div>" +
        (snip ? '<div class="result-snippet">' + snip + "</div>" : "") +
        '<div class="result-meta">' + (a.g ? "<span>" + esc(a.g) + "</span>" : "") + "<span>" + esc(cc.branch || "") + "</span>" +
          (a.note ? "<span>только аннотация</span>" : "") + whyLine(a, p, x) + "</div>" +
        "</div>";
    }).join("");
    /* Широкий запрос («суд», «вред») даёт сотни совпадений: показываем первые
       и прямо говорим, что список длиннее, — иначе выдача выглядит свалкой. */
    var hint = res.length > 150
      ? '<p class="small muted" style="margin-top:14px">Показаны первые 150. Уточните запрос — добавьте отрасль, номер статьи или характерный признак.</p>'
      : "";
    return head + items + hint + roleBlock(q, res) + '<div id="ftBlock"></div>';
  }

  /* ------------------------------------------------------------------ блок роли

     Роль не переставляет юридически верный ответ, но её выбор должен быть
     виден на любой вкладке. Поэтому под основной выдачей — отдельный блок
     «По вашей роли»: нормы, которые попали в кандидаты по этому же запросу и
     подходят под роль, но в первую пятёрку не вошли. Если роль не выбрана
     или добавить нечего, блок не показывается. */
  function roleBlock(q, shown) {
    if (!state.role || !q || !q.trim()) return "";
    var d = roleDef();
    if (!d.prio.length) return "";
    var have = {};
    shown.slice(0, 6).forEach(function (x) { have[x.a.id] = 1; });
    var wide;
    try { wide = search(q, { cut: 0.05, need: 2, skipRepealed: searchOpts.skipRepealed }); }
    catch (e) { return ""; }
    var picks = wide.filter(function (x) { return x.role === "on" && !have[x.a.id]; }).slice(0, 4);
    if (!picks.length) return "";
    return '<div class="role-block" id="roleBlock">' +
      '<div class="role-block-h">' + ic("user") +
        "<span>По вашей роли — " + esc(d.title) + "</span>" +
        '<span class="small muted">не меняет порядок основной выдачи</span>' +
      "</div>" +
      picks.map(function (x) {
        return '<div class="role-item" data-go="#/article/' + encodeURIComponent(x.a.id) + '">' +
          '<span class="result-num">ст. ' + esc(x.a.dn) + "</span>" +
          '<span class="result-title">' + esc(x.a.t) + "</span>" +
          statusBadge(x.a.id) + "</div>";
      }).join("") +
      "</div>";
  }

  /* Перерисовать выдачу после смены фильтра. Адрес и прокрутка сохраняются:
     смена фильтра — не переход на другую страницу. */
  function refreshSearch() {
    if (state.route.name !== "search") return;
    var v = $("#view");
    if (!v) return;
    var y = window.pageYOffset || 0;
    v.innerHTML = viewSearch(state.route.q);
    afterSearch(state.route.q);
    paintIcons(v);
    a11yNav(v);
    try { window.scrollTo(0, y); } catch (e) {}
  }

  /* Полнотекстовые совпадения догружаются после отрисовки — индекс лежит
     в отдельных сегментах и поднимается по требованию. */
  function afterSearch(q) {
    var box = $("#ftBlock");
    if (!box) return;
    if (!q || !q.trim() || !FT_META || !FT) { box.innerHTML = ""; return; }
    var p = parseQuery(q);
    if (!p.tokens.length) { box.innerHTML = ""; return; }

    var metaIds = {};
    search(q, { skipRepealed: searchOpts.skipRepealed }).forEach(function (x) { metaIds[x.a.id] = 1; });
    var stems = FT.stems(q);
    box.innerHTML = '<div class="loading" style="margin-top:20px">Ищем по полным текстам статей…</div>';

    ftSearch(q, {
      code: p.code, limit: 240, syn: p.syn, parsed: p,
      skipRepealed: searchOpts.skipRepealed
    }, function (err, list, info) {
      if (state.route.name !== "search") return;
      var b = $("#ftBlock");
      if (!b) return;
      var emptyBox = $("#metaEmpty");
      if (err) { b.innerHTML = ""; if (emptyBox) emptyBox.innerHTML = '<div class="ico">' + ic("search") + '</div><div>Ничего не найдено. Попробуйте изменить формулировку или убрать номер статьи.</div>'; return; }

      var fresh = list.filter(function (r) { return !metaIds[r.a.id]; });
      if (searchOpts.src) fresh = fresh.filter(function (r) { return r.a.c === searchOpts.src; });
      /* Исправленные опечатки показываем до списка: иначе непонятно, почему
         выдача не совпадает с тем, что человек напечатал. */
      var corr = ((info && info.corrections) || []).filter(function (c, i, arr) {
        return arr.findIndex(function (y) { return y[1] === c[1]; }) === i;
      });
      var corrHtml = corr.length
        ? '<p class="small muted" style="margin-top:18px">В запросе не нашлось слов: ' +
          corr.map(function (c) { return "«" + esc(c[0]) + "» → «" + esc(c[1]) + "»"; }).join(", ") +
          ". Поиск выполнен по исправленным словам.</p>"
        : "";
      if (!fresh.length) {
        b.innerHTML = corrHtml;
        if (emptyBox) emptyBox.innerHTML = '<div class="ico">' + ic("search") + '</div><div>' +
          (corr.length ? "По исправленным словам совпадений тоже нет. Уточните формулировку."
            : "Ничего не найдено. Попробуйте изменить формулировку или убрать номер статьи.") + "</div>";
        return;
      }
      if (emptyBox) emptyBox.remove();

      /* догружаем полные тексты, чтобы показать отрывки с подсветкой и
         проверить точные фразы по настоящему тексту, а не по основам слов */
      var need = {}, docs = [];
      fresh.slice(0, 20).forEach(function (r) { if (!need[r.a.c]) { need[r.a.c] = 1; docs.push(r.a.c); } });
      var left = docs.length;
      if (!left) { paint(); return; }
      docs.forEach(function (d) {
        loadFull(d, function () { if (--left === 0) paint(); });
      });

      function paint() {
        if (state.route.name !== "search") return;
        var rows = [], shown = 0, droppedByPhrase = 0;
        fresh.slice(0, 20).forEach(function (r) {
          var a = r.a, cc = codeById(a.c) || { short: a.c, color: "#888", branch: "" };
          var row = findFull(a.c, a.n);
          /* Точная фраза проверяется по настоящему тексту статьи: индекс
             хранит только основы слов и порядка их не знает. */
          if (row && p.phrases.length) {
            var hay = norm(row[4]);
            var miss = p.phrases.some(function (ph) { return hay.indexOf(ph) === -1; });
            if (miss) { droppedByPhrase++; return; }
          }
          shown++;
          var snip = row ? highlightStems(ftSnippet(row[4], stems), stems) : "";
          var stb = statusBadge(a.id);
          rows.push('<div class="result' + (stb ? " has-status" : "") + '" data-go="#/article/' + encodeURIComponent(a.id) + '">' +
            '<div class="result-head">' +
              '<span class="badge badge-code" style="border-color:' + cc.color + '44;color:' + cc.color + '">' + esc(cc.short) + "</span>" +
              '<span class="result-num">ст. ' + esc(a.dn) + "</span>" +
              '<span class="result-title">' + highlight(a.t, p.tokens) + "</span>" +
              stb +
              '<button class="ibtn ibtn-col' + (inCol(a.id) ? " on" : "") + '" data-col-add="' + esc(a.id) + '" ' +
                'title="' + (inCol(a.id) ? "Убрать из подборки" : "Добавить в подборку") + '">' + ic("clip") + '</button>' +
            "</div>" +
            (snip ? '<div class="result-snippet">' + snip + "</div>" : "") +
            '<div class="result-meta">' + (a.g ? "<span>" + esc(a.g) + "</span>" : "") +
              "<span>" + esc(cc.branch || "") + "</span>" + whyLine(a, p, r) + "</div>" +
            "</div>");
        });
        b.innerHTML = corrHtml + '<h2 style="margin-top:26px">Найдено в текстах статей</h2>' +
          '<p class="lead">Слова запроса встречаются внутри полного текста статьи, а не только в её названии. ' +
          "Совпадений: " + fresh.length + (fresh.length > 20 ? " — показаны первые 20" : "") +
          (droppedByPhrase ? " · по фразе отсеяно ещё " + droppedByPhrase + " при проверке полного текста" : "") +
          ".</p>" + rows.join("");
      }
    });
  }

  /* --- статья --- */

  /* Список дел: добавляет статью в выбранное дело */
  function casePicker(id) {
    if (!state.cases.length) return '<a class="btn" href="#/cases">' + ic("folder") + " Создать дело</a>";
    return '<select class="input" id="casePick" title="Добавить статью в дело" style="max-width:250px">' +
      '<option value="">В дело…</option>' +
      state.cases.map(function (c) {
        var has = caseItemIdx(c, id) !== -1;
        return '<option value="' + esc(c.id) + '"' + (has ? " disabled" : "") + ">" +
          esc(c.title) + (has ? " — уже есть" : "") + "</option>";
      }).join("") +
      "</select>";
  }

  function viewArticle(id) {
    var a = byId[id];
    if (!a) return '<div class="empty"><div class="ico">' + ic("file") + '</div><div>Статья не найдена.</div></div>';
    var c = codeById(a.c) || { short: a.c, full: a.c, color: "#888", branch: "" };
    var fav = isFav(id);
    var noteText = getNotes()[id] || "";

    var related = (byCode[a.c] || []).filter(function (x) {
      return x !== a && Math.abs((parseInt(x.n, 10) || 0) - (parseInt(a.n, 10) || 0)) <= 2;
    }).slice(0, 8);

    var head = '<div class="article-head">' +
      '<div class="article-cite">' + esc(c.full) + " · ст. " + esc(a.dn) + "</div>" +
      '<div class="article-title">' + esc(a.t) + "</div>" +
      '<div class="result-meta">' +
        '<span class="badge" style="border-color:' + c.color + '44;color:' + c.color + '">' + esc(c.short) + "</span>" +
        (a.g ? "<span>" + esc(a.g) + "</span>" : "") +
        (c.redaction ? "<span>редакция " + fmtRed(c.redaction) + "</span>" : "") +
        statusBadge(id) +
      "</div></div>";

    var lctx = linkCtx(a.id);
    var annot =
      (a.s ? '<div class="section-label">Справочное содержание</div><p>' + linkify(a.s, lctx) + "</p>" : "") +
      (a.p ? '<div class="section-label">Санкция / правовое значение</div><div class="note-box">' + linkify(a.p, lctx) + "</div>" : "") +
      (a.x ? '<div class="section-label">На что обратить внимание</div><div class="info-box">' + linkify(a.x, lctx) + "</div>" : "");
    if (a.k) {
      annot = '<div class="section-label">Ключевые слова</div><div class="chips">' +
        a.k.split(/\s+/).filter(Boolean).map(function (w) { return '<span class="badge">' + esc(w) + "</span>"; }).join("") +
        "</div>" + annot;
    }

    var actions = '<div class="actions-row">' +
      '<button class="btn btn-primary" data-copy-cite="' + esc(cite(a)) + '">Скопировать ссылку</button>' +
      '<button class="btn" data-copy-full="' + esc(id) + '">Скопировать с реквизитами</button>' +
      '<button class="btn" data-copy-gost="' + esc(id) + '">Ссылка по ГОСТ</button>' +
      '<button class="btn" data-copy-art="' + esc(id) + '">Скопировать текст</button>' +
      '<button class="btn" data-docx-art="' + esc(id) + '">Скачать .docx</button>' +
      '<button class="btn' + (inCol(id) ? " active" : "") + '" data-col-add="' + esc(id) + '">' + (inCol(id) ? ic("clip") + " В подборке" : ic("clip") + " В подборку") + "</button>" +
      '<button class="btn' + (fav ? " active" : "") + '" data-fav="' + esc(id) + '">' + (fav ? ic("star") + " В избранном" : ic("star") + " В избранное") + "</button>" +
      '<a class="btn" href="#/compare/' + encodeURIComponent(id) + '">Сравнить с другой статьёй</a>' +
      casePicker(id) +
      '<a class="btn" href="' + officialUrl(a) + '" target="_blank" rel="noopener">Официальный источник ↗</a>' +
      '<a class="btn" href="' + webUrl(a) + '" target="_blank" rel="noopener">Поиск в сети ↗</a>' +
      "</div>";

    var inCases = casesWith(id);

    return head +
      statusBox(id) +
      (annot ? '<div class="article-body"><div class="section-label">Справочная аннотация</div>' + annot + "</div>" : "") +
      '<div class="section-label" style="margin-top:22px">Официальный текст статьи</div>' +
      '<div class="article-body" id="artText"><div class="loading">Загрузка полного текста…</div></div>' +
      actions +
      '<div class="note-box" style="border-left-color:var(--accent);margin-top:20px">' +
        '<div class="section-label" style="margin-top:0">Мои заметки к статье</div>' +
        '<textarea class="textarea" id="noteArea" style="min-height:90px" placeholder="Личная заметка — видна только вам и хранится в этом браузере…">' + esc(noteText) + "</textarea>" +
        '<div class="actions-row" style="margin-top:8px">' +
          '<button class="btn btn-primary" data-note-save="' + esc(id) + '">Сохранить заметку</button>' +
          (noteText ? '<button class="btn" data-note-del="' + esc(id) + '">Удалить</button>' : "") +
          '<span class="small muted" id="noteStatus"></span>' +
        "</div></div>" +
      (inCases.length ? '<div class="small muted" style="margin-top:8px">Статья уже в делах: ' +
        inCases.map(function (cc) {
          return '<span class="chip" data-go="#/case/' + encodeURIComponent(cc.id) + '">' + ic("folder") + " " + esc(cc.title) + "</span>";
        }).join(" ") + "</div>" : "") +
      (related.length ? '<h2>Смежные статьи</h2><div class="chips">' + related.map(function (x) {
        return '<div class="chip" data-go="#/article/' + encodeURIComponent(x.id) + '">ст. ' + esc(x.dn) + " · " + esc(x.t) + "</div>";
      }).join("") + "</div>" : "") +
      '<h2>Проверить сроки</h2><div class="chips"><div class="chip" data-go="#/deadlines">Калькулятор процессуальных сроков</div>' +
      '<div class="chip" data-go="#/assistant">Разобрать в Помощнике</div></div>';
  }

  function afterArticle(id) {
    var a = byId[id];
    var box = $("#artText");
    if (!a || !box) return;

    /* выбор дела — связываем до отрисовки текста, потому что ниже есть return */
    var sel = $("#casePick");
    if (sel) sel.addEventListener("change", function () {
      var cid = sel.value;
      if (!cid) return;
      var c = caseById(cid);
      if (caseAddItem(cid, id)) toast("Добавлено в дело «" + (c ? c.title : "") + "»");
      else toast("Эта статья уже есть в деле");
      render();
    });

    if (a.note) {
      box.innerHTML = '<div class="warn-box">Полный текст этого источника не входит в открытый набор данных. ' +
        'Доступна справочная аннотация — она приведена выше. Официальный текст откройте по ссылке «Официальный источник».</div>';
      return;
    }
    if (hasFull(a.c)) { paintFull(a, box); restoreScroll(id); return; }
    loadFull(a.c, function (err) {
      if (state.route.name !== "article" || state.route.arg !== id) return;
      var b = $("#artText");
      if (!b) return;
      if (err) {
        b.innerHTML = '<div class="warn-box"><b>Не удалось загрузить полный текст.</b> ' +
          "Файл <code>data/full/" + esc(a.c) + ".js</code> не найден или заблокирован браузером. " +
          "Проверьте, что папка <code>data/full</code> находится рядом с <code>index.html</code>. " +
          "Если браузер запрещает загрузку локальных файлов, запустите приложение через локальный сервер: " +
          "<code>python -m http.server 8080</code> и откройте <code>http://localhost:8080</code>. " +
          "Справочная аннотация выше доступна в любом случае.</div>";
        return;
      }
      paintFull(a, b);
      restoreScroll(id);
    });
  }

  function paintFull(a, box) {
    var row = findFull(a.c, a.n);
    if (!row) {
      box.innerHTML = '<div class="warn-box">В загруженном тексте кодекса эта статья не найдена. Возможно, она утратила силу.</div>';
      return;
    }
    var red = row[3];
    var ctx = { doc: a.c, num: a.n };
    var html = '<div class="law-meta">' + (red ? "Редакция статьи: <b>" + fmtRed(red) + "</b> · " : "") +
      '<a href="' + officialUrl(a) + '" target="_blank" rel="noopener">официальный источник</a></div>';
    html += '<div class="law-text">' + renderLawText(row[4], ctx) + "</div>";
    html += refsBlock(row[4], ctx);
    box.innerHTML = html;
  }

  /* Ссылки на другие статьи, которые упоминает данная статья */
  function refsBlock(text, ctx) {
    if (!XREF) return "";
    var tg = XREF.targets(text, ctx);
    if (!tg.length) return "";

    var order = [], groups = {};
    tg.forEach(function (t) {
      if (!groups[t.doc]) { groups[t.doc] = []; order.push(t.doc); }
      groups[t.doc].push(t.num);
    });
    order.sort(function (x, y) {
      var a = codeById(x), b = codeById(y);
      return (a ? DOC_ORDER[x] : 9999) - (b ? DOC_ORDER[y] : 9999);
    });

    var body = order.map(function (id) {
      var c = codeById(id);
      return '<div class="refs-group"><div class="refs-doc">' + esc(c ? c.short : id) + "</div>" +
        '<div class="chips">' + groups[id].map(function (n) {
          var t = byId[id + "-" + n];
          return '<div class="chip" data-go="#/article/' + encodeURIComponent(id + "-" + n) + '"' +
            (t ? ' title="' + esc(t.t) + '"' : "") + ">ст. " + esc(n) + "</div>";
        }).join("") + "</div></div>";
    }).join("");

    var many = tg.length > 24;
    return '<details class="refs-block"' + (many ? "" : " open") + ">" +
      '<summary>' + ic("share") + ' Ссылается на ' + tg.length + " " + plural(tg.length, ["статью", "статьи", "статей"]) +
      " в " + order.length + " " + plural(order.length, ["документе", "документах", "документах"]) +
      (many ? '<span class="refs-hint">развернуть список</span>' : "") + "</summary>" +
      '<div class="refs-body">' + body + "</div></details>";
  }

  /* Оформление официального текста: номера частей, пункты, санкции, примечания,
     перекрёстные ссылки на другие статьи. */
  function renderLawText(text, ctx) {
    var lines = String(text || "").split("\n");
    var html = [];
    var para = [];
    var inNotes = false;

    function flushPara() {
      if (!para.length) return;
      var s = para.join(" ").trim();
      para = [];
      if (s) html.push('<p>' + linkify(s, ctx) + "</p>");
    }
    function emit(s) { flushPara(); html.push(s); }

    /* Примечание к редакции, конституционное разъяснение и т.п. */
    function isEditorial(l) {
      return /^\([^)]*(?:в ред\.|в редакции|ред\.|Дополнение\s+пункт\w*|Часть\s+в\s+редакции|Федеральн\w+\s+закон\w+\s+от|Статья\s+в\s+редакции|статья\s+в\s+редакции|несоответствии\s+Конституции|Конституционн\w+\s+Суд)/i.test(l);
    }

    /* Разделяет «часть N. описание деяния, - наказывается штрафом...» */
    function splitSanction(s) {
      var m = /,\s*[-–—]\s*(наказыва[ею]тс[яю])\s*([\s\S]*)/i.exec(s);
      if (!m) return [];
      var desc = s.slice(0, m.index).replace(/[\s,]+-\s*$/, "").trim();
      var sanction = (m[1] + " " + (m[2] || "")).replace(/\s+/g, " ").trim();
      return [desc, sanction];
    }

    /* Признак утраты силы / приостановления у части или пункта внутри статьи.
       Используется тот же детектор, что и при сборке данных (data/parse.js),
       чтобы интерфейс и слой статусов не расходились. */
    function partStatus(l) {
      if (!PARSE || !PARSE.detectStatus) return null;
      var s = PARSE.detectStatus(l);
      if (!s) return null;
      /* в самой статье заголовок уже помечен плашкой — повтор не нужен */
      if (/^(Статья|Ст\.)\s*\d/i.test(l)) return null;
      return s;
    }

    function partFlag(s) {
      if (!s) return "";
      var t = ST_TITLE[s.status] || "Утратила силу";
      var cls = s.status === "suspended" ? "law-part-susp" : "law-part-rep";
      return ' <span class="law-part-st ' + cls + '">' + esc(t) +
        (s.act ? ' <span class="law-part-st-act">' + esc(s.act) + "</span>" : "") + "</span>";
    }

    lines.forEach(function (raw) {
      var l = raw.trim();
      if (!l) { flushPara(); return; }

      /* Заголовок раздела примечаний */
      if (/^Примечания\s*\.$/i.test(l)) {
        emit('<h3 class="law-notes-head">' + esc(l) + "</h3>");
        inNotes = true;
        return;
      }

      if (isEditorial(l)) {
        emit('<div class="law-meta-note">' + linkify(l, ctx) + "</div>");
        return;
      }

      /* Самостоятельная санкция — отдельной строкой */
      if (/^[-–—]?\s*наказыва[ею]тс[яю]/i.test(l)) {
        var disp = l.replace(/^[-–—]\s*/, "");
        emit('<div class="law-sanction"><span class="law-sanction-mark">' + ic("scales") + '</span><span class="law-sanction-text">' +
          linkify(disp, ctx) + "</span></div>");
        return;
      }

      /* Номер части / номер примечания */
      var m = /^(\d+(?:\.\d+)?)\.\s+(.*)$/.exec(l);
      if (m) {
        var num = m[1], body = m[2];
        if (inNotes) {
          emit('<div class="law-note-item"><span class="law-note-item-num">' + esc(num) +
            '.</span><span class="law-note-item-body">' + linkify(body, ctx) + "</span></div>");
        } else {
          var ps = partStatus(body);
          if (ps) {
            emit('<div class="law-part law-part-repealed"><span class="law-part-num">' + esc(num) +
              '.</span><span class="law-part-body">' + linkify(body.replace(/\([^)]*утратил[^)]*\)/i, "").trim(), ctx) +
              partFlag(ps) + "</span></div>");
            return;
          }
          var sp = splitSanction(body);
          if (sp.length) {
            emit('<div class="law-part"><span class="law-part-num">' + esc(num) +
              '.</span><span class="law-part-body">' + linkify(sp[0], ctx) + "</span></div>");
            emit('<div class="law-sanction"><span class="law-sanction-mark">' + ic("scales") + '</span><span class="law-sanction-text">' +
              linkify(sp[1], ctx) + "</span></div>");
          } else {
            emit('<div class="law-part"><span class="law-part-num">' + esc(num) +
              '.</span><span class="law-part-body">' + linkify(body, ctx) + "</span></div>");
          }
        }
        return;
      }

      /* Буквенный пункт а), б), г)… */
      var sm = /^([а-яёa-z])\)\s+(.*)$/i.exec(l);
      if (sm) {
        var mark = sm[1], sbody = sm[2];
        var smStatus = partStatus(sbody);
        if (smStatus) {
          emit('<div class="law-subitem law-part-repealed"><span class="law-subitem-mark">' + esc(mark) +
            ')</span><span class="law-subitem-body">' +
            linkify(sbody.replace(/\([^)]*утратил[^)]*\)/i, "").trim(), ctx) + partFlag(smStatus) + "</span></div>");
          return;
        }
        var sp = splitSanction(sbody);
        if (sp.length) {
          emit('<div class="law-subitem"><span class="law-subitem-mark">' + esc(mark) +
            ')</span><span class="law-subitem-body">' + linkify(sp[0], ctx) +
            " —</span></div>");
          emit('<div class="law-sanction"><span class="law-sanction-mark">' + ic("scales") + '</span><span class="law-sanction-text">' +
            linkify(sp[1], ctx) + "</span></div>");
        } else {
          var clean = sbody.replace(/[\s,]+-\s*$/, "");
          emit('<div class="law-subitem"><span class="law-subitem-mark">' + esc(mark) +
            ')</span><span class="law-subitem-body">' + linkify(clean, ctx) + "</span></div>");
        }
        return;
      }

      para.push(l);
    });
    flushPara();

    return html.join("");
  }

  /* Только красные блоки санкций из текста статьи — для разбора ситуации */
  function sanctionBlocks(text, ctx) {
    var lines = String(text || "").split("\n");
    var out = [];
    function isEditorial(l) {
      return /^\([^)]*(?:в ред\.|в редакции|ред\.|Дополнение\s+пункт\w*|Часть\s+в\s+редакции|Федеральн\w+\s+закон\w+\s+от|Статья\s+в\s+редакции|статья\s+в\s+редакции|несоответствии\s+Конституции|Конституционн\w+\s+Суд)/i.test(l);
    }
    function node(s) {
      return '<div class="law-sanction law-san-inline"><span class="law-sanction-mark">' + ic("scales") + '</span><span class="law-sanction-text">' +
        linkify(s, ctx) + "</span></div>";
    }
    lines.forEach(function (raw) {
      var l = raw.trim();
      if (!l || isEditorial(l)) return;
      if (/^[-–—]?\s*наказыва[ею]тс[яю]/i.test(l)) {
        out.push(node(l.replace(/^[-–—]\s*/, "")));
        return;
      }
      var sp = /,\s*[-–—]\s*(наказыва[ею]тс[яю])\s*([\s\S]*)/i.exec(l);
      if (sp) out.push(node(sp[1] + " " + sp[2]));
    });
    return out.join("");
  }

  /* Контекст для связывания упоминаний статей в произвольном тексте.
     Если передан id статьи — «ст. 30» без явного указания кодекса связывается
     с тем же актом (как в аннотациях к статье). Без контекста связываются
     только упоминания с прямым указанием документа («ст. 105 УК РФ»): лучше
     не поставить ссылку, чем поставить неверную. */
  function linkCtx(id) {
    var a = id ? byId[id] : null;
    return a ? { doc: a.c, num: a.dn } : { doc: "__none__", num: "" };
  }

  /* Ссылки на пункты Пленума ВС РФ: «п. 6 постановления Пленума ВС РФ
     № 29 от 27.12.2002». Связываем только когда акт и пункт однозначно
     находятся в индексе — иначе оставляем обычным текстом. */
  var PLENUM_RE = /(?:^|\s)((?:(?:п\.|пункт)\s*)(\d+(?:\.\d+)*))\s+(?:постановления\s+)?пленума\s+вс\s+рф\s*(?:№\s*)?(\d+)(?:\s+от\s+(\d{1,2})\.(\d{1,2})\.(\d{4}))?/gi;
  function plenumLinks(s) {
    if (!byCode) return [];
    var out = [], m;
    PLENUM_RE.lastIndex = 0;
    while ((m = PLENUM_RE.exec(s))) {
      var point = m[2], num = m[3], year = m[6];
      if (!year) continue;                       /* без даты акт неоднозначен */
      var arts = byCode["plenum" + num + "-" + year];
      if (!arts) continue;
      var found = null;
      for (var i = 0; i < arts.length; i++) { if (String(arts[i].dn) === point) { found = arts[i]; break; } }
      if (!found) continue;
      var i0 = m.index + m[0].indexOf(m[1]);
      out.push({
        i: i0, len: m[1].length,
        href: "#/article/" + encodeURIComponent(found.id),
        title: "Пленум ВС РФ № " + num + " от " + m[4] + "." + m[5] + "." + m[6] + ", п. " + point,
        cls: ""
      });
    }
    return out;
  }

  /* Экранирование текста + превращение упоминаний норм в ссылки.
     ctx можно не передавать — тогда подсвечиваются только упоминания, где
     документ назван явно в тексте («ст. 105 УК РФ»). Пункты Пленумов
     связываются отдельным проходом. Лучше не поставить ссылку, чем неверную. */
  function linkify(s, ctx) {
    if (!s) return "";
    if (!ctx) ctx = { doc: "__none__", num: "" };
    var links = [];
    if (XREF) {
      XREF.scan(s, ctx).forEach(function (r) {
        var c = codeById(r.doc);
        links.push({
          i: r.i, len: r.len,
          href: "#/article/" + encodeURIComponent(r.doc + "-" + r.num),
          title: (c ? c.short : r.doc) + " ст. " + r.num,
          cls: r.doc === ctx.doc ? " xref-own" : ""
        });
      });
    }
    plenumLinks(s).forEach(function (p) { links.push(p); });
    if (!links.length) return esc(s);
    /* сортируем по позиции; более длинные — первыми при совпадении начала */
    links.sort(function (a, b) { return a.i - b.i || (b.len - a.len); });
    var out = "", pos = 0, last = -1;
    links.forEach(function (L) {
      if (L.i < last || L.i < pos) return;
      out += esc(s.slice(pos, L.i));
      out += '<a class="xref' + (L.cls || "") + '" href="' + esc(L.href) + '" title="' + esc(L.title) + '">' +
        esc(s.slice(L.i, L.i + L.len)) + "</a>";
      pos = L.i + L.len; last = L.i + L.len;
    });
    out += esc(s.slice(pos));
    return out;
  }

  /* --- кодекс --- */

  function viewCode(id) {
    var c = codeById(id);
    if (!c) return '<div class="empty"><div class="ico">' + ic("book") + '</div><div>Источник не найден.</div></div>';
    var isPl = isPlenum(c);
    /* Порядок документа, а не номеров: у постановлений номера пунктов
       повторяются в приложениях («1. Тормозные системы» рядом с «1. ОБЩИЕ
       ПОЛОЖЕНИЯ»), и сортировка по номеру перемешала бы разделы. */
    var raw = byCode[id] || [];
    var list = raw.slice().sort(cmpArticles);
    var nGroups = (function () {
      var seen = {}, n = 0;
      raw.forEach(function (a) { var k = a.g || "Без главы"; if (!seen[k]) { seen[k] = 1; n++; } });
      return n;
    })();

    var body = buildCodeBody(raw);

    return '<h1 style="color:' + c.color + '">' + esc(c.short) + "</h1>" +
      '<p class="lead">' + esc(c.full) + (c.req ? " · " + esc(c.req) : "") + "</p>" +
      '<div class="grid grid-4" style="margin-bottom:16px">' +
        stat(list.length, isPl ? "пунктов разъяснений" : "статей") +
        stat(nGroups, isPl ? "разделов" : "глав и разделов") +
        stat(c.redaction ? fmtRed(c.redaction) : "—", "дата редакции") +
        stat(esc(isPl ? (c.docstate || "Действует") : (c.branch || "—")), isPl ? "состояние" : "отрасль") +
      "</div>" +
      '<div class="actions-row" style="margin-bottom:16px">' +
        '<button class="btn" data-copy-cite="' + esc(c.full) + '">Скопировать название</button>' +
        '<button class="btn" data-go="#/diff/' + esc(id) + '">Сравнить редакции</button>' +
        (verCount(id) ? '<span class="st st-muted">сохранено версий: ' + verCount(id) + "</span>" : "") +
        (c.source_url ? '<a class="btn" href="' + esc(c.source_url) + '" target="_blank" rel="noopener">' +
          (isPl ? "Открыть на sudact.ru ↗" : "Официальный источник ↗") + "</a>" : "") +
        (isPl ? '<a class="btn" href="' + esc(plenumCatalogue()) + '" target="_blank" rel="noopener">Проверить актуальность ↗</a>'
              : '<a class="btn" href="https://www.consultant.ru/search/?q=' + encodeURIComponent(c.short) + '" target="_blank" rel="noopener">Найти в КонсультантПлюс ↗</a>') +
      "</div>" +
      (isPl ? plenumValidityBox(c) : "") +
      (c.note ? '<div class="info-box" style="margin-bottom:16px">' + esc(c.note) + "</div>" : "") +
      '<div class="card" style="padding:14px;margin-bottom:16px">' +
        '<div class="field" style="margin-bottom:0"><label>Фильтр по номеру или названию ' +
          (isPl ? "пункта" : "статьи") + "</label>" +
        '<input class="input" id="codeFilter" placeholder="например: ' +
          (isPl ? "15, кража, проникновение" : "91, обыск, срок") + '" autocomplete="off"></div>' +
        '<div class="small muted" style="margin-top:8px" id="codeFilterInfo"></div>' +
      "</div>" +
      '<div id="codeList">' + body + "</div>" +
      '<div class="disclaimer">' +
        (isPl ? "Текст постановления приведён по действующей редакции: " + fmtRed(c.redaction || c.adopted) +
          ". Постановления Пленума — акты судебного толкования: они не создают новых норм, но обязательны " +
          "для единообразного применения закона судами. " : "") +
        (c.source_url && !isPl ? "Полный текст в действующей редакции. Дата редакции кодекса: " + fmtRed(c.redaction) + ". " : "") +
        "Отдельные " + (isPl ? "пункты" : "статьи") + " могли измениться позднее — дата последней редакции указана на странице " +
          (isPl ? "пункта" : "статьи") + "." +
      "</div>";
  }

  function afterCode(id) {
    var inp = $("#codeFilter");
    if (!inp) return;
    var list = byCode[id] || [];
    var tmr = null;
    inp.addEventListener("input", function () {
      /* перерисовка списка целиком — дорогая операция; при быстром наборе
         перезапускаем её не чаще, чем раз в 120 мс */
      if (tmr) clearTimeout(tmr);
      var box = $("#codeList");
      var val = this.value;
      tmr = setTimeout(function () { applyFilter(val, box, list); }, 120);
    });
  }

  function applyFilter(raw, box, list) {
    var q = norm(raw);
    if (!box) return;
    if (!q) { box.innerHTML = buildCodeBody(list); return; }
    var hit = list.filter(function (a) {
      return a._t.indexOf(q) !== -1 || a._n.indexOf(q) !== -1 || a._g.indexOf(q) !== -1 || (a._k && a._k.indexOf(q) !== -1);
    }).sort(cmpArticles);
    box.innerHTML = hit.length
      ? '<div class="small muted" style="margin-bottom:8px">Найдено: ' + hit.length + "</div>" +
        hit.map(function (a) {
          var s = artStatus(a.id);
          return '<div class="art-row' + (s ? " art-repealed" : "") + '" data-go="#/article/' + encodeURIComponent(a.id) + '">' +
            '<span class="art-num">ст. ' + esc(a.dn) + "</span>" +
            '<span class="art-t">' + esc(a.t) + "</span>" +
            (s ? '<span class="art-st">' + esc(s.title) + "</span>" : "") + "</div>";
        }).join("")
      : '<div class="empty"><div class="ico">' + ic("search") + '</div><div>Ничего не найдено</div></div>';
    a11yNav(box);
  }

  function buildCodeBody(list) {
    var groups = [], gmap = {};
    list.forEach(function (a) {
      var key = a.g || "Без главы";
      if (!gmap[key]) { gmap[key] = { title: key, items: [] }; groups.push(gmap[key]); }
      gmap[key].items.push(a);
    });
    return groups.map(function (g, i) {
      /* внутри раздела — по номерам пунктов */
      var items = g.items.slice().sort(cmpArticles);
      return '<details class="chapter"' + (i === 0 ? " open" : "") + ">" +
        "<summary><span>" + esc(g.title) + '</span><span class="cnt">' + items.length + "</span></summary>" +
        '<div class="chapter-body">' + items.map(function (a) {
          var s = artStatus(a.id);
          return '<div class="art-row' + (s ? " art-repealed" : "") + '" data-go="#/article/' + encodeURIComponent(a.id) + '">' +
            '<span class="art-num">ст. ' + esc(a.dn) + "</span>" +
            '<span class="art-t">' + esc(a.t) + "</span>" +
            (s ? '<span class="art-st">' + esc(s.title) + "</span>" : "") +
            (ANNOT[a.id] ? '<span class="art-badge" title="есть справочная аннотация">аннотация</span>' : "") +
            "</div>";
        }).join("") + "</div></details>";
    }).join("");
  }

  /* --- помощник: разбор ситуации и правовых вопросов --- */

  /* выбранные уточнения и текущий текст — живут между перерисовками разбора */
  var asText = "", asAnswers = {};

  function viewAssistant() {
    var examples = [
      "сотрудник полиции в метро попросил показать паспорт",
      "задержали с наркотиками",
      "уволили за прогул",
      "сосед затопил квартиру",
      "остановили за рулём в нетрезвом виде",
      "нанесли побои"
    ];
    return '<h1>Помощник</h1>' +
      '<p class="lead">Опишите ситуацию или правовой вопрос своими словами — помощник определит отрасль, вероятный состав, объект и предмет, покажет квалификацию, санкцию, что нужно установить и что сделать. Затем уточнит детали вопросами. Работает локально, без передачи данных.</p>' +
      '<div class="card">' +
        '<div class="field"><label>Ситуация или вопрос</label>' +
        '<textarea class="textarea" id="asInput" placeholder="Например: задержали с наркотиками; сосед затопил квартиру; уволили за прогул"></textarea></div>' +
        '<div class="actions-row" style="margin-top:0">' +
          '<button class="btn btn-primary" id="asRun">' + ic("compass") + " Разобрать</button>" +
          '<button class="btn" id="asClear">Очистить</button>' +
        "</div>" +
        '<div class="chips" style="margin-top:12px">' +
          examples.map(function (x) {
            return '<div class="chip" data-fill="' + esc(x) + '" title="' + esc(x) + '">' +
              esc(x.length > 58 ? x.slice(0, 56) + "…" : x) + "</div>";
          }).join("") +
        "</div>" +
      "</div>" +
      '<div id="asOut"></div>';
  }

  function bindAssistant() {
    var run = $("#asRun"), input = $("#asInput"), out = $("#asOut");
    if (!run) return;
    var render = function () {
      out.innerHTML = assistantResult(input.value);
      markNav();
      enrichAssistant(out);
    };
    var analyze = function () {
      var text = (input.value || "").trim();
      if (text.length < 5) { toast("Опишите ситуацию подробнее"); return; }
      asText = text; asAnswers = {};
      render();
      var first = out.querySelector(".help-card, .result, .as-art");
      if (first && typeof first.scrollIntoView === "function") first.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };
    run.addEventListener("click", analyze);
    $("#asClear").addEventListener("click", function () {
      input.value = ""; out.innerHTML = ""; asText = ""; asAnswers = {}; input.focus();
    });
    /* уточняющие вопросы и сброс — пересобирают разбор без повторного ввода */
    out.addEventListener("click", function (e) {
      if (e.target.closest("[data-help-reset]")) { e.preventDefault(); asAnswers = {}; render(); return; }
      var opt = e.target.closest("[data-help-opt]");
      if (!opt) return;
      e.preventDefault();
      var p = opt.getAttribute("data-help-opt").split(":");
      var qid = p[0], key = p[1];
      if (asAnswers[qid] === key) delete asAnswers[qid]; else asAnswers[qid] = key;
      render();
      var q = out.querySelector('[data-help-q="' + qid + '"]');
      if (q && typeof q.scrollIntoView === "function") q.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    $$(".chip[data-fill]").forEach(function (el) {
      el.addEventListener("click", function () { input.value = el.getAttribute("data-fill"); analyze(); });
    });
    input.addEventListener("keydown", function (e) { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) analyze(); });
  }

  /* ------------------------------------------------------ памятки оперативнику */

  var SCEN_TABS = [
    { k: "scenarios", t: "Памятки", h: "#/scenarios", ico: "shield" },
    { k: "checklists", t: "Чек-листы", h: "#/checklists", ico: "checkbox" },
    { k: "templates", t: "Шаблоны", h: "#/templates", ico: "file" }
  ];

  var ANALYTICS_TABS = [
    { k: "stats", t: "Обзор", h: "#/stats", ico: "chart" },
    { k: "timeline", t: "Лента изменений", h: "#/timeline", ico: "activity" },
    { k: "graph", t: "Связи источников", h: "#/graph", ico: "share" }
  ];

  var CMP_TABS = [
    { k: "diff", t: "Редакции источника", h: "#/diff", ico: "swap" },
    { k: "compare", t: "Две статьи", h: "#/compare", ico: "columns" }
  ];

  function scenarioById(id) {
    return (REF.scenarios || []).filter(function (s) { return s.id === id; })[0] || null;
  }

  /* Текстовое представление памятки — для копирования и выгрузки */
  function scenarioText(s) {
    var out = [s.t.toUpperCase(), ""];
    if (s.when) out.push("Когда применяется: " + s.when, "");
    out.push("ПОРЯДОК ДЕЙСТВИЙ");
    (s.steps || []).forEach(function (x, i) { out.push((i + 1) + ". " + x); });
    if (s.terms && s.terms.length) {
      out.push("", "КОНТРОЛЬНЫЕ СРОКИ И ОРИЕНТИРЫ");
      s.terms.forEach(function (x) { out.push("— " + x); });
    }
    var arts = (s.articles || []).map(function (aid) { return byId[aid]; }).filter(Boolean);
    if (arts.length) {
      out.push("", "СТАТЬИ ПО СИТУАЦИИ");
      arts.forEach(function (a) { out.push("— " + citeLegal(a)); });
    }
    out.push("", "Материал носит справочный характер и не заменяет официальный текст закона.");
    return out.join("\n");
  }

  function viewScenarios() {
    var list = REF.scenarios || [];
    var groups = [], map = {};
    list.forEach(function (s) {
      var g = s.group || "Прочее";
      if (!map[g]) { map[g] = { g: g, items: [] }; groups.push(map[g]); }
      map[g].items.push(s);
    });
    return "<h1>Памятки оперативнику</h1>" +
      '<p class="lead">Готовые сценарии типовых ситуаций: последовательность действий, применимые статьи, оформляемые документы и контрольные сроки. Материал справочный — сверяйтесь с действующей редакцией законов.</p>' +
      tabStrip(SCEN_TABS, "scenarios") +
      groups.map(function (gr) {
        return "<h2>" + esc(gr.g) + "</h2>" +
          '<div class="grid grid-2">' + gr.items.map(function (s) {
            return '<div class="card scen-card" data-go="#/scenario/' + s.id + '">' +
              '<div class="scen-head"><span class="scen-ico">' + ic(s.ico) + "</span>" +
              '<div class="scen-t">' + esc(s.t) + "</div></div>" +
              '<div class="scen-when">' + esc(s.when) + "</div>" +
              '<div class="scen-foot"><span class="badge">' + (s.steps || []).length + " шагов</span>" +
              '<span class="badge">' + (s.articles || []).length + " " + plural((s.articles || []).length, ["статья", "статьи", "статей"]) + "</span>" +
              '<span class="scen-go">Открыть ' + ic("arrow") + "</span></div></div>";
          }).join("") + "</div>";
      }).join("") +
      '<div class="disclaimer"><b>Справочно.</b> Памятки не заменяют закон. Формулировки и сроки приводятся по действующей редакции; проверяйте актуальность в разделе «Проверка актуальности».</div>';
  }

  function viewScenario(id) {
    var s = scenarioById(id);
    if (!s) return "<h1>Памятка не найдена</h1>" +
      '<p class="lead">Такого сценария нет. <span class="lnk" data-go="#/scenarios">Все памятки →</span></p>';
    var arts = (s.articles || []).map(function (aid) { return byId[aid]; }).filter(Boolean);
    return '<div class="crumbs"><span class="lnk" data-go="#/scenarios">Памятки оперативнику</span></div>' +
      "<h1>" + esc(s.t) + "</h1>" +
      '<p class="lead">' + esc(s.when) + "</p>" +
      tabStrip(SCEN_TABS, "scenarios") +
      '<div class="split">' +
        "<div>" +
          '<div class="card"><div class="section-label" style="margin-top:0">Статьи по ситуации</div>' +
          '<div class="chips">' + arts.map(function (a) {
            var c = codeById(a.c) || { short: a.c, color: "#888" };
            return '<div class="chip" data-go="#/article/' + encodeURIComponent(a.id) + '">' +
              "<b>" + esc(cite(a)) + "</b> · " + esc(a.t) + "</div>";
          }).join("") + "</div>" +
          '<div class="actions-row">' +
            '<button class="btn" data-col-batch="' + esc((s.articles || []).join(",")) + '">' + ic("clip") + " Все статьи в подборку</button>" +
            '<button class="btn" data-scen-docx="' + esc(s.id) + '">' + ic("file") + " Скачать .docx</button>" +
            '<button class="btn" data-scen-copy="' + esc(s.id) + '">' + ic("file") + " Скопировать текст</button>" +
            '<button class="btn no-print" data-scen-print="' + esc(s.id) + '">' + ic("print") + " Печать</button>" +
          "</div></div>" +
        "</div>" +
        "<div>" +
          '<div class="card"><div class="section-label" style="margin-top:0">Порядок действий</div>' +
          '<ol class="steps">' + (s.steps || []).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ol></div>" +
          (s.terms && s.terms.length ? '<div class="card" style="margin-top:12px"><div class="section-label" style="margin-top:0">Контрольные сроки и ориентиры</div>' +
            '<ul class="list">' + s.terms.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>" : "") +
        "</div>" +
      "</div>" +
      '<div class="disclaimer">Материал носит справочный характер и не заменяет официальный текст закона.</div>';
  }

  /* Совпадение признака разбора с текстом ситуации — по ОСНОВАМ слов, а не по
     подстроке. Подстрочный поиск (`low.indexOf(nk)`) давал «суд» внутри
     «государственная» и «вред» внутри «вредительство» — ровно тот же дефект,
     что уже исправлен в поиске по реестру. Многословный признак («тайное
     хищение», «проверить документ») требует все свои слова: подстрока
     заставляла их совпадать буквально, и «проверил документы» не находилось.

     Два независимых способа сверки, признак считается совпавшим при любом:
       1) по основам слов — учитывает словоформы («наркотик» / «наркотики»);
       2) по началу самих слов — страхует от расхождений стеммера: он снимает
          ровно одно окончание, поэтому «избили» даёт основу «изб», а «избил» —
          «избил», и формы одного слова расходятся. Сверка «избил» ⊂ «избили»
          по началу слова это расхождение закрывает.

     Возвращает силу совпадения: 2 — все основы совпали точно, 1 — совпадение
     неполное (по началу слова), 0 — совпадения нет. */
  function trigHit(k, txtStems, txtWords) {
    var nk = norm(k);
    if (!nk) return 0;
    var parts = nk.split(" ").filter(Boolean);
    if (!parts.length) return 0;
    var need = FT ? FT.stems(nk) : parts;
    var byStem = need.length > 0 && need.every(function (st) { return stemHit(txtStems, st); });
    var byWord = !!txtWords && parts.every(function (p) {
      return txtWords.some(function (w) {
        return w === p || (p.length >= 4 && w.length >= 4 && (w.indexOf(p) === 0 || p.indexOf(w) === 0));
      });
    });
    if (!byStem && !byWord) return 0;
    var exact = byStem && need.every(function (st) { return stemExact(txtStems, st); });
    return exact ? 2 : 1;
  }

  /* Подбор блоков разбора по ключевым словам.

     Раньше блоки сортировались просто по числу совпавших слов, поэтому
     общее слово («срок», «суд») весило столько же, сколько специфичное
     («обыск», «паспорт»), и в топ-3 попадали случайные блоки.

     Теперь у каждого совпадения есть вес: он растёт с длиной слова
     (специфичностью) и получает надбавку за многословную фразу. Блок
     показывается, только если набрал «сильное» совпадение — первое ключевое
     слово блока (по соглашению самое характерное), фразу либо слово от 6 букв —
     либо два любых совпадения. Так одиночное общее слово не вытягивает блок.

     Возвращаем также сами совпавшие слова — их показываем в интерфейсе,
     чтобы было видно, почему блок выбран. */
  /* подбор правовых разборов по ключевым признакам ситуации.
     Блок проходит, если набрал два совпадения ИЛИ одно «сильное» — самое
     характерное слово разбора (первое в triggers), многословную фразу либо
     слово от 6 букв. Так одиночное общее слово блок не вытягивает, а
     характерная формулировка («проникли в гараж», «изъяли наркотики») —
     срабатывает сразу. */
  function helpScore(low) {
    var txtStems = FT ? FT.stems(low) : [];
    var txtWords = FT ? FT.tokenize(low) : [];
    var out = (REF.help || []).map(function (h) {
      var hits = [], score = 0, strong = false, anchorHit = false;
      var anchor = norm((h.triggers || [])[0] || "");
      (h.triggers || []).forEach(function (k) {
        var nk = norm(k);
        var hit = trigHit(k, txtStems, txtWords);
        if (!hit) return;
        hits.push(k);
        if (nk === anchor) anchorHit = true;
        /* вес растёт с длиной признака (специфичностью); совпадение только по
           началу слова — вдвое слабее точного */
        score += (1 + Math.min(2, Math.floor(nk.length / 5))) * (hit === 2 ? 1 : 0.5);
        if (nk === anchor || nk.indexOf(" ") !== -1 || nk.length >= 6) strong = true;
      });
      return { h: h, hits: hits, n: hits.length, score: score, strong: strong, anchorHit: anchorHit };
    })
      .filter(function (x) { return x.n >= 2 || (x.n === 1 && x.strong); })
      /* при равном весе выше тот разбор, у которого совпало ЯКОРНОЕ слово —
         по соглашению самое характерное для ситуации («вымогат», а не «угроза») */
      .sort(function (a, b) {
        return b.score - a.score || (b.anchorHit ? 1 : 0) - (a.anchorHit ? 1 : 0) ||
          b.n - a.n || a.h.id.localeCompare(b.h.id);
      });
    /* Отсечка «слабого хвоста»: показываем только разборы, сопоставимые по
       весу с лучшим. Раньше в ответ попадали блоки, зацепившиеся за одно
       общее слово, — отсюда и бралась «не по теме» информация. */
    if (!out.length) return [];
    var best = out[0].score;
    var kept = out.filter(function (x) { return x.score >= best * 0.55; }).slice(0, 2);
    /* В одном описании часто ДВЕ ситуации («остановили за рулём, потом
       досмотрели машину»), и вторая по весу проигрывает первой. Показываем её,
       если она уверенна сама по себе: два совпадения, среди них сильное —
       фраза или якорное слово разбора. Иначе про вторую ситуацию человек не
       узнает вовсе. */
    if (kept.length === 1 && out.length > 1) {
      var second = out.slice(1).filter(function (x) {
        return x.strong && x.n >= 2 && x.score >= best * 0.3;
      })[0];
      if (second) kept.push(second);
    }
    return kept;
  }

  /* развёрнутый разбор: характеристика, квалификация, уточнения, действия */
  function helpCard(x) {
    var h = x.h;
    var picked = {};
    Object.keys(asAnswers).forEach(function (qid) { picked[asAnswers[qid]] = 1; });

    var html = '<div class="card help-card">' +
      '<div class="help-head"><span class="badge help-area">' + esc(h.area) + "</span>" +
      '<span class="help-hits">совпадений: ' + x.n + "</span></div>" +
      "<h2>" + esc(h.t) + "</h2>" +
      '<p class="help-summary">Разбор охватывает юридическую характеристику состава, варианты квалификации, ' +
      'доказательства, которые предстоит получить, и порядок действий. Ссылки на нормы — по действующей редакции, ' +
      'размещённой на сайте; нажмите на упоминание статьи, чтобы открыть её полный текст.</p>';

    if (h.char && h.char.length) {
      html += '<div class="section-label">Юридическая характеристика</div><div class="help-char">' +
        h.char.map(function (row) {
          return '<div class="hc-row"><span class="hc-k">' + esc(row[0]) + '</span><span class="hc-v">' + esc(row[1]) + "</span></div>";
        }).join("") + "</div>";
    }

    if (h.qual && h.qual.length) {
      html += '<div class="section-label">Возможная квалификация</div><div class="help-qual">' +
        h.qual.map(function (q) {
          var base = !q.need || !q.need.length;
          var on = !base && q.need.every(function (k) { return picked[k]; });
          return '<div class="hq-row' + (base ? " base" : "") + (on ? " on" : "") + '">' +
            '<span class="hq-dot"></span><span class="hq-t">' + esc(q.t) + "</span>" +
            (on ? '<span class="hq-tag">по вашим ответам</span>' : "") + "</div>";
        }).join("") + "</div>";
    }

    if (h.qs && h.qs.length) {
      html += '<div class="section-label">Уточните — разбор пересчитается</div><div class="help-qs">' +
        h.qs.map(function (q) {
          return '<div class="help-q" data-help-q="' + esc(q.id) + '"><div class="hq-q">' + esc(q.q) + "</div>" +
            '<div class="chips">' + q.opts.map(function (o) {
              var on = asAnswers[q.id] === o.k;
              return '<button type="button" class="chip help-opt' + (on ? " on" : "") + '" data-help-opt="' +
                esc(q.id + ":" + o.k) + '">' + (on ? ic("check") : "") + esc(o.v) + "</button>";
            }).join("") + "</div></div>";
        }).join("") + "</div>";
    }

    if (h.prove && h.prove.length) {
      html += '<div class="section-label">Что нужно установить (доказать)</div><ul class="list">' +
        h.prove.map(function (s) { return "<li>" + linkify(s) + "</li>"; }).join("") + "</ul>";
    }

    if (h.steps && h.steps.length) {
      html += '<div class="section-label">Что сделать</div><ol class="steps">' +
        h.steps.map(function (s) { return "<li>" + linkify(s) + "</li>"; }).join("") + "</ol>";
    }

    var arts = (h.articles || []).map(function (id) { return byId[id]; }).filter(Boolean);
    var artIds = arts.map(function (a) { return a.id; });
    if (arts.length) {
      html += '<div class="section-label">Статьи и нормы</div><div class="chips">' + arts.map(function (a) {
        var c = codeById(a.c) || { short: a.c };
        return '<div class="chip" data-go="#/article/' + encodeURIComponent(a.id) + '"><b>' + esc(cite(a)) + "</b> · " + esc(a.t) + "</div>";
      }).join("") + "</div>";
      /* источники, по которым построен разбор, с датой действующей редакции —
         чтобы было видно, что ссылки взяты из данных сайта, а не по памяти */
      var srcSeen = {}, srcList = [];
      arts.forEach(function (a) {
        if (srcSeen[a.c]) return; srcSeen[a.c] = 1;
        var c = codeById(a.c); if (c) srcList.push(c);
      });
      html += '<div class="help-src"><span class="section-label">Источники (редакции, размещённые на сайте)</span>' +
        '<div class="chips">' + srcList.map(function (c) {
          return '<div class="chip" data-go="#/code/' + c.id + '">' + esc(c.short) +
            (c.redaction ? " · ред. от " + fmtRed(c.redaction) : "") + "</div>";
        }).join("") + "</div></div>";
    }

    if (h.notes && h.notes.length) {
      html += '<div class="section-label">Правовые позиции и нюансы</div>' +
        h.notes.map(function (s) { return '<div class="help-note">' + linkify(s) + "</div>"; }).join("");
    }

    html += '<div class="actions-row">' +
      '<button class="btn" data-col-batch="' + esc(artIds.join(",")) + '">' + ic("clip") + " Все нормы в подборку</button>" +
      '<button class="btn" data-help-reset="1">Сбросить уточнения</button>' +
      "</div>";

    return html + "</div>";
  }

  function assistantScore(low) {
    var txtStems = FT ? FT.stems(low) : [];
    var txtWords = FT ? FT.tokenize(low) : [];
    var out = (REF.intents || []).map(function (it) {
      var kws = it.keywords || [];
      var primary = kws.length ? norm(kws[0]) : "";
      var hits = [], score = 0, strong = false, anchorHit = false;
      kws.forEach(function (k) {
        var nk = norm(k);
        var hit = trigHit(k, txtStems, txtWords);
        if (!hit) return;
        hits.push(k);
        if (nk === primary) anchorHit = true;
        var phrase = nk.indexOf(" ") !== -1;
        score += (1 + Math.min(2, Math.floor(nk.length / 5)) + (phrase ? 2 : 0)) * (hit === 2 ? 1 : 0.5);
        if (nk === primary || phrase || nk.length >= 6) strong = true;
      });
      return { it: it, hits: hits, n: hits.length, score: score, strong: strong, anchorHit: anchorHit };
    })
      .filter(function (x) { return x.n > 0 && (x.strong || x.n >= 2); })
      .sort(function (a, b) {
        return b.score - a.score || (b.anchorHit ? 1 : 0) - (a.anchorHit ? 1 : 0) ||
          b.n - a.n || a.it.id.localeCompare(b.it.id);
      });
    /* та же отсечка, что и у разборов: только правила, близкие к лучшему */
    if (!out.length) return [];
    var best = out[0].score;
    return out.filter(function (x) { return x.score >= best * 0.55; }).slice(0, 3);
  }

  /* Насколько уверенно распознана ситуация. Раньше ответ выглядел одинаково
     твёрдо и когда разбор совпал по трём характерным признакам, и когда движок
     зацепился за одно общее слово. Для юридического ответа это принципиально:
     человек должен видеть, где кончается разбор и начинается догадка. */
  function assistantConfidence(help, scored) {
    if (!help.length && !scored.length) {
      return { level: "нет", label: "не определена", cls: "none", pct: 0,
        reason: "Ни один разбор и ни одно правило не совпали с описанием." };
    }
    var top = help[0] || null, second = help[1] || null;
    if (top) {
      var margin = second ? top.score / Math.max(1, second.score) : 2;
      var level = (top.n >= 3 && top.strong && margin >= 1.3) ? "высокая"
        : (top.strong || top.n >= 2) ? "средняя" : "низкая";
      return { level: level, label: level, cls: level === "высокая" ? "high" : level === "средняя" ? "mid" : "low",
        pct: level === "высокая" ? 90 : level === "средняя" ? 70 : 45,
        reason: "Ситуация сопоставлена с разбором «" + top.h.t + "» по " + top.n + " " +
          plural(top.n, ["признаку", "признакам", "признакам"]) +
          (second ? ", следующий разбор заметно слабее" : ", конкурирующих разборов нет") + "." };
    }
    var it = scored[0];
    return { level: "низкая", label: "низкая", cls: "low", pct: 35,
      reason: "Прямого разбора под описание нет — ответ опирается на правило «" + it.it.t +
        "» по " + it.n + " " + plural(it.n, ["совпадению", "совпадениям", "совпадениям"]) +
        ". Проверьте применимость норм к вашей ситуации." };
  }

  /* Один расчёт на весь ответ: и разборы, и правила, и уверенность. Раньше
     helpScore и assistantScore вызывались порознь в разных местах, и добавить
     к ним оценку уверенности было некуда. */
  function assistantFound(text) {
    var low = norm(text);
    var help = helpScore(low);
    var helpIds = {};
    help.forEach(function (x) { helpIds[x.h.id] = 1; });
    var scored = assistantScore(low).filter(function (x) { return !helpIds[x.it.id]; });
    return { low: low, help: help, scored: scored, confidence: assistantConfidence(help, scored) };
  }

  /* Дословная цитата из текста нормы — предложение, где плотнее всего слова
     запроса. Вывод не должен выглядеть как пересказ «по памяти»: рядом с
     нормой показываем её собственный текст и подписываем, что это цитата. */
  function normQuote(text, stems, maxLen) {
    maxLen = maxLen || 320;
    if (!text || !stems || !stems.length || !FT) return "";
    var re = /[^.!?;]+[.!?;]+/g, m, best = "", bestScore = -1;
    while ((m = re.exec(text)) !== null) {
      var s = m[0].replace(/\s+/g, " ").trim();
      if (s.length < 25) continue;
      var st = FT.stems(s), hit = 0;
      for (var i = 0; i < st.length; i++) if (stems.indexOf(st[i]) !== -1) hit++;
      if (!hit) continue;
      /* при равной плотности берём предложение короче: оно точнее по смыслу */
      var sc = hit * 1000 - s.length;
      if (sc > bestScore) { bestScore = sc; best = s; }
    }
    if (!best) return "";
    if (best.length > maxLen) best = best.slice(0, maxLen).replace(/\s+\S*$/, "") + "…";
    return best;
  }

  /* Основной блок ответа. Разбор ситуации (REF.help) богаче — в нём есть
     юридическая характеристика и уточняющие вопросы, — поэтому при близких
     весах выигрывает он. Но если правило совпало заметно сильнее, основным
     становится оно: «задержали на 3 часа, составили административный
     протокол» — это административное задержание, а не задержание
     подозреваемого по ст. 91 УПК РФ. */
  function assistantPrimary(help, scored) {
    var prim = help.length ? { kind: "help", x: help[0] } : null;
    if (scored.length && (!prim || scored[0].score > prim.x.score * 1.25)) {
      prim = { kind: "intent", x: scored[0] };
    }
    return prim;
  }

  /* «Вывод по запросу» — профессиональная сводка ответа в начале разбора:
     отрасль, вероятная квалификация, нормы для проверки (кликабельные) и что
     установить. Собирается только из данных сайта и идёт первым, чтобы ответ
     читался с вывода. Заголовок намеренно не <h2>: первый h2 остаётся за
     самим развёрнутым разбором. */
  function conclusionBox(help, scored, res, conf, qStems) {
    var picked = {};
    Object.keys(asAnswers).forEach(function (q) { picked[asAnswers[q]] = 1; });
    var hasPicked = Object.keys(picked).length > 0;

    var area = "", qualText = "", arts = [], prove = [], acts = [], primKind = "";

    var prim = assistantPrimary(help, scored);

    if (prim && prim.kind === "help") {
      var h = prim.x.h;
      primKind = "help";
      area = h.area;
      var quals = h.qual || [], chosen = null;
      /* сначала — подтверждённая ответами на уточняющие вопросы, затем базовая */
      quals.forEach(function (q) {
        if (chosen) return;
        if (!q.need || !q.need.length) { chosen = q; return; }
        if (q.need.every(function (k) { return picked[k]; })) chosen = q;
      });
      if (!chosen && quals.length) chosen = quals[0];
      if (chosen) qualText = chosen.t;
      arts = (h.articles || []).map(function (id) { return byId[id]; }).filter(Boolean).slice(0, 5);
      prove = (h.prove || []).slice(0, 3);
    } else if (prim) {
      var it = prim.x.it;
      primKind = "intent";
      area = it.area || "";
      qualText = it.t;
      arts = (it.articles || []).map(function (id) { return byId[id]; }).filter(Boolean).slice(0, 5);
      acts = (it.actions || []).slice(0, 3);
    }

    /* вводная фраза — профессионально и понятно */
    var lead;
    if (primKind === "help") {
      lead = "По описанию ситуация относится к отрасли «" + area + "». " +
        (hasPicked ? "С учётом ваших уточнений " : "") +
        "наиболее вероятна квалификация по " +
        (qualText ? "«" + qualText + "»" : "соответствующей норме") +
        ". Ниже — развёрнутый разбор: юридическая характеристика, варианты квалификации, " +
        "что нужно установить и что сделать, а также нормы, на которые опирается вывод.";
      /* В одном описании часто две ситуации («остановили за рулём, потом
         досмотр машины»). Говорим об этом прямо, а не молча показываем
         вторую карточку ниже. Отрасли разные — значит это действительно две
         самостоятельные ситуации; одна отрасль — два близких разбора. */
      if (help.length > 1) {
        var sameArea = help[0].h.area === help[1].h.area;
        lead += (sameArea
          ? " В описании просматриваются два близких разбора — «" + help[0].h.t + "» и «" + help[1].h.t +
            "»; сверьте, какой из них соответствует вашей ситуации."
          : " В описании просматриваются две самостоятельные ситуации — «" + help[0].h.t +
            "» и «" + help[1].h.t + "»; обе разобраны ниже, каждую проверяйте по своим нормам.");
      }
    } else if (primKind === "intent") {
      lead = help.length
        ? "Основной блок под это описание — правило «" + qualText + "»" +
          (area ? " (отрасль «" + area + "»)" : "") +
          ": оно совпало с текстом заметно сильнее разбора ситуации. Разбор «" + help[0].h.t +
          "» приведён ниже как дополнительный — сверьте, какая из двух ситуаций ваша."
        : "Прямого разбора под это описание нет. Ближайший по смыслу блок — «" + qualText +
          "»" + (area ? " (отрасль «" + area + "»)" : "") +
          ". Проверьте указанные нормы и порядок действий; при необходимости уточните описание — " +
          "разбор пересчитается.";
    } else {
      lead = "По ключевым словам однозначно определить тип ситуации не удалось." +
        (res.length ? " Ниже — нормы, наиболее близкие к тексту запроса." : "") +
        " Чтобы дать обоснованный вывод, уточните описание: кто участвовал, что именно произошло, " +
        "какие наступили последствия и какой орган принял решение.";
    }
    /* При слабом совпадении честно предупреждаем: иначе ответ читается как
       заключение, хотя собран по одному общему слову. */
    if (conf && (conf.cls === "low" || conf.cls === "none")) {
      lead += " Разбор предварительный: ключевые признаки совпали слабо, поэтому вывод может быть неточным.";
    }

    var rows = [];
    if (area) rows.push(["Отрасль права", esc(area)]);
    if (qualText) rows.push([hasPicked ? "Квалификация (с учётом ответов)" : "Вероятная квалификация", esc(qualText)]);
    if (conf) {
      rows.push(["Надёжность вывода",
        '<span class="conf conf-' + esc(conf.cls) + '">' + esc(conf.label) + "</span>" +
        '<span class="conf-why">' + esc(conf.reason) + "</span>"]);
    }
    if (arts.length) {
      rows.push(["Нормы для проверки", '<div class="chips">' + arts.map(function (a) {
        return '<div class="chip" data-go="#/article/' + encodeURIComponent(a.id) + '"><b>' + esc(cite(a)) + "</b> · " + esc(a.t) + "</div>";
      }).join("") + "</div>"]);
      /* Дословные цитаты подгружает enrichAssistant из полного текста статьи:
         вывод должен опираться на текст нормы, а не на пересказ «по памяти». */
      if (qStems && qStems.length) {
        rows.push(["Из текста нормы", arts.slice(0, 2).map(function (a) {
          return '<div class="concl-quote" data-quote="' + esc(a.id) + '" data-q="' + esc(qStems.join(" ")) + '">' +
            '<span class="muted small">загрузка текста статьи…</span></div>';
        }).join("")]);
      }
    }
    if (prove.length) rows.push(["Что установить (доказать)", "<ul class=\"list\">" + prove.map(function (s) { return "<li>" + linkify(s) + "</li>"; }).join("") + "</ul>"]);
    if (acts.length) rows.push(["Что сделать", "<ol class=\"steps\">" + acts.map(function (s) { return "<li>" + linkify(s) + "</li>"; }).join("") + "</ol>"]);

    return '<div class="card concl">' +
      '<div class="concl-head">' + ic("check") + "Вывод по запросу</div>" +
      '<p class="concl-p">' + esc(lead) + "</p>" +
      (rows.length ? '<div class="concl-rows">' + rows.map(function (r) {
        return '<div class="concl-row"><div class="concl-k">' + r[0] + "</div>" +
          '<div class="concl-v">' + r[1] + "</div></div>";
      }).join("") + "</div>" : "") +
      '<div class="concl-foot">Вывод предварительный: он собран по ключевым словам описания и данным сайта ' +
      "(действующие редакции кодексов, законов и постановлений). " +
      "Итоговая квалификация и объём процессуальных действий определяются по материалам дела уполномоченным должностным лицом.</div>" +
      "</div>";
  }

  function assistantResult(text) {
    var f = assistantFound(text);
    var low = f.low, help = f.help, scored = f.scored;

    /* Нормы, близкие к запросу. Ищем не по всему тексту ситуации — в нём много
       «шумовых» слов («объект», «собственность»), из-за которых в ответ
       попадали, например, статьи Земельного кодекса, — а по тем ключевым
       словам, которые действительно сработали в разборе. */
    var hitWords = [];
    help.forEach(function (x) { hitWords = hitWords.concat(x.hits); });
    scored.forEach(function (x) { hitWords = hitWords.concat(x.hits); });
    var res = search(hitWords.length ? hitWords.join(" ") : text, { need: 1, cut: 0.5 }).slice(0, 5);

    /* Основы для дословных цитат: цитируем текст нормы по тем словам, которые
       действительно сработали в разборе, а не по всему описанию. */
    var qStems = FT ? FT.stems((hitWords.length ? hitWords.join(" ") : low)) : [];
    var html = conclusionBox(help, scored, res, f.confidence, qStems);

    if (help.length) {
      html += '<div class="ground-box"><span class="ico">' + ic("shield") + "</span>" +
        "<div>Разбор построен <b>только по текстам, размещённым на сайте</b> — действующие редакции кодексов, федеральных законов и постановлений. " +
        "Все ссылки открываются на статью с указанием источника и даты редакции. " +
        "Проверяйте реквизиты и дату редакции перед применением.</div></div>";
      html += help.map(helpCard).join("");
    }

    if (!scored.length) {
      if (!help.length) {
        html += '<div class="warn-box">Точный тип ситуации по ключевым словам не определён. Ниже — нормы, наиболее близкие к тексту описания.</div>';
      }
    } else {
      scored.forEach(function (x) {
        var it = x.it;
        html += '<div class="card" style="margin-top:18px">' +
          '<div class="badge" style="margin-bottom:8px">вероятный блок · совпадений: ' + x.n + "</div>" +
          '<h2 style="margin-top:0">' + esc(it.t) + "</h2>" +
          '<div class="small muted" style="margin:-4px 0 10px">Совпало: ' +
            x.hits.map(function (k) { return esc(k); }).join(", ") + "</div>" +
          '<div class="section-label">Статьи для проверки</div>' +
          '<div class="chips">' + it.articles.map(function (aid) {
            var a = byId[aid];
            if (!a) return "";
            return '<div class="chip" data-go="#/article/' + encodeURIComponent(a.id) + '"><b>' + esc(cite(a)) + "</b> · " + esc(a.t) + "</div>";
          }).join("") + "</div>" +
          (it.actions && it.actions.length ? '<div class="section-label">Что нужно сделать</div><ol class="steps">' + it.actions.map(function (s) { return "<li>" + linkify(s) + "</li>"; }).join("") + "</ol>" : "") +
          (it.terms && it.terms.length ? '<div class="section-label">Контрольные сроки</div><div class="chips">' + it.terms.map(function (s) { return '<span class="badge">' + esc(s) + "</span>"; }).join("") + "</div>" : "") +
          '<div class="actions-row">' +
            '<button class="btn" data-col-batch="' + esc(it.articles.join(",")) + '">' + ic("clip") + " Все статьи блока в подборку</button>" +
            (it.checklist ? '<div class="btn btn-sm" data-go="#/checklist/' + it.checklist + '">Открыть чек-лист →</div>' : "") +
          "</div>" +
          "</div>";
      });
    }

    /* уникальные статьи для показа санкций: приоритет составам УК/КоАП.
       Сначала — нормы правовых разборов (это ядро ответа), затем блоки правил
       и результаты поиска по тексту запроса. */
    var seen = {}, keyIds = [];
    function addKey(id) {
      var a = byId[id];
      if (!a || seen[id]) return;
      seen[id] = 1;
      var pri = (a.c === "uk" || a.c === "koap") ? 0 : 1;
      keyIds.push({ a: a, pri: pri });
    }
    help.forEach(function (x) { (x.h.articles || []).forEach(addKey); });
    scored.slice(0, 2).forEach(function (x) { (x.it.articles || []).forEach(addKey); });
    /* статьи из «шумного» поиска по описанию берём в санкции только тогда,
       когда разбор не распознан и этот список — единственный содержательный */
    if (!help.length && !scored.length) res.forEach(function (x) { addKey(x.a.id); });
    keyIds.sort(function (p, q) { return p.pri - q.pri; });
    var keyArts = keyIds.slice(0, 8).map(function (x) { return x.a; });

    /* Список «близких норм» показываем ТОЛЬКО когда разбор не распознан: если
       разбор найден, он сам перечисляет нужные нормы, а дополнительный список
       по словам описания тянул статьи соседних отраслей (Жилищный кодекс на
       слово «кооператив», закон об ипотеке на слово «квартира») — это и была
       «лишняя, не по теме» информация. */
    if (res.length && !help.length && !scored.length) {
      html += '<h2>Нормы, наиболее близкие к запросу</h2>' +
        '<div class="small muted" style="margin:-6px 0 12px">Отобраны по словам описания — проверьте применимость к вашей ситуации.</div>' +
        res.map(function (x) {
        var a = x.a, c = codeById(a.c) || { short: a.c, color: "#888" };
        return '<div class="result" data-go="#/article/' + encodeURIComponent(a.id) + '">' +
          '<div class="result-head"><span class="badge badge-code" style="border-color:' + c.color + '44;color:' + c.color + '">' + esc(c.short) + '</span>' +
          '<span class="result-num">ст. ' + esc(a.dn) + '</span><span class="result-title">' + esc(a.t) + "</span>" +
          '<button class="ibtn ibtn-col' + (inCol(a.id) ? " on" : "") + '" data-col-add="' + esc(a.id) + '" ' +
            'title="' + (inCol(a.id) ? "Убрать из подборку" : "Добавить в подборку") + '">' + ic("clip") + '</button></div>' +
          (a.s ? '<div class="result-snippet">' + esc(snippet(a.s, [], 170)) + "</div>" : "") +
          '<div class="as-san-body" data-as-san="' + esc(a.id) + '" data-c="' + esc(a.c) + '" data-n="' + esc(a.n) + '">' +
            '<span class="muted small">загрузка санкций…</span></div>' +
          "</div>";
      }).join("");
    }

    if (keyArts.length) {
      html += '<h2>Санкции по подобранным составам</h2>' +
        '<div class="small muted" style="margin:-6px 0 12px">Красным — санкции из действующей редакции. Загружаются из полных текстов статей.</div>' +
        keyArts.map(function (a) {
          var c = codeById(a.c) || { short: a.c, color: "#888" };
          return '<div class="as-art">' +
            '<div class="as-art-head"><span class="badge badge-code" style="border-color:' + c.color + '44;color:' + c.color + '">' + esc(c.short) + '</span>' +
            '<a class="as-art-title" href="#/article/' + encodeURIComponent(a.id) + '">ст. ' + esc(a.dn) + " · " + esc(a.t) + "</a></div>" +
            '<div class="as-san-body" data-as-san="' + esc(a.id) + '" data-c="' + esc(a.c) + '" data-n="' + esc(a.n) + '">' +
              '<span class="muted small">загрузка санкций…</span></div>' +
            "</div>";
        }).join("");
    }

    html += '<div class="disclaimer"><b>Важно.</b> Подбор норм выполняется по ключевым словам автоматически и носит ориентировочный характер. Итоговая квалификация и объём процессуальных действий определяются по материалам дела. Решение принимает уполномоченное должностное лицо.</div>';
    return html;
  }

  /* Подгружает полные тексты и вписывает красные блоки санкций в плейсхолдеры */
  function enrichAssistant(root) {
    /* дословные цитаты в выводе: текст нормы берём из источника, а не из
       аннотации; если предложение не нашлось, блок просто исчезает */
    root.querySelectorAll(".concl-quote[data-quote]").forEach(function (el) {
      var id = el.getAttribute("data-quote");
      var a = byId[id];
      if (!a) { el.remove(); return; }
      var stems = (el.getAttribute("data-q") || "").split(" ").filter(Boolean);
      loadFull(a.c, function (err) {
        if (err) { el.remove(); return; }
        var F = findFull(a.c, a.n);
        var q = F ? normQuote(F[4], stems) : "";
        if (!q) { el.remove(); return; }
        el.innerHTML = '<div class="cq-lbl">' + esc(cite(a)) + " — дословно из текста статьи</div>" +
          '<blockquote class="cq-t">' + esc(q) + "</blockquote>";
      });
    });
    var ph = root.querySelectorAll(".as-san-body[data-as-san]");
    ph.forEach(function (el) {
      var id = el.getAttribute("data-as-san");
      var c = el.getAttribute("data-c"), n = el.getAttribute("data-n");
      loadFull(c, function (err) {
        if (err) { el.innerHTML = '<span class="muted small">текст недоступен</span>'; return; }
        var F = findFull(c, n);
        if (!F) { el.innerHTML = '<span class="muted small">текст недоступен</span>'; return; }
        var sb = sanctionBlocks(F[4], { doc: c, num: n });
        el.innerHTML = sb || '<span class="muted small">санкция не выделена отдельно</span>';
      });
    });
  }

  /* --- сроки --- */

  /* ==================================================================== */
  /*  Калькуляторы                                                         */
  /*                                                                       */
  /*  Все коэффициенты, ставки и длительности ниже выписаны из текстов,     */
  /*  которые лежат в базе, а не по памяти. Рядом с каждым результатом      */
  /*  выводится основание с датой редакции статьи — цифру можно проверить   */
  /*  по первоисточнику в один клик.                                        */
  /* ==================================================================== */

  var CALC_TABS = [
    { k: "base",    t: "Процессуальные сроки", h: "#/calc",         ico: "clock" },
    { k: "limit",   t: "Давность и зачёт",     h: "#/calc/limit",   ico: "ban" },
    { k: "money",   t: "Пошлины и проценты",   h: "#/calc/money",   ico: "scales" },
    { k: "custody", t: "Под стражей",          h: "#/calc/custody", ico: "lock" },
    { k: "simple",  t: "Калькулятор",          h: "#/calc/simple",  ico: "calculator" }
  ];

  /* Контрольные точки от момента задержания. h — часы, m — месяцы. */
  var CALC_CUSTODY = [
    { t: "Телефонный разговор задержанного, уведомление близких родственников", h: 3,
      b: "ч. 1 ст. 96 УПК РФ", n: "срок считается с момента доставления, а не задержания" },
    { t: "Уведомление иных лиц о задержании", h: 12, b: "ч. 1 ст. 96 УПК РФ" },
    { t: "Материалы об избрании меры пресечения должны быть у судьи", h: 40,
      b: "ч. 3 ст. 108 УПК РФ", n: "не позднее чем за 8 часов до истечения срока задержания" },
    { t: "Предельный срок задержания без суда", h: 48,
      b: "ч. 2 ст. 94 УПК РФ, ст. 22 Конституции РФ" },
    { t: "Предел продления задержания судом", h: 72, b: "ч. 7 ст. 108 УПК РФ" },
    { t: "Срок домашнего ареста без продления", m: 2, b: "ч. 2 ст. 107 УПК РФ" },
    { t: "Срок содержания под стражей без продления", m: 2, b: "ч. 1 ст. 109 УПК РФ" },
    { t: "Продление стражи — общий предел", m: 6, b: "ч. 2 ст. 109 УПК РФ" },
    { t: "Продление стражи по тяжким и особо тяжким делам", m: 12, b: "ч. 2 ст. 109 УПК РФ" },
    { t: "Продление стражи — исключительный случай", m: 18, b: "ч. 3 ст. 109 УПК РФ" }
  ];

  /* Контрольные точки от даты возбуждения дела / события. */
  var CALC_CASE = [
    { t: "Проверка сообщения о преступлении", d: 3, b: "ч. 1 ст. 144 УПК РФ",
      n: "продлевается руководителем следственного органа до 10 суток, при документальных проверках и ревизиях — до 30 суток (ч. 3 ст. 144)" },
    { t: "Предварительное следствие", m: 2, b: "ч. 1 ст. 162 УПК РФ" },
    { t: "Продление предварительного следствия", m: 3, b: "ч. 4 ст. 162 УПК РФ" },
    { t: "Продление следствия по особо сложным делам", m: 12, b: "ч. 5 ст. 162 УПК РФ" },
    { t: "Дознание", d: 30, b: "ч. 3 ст. 223 УПК РФ",
      n: "продлевается прокурором, в отдельных случаях — до 6 и до 12 месяцев (ч. 4, 5 ст. 223)" },
    { t: "Дознание в сокращённой форме", d: 15, b: "ч. 1 ст. 226.6 УПК РФ" },
    { t: "Обжалование постановления по делу об административном правонарушении", d: 10,
      b: "ч. 1 ст. 30.3 КоАП РФ", n: "по делам о нарушениях на выборах — 5 дней (ч. 3 ст. 30.3)" },
    { t: "Уплата административного штрафа", d: 60, b: "ч. 1 ст. 32.2 КоАП РФ" },
    { t: "Апелляционная жалоба по уголовному делу", d: 15, b: "ч. 1 ст. 389.4 УПК РФ" },
    { t: "Апелляционная жалоба по гражданскому делу", m: 1, b: "ч. 1 ст. 321 ГПК РФ" },
    { t: "Апелляционная жалоба по административному делу", m: 1, b: "ч. 1 ст. 298 КАС РФ" },
    { t: "Апелляционная жалоба в арбитражном процессе", m: 1, b: "ч. 1 ст. 259 АПК РФ" }
  ];

  /* Зачёт содержания под стражей — ч. 3, 3.1, 3.4 ст. 72 УК РФ.
     k — сколько дней срока наказания даёт один день под стражей. */
  var CALC_SETOFF = [
    { k: "prison", t: "Тюрьма, ИК строгого или особого режима", r: 1,
      b: "подп. «а» ч. 3.1 ст. 72 УК РФ" },
    { k: "general", t: "ИК общего режима, воспитательная колония", r: 1.5,
      b: "подп. «б» ч. 3.1 ст. 72 УК РФ" },
    { k: "settle", t: "Колония-поселение", r: 2, b: "подп. «в» ч. 3.1 ст. 72 УК РФ" },
    { k: "restrict", t: "Ограничение свободы, принудительные работы, арест", r: 2,
      b: "ч. 3 ст. 72 УК РФ" },
    { k: "disc", t: "Дисциплинарная воинская часть", r: 1.5, b: "ч. 3 ст. 72 УК РФ" },
    { k: "correct", t: "Исправительные работы, ограничение по военной службе", r: 3,
      b: "ч. 3 ст. 72 УК РФ" },
    { k: "oblig", t: "Обязательные работы", r: 0,
      b: "ч. 3 ст. 72 УК РФ", n: "один день под стражей = 8 часов обязательных работ" }
  ];

  /* Госпошлина по имущественному иску — подп. 1 п. 1 ст. 333.19 НК РФ
     (в редакции Федерального закона от 08.08.2024 № 259-ФЗ).
     up — верхняя граница цены иска, base — фиксированная часть,
     pct — процент с суммы сверх from. */
  var CALC_DUTY_TIERS = [
    { up: 100000,    base: 4000,   pct: 0,    from: 0 },
    { up: 300000,    base: 4000,   pct: 3,    from: 100000 },
    { up: 500000,    base: 10000,  pct: 2.5,  from: 300000 },
    { up: 1000000,   base: 15000,  pct: 2,    from: 500000 },
    { up: 3000000,   base: 25000,  pct: 1,    from: 1000000 },
    { up: 8000000,   base: 45000,  pct: 0.7,  from: 3000000 },
    { up: 24000000,  base: 80000,  pct: 0.35, from: 8000000 },
    { up: 50000000,  base: 136000, pct: 0.3,  from: 24000000 },
    { up: 100000000, base: 214000, pct: 0.2,  from: 50000000 },
    { up: Infinity,  base: 314000, pct: 0.15, from: 100000000, cap: 900000 }
  ];

  /* Фиксированные размеры госпошлины — п. 1 ст. 333.19 НК РФ. */
  var CALC_DUTY_FIXED = [
    { k: "nonprop-fl", t: "Иск неимущественного характера, не подлежащий оценке — физлицо", v: 3000,
      b: "подп. 3 п. 1 ст. 333.19 НК РФ" },
    { k: "nonprop-org", t: "Иск неимущественного характера, не подлежащий оценке — организация", v: 20000,
      b: "подп. 3 п. 1 ст. 333.19 НК РФ" },
    { k: "divorce", t: "Расторжение брака", v: 5000, b: "подп. 5 п. 1 ст. 333.19 НК РФ" },
    { k: "npa-fl", t: "Оспаривание нормативного правового акта — физлицо", v: 4000,
      b: "подп. 6 п. 1 ст. 333.19 НК РФ" },
    { k: "npa-org", t: "Оспаривание нормативного правового акта — организация", v: 20000,
      b: "подп. 6 п. 1 ст. 333.19 НК РФ" },
    { k: "act-fl", t: "Оспаривание ненормативного акта, решений и действий органов — физлицо", v: 3000,
      b: "подп. 7 п. 1 ст. 333.19 НК РФ" },
    { k: "act-org", t: "Оспаривание ненормативного акта, решений и действий органов — организация", v: 15000,
      b: "подп. 7 п. 1 ст. 333.19 НК РФ" },
    { k: "special", t: "Заявление по делу особого производства", v: 3000,
      b: "подп. 8 п. 1 ст. 333.19 НК РФ" },
    { k: "review", t: "Пересмотр по новым или вновь открывшимся обстоятельствам", v: 10000,
      b: "подп. 14 п. 1 ст. 333.19 НК РФ" },
    { k: "injunction", t: "Заявление об обеспечении иска", v: 10000,
      b: "подп. 15 п. 1 ст. 333.19 НК РФ" }
  ];

  /* Давность привлечения к уголовной ответственности — ч. 1 ст. 78 УК РФ. */
  var CALC_LIMIT_UK = [
    { k: "small", t: "Преступление небольшой тяжести", y: 2, b: "п. «а» ч. 1 ст. 78 УК РФ" },
    { k: "mid",   t: "Преступление средней тяжести",   y: 6, b: "п. «б» ч. 1 ст. 78 УК РФ" },
    { k: "grave", t: "Тяжкое преступление",            y: 10, b: "п. «в» ч. 1 ст. 78 УК РФ" },
    { k: "extra", t: "Особо тяжкое преступление",      y: 15, b: "п. «г» ч. 1 ст. 78 УК РФ" }
  ];

  /* --- арифметика сроков --------------------------------------------- */

  /* Дата, отстоящая от начала на n часов / суток / месяцев. */
  function calcAdd(from, num, unit) {
    var d = new Date(from.getTime());
    if (unit === "hours") d.setHours(d.getHours() + num);
    else if (unit === "days") d.setDate(d.getDate() + num);
    else if (unit === "months") {
      /* «соответствующее число последнего месяца, а если этот месяц не имеет
         соответствующего числа, то срок оканчивается в последние сутки
         этого месяца» — ч. 2 ст. 128 УПК РФ */
      var day = d.getDate(), m = d.getMonth(), y = d.getFullYear();
      d.setDate(1);
      d.setMonth(m + num);
      var last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(day, last));
      if (d.getFullYear() !== y && num === 0) d.setFullYear(y);
    } else if (unit === "years") d.setFullYear(d.getFullYear() + num);
    return d;
  }

  function isWorkday(d) {
    var w = d.getDay();
    return w !== 0 && w !== 6;
  }

  /* Первый рабочий день, начиная с указанного (если он сам нерабочий). */
  function nextWorkday(d) {
    var x = new Date(d.getTime());
    var guard = 0;
    while (!isWorkday(x) && guard++ < 10) x.setDate(x.getDate() + 1);
    return x;
  }

  function calcFmtDays(n) {
    return n + " " + plural(n, ["день", "дня", "дней"]);
  }

  /* Только название дня недели — для строк, где дата уже напечатана рядом. */
  function dayName(d) {
    return ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"][d.getDay()];
  }

  /* Ближайшие контрольные точки от указанного момента. */
  function calcPointsHtml(from, points, kind) {
    var now = new Date();
    return '<table class="tbl calc-tbl"><thead><tr><th>Точка</th><th>Дата и время</th><th>Основание</th></tr></thead><tbody>' +
      points.map(function (p) {
        var at = kind === "custody" ? calcAdd(from, p.h != null ? p.h : p.m, p.h != null ? "hours" : "months")
                                    : calcAdd(from, p.d != null ? p.d : p.m, p.d != null ? "days" : "months");
        var past = at.getTime() <= now.getTime();
        return "<tr" + (past ? ' class="calc-past"' : "") + ">" +
          "<td>" + esc(p.t) + (p.n ? '<div class="small muted">' + esc(p.n) + "</div>" : "") + "</td>" +
          '<td class="term">' + fmtDateTime(at) + '<div class="small muted">' + dayName(at) + (past ? " · прошло" : "") + "</div></td>" +
          '<td class="small muted">' + esc(p.b) + "</td></tr>";
      }).join("") + "</tbody></table>";
  }

  /* --- вкладка: процессуальные сроки ---------------------------------- */

  function calcBaseTab() {
    return '<div class="split calc-split">' +
      '<div class="card">' +
        '<h3 style="margin-top:0">Дата окончания срока</h3>' +
        '<div class="field"><label>Начало срока</label><input type="date" class="input" id="cDate"></div>' +
        '<div class="field"><label>Время начала</label><input type="time" class="input" id="cTime" value="12:00"></div>' +
        '<div class="field"><label>Длительность</label><div class="form-row">' +
          '<input type="number" class="input" id="cNum" value="2" min="0" step="1">' +
          '<select class="select" id="cUnit">' +
            '<option value="hours">часов</option>' +
            '<option value="days">суток</option>' +
            '<option value="months" selected>месяцев</option>' +
            '<option value="years">лет</option>' +
          "</select></div></div>" +
        '<label class="calc-check"><input type="checkbox" id="cSkip"> не переносить с нерабочего дня</label>' +
        '<button class="btn btn-primary" id="cRun" style="width:100%">Рассчитать</button>' +
        '<div id="cOut" style="margin-top:14px"></div>' +
      "</div>" +
      '<div class="card">' +
        '<h3 style="margin-top:0">Быстрые сроки</h3>' +
        '<p class="small muted">Подставьте типовой срок — калькулятор посчитает дату и покажет норму.</p>' +
        '<div class="chips calc-presets">' +
          [["48 часов — задержание", 48, "hours"], ["72 часа — продление судом", 72, "hours"],
           ["3 суток — проверка сообщения", 3, "days"], ["10 суток — обжалование по КоАП", 10, "days"],
           ["15 суток — апелляция по УПК", 15, "days"], ["30 суток — дознание", 30, "days"],
           ["2 месяца — следствие", 2, "months"], ["3 месяца — продление следствия", 3, "months"],
           ["1 месяц — апелляция ГПК/КАС/АПК", 1, "months"], ["6 месяцев — стража", 6, "months"],
           ["12 месяцев — следствие, стража", 12, "months"], ["18 месяцев — исключительный случай", 18, "months"]]
            .map(function (x) {
              return '<div class="chip" data-calc-preset="' + x[1] + ':' + x[2] + '">' + esc(x[0]) + "</div>";
            }).join("") +
        "</div>" +
        '<div class="info-box" style="margin-top:14px"><b>Правила исчисления — ст. 128 УПК РФ.</b> ' +
          "Сроки исчисляются часами, сутками и месяцами. Срок сутками истекает в 24 часа последних суток; " +
          "срок месяцами — в соответствующее число последнего месяца, а если такого числа нет — в последние сутки месяца. " +
          "Если окончание приходится на нерабочий день, последним днём считается первый следующий рабочий день. " +
          "Исключение — задержание, содержание под стражей, домашний арест и запрет определённых действий: там нерабочие дни не переносят. " +
          "При задержании срок исчисляется с момента фактического задержания.</div>" +
      "</div>" +
    "</div>" +
    '<h2>Контрольные точки по делу</h2>' +
    '<div class="card">' +
      '<div class="form-row" style="max-width:520px">' +
        '<input type="date" class="input" id="cCaseDate">' +
        '<select class="select" id="cCaseKind">' +
          '<option value="custody">от момента задержания</option>' +
          '<option value="case">от возбуждения дела / события</option>' +
        "</select>" +
        '<button class="btn btn-primary" id="cCaseRun">Построить</button>' +
      "</div>" +
      '<div id="cCaseOut" style="margin-top:14px"></div>' +
    "</div>";
  }

  /* --- вкладка: давность и зачёт -------------------------------------- */

  function calcLimitTab() {
    return '<div class="split calc-split">' +
      '<div class="card">' +
        '<h3 style="margin-top:0">Давность: УК РФ</h3>' +
        '<p class="small muted">Ст. 78 УК РФ — сроки считаются со дня совершения преступления и до вступления приговора в силу.</p>' +
        '<div class="field"><label>Категория преступления</label><select class="select" id="lCat">' +
          CALC_LIMIT_UK.map(function (x) { return '<option value="' + x.k + '">' + esc(x.t) + " — " + x.y + " лет</option>"; }).join("") +
        "</select></div>" +
        '<div class="field"><label>Дата совершения преступления</label><input type="date" class="input" id="lDate"></div>' +
        '<button class="btn btn-primary" id="lRun" style="width:100%">Рассчитать</button>' +
        '<div id="lOut" style="margin-top:14px"></div>' +
      "</div>" +
      '<div class="card">' +
        '<h3 style="margin-top:0">Давность: КоАП РФ</h3>' +
        '<p class="small muted">Ст. 4.5 КоАП РФ. По длящимся правонарушениям срок считается со дня обнаружения.</p>' +
        '<div class="field"><label>Дата совершения (обнаружения)</label><input type="date" class="input" id="aDate"></div>' +
        '<div class="field"><label>Кто рассматривает дело</label><select class="select" id="aWho">' +
          '<option value="60">иной орган или должностное лицо — 60 дней</option>' +
          '<option value="90">судья — 90 дней</option>' +
          '<option value="365">дисквалификация — 1 год</option>' +
        "</select></div>" +
        '<button class="btn btn-primary" id="aRun" style="width:100%">Рассчитать</button>' +
        '<div id="aOut" style="margin-top:14px"></div>' +
      "</div>" +
    "</div>" +
    '<h2>Исковая давность</h2>' +
    '<div class="card">' +
      '<p class="small muted">Ст. 196 и 200 ГК РФ. Течение начинается со дня, когда лицо узнало или должно было узнать о нарушении права и о надлежащем ответчике.</p>' +
      '<div class="form-row" style="max-width:620px">' +
        '<input type="date" class="input" id="iDate">' +
        '<input type="date" class="input" id="iViol" title="День нарушения права">' +
        '<button class="btn btn-primary" id="iRun">Рассчитать</button>' +
      "</div>" +
      '<p class="small muted" style="margin-top:8px">Первое поле — когда узнали о нарушении, второе (необязательно) — день самого нарушения для проверки предельного срока.</p>' +
      '<div id="iOut" style="margin-top:12px"></div>' +
    "</div>" +
    '<h2>Зачёт содержания под стражей</h2>' +
    '<div class="card">' +
      '<p class="small muted">Ст. 72 УК РФ. Один день под стражей засчитывается по-разному в зависимости от вида наказания.</p>' +
      '<div class="form-row" style="max-width:620px">' +
        '<input type="number" class="input" id="sDays" min="0" step="1" placeholder="дней под стражей" value="30">' +
        '<select class="select" id="sKind">' +
          CALC_SETOFF.map(function (x) { return '<option value="' + x.k + '">' + esc(x.t) + "</option>"; }).join("") +
        "</select>" +
        '<button class="btn btn-primary" id="sRun">Посчитать</button>' +
      "</div>" +
      '<div id="sOut" style="margin-top:12px"></div>' +
      '<div class="note-box" style="margin-top:12px">Домашний арест засчитывается иначе: два дня домашнего ареста за один день содержания под стражей или лишения свободы (ч. 3.4 ст. 72 УК РФ).</div>' +
    "</div>";
  }

  /* --- вкладка: пошлины и проценты ------------------------------------ */

  function calcMoneyTab() {
    return '<div class="split calc-split">' +
      '<div class="card">' +
        '<h3 style="margin-top:0">Госпошлина по иску</h3>' +
        '<p class="small muted">Ст. 333.19 НК РФ в редакции Федерального закона от 08.08.2024 № 259-ФЗ.</p>' +
        '<div class="field"><label>Требование</label><select class="select" id="dKind">' +
          '<option value="prop">Имущественный иск, подлежащий оценке</option>' +
          '<option value="order">Заявление о вынесении судебного приказа</option>' +
          CALC_DUTY_FIXED.map(function (x) { return '<option value="' + x.k + '">' + esc(x.t) + "</option>"; }).join("") +
        "</select></div>" +
        '<div class="field" id="dPriceWrap"><label>Цена иска, ₽</label><input type="number" class="input" id="dPrice" min="0" step="1000" value="500000"></div>' +
        '<button class="btn btn-primary" id="dRun" style="width:100%">Рассчитать</button>' +
        '<div id="dOut" style="margin-top:14px"></div>' +
      "</div>" +
      '<div class="card">' +
        '<h3 style="margin-top:0">Неустойка и индексация</h3>' +
        '<div class="field"><label>Сумма долга, ₽</label><input type="number" class="input" id="nSum" min="0" step="1000" value="100000"></div>' +
        '<div class="form-row">' +
          '<input type="date" class="input" id="nFrom">' +
          '<input type="date" class="input" id="nTo">' +
        "</div>" +
        '<div class="field" style="margin-top:10px"><label>Неустойка</label><div class="form-row">' +
          '<input type="number" class="input" id="nRate" min="0" step="0.01" value="0.1">' +
          '<select class="select" id="nUnit">' +
            '<option value="day">% в день</option>' +
            '<option value="year">% годовых</option>' +
          "</select></div></div>" +
        '<div class="field"><label>Индекс потребительских цен, % (для индексации)</label>' +
          '<input type="number" class="input" id="nCpi" min="0" step="0.01" placeholder="например 108,4"></div>' +
        '<button class="btn btn-primary" id="nRun" style="width:100%">Рассчитать</button>' +
        '<div id="nOut" style="margin-top:14px"></div>' +
      "</div>" +
    "</div>" +
    '<h2>Проценты по ключевой ставке</h2>' +
    '<div class="card">' +
      '<p class="small muted">П. 1 ст. 395 ГК РФ: проценты определяются ключевой ставкой Банка России, действовавшей в соответствующие периоды. Ставка менялась — добавьте период на каждое её значение.</p>' +
      '<div class="field"><label>Сумма долга, ₽</label><input type="number" class="input" id="pSum" min="0" step="1000" value="100000" style="max-width:240px"></div>' +
      '<div id="pRows"></div>' +
      '<div class="actions-row">' +
        '<button class="btn" id="pAdd">' + ic("plus") + " Добавить период</button>" +
        '<button class="btn btn-primary" id="pRun">Рассчитать</button>' +
      "</div>" +
      '<div id="pOut" style="margin-top:14px"></div>' +
      '<div class="note-box" style="margin-top:12px">Если договором предусмотрена неустойка за то же нарушение, проценты по ст. 395 ГК РФ не взыскиваются (п. 4 ст. 395 ГК РФ). Суд вправе уменьшить неустойку при её явной несоразмерности (ст. 333 ГК РФ).</div>' +
    "</div>";
  }

  /* --- вкладка: под стражей ------------------------------------------- */

  function calcCustodyTab() {
    return '<div class="card">' +
        '<h3 style="margin-top:0">Контрольные точки от момента задержания</h3>' +
        '<p class="small muted">Введите момент фактического задержания — получите сроки, которые нельзя пропустить.</p>' +
        '<div class="form-row" style="max-width:520px">' +
          '<input type="datetime-local" class="input" id="kTime">' +
          '<button class="btn btn-primary" id="kRun">Построить</button>' +
        "</div>" +
        '<div id="kOut" style="margin-top:14px"></div>' +
      "</div>" +
      '<h2>Пределы продления</h2>' +
      '<div class="card" style="padding:0;overflow:hidden">' +
        '<table class="tbl"><thead><tr><th>Мера пресечения</th><th>Срок</th><th>Основание</th></tr></thead><tbody>' +
        [
          ["Домашний арест", "до 2 месяцев, продлевается судом", "ч. 2 ст. 107 УПК РФ"],
          ["Запрет определённых действий", "до 2 месяцев, продлевается судом", "ч. 1 ст. 105.1 УПК РФ"],
          ["Содержание под стражей", "до 2 месяцев", "ч. 1 ст. 109 УПК РФ"],
          ["— продление", "до 6 месяцев", "ч. 2 ст. 109 УПК РФ"],
          ["— продление по тяжким и особо тяжким", "до 12 месяцев", "ч. 2 ст. 109 УПК РФ"],
          ["— исключительный случай", "до 18 месяцев", "ч. 3 ст. 109 УПК РФ"],
          ["Задержание до суда", "не более 48 часов", "ч. 2 ст. 94 УПК РФ, ст. 22 Конституции РФ"],
          ["Продление задержания судом", "не более 72 часов", "ч. 7 ст. 108 УПК РФ"]
        ].map(function (r) {
          return "<tr><td>" + esc(r[0]) + '</td><td class="term">' + esc(r[1]) + '</td><td class="small muted">' + esc(r[2]) + "</td></tr>";
        }).join("") +
        "</tbody></table>" +
      "</div>" +
      '<div class="disclaimer">Расчёт ведётся по календарным правилам ст. 128 УПК РФ. При исчислении сроков заключения под стражу, домашнего ареста, запрета определённых действий и нахождения в медицинской организации нерабочее время включается в срок, поэтому перенос с нерабочего дня к ним не применяется.</div>';
  }

  /* --- вкладка: обычный калькулятор ----------------------------------- */

  /* Плоский счёт без привязки к нормам: «5 + 5». Выражение хранится в
     машинной форме (+ - * /), а лента вычислений — в localStorage. */
  var scHist = LS.get("calcHist", []);
  if (!Array.isArray(scHist)) scHist = [];
  var sc = { expr: "", done: false, last: "", hist: scHist };

  /* Выражение в вид для человека: × ÷ − и запятая вместо точки. */
  function scShow(s) {
    return String(s || "")
      .replace(/\*/g, " × ").replace(/\//g, " ÷ ")
      .replace(/\+/g, " + ").replace(/-/g, " − ")
      .replace(/\./g, ",")
      .replace(/\s+/g, " ")
      .trim();
  }

  /* Число в машинную строку: без экспоненты и хвостовых нулей. */
  function scNum(v) {
    if (!isFinite(v)) return "0";
    return String(Math.round(v * 1e10) / 1e10);
  }

  /* Число на экран: разряды через пробел, дробная часть — через запятую. */
  function scFmt(v) {
    if (!isFinite(v)) return "Ошибка";
    var r = Math.round(v * 1e10) / 1e10;
    if (r !== 0 && (Math.abs(r) >= 1e15 || Math.abs(r) < 1e-9)) {
      return r.toExponential(6).replace(".", ",");
    }
    var s = String(r), neg = s.charAt(0) === "-";
    if (neg) s = s.slice(1);
    var p = s.split(".");
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
    return (neg ? "\u2212" : "") + p.join(",");
  }

  /* Токенизация: числа и операторы. Унарный минус приклеивается к числу,
     поэтому «5 + -3» считается как 5 + (−3). */
  function scTokens(s) {
    var out = [], i = 0, n = s.length;
    var isD = function (c) { return (c >= "0" && c <= "9") || c === "."; };
    while (i < n) {
      var c = s.charAt(i);
      if (c === " ") { i++; continue; }
      if (isD(c)) {
        var j = i;
        while (j < n && isD(s.charAt(j))) j++;
        var num = parseFloat(s.slice(i, j));
        out.push({ t: "n", v: isNaN(num) ? 0 : num });
        i = j; continue;
      }
      if (c === "+" || c === "-") {
        var prev = out[out.length - 1];
        if (!prev || prev.t === "o") {          /* унарный знак */
          var k = i + 1;
          if (k < n && isD(s.charAt(k))) {
            var m = k;
            while (m < n && isD(s.charAt(m))) m++;
            var v2 = parseFloat(s.slice(k, m));
            if (isNaN(v2)) v2 = 0;
            out.push({ t: "n", v: c === "-" ? -v2 : v2 });
            i = m; continue;
          }
          i++; continue;
        }
        out.push({ t: "o", v: c });
        i++; continue;
      }
      if (c === "*" || c === "/") { out.push({ t: "o", v: c }); i++; continue; }
      i++;                                       /* посторонний символ пропускаем */
    }
    return out;
  }

  /* Вычисление по приоритету: сначала × и ÷, затем + и −. */
  function scEval(s) {
    if (!s) return NaN;
    var list = scTokens(String(s));
    if (!list.length || list[0].t !== "n") return NaN;
    for (var i = 1; i < list.length - 1;) {
      if (list[i].t === "o" && (list[i].v === "*" || list[i].v === "/")) {
        var a = list[i - 1].v, b = list[i + 1].v;
        var r = list[i].v === "*" ? a * b : (b === 0 ? NaN : a / b);
        list.splice(i - 1, 3, { t: "n", v: r });
        i = 1;
      } else i++;
    }
    var acc = list[0].v;
    for (var j = 1; j < list.length - 1; j += 2) {
      if (list[j].t !== "o" || list[j + 1].t !== "n") break;
      acc = list[j].v === "+" ? acc + list[j + 1].v : acc - list[j + 1].v;
    }
    return acc;
  }

  /* Последнее число в выражении — для «±» и «%». */
  function scTail(s) {
    var m = /(\d+\.?\d*|\.\d+)$/.exec(s);
    return m ? { at: m.index, text: m[0] } : null;
  }

  function scReset() { sc.expr = ""; sc.done = false; sc.last = ""; }

  function scPushNum(d) {
    if (sc.done) scReset();
    var t = scTail(sc.expr);
    if (t && /^0$/.test(t.text)) sc.expr = sc.expr.slice(0, t.at) + d;  /* «0» + «5» = «5» */
    else sc.expr += d;
  }

  function scPushDot() {
    if (sc.done) scReset();
    var t = scTail(sc.expr);
    if (!t) { sc.expr += "0."; return; }
    if (t.text.indexOf(".") === -1) sc.expr += ".";
  }

  function scPushOp(op) {
    if (sc.done) { sc.done = false; sc.last = ""; }
    if (!sc.expr) { if (op === "-") sc.expr = "-"; return; }
    if (/[+\-*/]$/.test(sc.expr)) sc.expr = sc.expr.replace(/[+\-*/]+$/, "") + op;
    else sc.expr += op;
  }

  function scBack() {
    if (sc.done) { scReset(); return; }
    sc.expr = sc.expr.slice(0, -1);
  }

  function scSign() {
    if (sc.done) { sc.done = false; sc.last = ""; }
    var t = scTail(sc.expr);
    if (!t) { if (!sc.expr) sc.expr = "-"; return; }
    var before = sc.expr.slice(0, t.at);
    if (before.slice(-1) === "-" && (before.length === 1 || /[+\-*/]$/.test(before.slice(0, -1)))) {
      sc.expr = before.slice(0, -1) + t.text;     /* снять минус */
    } else {
      sc.expr = before + "-" + t.text;            /* поставить минус */
    }
  }

  /* Проценты как в обычном калькуляторе: «200 + 10 %» = 220, «50 %» = 0,5. */
  function scPercent() {
    if (!sc.expr) return;
    var m = /^(.*?)([+\-*/])(\d+\.?\d*|\.\d+)$/.exec(sc.expr);
    if (m) {
      var left = scEval(m[1]), right = parseFloat(m[3]);
      var val = (m[2] === "+" || m[2] === "-") ? left * right / 100 : right / 100;
      sc.expr = m[1] + m[2] + scNum(val);
    } else {
      var t = scTail(sc.expr);
      if (t) sc.expr = sc.expr.slice(0, t.at) + scNum(parseFloat(t.text) / 100);
    }
  }

  function scEquals() {
    if (!sc.expr) return;
    var r = scEval(sc.expr);
    if (!isFinite(r)) { sc.last = scShow(sc.expr) + " ="; sc.expr = ""; sc.done = true; return; }
    sc.hist = [{ e: sc.expr, r: r }].concat(sc.hist).slice(0, 12);
    LS.set("calcHist", sc.hist);
    sc.last = scShow(sc.expr) + " =";
    sc.expr = scNum(r);
    sc.done = true;
  }

  function scDo(a) {
    if (!a) return;
    var i = a.indexOf(":");
    var cmd = i === -1 ? a : a.slice(0, i);
    var arg = i === -1 ? "" : a.slice(i + 1);
    if (cmd === "num") scPushNum(arg);
    else if (cmd === "op") scPushOp(arg);
    else if (cmd === "clear") scReset();
    else if (cmd === "back") scBack();
    else if (cmd === "dot") scPushDot();
    else if (cmd === "sign") scSign();
    else if (cmd === "pct") scPercent();
    else if (cmd === "eq") scEquals();
  }

  function scRender() {
    var exprEl = $("#scExpr"), valEl = $("#scValue");
    if (!exprEl || !valEl) return;
    var e = sc.expr, line = "", val = "0";
    if (sc.done) {
      line = sc.last; val = scFmt(scEval(e));
    } else if (!e) {
      line = ""; val = "0";
    } else {
      var t = scTail(e);
      if (!t) {                                   /* выражение заканчивается оператором */
        line = scShow(e);
        var head = e.slice(0, -1);
        val = head ? scFmt(scEval(head)) : "0";
      } else if (e === t.text) {                  /* набираем одно число — показываем как есть */
        line = ""; val = scShow(t.text);
      } else {
        line = scShow(e); val = scFmt(scEval(e));
      }
    }
    exprEl.textContent = line || "\u00a0";
    valEl.textContent = val;
    valEl.classList.toggle("sc-err", val === "Ошибка");

    var tape = $("#scTape"), list = $("#scTapeList");
    if (tape && list) {
      if (sc.hist.length) {
        tape.hidden = false;
        list.innerHTML = sc.hist.map(function (h) {
          return '<div class="sc-tape-item" data-sc-use="' + esc(scNum(h.r)) + '">' +
            esc(scShow(h.e) + " = " + scFmt(h.r)) + "</div>";
        }).join("");
      } else { tape.hidden = true; list.innerHTML = ""; }
    }
  }

  /* Клавиатура калькулятора. Возвращает true, если нажатие обработано;
     вызывается из общего обработчика keydown. */
  function scKey(e) {
    if (!(state.route.name === "calc" && state.route.arg === "simple")) return false;
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    var ae = document.activeElement;
    if (ae && (/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) ||
      (ae.classList && ae.classList.contains("sc-key")))) return false;
    var k = e.key, handled = true;
    if (/^[0-9]$/.test(k)) scPushNum(k);
    else if (k === "." || k === ",") scPushDot();
    else if (k === "+") scPushOp("+");
    else if (k === "-") scPushOp("-");
    else if (k === "*" || k === "x" || k === "X") scPushOp("*");
    else if (k === "/") scPushOp("/");
    else if (k === "%") scPercent();
    else if (k === "=" || k === "Enter") scEquals();
    else if (k === "Backspace") scBack();
    else if (k === "Delete") scReset();
    else handled = false;
    if (handled) { e.preventDefault(); scRender(); }
    return handled;
  }

  function calcSimpleTab() {
    var key = function (cls, data, label, aria) {
      return '<button class="sc-key ' + cls + '" type="button" data-sc="' + data + '"' +
        (aria ? ' aria-label="' + aria + '"' : "") + ">" + label + "</button>";
    };
    return '<div class="split calc-split">' +
      '<div class="card">' +
        '<div class="simple-calc">' +
          '<div class="sc-display">' +
            '<div class="sc-expr" id="scExpr" aria-hidden="true">&nbsp;</div>' +
            '<div class="sc-value" id="scValue" role="status" aria-live="polite">0</div>' +
          "</div>" +
          '<div class="sc-keys" id="scKeys">' +
            key("sc-fn", "clear", "C", "Очистить") +
            key("sc-fn", "back", ic("backspace"), "Удалить последний символ") +
            key("sc-fn", "pct", "%", "Проценты") +
            key("sc-op", "op:/", "\u00f7", "Деление") +
            key("", "num:7", "7") + key("", "num:8", "8") + key("", "num:9", "9") +
            key("sc-op", "op:*", "\u00d7", "Умножение") +
            key("", "num:4", "4") + key("", "num:5", "5") + key("", "num:6", "6") +
            key("sc-op", "op:-", "\u2212", "Вычитание") +
            key("", "num:1", "1") + key("", "num:2", "2") + key("", "num:3", "3") +
            key("sc-op", "op:+", "+", "Сложение") +
            key("sc-fn", "sign", "\u00b1", "Сменить знак") +
            key("", "num:0", "0") +
            key("", "dot", ",") +
            key("sc-eq", "eq", "=", "Равно") +
          "</div>" +
          '<div class="sc-tape" id="scTape" hidden>' +
            '<div class="sc-tape-h" title="Нажмите на запись, чтобы взять результат">Лента вычислений</div>' +
            '<div class="sc-tape-list" id="scTapeList"></div>' +
          "</div>" +
        "</div>" +
      "</div>" +
      '<div class="card">' +
        '<h3 style="margin-top:0">Как считать</h3>' +
        '<p class="small muted">Обычный калькулятор: сложение, вычитание, умножение и деление. Счёт идёт в браузере, данные никуда не отправляются.</p>' +
        '<ul class="sc-help">' +
          "<li><b>5 + 5 =</b> — выражение набирается целиком, ответ считается при «=».</li>" +
          "<li><b>%</b> — проценты: <b>200 + 10 %</b> даёт 220, <b>50 %</b> даёт 0,5.</li>" +
          "<li><b>±</b> — меняет знак числа, <b>Стереть</b> — убирает последний символ, <b>C</b> — сбрасывает всё.</li>" +
          "<li><b>×</b> набирается как <b>*</b>, <b>÷</b> — как <b>/</b>; дробная часть — точка или запятая.</li>" +
          "<li><b>Лента</b> внизу — последние вычисления; нажмите на запись, чтобы взять результат.</li>" +
        "</ul>" +
        '<div class="note-box">С клавиатуры: цифры и <b>+ − * /</b> работают без мыши, <b>Enter</b> — «=», <b>Backspace</b> — стереть, <b>Delete</b> — сброс. Если курсор стоит в поле ввода, клавиши идут в него.</div>' +
        '<p class="small muted">Для расчётов, привязанных к нормам, откройте соседние вкладки — процессуальные сроки, давность, пошлины, сроки под стражей: там рядом с результатом указано основание с датой редакции.</p>' +
      "</div>" +
    "</div>";
  }

  function viewCalc(tab) {
    var k = tab || "base";
    var body = k === "limit" ? calcLimitTab()
      : k === "money" ? calcMoneyTab()
      : k === "custody" ? calcCustodyTab()
      : k === "simple" ? calcSimpleTab()
      : calcBaseTab();
    var lead = {
      base: "Дата окончания срока по правилам ст. 128 УПК РФ и контрольные точки по делу и по задержанию.",
      limit: "Сроки давности по УК, КоАП и ГК, а также зачёт времени содержания под стражей.",
      money: "Госпошлина по ст. 333.19 НК РФ, проценты по ст. 395 ГК РФ, неустойка и индексация.",
      custody: "Сроки содержания под стражей, домашнего ареста и продлений — от момента задержания.",
      simple: "Обычный калькулятор: сложение, вычитание, умножение, деление, проценты и смена знака. Считает прямо в браузере, работает и с клавиатуры."
    }[k];
    return "<h1>Калькуляторы</h1>" +
      '<p class="lead">' + lead + (k === "simple" ? "" :
        " Расчёты опираются на тексты, размещённые на сайте, — рядом с каждым результатом указано основание с датой редакции.") + "</p>" +
      tabStrip(CALC_TABS, k) +
      body;
  }

  function bindCalc(tab) {
    var k = tab || "base";
    var today = new Date();
    var iso = today.toISOString().slice(0, 10);

    var money = function (n) {
      return n.toLocaleString("ru-RU", { maximumFractionDigits: 2, minimumFractionDigits: 2 }) + " ₽";
    };

    if (k === "simple") {
      var keys = $("#scKeys");
      if (keys) keys.addEventListener("click", function (e) {
        var b = e.target.closest("[data-sc]");
        if (!b) return;
        scDo(b.getAttribute("data-sc"));
        scRender();
      });
      var tape = $("#scTape");
      if (tape) tape.addEventListener("click", function (e) {
        var it = e.target.closest("[data-sc-use]");
        if (!it) return;
        sc.expr = it.getAttribute("data-sc-use") || "";
        sc.done = false; sc.last = "";
        scRender();
      });
      scReset();
      scRender();
      return;
    }

    if (k === "base") {
      $("#cDate").value = iso;
      $("#cCaseDate").value = iso;
      var run = function () {
        var ds = $("#cDate").value;
        if (!ds) { toast("Укажите дату"); return; }
        var num = parseInt($("#cNum").value, 10) || 0;
        var unit = $("#cUnit").value;
        var ts = $("#cTime").value || "00:00";
        var start = new Date(ds + "T" + ts + ":00");
        if (isNaN(start.getTime())) { toast("Некорректная дата"); return; }
        var end = calcAdd(start, num, unit);
        var shifted = null;
        if (!$("#cSkip").checked && !isWorkday(end)) {
          shifted = nextWorkday(end);
        }
        var days = Math.round((end - start) / 86400000);
        $("#cOut").innerHTML =
          '<div class="info-box">' +
            '<div class="small muted">Начало</div><b>' + fmtDateTime(start) + "</b>" +
            '<div class="small muted" style="margin-top:8px">Окончание</div><b style="font-size:17px">' + fmtDateTime(end) + "</b>" +
            '<div class="small muted" style="margin-top:8px">' + fmtDay(end) + " · " + calcFmtDays(days) + "</div>" +
          "</div>" +
          (shifted ? '<div class="warn-box" style="margin-top:10px"><b>Окончание попадает на нерабочий день.</b> Последним днём срока считается первый следующий рабочий день — <b>' +
            fmtDateTime(shifted) + "</b> (" + dayName(shifted) + "). Основание: ч. 2 ст. 128 УПК РФ.</div>"
            : '<div class="warn-box" style="margin-top:10px">Последний день срока — до 24:00 указанной даты. Если действие совершается в организации, срок истекает в час окончания рабочего дня (ч. 2 ст. 128 УПК РФ).</div>') +
          '<div class="small muted" style="margin-top:8px">Основание: ст. 128 УПК РФ, <a class="lnk" data-go="#/article/upk-128">открыть статью</a>.</div>';
      };
      $("#cRun").addEventListener("click", run);
      $("#cUnit").addEventListener("change", run);
      $("#cSkip").addEventListener("change", run);
      $(".calc-presets").addEventListener("click", function (e) {
        var p = e.target.closest("[data-calc-preset]");
        if (!p) return;
        var v = p.getAttribute("data-calc-preset").split(":");
        $("#cNum").value = v[0];
        $("#cUnit").value = v[1];
        $$(".calc-presets .chip").forEach(function (c) { c.classList.toggle("on", c === p); });
        run();
      });

      var runCase = function () {
        var ds = $("#cCaseDate").value;
        if (!ds) { toast("Укажите дату"); return; }
        var kind = $("#cCaseKind").value;
        var from = new Date(ds + (kind === "custody" ? "T00:00:00" : "T00:00:00"));
        $("#cCaseOut").innerHTML =
          '<div class="small muted" style="margin-bottom:8px">Отсчёт от ' + fmtDate(from) + " · " +
            (kind === "custody" ? "момент задержания" : "возбуждение дела") + "</div>" +
          calcPointsHtml(from, kind === "custody" ? CALC_CUSTODY : CALC_CASE, kind);
      };
      $("#cCaseRun").addEventListener("click", runCase);
      run();
      return;
    }

    if (k === "limit") {
      $("#lDate").value = iso;
      $("#aDate").value = iso;
      $("#iDate").value = iso;
      $("#lRun").addEventListener("click", function () {
        var ds = $("#lDate").value;
        if (!ds) { toast("Укажите дату"); return; }
        var cat = CALC_LIMIT_UK.filter(function (x) { return x.k === $("#lCat").value; })[0] || CALC_LIMIT_UK[0];
        var from = new Date(ds + "T00:00:00");
        var end = calcAdd(from, cat.y, "years");
        $("#lOut").innerHTML =
          '<div class="info-box">' +
            '<div class="small muted">Срок давности</div><b style="font-size:17px">' + cat.y + " " + plural(cat.y, ["год", "года", "лет"]) + "</b>" +
            '<div class="small muted" style="margin-top:8px">Истекает</div><b>' + fmtDay(end) + "</b>" +
          "</div>" +
          '<div class="small muted" style="margin-top:8px">Основание: ' + esc(cat.b) + '. Течение приостанавливается, если лицо уклоняется от следствия или суда либо от уплаты судебного штрафа, и возобновляется с момента задержания или явки с повинной (ч. 3 ст. 78 УК РФ). К террористическим преступлениям и ряду других сроки давности не применяются (ч. 5 ст. 78 УК РФ). ' +
          '<a class="lnk" data-go="#/article/uk-78">ст. 78 УК РФ</a></div>';
      });
      $("#aRun").addEventListener("click", function () {
        var ds = $("#aDate").value;
        if (!ds) { toast("Укажите дату"); return; }
        var days = parseInt($("#aWho").value, 10);
        var from = new Date(ds + "T00:00:00");
        var end = calcAdd(from, days, "days");
        $("#aOut").innerHTML =
          '<div class="info-box">' +
            '<div class="small muted">Срок давности</div><b style="font-size:17px">' + days + " " + plural(days, ["день", "дня", "дней"]) + "</b>" +
            '<div class="small muted" style="margin-top:8px">Истекает</div><b>' + fmtDay(end) + "</b>" +
          "</div>" +
          '<div class="small muted" style="margin-top:8px">Основание: ч. 1, 3 ст. 4.5 КоАП РФ. По длящемуся правонарушению срок считается со дня обнаружения (ч. 2 ст. 4.5). <a class="lnk" data-go="#/article/koap-4.5">ст. 4.5 КоАП РФ</a></div>';
      });
      $("#iRun").addEventListener("click", function () {
        var ds = $("#iDate").value;
        if (!ds) { toast("Укажите дату"); return; }
        var from = new Date(ds + "T00:00:00");
        var end = calcAdd(from, 3, "years");
        var html = '<div class="info-box">' +
          '<div class="small muted">Общий срок исковой давности</div><b style="font-size:17px">3 года</b>' +
          '<div class="small muted" style="margin-top:8px">Истекает</div><b>' + fmtDay(end) + "</b></div>";
        var vs = $("#iViol").value;
        if (vs) {
          var vd = new Date(vs + "T00:00:00");
          var cap = calcAdd(vd, 10, "years");
          var over = end.getTime() > cap.getTime();
          html += '<div class="' + (over ? "warn-box" : "info-box") + '" style="margin-top:10px">' +
            "Предельный срок — 10 лет со дня нарушения права: <b>" + fmtDay(cap) + "</b>. " +
            (over ? "Расчётный трёхлетний срок выходит за этот предел, поэтому применяется предельный." :
                    "Расчётный срок укладывается в предельный.") + "</div>";
        }
        html += '<div class="small muted" style="margin-top:8px">Основание: ст. 196, 200 ГК РФ. <a class="lnk" data-go="#/article/gk1-196">ст. 196 ГК РФ</a></div>';
        $("#iOut").innerHTML = html;
      });
      $("#sRun").addEventListener("click", function () {
        var days = parseInt($("#sDays").value, 10) || 0;
        var kind = CALC_SETOFF.filter(function (x) { return x.k === $("#sKind").value; })[0] || CALC_SETOFF[0];
        var out;
        if (kind.r === 0) {
          out = "<b>" + days * 8 + " часов</b> обязательных работ";
        } else {
          var credited = Math.round(days * kind.r * 100) / 100;
          out = "<b>" + credited + " " + plural(Math.round(credited), ["день", "дня", "дней"]) + "</b> зачтётся в срок наказания";
        }
        $("#sOut").innerHTML = '<div class="info-box">' + days + " " + plural(days, ["день", "дня", "дней"]) +
          " под стражей → " + out + '<div class="small muted" style="margin-top:8px">Основание: ' + esc(kind.b) + "</div></div>";
      });
      return;
    }

    if (k === "money") {
      var syncPrice = function () {
        var v = $("#dKind").value;
        $("#dPriceWrap").style.display = (v === "prop" || v === "order") ? "" : "none";
      };
      $("#dKind").addEventListener("change", function () { syncPrice(); });
      syncPrice();
      $("#dRun").addEventListener("click", function () {
        var v = $("#dKind").value;
        var sum, basis;
        if (v === "prop" || v === "order") {
          var price = Math.max(0, parseFloat($("#dPrice").value) || 0);
          var tier = CALC_DUTY_TIERS.filter(function (t) { return price <= t.up; })[0];
          sum = tier.base + (price > tier.from ? (price - tier.from) * tier.pct / 100 : 0);
          if (tier.cap) sum = Math.min(sum, tier.cap);
          basis = "подп. 1 п. 1 ст. 333.19 НК РФ";
          if (v === "order") { sum = sum / 2; basis = "подп. 2 п. 1 ст. 333.19 НК РФ — 50 % пошлины по имущественному иску"; }
        } else {
          var f = CALC_DUTY_FIXED.filter(function (x) { return x.k === v; })[0];
          sum = f.v; basis = f.b;
        }
        $("#dOut").innerHTML = '<div class="info-box">' +
          '<div class="small muted">Государственная пошлина</div><b style="font-size:19px">' + money(sum) + "</b>" +
          '<div class="small muted" style="margin-top:8px">Основание: ' + esc(basis) + "</div></div>" +
          '<div class="small muted" style="margin-top:8px">Суд вправе уменьшить размер пошлины с учётом имущественного положения (п. 2 ст. 333.20 НК РФ). <a class="lnk" data-go="#/article/nk2-333.19">ст. 333.19 НК РФ</a></div>';
      });
      $("#nFrom").value = iso;
      $("#nTo").value = iso;
      $("#nRun").addEventListener("click", function () {
        var s = Math.max(0, parseFloat($("#nSum").value) || 0);
        var f = new Date($("#nFrom").value + "T00:00:00");
        var t = new Date($("#nTo").value + "T00:00:00");
        var rate = Math.max(0, parseFloat($("#nRate").value) || 0);
        var unit = $("#nUnit").value;
        var cpi = parseFloat($("#nCpi").value);
        var days = Math.max(0, Math.round((t - f) / 86400000));
        var html = "";
        if (!isNaN(f.getTime()) && days > 0 && rate > 0) {
          var pen = unit === "day" ? s * rate / 100 * days : s * rate / 100 * days / 365;
          html += '<div class="info-box"><div class="small muted">Неустойка за ' + calcFmtDays(days) + "</div>" +
            '<b style="font-size:19px">' + money(pen) + "</b>" +
            '<div class="small muted" style="margin-top:8px">Основание: ст. 330 ГК РФ. При явной несоразмерности суд вправе уменьшить неустойку (ст. 333 ГК РФ).</div></div>';
        }
        if (!isNaN(cpi) && cpi > 0) {
          html += '<div class="info-box" style="margin-top:10px"><div class="small muted">Индексация на ' + cpi + " %</div>" +
            '<b style="font-size:19px">' + money(s * cpi / 100) + "</b>" +
            '<div class="small muted" style="margin-top:8px">Основание: ст. 208 ГПК РФ — для индексации используется официальная статистическая информация об индексе потребительских цен. Индекс нужно взять из данных Росстата за нужный период.</div></div>';
        }
        if (!html) html = '<div class="warn-box">Укажите период и ставку — расчёт появится здесь.</div>';
        $("#nOut").innerHTML = html;
      });

      var addRow = function () {
        var row = document.createElement("div");
        row.className = "form-row calc-row";
        row.innerHTML =
          '<input type="date" class="input" data-p-from value="' + iso + '">' +
          '<input type="date" class="input" data-p-to value="' + iso + '">' +
          '<input type="number" class="input" data-p-rate min="0" step="0.01" placeholder="% годовых" value="16">' +
          '<button class="btn" data-p-del type="button" aria-label="Удалить период">' + ic("close") + "</button>";
        $("#pRows").appendChild(row);
      };
      $("#pAdd").addEventListener("click", addRow);
      $("#pRows").addEventListener("click", function (e) {
        var d = e.target.closest("[data-p-del]");
        if (d) d.parentNode.remove();
      });
      $("#pRun").addEventListener("click", function () {
        var s = Math.max(0, parseFloat($("#pSum").value) || 0);
        var rows = $$("#pRows .calc-row");
        var total = 0, parts = [];
        rows.forEach(function (r) {
          var f = new Date(r.querySelector("[data-p-from]").value + "T00:00:00");
          var t = new Date(r.querySelector("[data-p-to]").value + "T00:00:00");
          var rate = parseFloat(r.querySelector("[data-p-rate]").value) || 0;
          var days = Math.round((t - f) / 86400000);
          if (isNaN(f.getTime()) || isNaN(t.getTime()) || days <= 0 || rate <= 0) return;
          var sum = s * rate / 100 * days / 365;
          total += sum;
          parts.push(fmtDate(f) + " — " + fmtDate(t) + " (" + calcFmtDays(days) + ", " + rate + " %): " + money(sum));
        });
        if (!parts.length) { $("#pOut").innerHTML = '<div class="warn-box">Заполните хотя бы один период.</div>'; return; }
        $("#pOut").innerHTML = '<div class="info-box">' +
          '<div class="small muted">Проценты по ст. 395 ГК РФ</div><b style="font-size:19px">' + money(total) + "</b></div>" +
          '<div class="small muted" style="margin-top:8px">' + parts.map(esc).join("<br>") + "</div>" +
          '<div class="small muted" style="margin-top:8px">Формула: сумма × ставка / 100 × дни / 365. Проценты взимаются по день уплаты долга (п. 3 ст. 395 ГК РФ). Начисление процентов на проценты не допускается (п. 5 ст. 395 ГК РФ). <a class="lnk" data-go="#/article/gk1-395">ст. 395 ГК РФ</a></div>';
      });
      addRow();
      return;
    }

    if (k === "custody") {
      var dt = new Date(Date.now() - 3600 * 1000);
      $("#kTime").value = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      var runK = function () {
        var v = $("#kTime").value;
        if (!v) { toast("Укажите момент задержания"); return; }
        var from = new Date(v);
        if (isNaN(from.getTime())) { toast("Некорректная дата"); return; }
        var now = new Date();
        var passed = Math.floor((now - from) / 3600000);
        $("#kOut").innerHTML =
          '<div class="' + (passed >= 48 ? "warn-box" : "info-box") + '">' +
            "С момента задержания прошло <b>" + passed + " " + plural(passed, ["час", "часа", "часов"]) + "</b> (" +
            calcFmtDays(Math.floor(passed / 24)) + "). " +
            (passed >= 48 ? "<b>Предельный срок задержания без суда истёк</b> — ч. 2 ст. 94 УПК РФ." : "До предельного срока задержания осталось " + (48 - passed) + " ч.") +
          "</div>" +
          calcPointsHtml(from, CALC_CUSTODY, "custody");
      };
      $("#kRun").addEventListener("click", runK);
      runK();
      return;
    }
  }

  function viewDeadlines() {
    var rows = (REF.deadlines || []).map(function (d) {
      return "<tr><td>" + esc(d.t) + '</td><td class="term">' + esc(d.term) + "</td><td>" + esc(d.basis) + "</td></tr>";
    }).join("");

    return '<h1>Процессуальные сроки</h1>' +
      '<p class="lead">Справочник ключевых сроков и калькулятор для расчёта даты окончания, включая контрольные точки по задержанию.</p>' +
      '<div class="note-box">Полный набор расчётов — процессуальные сроки, давность и зачёт, госпошлина и проценты, сроки под стражей — в разделе <a class="lnk" data-go="#/calc">Калькуляторы</a>.</div>' +

      '<div class="split">' +
        '<div class="card">' +
          '<h3 style="margin-top:0">Калькулятор срока</h3>' +
          '<div class="field"><label>Начало срока (дата)</label><input type="date" class="input" id="calcDate"></div>' +
          '<div class="field"><label>Длительность</label><div class="form-row">' +
            '<input type="number" class="input" id="calcNum" value="2" min="0" step="1">' +
            '<select class="select" id="calcUnit"><option value="hours">часов</option><option value="days">суток</option><option value="months" selected>месяцев</option></select>' +
          "</div></div>" +
          '<div class="field"><label>Время начала (для часов)</label><input type="time" class="input" id="calcTime" value="12:00"></div>' +
          '<button class="btn btn-primary" id="calcRun" style="width:100%">Рассчитать</button>' +
          '<div id="calcOut" style="margin-top:14px"></div>' +
        "</div>" +

        '<div class="card">' +
          '<h3 style="margin-top:0">Контрольные точки по задержанию</h3>' +
          '<p class="small muted">Введите момент фактического задержания — получите сроки, которые нельзя пропустить.</p>' +
          '<div class="form-row"><input type="datetime-local" class="input" id="detTime"><button class="btn btn-primary" id="detRun">Построить</button></div>' +
          '<div id="detOut" style="margin-top:14px"></div>' +
        "</div>" +
      "</div>" +

      '<h2>Справочник сроков</h2>' +
      '<div class="card" style="padding:0;overflow:hidden"><table class="tbl"><thead><tr><th>Что</th><th>Срок</th><th>Основание</th></tr></thead><tbody>' +
      rows + "</tbody></table></div>" +

      '<div class="disclaimer">Расчёт выполняется по календарным правилам. Порядок исчисления сроков установлен ст. 128 УПК РФ: сроки исчисляются часами, сутками и месяцами; при задержании срок исчисляется с момента фактического задержания. Выходные и праздничные дни учитываются в зависимости от вида срока.</div>';
  }

  function bindDeadlines() {
    var today = new Date();
    $("#calcDate").value = today.toISOString().slice(0, 10);

    function calc() {
      var ds = $("#calcDate").value;
      if (!ds) { toast("Укажите дату"); return; }
      var num = parseInt($("#calcNum").value, 10) || 0;
      var unit = $("#calcUnit").value;
      var ts = $("#calcTime").value || "00:00";
      var d = new Date(ds + "T" + ts + ":00");
      if (isNaN(d.getTime())) { toast("Некорректная дата"); return; }
      var end = new Date(d.getTime());
      if (unit === "hours") end.setHours(end.getHours() + num);
      else if (unit === "days") end.setDate(end.getDate() + num);
      else end.setMonth(end.getMonth() + num);

      var days = Math.round((end - d) / 86400000);
      $("#calcOut").innerHTML =
        '<div class="info-box"><div class="small muted">Начало</div><b>' + fmtDateTime(d) + "</b>" +
        '<div class="small muted" style="margin-top:8px">Окончание</div><b style="font-size:17px">' + fmtDateTime(end) + "</b>" +
        '<div class="small muted" style="margin-top:8px">' + fmtDay(end) + " · " + plural(days, ["день", "дня", "дней"]) + " (" + days + ")" +
        "</div></div>" +
        '<div class="warn-box" style="margin-top:10px">Последний день срока — до 24:00 указанной даты. Если действие должно быть совершено в организации, срок истекает в час окончания рабочего дня.</div>';
    }
    $("#calcRun").addEventListener("click", calc);
    ["calcNum", "calcUnit", "calcDate", "calcTime"].forEach(function (id) {
      var el = $("#" + id); el.addEventListener("change", calc);
    });
    calc();

    function det() {
      var v = $("#detTime").value;
      if (!v) { toast("Укажите момент задержания"); return; }
      var d = new Date(v);
      if (isNaN(d.getTime())) { toast("Некорректная дата"); return; }
      var add = function (h) { return new Date(d.getTime() + h * 3600000); };
      var rows = [
        ["Составление протокола задержания", add(3), "не более 3 часов с момента доставления"],
        ["Уведомление прокурора и близких родственников", add(12), "не позднее 12 часов"],
        ["Предельный срок задержания без судебного решения", add(48), "не более 48 часов"],
        ["Продление задержания судом для представления доказательств", add(72), "не более 72 часов"],
        ["Предъявление обвинения при избранной мере пресечения", add(240), "не более 10 суток"]
      ];
      $("#detOut").innerHTML = '<table class="tbl"><tbody>' + rows.map(function (r) {
        return "<tr><td>" + esc(r[0]) + '<div class="small muted">' + esc(r[2]) + '</div></td><td class="term">' + fmtDateTime(r[1]) + "</td></tr>";
      }).join("") + "</tbody></table>";
    }
    $("#detRun").addEventListener("click", det);
    var now = new Date();
    $("#detTime").value = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) + "T" + pad(now.getHours()) + ":" + pad(now.getMinutes());
    det();
  }

  /* --- чек-листы --- */

  function viewChecklists() {
    var all = REF.checklists || [];
    var cards = roleSort(all, function (c) { return c.t + " " + c.basis; }).map(function (c) {
      return '<div class="card' + (roleOff(c.t + " " + c.basis) ? " role-off" : "") + '" data-go="#/checklist/' + c.id + '" style="cursor:pointer">' +
        '<div style="font-weight:620">' + esc(c.t) + "</div>" +
        '<div class="small muted" style="margin-top:4px">' + esc(c.basis) + "</div>" +
        '<div class="small muted" style="margin-top:8px">' + c.items.length + " " + plural(c.items.length, ["пункт", "пункта", "пунктов"]) + "</div></div>";
    }).join("");
    return '<h1>Чек-листы следственных действий</h1>' +
      '<p class="lead">Обязательные элементы, которые проверяются при оценке законности процессуального действия. Отсутствие любого из них — типичное основание для признания доказательств недопустимыми.</p>' +
      tabStrip(SCEN_TABS, "checklists") +
      '<div class="grid grid-2">' + cards + "</div>";
  }

  function viewChecklist(id) {
    var c = (REF.checklists || []).filter(function (x) { return x.id === id; })[0];
    if (!c) return '<div class="empty"><div class="ico">' + ic("checkbox") + '</div><div>Чек-лист не найден.</div></div>';
    var txt = c.t + "\nОснование: " + c.basis + "\n\n" + c.items.map(function (x, i) { return (i + 1) + ". " + x; }).join("\n");
    return '<h1>' + esc(c.t) + "</h1>" +
      '<p class="lead">Правовое основание: ' + esc(c.basis) + "</p>" +
      '<div class="card"><ol class="steps">' + c.items.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ol></div>" +
      '<div class="actions-row"><button class="btn btn-primary" data-copy-raw="' + encodeURIComponent(txt) + '">Скопировать чек-лист</button>' +
      '<button class="btn" data-dl="' + encodeURIComponent(c.t) + '|' + encodeURIComponent(txt) + '">Скачать .txt</button>' +
      '<button class="btn no-print" onclick="window.print()">Печать</button>' +
      '<div class="btn" data-go="#/checklists">← Все чек-листы</div></div>';
  }

  /* ==================================================================
     Шаблоны документов

     Документ хранится не сплошным текстом, а набором блоков — заголовок,
     реквизиты, абзац, пункт, таблица, подпись. Из одного набора блоков
     собираются три представления:

       docHtml(…, false) — HTML для экрана (стили из styles.css, тема);
       docHtml(…, true)  — HTML для Word и печати: те же свойства инлайном,
                           раскладка таблицами (Word не понимает flex и
                           CSS-переменные);
       docText(…)        — простой текст для буфера обмена и .txt.

     Значения подставляются по {{ключ}}. Поле может заполняться само:
     src:"today" — сегодняшняя дата, src:"profile.<ключ>" — из «Моих
     реквизитов», чтобы не набирать должность и ФИО в каждом документе.
     ================================================================== */

  var MONTHS_RU = ["января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря"];

  /* «11 октября 2026 г.» — так дата пишется в процессуальных документах */
  function fmtDateRu(d) {
    return d.getDate() + " " + MONTHS_RU[d.getMonth()] + " " + d.getFullYear() + " г.";
  }

  /* Общие реквизиты: вводятся один раз, подставляются во все документы */
  var PROFILE_FIELDS = [
    { k: "gorod", l: "Населённый пункт", p: "г. Москва" },
    { k: "organ", l: "Орган, подразделение", p: "СО ОМВД России по району ..." },
    { k: "dolzhnost", l: "Должность и звание", p: "следователь, лейтенант юстиции" },
    { k: "fio", l: "ФИО", p: "Иванов И.И." }
  ];
  function getProfile() { return LS.get("profile", {}); }
  function setProfile(p) { LS.set("profile", p || {}); }

  /* Значение поля при открытии документа: автоисточник, иначе образец */
  function tplValue(f, profile) {
    if (f.src === "today") return fmtDateRu(new Date());
    if (f.src && f.src.indexOf("profile.") === 0) {
      var v = (profile || {})[f.src.slice(8)];
      if (v != null && String(v).trim() !== "") return String(v);
    }
    return f.p != null ? String(f.p) : "";
  }

  function substHtml(s, vals, blank) {
    return esc(s).replace(/\{\{(\w+)\}\}/g, function (m, k) {
      var v = vals[k];
      return (v != null && String(v).trim() !== "") ? esc(v) : blank;
    });
  }
  function substText(s, vals) {
    return String(s == null ? "" : s).replace(/\{\{(\w+)\}\}/g, function (m, k) {
      var v = vals[k];
      return (v != null && String(v).trim() !== "") ? String(v) : "________";
    });
  }

  /* Инлайновые стили выгрузки. Word не поддерживает flex и var(--x),
     поэтому шапка и подписи собираются таблицами без рамок. */
  var DOC_INL = {
    title: "text-align:center;font-weight:bold;text-transform:uppercase;letter-spacing:.03em;margin:0 0 2px;font-size:13pt",
    sub: "text-align:center;margin:0 0 14px",
    req: "width:100%;border-collapse:collapse;margin:0 0 14px",
    "req-l": "text-align:left;vertical-align:bottom;padding:0",
    "req-r": "text-align:right;vertical-align:bottom;padding:0",
    addr: "text-align:right;margin:0 0 16px 35%",
    p: "text-align:justify;text-indent:2.2em;margin:0 0 8px",
    np: "text-align:justify;margin:0 0 8px",
    h: "font-weight:bold;margin:14px 0 8px",
    c: "text-align:center;margin:10px 0",
    ol: "margin:0 0 10px;padding-left:1.7em",
    ul: "margin:0 0 10px;padding-left:1.5em",
    li: "margin:0 0 5px;text-align:justify",
    line: "margin:8px 0",
    note: "font-size:10pt;color:#555;margin:10px 0",
    sig: "width:100%;border-collapse:collapse;margin:16px 0 4px",
    "sig-l": "text-align:left;vertical-align:bottom;padding:0 10px 12px 0;white-space:nowrap",
    "sig-m": "border-bottom:1px solid #000;width:100%;padding:0 10px 12px 0",
    "sig-r": "text-align:right;vertical-align:bottom;padding:0 0 12px 0;white-space:nowrap",
    tbl: "width:100%;border-collapse:collapse;margin:0 0 12px",
    th: "border:1px solid #808080;padding:4px 7px;font-weight:bold;background:#f2f2f2;text-align:left",
    td: "border:1px solid #808080;padding:4px 7px;vertical-align:top;text-align:left",
    br: "page-break-after:always;height:0"
  };

  /* Блоки → HTML. inline=false — для экрана (классы), true — для Word и печати. */
  function docHtml(blocks, vals, inline) {
    var BLANK = inline ? "________" : '<span class="doc-fill"></span>';
    function S(s) { return substHtml(s, vals, BLANK); }
    function T(name, content, el) {
      el = el || "div";
      return inline
        ? "<" + el + ' style="' + DOC_INL[name] + '">' + content + "</" + el + ">"
        : '<' + el + ' class="doc-' + name + '">' + content + "</" + el + ">";
    }
    return (blocks || []).map(function (b) {
      var t = b.t;
      if (t === "title") return T("title", S(b.x));
      if (t === "sub") return T("sub", S(b.x));
      if (t === "req") return T("req", "<tr>" + T("req-l", S(b.l), "td") + T("req-r", S(b.r), "td") + "</tr>", "table");
      if (t === "addr") return T("addr", (b.x || []).map(function (l) { return "<div>" + S(l) + "</div>"; }).join(""));
      if (t === "p") return T("p", S(b.x), "p");
      if (t === "np") return T("np", S(b.x), "p");
      if (t === "h") return T("h", S(b.x));
      if (t === "c") return T("c", S(b.x));
      if (t === "ol") return T("ol", (b.x || []).map(function (l) { return T("li", S(l), "li"); }).join(""), "ol");
      if (t === "ul") return T("ul", (b.x || []).map(function (l) { return T("li", S(l), "li"); }).join(""), "ul");
      if (t === "line") return T("line", S(b.x));
      if (t === "note") return T("note", S(b.x));
      if (t === "br") return T("br", "");
      if (t === "sig") return T("sig", (b.x || []).map(function (r) {
        return "<tr>" + T("sig-l", S(r[0]), "td") + T("sig-m", "", "td") + T("sig-r", S(r[1]), "td") + "</tr>";
      }).join(""), "table");
      if (t === "tbl") return T("tbl",
        (b.h && b.h.length ? "<tr>" + b.h.map(function (h) { return T("th", S(h), "th"); }).join("") + "</tr>" : "") +
        (b.x || []).map(function (row) {
          return "<tr>" + row.map(function (c) { return T("td", S(c), "td"); }).join("") + "</tr>";
        }).join(""), "table");
      return "";
    }).join("");
  }

  /* Блоки → простой текст (буфер обмена, .txt) */
  function docText(blocks, vals) {
    var out = [];
    (blocks || []).forEach(function (b) {
      var t = b.t;
      if (t === "title" || t === "sub" || t === "c") out.push(substText(b.x, vals));
      else if (t === "req") out.push(substText(b.l, vals) + "\t\t\t\t\t\t" + substText(b.r, vals));
      else if (t === "addr") out.push((b.x || []).map(function (l) { return substText(l, vals); }).join("\n"));
      else if (t === "p" || t === "np") out.push(substText(b.x, vals));
      else if (t === "h") out.push(substText(b.x, vals).toUpperCase());
      else if (t === "ol") out.push((b.x || []).map(function (l, i) { return (i + 1) + ". " + substText(l, vals); }).join("\n"));
      else if (t === "ul") out.push((b.x || []).map(function (l) { return "— " + substText(l, vals); }).join("\n"));
      else if (t === "line" || t === "note") out.push(substText(b.x, vals));
      else if (t === "br") out.push("\f");
      else if (t === "sig") out.push((b.x || []).map(function (r) {
        return substText(r[0], vals) + "  ______________________  " + substText(r[1], vals);
      }).join("\n"));
      else if (t === "tbl") {
        var rows = [];
        if (b.h && b.h.length) rows.push(b.h.map(function (h) { return substText(h, vals); }).join(" | "));
        (b.x || []).forEach(function (row) { rows.push(row.map(function (c) { return substText(c, vals); }).join(" | ")); });
        out.push(rows.join("\n"));
      }
    });
    return out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  /* Копирование с форматированием: Word и редакторы получают готовую
     структуру, а не сплошной текст. Если ClipboardItem недоступен —
     откатываемся к обычному тексту. */
  function copyRich(html, text, label) {
    var done = function () { toast(label || "Скопировано"); };
    try {
      if (navigator.clipboard && navigator.clipboard.write && typeof ClipboardItem === "function") {
        var item = new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" })
        });
        navigator.clipboard.write([item]).then(done, function () { copyText(text, label); });
        return;
      }
    } catch (e) {}
    copyText(text, label);
  }

  function tplById(id) {
    return (REF.templates || []).filter(function (x) { return x.id === id; })[0];
  }

  /* --- список шаблонов + «Мои реквизиты» --- */

  function viewTemplates() {
    var profile = getProfile();
    var filled = PROFILE_FIELDS.filter(function (f) { return profile[f.k]; }).length;
    var all = roleSort(REF.templates || [], function (t) { return t.t + " " + (t.basis || ""); });
    var groups = [], map = {};
    all.forEach(function (t) {
      var g = t.group || "Прочее";
      if (!map[g]) { map[g] = { g: g, items: [] }; groups.push(map[g]); }
      map[g].items.push(t);
    });

    var prof = '<details class="prof"' + (filled ? "" : " open") + "><summary>Мои реквизиты" +
      (filled ? '<span class="badge">заполнено</span>' : '<span class="small muted">заполните один раз — подставляются во все документы</span>') +
      "</summary><div class=\"prof-grid\">" + PROFILE_FIELDS.map(function (f) {
        return '<div class="field"><label>' + esc(f.l) + "</label>" +
          '<input class="input" data-prof="' + f.k + '" value="' + esc(profile[f.k] || "") + '" placeholder="' + esc(f.p) + '"></div>';
      }).join("") + "</div>" +
      '<div class="actions-row"><button class="btn btn-primary" id="profSave">' + ic("check") + " Сохранить</button>" +
      '<button class="btn" id="profClear">Очистить</button>' +
      '<span class="small muted">Данные остаются в вашем браузере.</span></div></details>';

    /* панель: поиск по шаблонам и быстрый переход к разделу */
    var bar = '<div class="tpl-bar">' +
      '<input class="input" id="tplFind" type="search" autocomplete="off" placeholder="Поиск шаблона: название, правовое основание, раздел">' +
      '<div class="chips tpl-nav">' + groups.map(function (gr) {
        return '<div class="chip" data-tpl-jump="' + esc(gr.g) + '">' + esc(gr.g) + " <b>" + gr.items.length + "</b></div>";
      }).join("") + "</div></div>";

    var cards = groups.map(function (gr) {
      return '<section class="tpl-group" data-group="' + esc(gr.g) + '">' +
        "<h2>" + esc(gr.g) + '<span class="small muted">' + gr.items.length + "</span></h2>" +
        '<div class="grid grid-2">' + gr.items.map(function (t) {
          var hay = (t.t + " " + (t.basis || "") + " " + (t.group || "")).toLowerCase();
          return '<div class="card' + (roleOff(t.t + " " + (t.basis || "")) ? " role-off" : "") + '" data-go="#/template/' + t.id + '" data-tpl-hay="' + esc(hay) + '" style="cursor:pointer">' +
            '<div style="font-weight:620">' + esc(t.t) + "</div>" +
            '<div class="small muted" style="margin-top:4px">' + esc(t.basis || "") + "</div>" +
            '<div class="small muted" style="margin-top:8px">' + (t.fields || []).length + " " +
            plural((t.fields || []).length, ["поле", "поля", "полей"]) +
            ((t.articles || []).length ? " · " + (t.articles || []).length + " " +
              plural((t.articles || []).length, ["статья", "статьи", "статей"]) : "") + "</div></div>";
        }).join("") + "</div></section>";
    }).join("");

    return "<h1>Шаблоны документов</h1>" +
      '<p class="lead">' + all.length + " " + plural(all.length, ["готовый бланк", "готовых бланка", "готовых бланков"]) +
      " по " + groups.length + " " + plural(groups.length, ["разделу", "разделам", "разделам"]) +
      ": уголовный процесс, административные правонарушения, гражданский и арбитражный процесс, трудовые споры, обращения и надзор. " +
      "Заполните поля — документ собирается сразу, с шапкой, реквизитами, пунктами и подписями. Его можно скопировать с форматированием, скачать в Word, сохранить текстом или распечатать.</p>" +
      tabStrip(SCEN_TABS, "templates") +
      prof + bar + cards +
      '<div class="empty" id="tplEmpty" hidden><div class="ico">' + ic("search") + '</div><div>Ничего не найдено. Измените запрос или очистите поиск.</div></div>' +
      '<div class="disclaimer">Шаблоны носят справочный характер и требуют адаптации к материалам конкретного дела, а также проверки актуальных требований ведомственных приказов и бланков.</div>';
  }

  function bindTemplates() {
    var save = $("#profSave"), clr = $("#profClear");
    if (save) save.addEventListener("click", function () {
      var p = {};
      $$("[data-prof]").forEach(function (el) { p[el.getAttribute("data-prof")] = el.value.trim(); });
      setProfile(p);
      var n = PROFILE_FIELDS.filter(function (f) { return p[f.k]; }).length;
      toast(n ? "Реквизиты сохранены — подставятся в документы" : "Реквизиты очищены");
      render();
    });
    if (clr) clr.addEventListener("click", function () {
      setProfile({}); toast("Реквизиты очищены"); render();
    });

    /* поиск по шаблонам: фильтруем карточки, пустые разделы прячем */
    var find = $("#tplFind");
    if (find) {
      var apply = function () {
        var q = find.value.trim().toLowerCase();
        var shown = 0;
        $$("#view .tpl-group").forEach(function (sec) {
          var n = 0;
          $$(".card", sec).forEach(function (card) {
            var hit = !q || (card.getAttribute("data-tpl-hay") || "").indexOf(q) !== -1;
            card.hidden = !hit;
            if (hit) n++;
          });
          sec.hidden = n === 0;
          shown += n;
        });
        var empty = $("#tplEmpty");
        if (empty) empty.hidden = shown !== 0;
      };
      find.addEventListener("input", apply);
      find.addEventListener("search", apply);
      find.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && find.value) { find.value = ""; apply(); }
      });
    }

    /* переход к разделу списка */
    $$("#view [data-tpl-jump]").forEach(function (el) {
      el.addEventListener("click", function () {
        var g = el.getAttribute("data-tpl-jump");
        var sec = $$("#view .tpl-group").filter(function (s) { return s.getAttribute("data-group") === g; })[0];
        if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  /* --- один документ --- */

  function viewTemplate(id) {
    var t = tplById(id);
    if (!t) return '<div class="empty"><div class="ico">' + ic("file") + '</div><div>Шаблон не найден.</div></div>';
    var profile = getProfile();
    var fields = (t.fields || []).map(function (f) {
      var v = tplValue(f, profile);
      var auto = f.src ? ' <span class="tpl-auto">авто</span>' : "";
      var inp = f.type === "textarea"
        ? '<textarea class="input" rows="3" data-tf="' + esc(f.k) + '" placeholder="' + esc(f.p || "") + '">' + esc(v) + "</textarea>"
        : '<input class="input" data-tf="' + esc(f.k) + '" value="' + esc(v) + '" placeholder="' + esc(f.p || "") + '">';
      return '<div class="field"><label>' + esc(f.l) + auto + "</label>" + inp + "</div>";
    }).join("");

    var arts = (t.articles || []).map(function (aid) { return byId[aid]; }).filter(Boolean);

    return '<div class="crumbs"><span class="lnk" data-go="#/templates">Шаблоны документов</span></div>' +
      "<h1>" + esc(t.t) + "</h1>" +
      '<p class="lead">Правовое основание: ' + esc(t.basis || "") + "</p>" +
      tabStrip(SCEN_TABS, "templates") +
      '<div class="split">' +
        "<div>" +
          '<div class="card"><div class="section-label" style="margin-top:0">Данные для подстановки</div>' + fields +
            '<div class="actions-row">' +
              '<button class="btn" id="tplReset">Сбросить к образцу</button>' +
              '<button class="btn" id="tplClear">Очистить</button>' +
            "</div>" +
            (!profile.fio ? '<div class="small muted" style="margin-top:8px">Подсказка: заполните «Мои реквизиты» в списке шаблонов — должность и ФИО будут подставляться сами.</div>' : "") +
          "</div>" +
          (arts.length ? '<div class="card" style="margin-top:12px"><div class="section-label" style="margin-top:0">Правовое основание</div>' +
            '<div class="chips">' + arts.map(function (a) {
              var c = codeById(a.c) || { short: a.c, color: "#888" };
              return '<div class="chip" data-go="#/article/' + encodeURIComponent(a.id) + '"><b>' + esc(cite(a)) + "</b> · " + esc(a.t) + "</div>";
            }).join("") + "</div>" +
            '<div class="actions-row"><button class="btn" data-col-batch="' + esc((t.articles || []).join(",")) + '">' +
            ic("clip") + " Статьи в подборку</button></div></div>" : "") +
        "</div>" +
        "<div>" +
          '<div class="card"><div class="section-label" style="margin-top:0">Готовый документ</div>' +
          '<div class="doc-sheet" id="tplOut"></div>' +
          '<div class="actions-row">' +
            '<button class="btn btn-primary" id="tplCopyRich">' + ic("clip") + " Скопировать</button>" +
            '<button class="btn" id="tplDoc">' + ic("file") + " Скачать .doc</button>" +
            '<button class="btn" id="tplTxt">' + ic("file") + " Скачать .txt</button>" +
            '<button class="btn no-print" id="tplPrint">' + ic("print") + " Печать</button>" +
          "</div></div>" +
        "</div>" +
      "</div>" +
      '<div class="disclaimer">Проверьте нумерацию, даты и ссылки на материалы дела перед подписанием. Шаблон не учитывает особенности конкретного ведомственного бланка.</div>';
  }

  function bindTemplate() {
    var t = tplById(state.route.arg);
    if (!t) return;
    var out = $("#tplOut");

    function vals() {
      var v = {};
      $$("[data-tf]").forEach(function (el) { v[el.getAttribute("data-tf")] = el.value; });
      return v;
    }
    function screen() { return docHtml(t.blocks, vals(), false); }
    function word() { return docHtml(t.blocks, vals(), true); }
    function plain() { return docText(t.blocks, vals()); }
    function refresh() { out.innerHTML = screen(); }

    $$("[data-tf]").forEach(function (el) {
      el.addEventListener("input", refresh);
      el.addEventListener("change", refresh);
    });

    $("#tplReset").addEventListener("click", function () {
      var profile = getProfile();
      $$("[data-tf]").forEach(function (el) {
        var f = (t.fields || []).filter(function (x) { return x.k === el.getAttribute("data-tf"); })[0];
        el.value = f ? tplValue(f, profile) : "";
      });
      refresh(); toast("Поля сброшены к образцу");
    });
    $("#tplClear").addEventListener("click", function () {
      $$("[data-tf]").forEach(function (el) { el.value = ""; });
      refresh(); toast("Поля очищены");
    });

    $("#tplCopyRich").addEventListener("click", function () {
      copyRich(word(), plain(), "Документ скопирован");
    });
    $("#tplTxt").addEventListener("click", function () {
      download(t.id + ".txt", plain(), "text/plain"); toast("Файл сохранён");
    });
    $("#tplDoc").addEventListener("click", function () {
      saveDocx(t.id + ".doc", t.t, '<div style="font-family:\'Times New Roman\',serif;font-size:12pt">' + word() + "</div>");
      toast("Файл сохранён");
    });
    $("#tplPrint").addEventListener("click", function () {
      printDoc("", '<div class="doc-sheet doc-print">' + word() + "</div>");
    });

    refresh();
  }

  /* --- подборка норм --- */

  function viewCollection() {
    var items = colItems();
    var head = '<h1>Подборка норм</h1>' +
      '<p class="lead">Рабочий набор статей по делу: добавляйте нормы из поиска, из текста статьи и из разбора ситуации, пишите заметки к позициям и выгружайте одним документом. Хранится только в вашем браузере.</p>';

    if (!items.length) {
      return head + '<div class="empty"><div class="ico">' + ic("clip") + '</div><div>Подборка пуста. Откройте статью и нажмите «В подборку» — или добавьте нормы прямо из результатов поиска.</div></div>' +
        '<div class="chips" style="margin-top:14px">' +
        ["ст 105 УК", "статья 91 УПК", "19.7 КоАП", "обыск в жилище", "получение взятки"]
          .map(function (x) { return '<div class="chip" data-go="#/search/' + encodeURIComponent(x) + '">' + esc(x) + "</div>"; }).join("") +
        "</div>";
    }

    var missing = state.col.length - items.length;
    var body = items.map(function (x, i) {
      var a = x.a, c = codeById(a.c) || { short: a.c, color: "#888", branch: "" };
      return '<div class="col-item" data-col-item="' + esc(a.id) + '">' +
        '<div class="col-head">' +
          '<span class="col-idx">' + (i + 1) + "</span>" +
          '<span class="badge badge-code" style="border-color:' + c.color + '44;color:' + c.color + '">' + esc(c.short) + "</span>" +
          '<span class="result-num">ст. ' + esc(a.dn) + "</span>" +
          '<span class="result-title" data-go="#/article/' + encodeURIComponent(a.id) + '">' + esc(a.t) + "</span>" +
          '<span class="col-tools">' +
            '<button class="ibtn" data-col-up="' + esc(a.id) + '" title="Выше" aria-label="Выше">↑</button>' +
            '<button class="ibtn" data-col-down="' + esc(a.id) + '" title="Ниже" aria-label="Ниже">↓</button>' +
            '<button class="ibtn ibtn-del" data-col-del="' + esc(a.id) + '" title="Убрать" aria-label="Убрать">✕</button>' +
          "</span>" +
        "</div>" +
        '<textarea class="input col-note" data-col-note="' + esc(a.id) + '" rows="2" ' +
          'placeholder="Заметка к позиции: зачем норма, на что обратить внимание…">' + esc(x.e.note || "") + "</textarea>" +
        '<div class="col-preview small muted" data-col-preview="' + esc(a.id) + '">' +
          (a.s ? esc(snippet(a.s, [], 240)) : "Текст подгрузится при экспорте…") + "</div>" +
        "</div>";
    }).join("");

    return head +
      '<div class="actions-row">' +
        '<button class="btn btn-primary" id="colExportDoc">Скачать .doc</button>' +
        '<button class="btn" id="colExportTxt">Скачать .txt</button>' +
        '<button class="btn" id="colCopy">Скопировать текстом</button>' +
        '<button class="btn" id="colPrint">Печать / PDF</button>' +
        '<button class="btn" id="colClear">Очистить подборку</button>' +
      "</div>" +
      '<div class="small muted" style="margin-bottom:14px">В подборке ' + items.length + " " +
        plural(items.length, ["статья", "статьи", "статей"]) +
        (missing > 0 ? " · " + missing + " " + plural(missing, ["запись недоступна", "записи недоступны", "записей недоступно"]) : "") +
      ". Заметки сохраняются автоматически.</div>" +
      body;
  }

  /* -------------------------------------------------------------- дела */

  function viewCases() {
    var head = '<h1>Дела</h1>' +
      '<p class="lead">Рабочие папки по делам: в каждую собираются нужные нормы с заметками и ведётся журнал по делу. ' +
      "Всё хранится только в вашем браузере — ничего никуда не отправляется.</p>";

    var form = '<div class="card"><h3 style="margin-top:0">Новое дело</h3>' +
      '<div class="actions-row">' +
        '<input class="input" id="caseNewTitle" placeholder="Название — например: Дело № 123456, Иванов И.И." style="flex:1 1 260px">' +
        '<input class="input" id="caseNewDesc" placeholder="Кратко: что произошло, статья, стадия" style="flex:1 1 260px">' +
        '<button class="btn btn-primary" id="caseNewBtn">Создать дело</button>' +
      "</div></div>";

    if (!state.cases.length) {
      return head + form +
        '<div class="empty"><div class="ico">' + ic("folder") + '</div><div>Дел пока нет. Создайте первое — ' +
        "потом добавляйте в него нормы прямо со страницы статьи.</div></div>";
    }

    var cards = state.cases.map(function (c) {
      var items = caseItems(c.id);
      return '<div class="card case-card" data-go="#/case/' + encodeURIComponent(c.id) + '">' +
        '<div class="case-card-head">' +
          '<span class="result-title">' + ic("folder") + " " + esc(c.title) + "</span>" +
          '<span class="badge">' + items.length + " " + plural(items.length, ["норма", "нормы", "норм"]) + "</span>" +
          '<span class="badge">' + c.notes.length + " " + plural(c.notes.length, ["заметка", "заметки", "заметок"]) + "</span>" +
        "</div>" +
        (c.desc ? '<div class="small muted">' + esc(c.desc) + "</div>" : "") +
        '<div class="result-meta"><span>изменено ' + esc(fmtDate(new Date(c.updated || c.created))) + "</span></div>" +
        "</div>";
    }).join("");

    return head + form +
      '<div class="grid grid-2" style="margin-top:14px">' + cards + "</div>" +
      '<div class="actions-row" style="margin-top:16px">' +
        '<button class="btn" id="caseExportJson">Выгрузить все дела (JSON)</button>' +
        '<button class="btn" id="caseImportBtn">Загрузить из файла</button>' +
        '<input type="file" id="caseImportFile" accept=".json,application/json" style="display:none">' +
      "</div>";
  }

  function viewCase(id) {
    var c = caseById(id);
    if (!c) {
      return '<div class="empty"><div class="ico">' + ic("folder") + '</div><div>Дело не найдено. Возможно, оно было удалено.</div></div>' +
        '<div class="chips"><div class="chip" data-go="#/cases">К списку дел</div></div>';
    }

    var items = caseItems(c.id);
    var missing = c.items.length - items.length;

    var head = '<div class="article-head">' +
      '<div class="article-cite">Дело · изменено ' + esc(fmtDate(new Date(c.updated || c.created))) + "</div>" +
      '<div class="article-title">' + ic("folder") + " " + esc(c.title) + "</div>" +
      '<div class="result-meta"><span>' + items.length + " " + plural(items.length, ["норма", "нормы", "норм"]) + "</span>" +
        "<span>" + c.notes.length + " " + plural(c.notes.length, ["заметка", "заметки", "заметок"]) + "</span>" +
        (missing > 0 ? "<span>" + missing + " " + plural(missing, ["запись недоступна", "записи недоступны", "записей недоступно"]) + "</span>" : "") +
      "</div></div>";

    var actions = '<div class="actions-row">' +
      '<button class="btn btn-primary" id="caseExportDoc">Скачать .doc</button>' +
      '<button class="btn" id="caseExportTxt">Скачать .txt</button>' +
      '<button class="btn" id="caseCopy">Скопировать текстом</button>' +
      '<button class="btn" id="casePrint">Печать / PDF</button>' +
      '<button class="btn" id="caseDel">Удалить дело</button>' +
      "</div>";

    var edit = '<div class="card"><h3 style="margin-top:0">Реквизиты дела</h3>' +
      '<input class="input" id="caseTitle" value="' + esc(c.title) + '" placeholder="Название дела" style="width:100%;margin-bottom:8px">' +
      '<textarea class="textarea" id="caseDesc" rows="2" placeholder="Краткое описание: что произошло, статья, стадия, участники" style="width:100%">' +
        esc(c.desc) + "</textarea>" +
      '<div class="small muted" style="margin-top:8px">Поля сохраняются сразу, кнопки сохранять нет.</div></div>';

    var find = '<div class="card"><h3 style="margin-top:0">Добавить норму</h3>' +
      '<div class="actions-row">' +
        '<input class="input" id="caseFind" placeholder="Номер или слова — например: 91 УПК, обыск в жилище" style="flex:1 1 260px">' +
        '<button class="btn btn-primary" id="caseFindBtn">Найти</button>' +
      "</div>" +
      '<div id="caseFindOut"></div>' +
      '<p class="small muted">Норму можно добавить и со страницы самой статьи — списком «В дело».</p></div>';

    var body = items.length ? items.map(function (x, i) {
      var a = x.a, cc = codeById(a.c) || { short: a.c, color: "#888", branch: "" };
      return '<div class="col-item" data-case-item="' + esc(a.id) + '">' +
        '<div class="col-head">' +
          '<span class="col-idx">' + (i + 1) + "</span>" +
          '<span class="badge badge-code" style="border-color:' + cc.color + '44;color:' + cc.color + '">' + esc(cc.short) + "</span>" +
          '<span class="result-num">ст. ' + esc(a.dn) + "</span>" +
          '<span class="result-title" data-go="#/article/' + encodeURIComponent(a.id) + '">' + esc(a.t) + "</span>" +
          '<span class="col-tools">' +
            '<button class="ibtn" data-case-up="' + esc(a.id) + '" title="Выше" aria-label="Выше">↑</button>' +
            '<button class="ibtn" data-case-down="' + esc(a.id) + '" title="Ниже" aria-label="Ниже">↓</button>' +
            '<button class="ibtn ibtn-del" data-case-del="' + esc(a.id) + '" title="Убрать из дела" aria-label="Убрать из дела">✕</button>' +
          "</span>" +
        "</div>" +
        '<textarea class="input col-note" data-case-note="' + esc(a.id) + '" rows="2" ' +
          'placeholder="Заметка к норме: зачем она в деле, на что обратить внимание…">' + esc(x.e.note || "") + "</textarea>" +
        "</div>";
    }).join("") : '<div class="empty"><div class="ico">' + ic("file") + '</div><div>В деле пока нет норм.</div></div>';

    var notes = '<div class="card"><h3 style="margin-top:0">Заметки по делу</h3>' +
      '<textarea class="textarea" id="caseNoteNew" rows="3" ' +
        'placeholder="Свободная заметка: хронология, что сделано, что проверить, вопросы…" style="width:100%"></textarea>' +
      '<div class="actions-row"><button class="btn btn-primary" id="caseNoteAdd">Добавить заметку</button></div>' +
      (c.notes.length ? '<div style="margin-top:12px">' + c.notes.map(function (n) {
        return '<div class="case-note" data-case-note-row="' + esc(n.id) + '">' +
          '<div class="small muted">' + esc(fmtDate(new Date(n.created))) + "</div>" +
          '<textarea class="textarea" data-case-note-text="' + esc(n.id) + '" rows="3" style="width:100%">' + esc(n.text) + "</textarea>" +
          '<button class="ibtn ibtn-del" data-case-note-del="' + esc(n.id) + '" title="Удалить заметку" aria-label="Удалить заметку">✕</button>' +
          "</div>";
      }).join("") + "</div>" : '<div class="small muted" style="margin-top:10px">Заметок пока нет.</div>') +
      "</div>";

    return head + actions + edit + find +
      '<h2 style="margin-top:22px">Нормы в деле</h2>' + body + notes;
  }

  /* Полные тексты норм дела: догружаем отсутствующие */
  function caseCollect(id, cb) {
    var items = caseItems(id);
    var need = [];
    items.forEach(function (x) { if (!hasFull(x.a.c)) need.push(x.a.c); });
    var left = need.length;
    if (!left) { cb(items); return; }
    need.forEach(function (d) { loadFull(d, function () { if (--left === 0) cb(items); }); });
  }

  function caseTextPlain(c, items) {
    var blocks = colBody(items).map(function (d) {
      return [d.n + ". " + citeFull(d.a),
        d.red ? "Редакция: " + d.red : "",
        d.note ? "Заметка: " + d.note : "",
        "", d.text, "", "Источник: " + d.url].filter(function (l) { return l !== ""; }).join("\n");
    });
    var out = "ДЕЛО: " + c.title + "\n";
    if (c.desc) out += c.desc + "\n";
    out += fmtDate(new Date()) + "\n\n" + blocks.join("\n\n" + "-".repeat(60) + "\n\n");
    if (c.notes.length) {
      out += "\n\n" + "=".repeat(60) + "\n\nЗАМЕТКИ ПО ДЕЛУ\n\n" +
        c.notes.map(function (n, i) {
          return (i + 1) + ". [" + fmtDate(new Date(n.created)) + "]\n" + n.text;
        }).join("\n\n");
    }
    return out + "\n";
  }

  function caseDocHtml(c, items) {
    var notes = c.notes.length ? "<hr><h2>Заметки по делу</h2>" + c.notes.map(function (n, i) {
      return '<p class="m"><b>' + (i + 1) + ".</b> " + esc(fmtDate(new Date(n.created))) + "</p>" +
        "<pre>" + esc(n.text) + "</pre>";
    }).join("") : "";
    return '<html><head><meta charset="utf-8"><title>' + esc(c.title) + "</title><style>" +
      "body{font:14px/1.6 Georgia,serif;margin:32px;color:#111}" +
      "h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 8px}" +
      "pre{font:13.5px/1.6 Georgia,serif;white-space:pre-wrap;margin:0 0 8px}" +
      ".m{color:#666;font-size:12px;margin:0 0 10px}.nt{background:#f2f4f7;padding:8px 10px;border-left:3px solid #888;margin:0 0 10px}" +
      "hr{border:0;border-top:1px solid #ccc;margin:18px 0}" +
      "</style></head><body><h1>" + esc(c.title) + "</h1>" +
      (c.desc ? '<p class="m">' + esc(c.desc) + "</p>" : "") +
      '<p class="m">' + esc(fmtDate(new Date())) + " · " + items.length + " " +
      plural(items.length, ["норма", "нормы", "норм"]) + "</p><hr>" +
      colTextHtml(items) + notes + "</body></html>";
  }

  function bindCases() {
    syncCaseCount();
    var btn = $("#caseNewBtn");
    if (btn) btn.addEventListener("click", function () {
      var t = $("#caseNewTitle"), d = $("#caseNewDesc");
      var c = caseAdd(t ? t.value : "", d ? d.value : "");
      toast("Дело создано");
      go("#/case/" + encodeURIComponent(c.id));
    });
    var t = $("#caseNewTitle");
    if (t) t.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { var b = $("#caseNewBtn"); if (b) b.click(); }
    });

    var ex = $("#caseExportJson");
    if (ex) ex.addEventListener("click", function () {
      download("pravovoy-konsultant-dela.json", JSON.stringify({
        app: "pravovoy-konsultant", kind: "cases", exported: new Date().toISOString(), cases: state.cases
      }, null, 1), "application/json");
      toast("Дела выгружены в файл");
    });

    var im = $("#caseImportBtn"), f = $("#caseImportFile");
    if (im && f && typeof FileReader !== "undefined") {
      im.addEventListener("click", function () { f.click(); });
      f.addEventListener("change", function () {
        var file = f.files && f.files[0];
        if (!file) return;
        var fr = new FileReader();
        fr.onload = function () {
          var add = 0;
          try {
            var data = JSON.parse(String(fr.result));
            var list = data && data.cases;
            if (!Array.isArray(list)) throw new Error("нет списка дел");
            list.forEach(function (c) {
              if (!c || !c.id || caseById(c.id)) return;
              state.cases.push({
                id: c.id, title: String(c.title || "Дело без названия"), desc: String(c.desc || ""),
                created: c.created || Date.now(), updated: c.updated || Date.now(),
                items: Array.isArray(c.items) ? c.items.filter(function (i) { return i && i.id; }) : [],
                notes: Array.isArray(c.notes) ? c.notes.filter(function (n) { return n && n.id; }) : []
              });
              add++;
            });
            caseSave();
          } catch (e) { toast("Файл не распознан"); }
          toast(add ? "Загружено дел: " + add : "Новых дел в файле нет");
          render();
          try { f.value = ""; } catch (e) {}
        };
        fr.readAsText(file);
      });
    }
  }

  function bindCase(id) {
    var c = caseById(id);
    if (!c) return;
    syncCaseCount();

    var ti = $("#caseTitle");
    if (ti) ti.addEventListener("input", function () { c.title = ti.value; c.updated = Date.now(); LS.set("cases", state.cases); });
    var de = $("#caseDesc");
    if (de) de.addEventListener("input", function () { c.desc = de.value; c.updated = Date.now(); LS.set("cases", state.cases); });

    $$("[data-case-up]").forEach(function (b) {
      b.addEventListener("click", function () { caseMoveItem(id, b.getAttribute("data-case-up"), -1); render(); });
    });
    $$("[data-case-down]").forEach(function (b) {
      b.addEventListener("click", function () { caseMoveItem(id, b.getAttribute("data-case-down"), 1); render(); });
    });
    $$("[data-case-del]").forEach(function (b) {
      b.addEventListener("click", function () { caseDelItem(id, b.getAttribute("data-case-del")); render(); });
    });
    $$("[data-case-note]").forEach(function (t) {
      t.addEventListener("input", function () {
        var i = caseItemIdx(c, t.getAttribute("data-case-note"));
        if (i === -1) return;
        c.items[i].note = t.value;
        LS.set("cases", state.cases);
      });
    });
    $$("[data-case-note-text]").forEach(function (t) {
      t.addEventListener("input", function () {
        var nid = t.getAttribute("data-case-note-text");
        c.notes.forEach(function (n) { if (n.id === nid) n.text = t.value; });
        LS.set("cases", state.cases);
      });
    });
    $$("[data-case-note-del]").forEach(function (b) {
      b.addEventListener("click", function () { caseDelNote(id, b.getAttribute("data-case-note-del")); render(); });
    });

    var na = $("#caseNoteAdd");
    if (na) na.addEventListener("click", function () {
      var t = $("#caseNoteNew");
      if (!t || !t.value.trim()) { toast("Заметка пустая"); return; }
      caseAddNote(id, t.value);
      render();
      toast("Заметка добавлена");
    });

    /* поиск нормы прямо внутри дела */
    function runFind() {
      var out = $("#caseFindOut"), fi = $("#caseFind");
      if (!out || !fi) return;
      var q = fi.value.trim();
      if (q.length < 2) { out.innerHTML = '<div class="small muted">Введите не меньше двух символов.</div>'; return; }
      var res = search(q).slice(0, 12);
      if (!res.length) {
        out.innerHTML = '<div class="small muted">По названиям и ключевым словам ничего не найдено. ' +
          "Попробуйте поиск по тексту на странице поиска — там ищется и внутри статей.</div>";
        return;
      }
      out.innerHTML = '<div style="margin-top:10px">' + res.map(function (x) {
        var a = x.a, cc = codeById(a.c) || { short: a.c, color: "#888" };
        var on = caseItemIdx(c, a.id) !== -1;
        return '<div class="result"><div class="result-head">' +
          '<span class="badge badge-code" style="border-color:' + cc.color + '44;color:' + cc.color + '">' + esc(cc.short) + "</span>" +
          '<span class="result-num">ст. ' + esc(a.dn) + "</span>" +
          '<span class="result-title">' + esc(a.t) + "</span>" +
          '<button class="btn btn-sm' + (on ? " active" : "") + '" data-case-pick="' + esc(a.id) + '">' +
            (on ? "✓ В деле" : "＋ В дело") + "</button>" +
          "</div></div>";
      }).join("") + "</div>";
      $$("[data-case-pick]").forEach(function (b) {
        b.addEventListener("click", function () {
          if (caseAddItem(id, b.getAttribute("data-case-pick"))) toast("Норма добавлена в дело");
          else toast("Эта норма уже есть в деле");
          /* перерисовываем страницу, иначе список норм в деле не обновится;
             строку запроса и результаты поиска возвращаем на место */
          var q = fi.value;
          render();
          var nf = $("#caseFind");
          if (nf) { nf.value = q; if (q.trim().length >= 2) runFind(); }
        });
      });
    }
    var fb = $("#caseFindBtn");
    if (fb) fb.addEventListener("click", runFind);
    var fi = $("#caseFind");
    if (fi) fi.addEventListener("keydown", function (e) { if (e.key === "Enter") runFind(); });

    /* удаление — в два шага, без всплывающих confirm */
    var db = $("#caseDel");
    if (db) db.addEventListener("click", function () {
      if (db.getAttribute("data-armed") !== "1") {
        db.setAttribute("data-armed", "1");
        db.textContent = "Точно удалить?";
        db.style.borderColor = "#e2564a";
        db.style.color = "#e2564a";
        return;
      }
      caseRemove(id);
      toast("Дело удалено");
      go("#/cases");
    });

    var ed = $("#caseExportDoc");
    if (ed) ed.addEventListener("click", function () {
      caseCollect(id, function (items) {
        download("delo.doc", caseDocHtml(c, items), "application/msword");
        toast("Файл .doc сохранён");
      });
    });
    var et = $("#caseExportTxt");
    if (et) et.addEventListener("click", function () {
      caseCollect(id, function (items) {
        download("delo.txt", caseTextPlain(c, items), "text/plain");
        toast("Файл .txt сохранён");
      });
    });
    var cp = $("#caseCopy");
    if (cp) cp.addEventListener("click", function () {
      caseCollect(id, function (items) {
        copyText(caseTextPlain(c, items), "Дело скопировано текстом");
      });
    });
    var pr = $("#casePrint");
    if (pr) pr.addEventListener("click", function () {
      caseCollect(id, function (items) {
        printDoc(c.title, colTextHtml(items) +
          (c.notes.length ? "<hr><h2>Заметки по делу</h2>" + c.notes.map(function (n, i) {
            return '<p class="m"><b>' + (i + 1) + ".</b> " + esc(fmtDate(new Date(n.created))) + "</p><pre>" + esc(n.text) + "</pre>";
          }).join("") : ""));
      });
    });
  }

  /* Полные тексты позиций подборки: догружаем отсутствующие, затем отдаём HTML */
  function collectDocs(cb) {
    var items = colItems();
    var need = [];
    items.forEach(function (x) { if (!hasFull(x.a.c)) need.push(x.a.c); });
    var left = need.length;
    if (!left) { cb(items); return; }
    need.forEach(function (id) {
      loadFull(id, function () { if (--left === 0) cb(items); });
    });
  }

  function colBody(items) {
    return items.map(function (x, i) {
      var a = x.a, c = codeById(a.c);
      var row = findFull(a.c, a.n);
      var txt = row ? row[4] : (a.s || "Текст не входит в открытый набор данных.");
      return {
        n: i + 1, a: a, c: c, note: (x.e.note || "").trim(),
        red: row && row[3] ? fmtRed(row[3]) : (c && c.redaction ? fmtRed(c.redaction) : ""),
        text: txt, url: officialUrl(a)
      };
    });
  }

  function colTextPlain(items) {
    var blocks = colBody(items).map(function (d) {
      return [d.n + ". " + citeFull(d.a),
        d.red ? "Редакция: " + d.red : "",
        d.note ? "Заметка: " + d.note : "",
        "",
        d.text,
        "",
        "Источник: " + d.url].filter(function (l) { return l !== ""; }).join("\n");
    });
    return "ПОДБОРКА НОРМ\n" + fmtDate(new Date()) + "\n\n" + blocks.join("\n\n" + "-".repeat(60) + "\n\n") + "\n";
  }

  function colTextHtml(items) {
    var blocks = colBody(items).map(function (d) {
      return "<h2>" + d.n + ". " + esc(citeFull(d.a)) + "</h2>" +
        (d.red ? '<p class="m"><i>Редакция: ' + esc(d.red) + "</i></p>" : "") +
        (d.note ? '<p class="nt"><b>Заметка:</b> ' + esc(d.note) + "</p>" : "") +
        "<pre>" + esc(d.text) + "</pre>" +
        '<p class="m">Источник: ' + esc(d.url) + "</p>";
    });
    return blocks.join("\n");
  }

  function colDocHtml(items) {
    return '<html><head><meta charset="utf-8"><title>Подборка норм</title><style>' +
      "body{font:14px/1.6 Georgia,serif;margin:32px;color:#111}" +
      "h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 8px}" +
      "pre{font:13.5px/1.6 Georgia,serif;white-space:pre-wrap;margin:0 0 8px}" +
      ".m{color:#666;font-size:12px;margin:0 0 10px}.nt{background:#f2f4f7;padding:8px 10px;border-left:3px solid #888;margin:0 0 10px}" +
      "hr{border:0;border-top:1px solid #ccc;margin:18px 0}" +
      "</style></head><body><h1>Подборка норм</h1>" +
      '<p class="m">' + esc(fmtDate(new Date())) + " · " + items.length + " " +
      plural(items.length, ["статья", "статьи", "статей"]) + "</p><hr>" + colTextHtml(items) + "</body></html>";
  }

  /* Печать без всплывающих окон: печатается только временный блок */
  function printDoc(title, html) {
    var box = document.createElement("div");
    box.id = "printArea";
    box.innerHTML = (title ? "<h1>" + esc(title) + "</h1>" : "") + html;
    document.body.appendChild(box);
    document.body.classList.add("printing");
    var done = function () {
      document.body.classList.remove("printing");
      if (box.parentNode) box.parentNode.removeChild(box);
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    try { window.print(); } catch (e) {}
    setTimeout(done, 2000);
  }

  function bindCollection() {
    syncColCount();

    /* предпросмотр текстов позиций */
    colItems().forEach(function (x) {
      var box = $('[data-col-preview="' + x.a.id + '"]');
      if (!box) return;
      loadFull(x.a.c, function (err) {
        if (err) return;
        var row = findFull(x.a.c, x.a.n);
        if (!row) return;
        box.textContent = snippet(row[4], [], 260);
      });
    });

    $$("[data-col-up]").forEach(function (b) {
      b.addEventListener("click", function () { colMove(b.getAttribute("data-col-up"), -1); render(); });
    });
    $$("[data-col-down]").forEach(function (b) {
      b.addEventListener("click", function () { colMove(b.getAttribute("data-col-down"), 1); render(); });
    });
    $$("[data-col-del]").forEach(function (b) {
      b.addEventListener("click", function () { colRemove(b.getAttribute("data-col-del")); render(); });
    });
    $$("[data-col-note]").forEach(function (t) {
      t.addEventListener("input", function () {
        var i = colIndex(t.getAttribute("data-col-note"));
        if (i === -1) return;
        state.col[i].note = t.value;
        LS.set("col", state.col);
      });
    });

    var clr = $("#colClear");
    if (clr) clr.addEventListener("click", function () { colClear(); render(); toast("Подборка очищена"); });

    var ed = $("#colExportDoc");
    if (ed) ed.addEventListener("click", function () {
      collectDocs(function (items) {
        download("podborka-norm.doc", colDocHtml(items), "application/msword");
        toast("Файл .doc сохранён");
      });
    });
    var et = $("#colExportTxt");
    if (et) et.addEventListener("click", function () {
      collectDocs(function (items) {
        download("podborka-norm.txt", colTextPlain(items), "text/plain");
        toast("Файл .txt сохранён");
      });
    });
    var cp = $("#colCopy");
    if (cp) cp.addEventListener("click", function () {
      collectDocs(function (items) { copyText(colTextPlain(items), "Подборка скопирована"); });
    });
    var pr = $("#colPrint");
    if (pr) pr.addEventListener("click", function () {
      collectDocs(function (items) { printDoc("Подборка норм", colTextHtml(items)); });
    });
  }

  /* --- избранное --- */

  function viewFavorites() {
    var items = state.fav.map(function (id) { return byId[id]; }).filter(Boolean).sort(cmpArticles);
    if (!items.length) {
      return '<h1>Избранное</h1><p class="lead">Здесь появятся статьи, которые вы отметите звёздочкой.</p>' +
        '<div class="empty"><div class="ico">' + ic("star") + '</div><div>Список пуст. Откройте статью и нажмите «В избранное».</div></div>';
    }
    var rows = items.map(function (a) {
      var c = codeById(a.c) || { short: a.c, color: "#888" };
      return '<div class="result" data-go="#/article/' + encodeURIComponent(a.id) + '">' +
        '<div class="result-head"><span class="badge badge-code" style="border-color:' + c.color + '44;color:' + c.color + '">' + esc(c.short) + '</span>' +
        '<span class="result-num">ст. ' + esc(a.dn) + '</span><span class="result-title">' + esc(a.t) + "</span></div>" +
        (a.s ? '<div class="result-snippet">' + esc(snippet(a.s, [], 150)) + "</div>" : "") + "</div>";
    }).join("");
    var txt = items.map(function (a) { return cite(a) + " — " + a.t; }).join("\n");
    return '<h1>Избранное</h1><p class="lead">Сохранено ' + items.length + " " + plural(items.length, ["статья", "статьи", "статей"]) + ".</p>" +
      '<div class="actions-row" style="margin-bottom:16px"><button class="btn" data-copy-raw="' + encodeURIComponent(txt) + '">Скопировать список</button>' +
      '<button class="btn" id="favClear">Очистить избранное</button></div>' + rows;
  }

  /* --- справка --- */

  /* ------------------------------------------------------------------ реестр утративших силу */

  /* Плоский список утративших силу и приостановленных норм — собирается из
     слоя статусов с подстановкой названия из индекса. Индекс не содержит
     собственного статуса, поэтому связываем по id. */
  function repealedList() {
    var out = [];
    Object.keys(STATUS).forEach(function (id) {
      var s = STATUS[id];
      var a = byId[id];
      if (!a) return;
      out.push({
        id: id, art: a, st: s[0], act: s[1] || "", date: s[2] || "",
        title: ST_TITLE[s[0]] || "Утратила силу"
      });
    });
    out.sort(function (x, y) {
      /* сначала свежие по дате акта */
      if (x.date !== y.date) return (y.date || "").localeCompare(x.date || "");
      return cmpArticles(x.art, y.art);
    });
    return out;
  }

  /* ------------------------------------------------------------------ реестр
     норм, утративших силу

     Фильтры по дате — не только по году: есть период («за неделю», «за
     месяц») и отдельный выбор года с месяцами, а у каждой записи дата
     акта-основания показана полностью и с относительной подписью вида
     «3 дня назад», «месяц назад». Считаем по календарю, а не по 30-суточным
     месяцам: «месяц назад» должен совпадать с тем, что видит человек. */

  var repFilter = { code: "", status: "", year: "", period: "" };

  var REP_PERIODS = [
    { v: "", t: "Все даты" },
    { v: "w", t: "За последнюю неделю" },
    { v: "m", t: "За последний месяц" },
    { v: "q", t: "За последние 3 месяца" },
    { v: "y", t: "За последний год" }
  ];
  var REP_PERIOD_DAYS = { w: 7, m: 31, q: 92, y: 366 };

  function repDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  /* первый день, с которого записи попадают в период */
  function repCutoff(p) {
    var d = REP_PERIOD_DAYS[p];
    if (!d) return null;
    var n = new Date();
    n.setHours(0, 0, 0, 0);
    n.setDate(n.getDate() - (d - 1));
    return n;
  }

  /* Общий предикат фильтров: одна логика и для страницы, и для выгрузок
     (.txt/.docx), иначе файл расходился бы с экраном. */
  function repMatch(r, query) {
    if (repFilter.code && r.art.c !== repFilter.code) return false;
    if (repFilter.status && r.st !== repFilter.status) return false;
    /* repFilter.year — «2026» либо «2026-10»: сравниваем по длине значения,
       потому что префикс ISO-даты как раз и даёт нужную точность. */
    if (repFilter.year && String(r.date || "").slice(0, repFilter.year.length) !== repFilter.year) return false;
    if (repFilter.period) {
      var cut = repCutoff(repFilter.period), dt = repDate(r.date);
      /* запись без даты сохраняем: отнести её к периоду невозможно */
      if (cut && dt && dt < cut) return false;
    }
    if (query) {
      var hay = norm(r.art.dn + " " + r.art.t + " " + r.act + " " + (codeById(r.art.c) || {}).short);
      if (hay.indexOf(norm(query)) === -1) return false;
    }
    return true;
  }

  function viewRepealed() {
    var all = repealedList();
    var query = state.route.q || "";

    /* фильтры */
    var codes = {}, months = {};
    all.forEach(function (r) {
      codes[r.art.c] = (codes[r.art.c] || 0) + 1;
      if (r.date) {
        var k = r.date.slice(0, 7);
        months[k] = (months[k] || 0) + 1;
      }
    });

    var list = all.filter(function (r) { return repMatch(r, query); });

    var nRep = all.filter(function (r) { return r.st === "repealed"; }).length;
    var nSusp = all.filter(function (r) { return r.st === "suspended"; }).length;
    var nVoid = all.filter(function (r) { return r.st === "void"; }).length;
    var nDocs = Object.keys(codes).length;
    var nNoDate = all.filter(function (r) { return !r.date; }).length;

    var codeOpts = Object.keys(codes).sort(function (a, b) {
      return (DOC_ORDER[a] || 9999) - (DOC_ORDER[b] || 9999);
    }).map(function (id) {
      var c = codeById(id);
      return '<option value="' + esc(id) + '"' + (repFilter.code === id ? " selected" : "") + ">" +
        esc(c ? c.short : id) + " (" + codes[id] + ")</option>";
    }).join("");

    /* год и месяц: варианты собираются из самих записей, поэтому в списке
       только те месяцы, в которые акты действительно были. */
    var byYear = {};
    Object.keys(months).forEach(function (k) {
      (byYear[k.slice(0, 4)] = byYear[k.slice(0, 4)] || []).push(k);
    });
    var ymOpts = Object.keys(byYear).sort().reverse().map(function (y) {
      return '<optgroup label="' + esc(y) + '">' +
        byYear[y].sort().reverse().map(function (k) {
          return '<option value="' + esc(k) + '"' + (repFilter.year === k ? " selected" : "") + ">" +
            esc(MONTHS_NOM[+k.slice(5, 7) - 1]) + " (" + months[k] + ")</option>";
        }).join("") + "</optgroup>";
    }).join("");

    var periodOpts = REP_PERIODS.map(function (p) {
      return '<option value="' + p.v + '"' + (repFilter.period === p.v ? " selected" : "") + ">" +
        esc(p.t) + "</option>";
    }).join("");

    var filters = '<div class="rep-filters">' +
      '<div class="field"><label>Источник</label><select class="select" id="repCode">' +
        '<option value="">Все источники (' + all.length + ")</option>" + codeOpts + "</select></div>" +
      '<div class="field"><label>Статус</label><select class="select" id="repStatus">' +
        '<option value="">Все статусы</option>' +
        '<option value="repealed"' + (repFilter.status === "repealed" ? " selected" : "") + ">Утратила силу (" + nRep + ")</option>" +
        '<option value="suspended"' + (repFilter.status === "suspended" ? " selected" : "") + ">Приостановлена (" + nSusp + ")</option>" +
        '<option value="void"' + (repFilter.status === "void" ? " selected" : "") + ">Признана недействующей (" + nVoid + ")</option>" +
      "</select></div>" +
      '<div class="field"><label>Период</label><select class="select" id="repPeriod">' +
        periodOpts + "</select></div>" +
      '<div class="field"><label>Год и месяц акта</label><select class="select" id="repYear">' +
        '<option value="">Любые даты' + (nNoDate ? " · без даты: " + nNoDate : "") + "</option>" +
        ymOpts + "</select></div>" +
      '<div class="field" style="flex:2 1 220px"><label>Поиск по номеру, названию, акту</label>' +
        '<input class="input" id="repFind" value="' + esc(query) + '" placeholder="например: 105, мошенничество, 162-ФЗ"></div>' +
      '<button class="btn" id="repReset">Сбросить</button>' +
      "</div>";

    /* Заголовки по месяцам — только при длинной выдаче: на десятке записей
       они бы только мешали. */
    var withGroups = list.length > 12;

    var cards = list.slice(0, 400).map(function (r) {
      var c = codeById(r.art.c) || { short: r.art.c, color: "#888" };
      var rel = r.date ? relDay(r.date) : "";
      return { m: (r.date || "").slice(0, 7), h:
        '<div class="rep-item">' +
        '<div class="rep-item-head">' +
          '<span class="badge badge-code" style="border-color:' + c.color + '44;color:' + c.color + '">' + esc(c.short) + "</span>" +
          '<span class="result-num">ст. ' + esc(r.art.dn) + "</span>" +
          '<span class="rep-item-title">' + esc(r.art.t) + "</span>" +
          '<span class="st ' + (r.st === "suspended" ? "st-warn" : "st-rep") + '">' + esc(r.title) + "</span>" +
          '<span style="margin-left:auto;display:flex;gap:6px">' +
            '<button class="ibtn ibtn-col' + (inCol(r.id) ? " on" : "") + '" data-col-add="' + esc(r.id) + '" ' +
              'title="' + (inCol(r.id) ? "Убрать из подборки" : "Добавить в подборку") + '">' + ic("clip") + '</button>' +
            '<button class="ibtn" data-go="#/article/' + encodeURIComponent(r.id) + '" title="Открыть статью">→</button>' +
          "</span>" +
        "</div>" +
        (r.act ? '<div class="rep-item-act">Основание: ' + esc(r.act) +
          (r.date ? " от " + fmtRed(r.date) : "") + "</div>"
               : '<div class="rep-item-act">Акт-основание в тексте не указан</div>') +
        (rel ? '<div class="rep-item-rel">' + esc(rel) + "</div>" : "") +
        "</div>"
      };
    });

    var body;
    if (cards.length) {
      var inner = "";
      if (withGroups) {
        var counts = {};
        cards.forEach(function (x) { counts[x.m] = (counts[x.m] || 0) + 1; });
        var last = null;
        cards.forEach(function (x) {
          if (x.m === last) { inner += x.h; return; }
          last = x.m;
          var lbl = /^\d{4}-\d{2}$/.test(x.m)
            ? MONTHS_NOM[+x.m.slice(5, 7) - 1] + " " + x.m.slice(0, 4)
            : "Дата акта не указана";
          inner += '<div class="ndate rep-group-h">' + esc(lbl) +
            ' <span class="small muted">· ' + counts[x.m] +
            " " + plural(counts[x.m], ["запись", "записи", "записей"]) + "</span></div>" + x.h;
        });
      } else {
        inner = cards.map(function (x) { return x.h; }).join("");
      }
      body = '<div class="rep-cards">' + inner + "</div>" +
        (list.length > 400 ? '<p class="small muted">Показаны первые 400 записей. Уточните фильтр.</p>' : "");
    } else {
      body = '<div class="empty"><div class="ico">⊘</div><div>По заданным условиям утративших силу норм не найдено.</div></div>';
    }

    return '<h1>Утратившие силу и приостановленные нормы</h1>' +
      '<p class="lead">Реестр норм, которые исключены из действующей редакции, признаны недействующими ' +
      "или действие которых приостановлено. Статус и акт-основание распознаются из официального текста " +
      "при сборке базы и служат для ориентира: перед применением сверяйтесь с официальной публикацией. " +
      "Дату можно отсеять по периоду («за месяц», «за неделю»), а также по году и месяцу; " +
      "у каждой записи подписано, сколько времени прошло.</p>" +

      '<div class="grid grid-4" style="margin-bottom:16px">' +
        stat(all.length, "норм со статусом") +
        stat(nRep, "утратили силу") +
        stat(nSusp + nVoid, "приостановлено и недействующих") +
        stat(nDocs, "источников затронуто") +
      "</div>" +

      '<div class="card">' + filters + "</div>" +
      '<div style="margin-top:14px">' + body + "</div>" +

      '<div class="actions-row" style="margin-top:16px">' +
        '<button class="btn btn-primary" id="repDocx">Скачать реестр .docx</button>' +
        '<button class="btn" id="repTxt">Скачать .txt</button>' +
        '<button class="btn" id="repCopy">Скопировать список</button>' +
      "</div>" +

      '<div class="disclaimer"><b>О статусах.</b> Признаки утраты силы и приостановления распознаются ' +
      "автоматически по формулировкам официального текста («Статья утратила силу — Федеральный закон от …»). " +
      "Если норма утратила силу вместе с охватывающим её актом, отдельной пометки в тексте может не быть — " +
      "такие случаи в реестр не попадают. Статус носит справочный характер; юридически значимые выводы " +
      "делайте по официальной публикации и разделу «Проверка актуальности».</div>";
  }

  function repCurrentList() {
    var query = state.route.q || "";
    return repealedList().filter(function (r) { return repMatch(r, query); });
  }

  function bindRepealed() {
    var rc = $("#repCode"), rs = $("#repStatus"), ry = $("#repYear"), rp = $("#repPeriod");
    function apply() {
      if (rc) repFilter.code = rc.value;
      if (rs) repFilter.status = rs.value;
      if (ry) repFilter.year = ry.value;
      if (rp) repFilter.period = rp.value;
      render();
    }
    if (rc) rc.addEventListener("change", apply);
    if (rs) rs.addEventListener("change", apply);
    if (ry) ry.addEventListener("change", apply);
    if (rp) rp.addEventListener("change", apply);

    var rf = $("#repFind");
    if (rf) rf.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var q = rf.value.trim();
      go(q ? "#/repealed/" + encodeURIComponent(q) : "#/repealed");
    });

    var rst = $("#repReset");
    if (rst) rst.addEventListener("click", function () {
      repFilter = { code: "", status: "", year: "", period: "" };
      go("#/repealed");
    });

    function buildText() {
      var list = repCurrentList();
      var lines = ["РЕЕСТР УТРАТИВШИХ СИЛУ И ПРИОСТАНОВЛЕННЫХ НОРМ",
        "Сформирован: " + fmtDateTime(new Date()), "Всего записей: " + list.length, ""];
      var byDoc = {}, order = [];
      list.forEach(function (r) {
        if (!byDoc[r.art.c]) { byDoc[r.art.c] = []; order.push(r.art.c); }
        byDoc[r.art.c].push(r);
      });
      order.forEach(function (id) {
        var c = codeById(id);
        lines.push("", (c ? c.full : id).toUpperCase(), "-".repeat(48));
        byDoc[id].forEach(function (r) {
          lines.push("Статья " + r.art.dn + ". " + r.art.t + " — " + r.title +
            (r.act ? " (" + r.act + (r.date ? " от " + fmtRed(r.date) : "") + ")" : ""));
        });
      });
      return lines.join("\n");
    }

    var d = $("#repDocx");
    if (d) d.addEventListener("click", function () {
      var list = repCurrentList();
      var byDoc = {}, order = [];
      list.forEach(function (r) {
        if (!byDoc[r.art.c]) { byDoc[r.art.c] = []; order.push(r.art.c); }
        byDoc[r.art.c].push(r);
      });
      var inner = "<h1>Реестр утративших силу и приостановленных норм</h1>" +
        '<p class="m">Сформирован: ' + fmtDateTime(new Date()) + " · записей: " + list.length + "</p><hr>" +
        order.map(function (id) {
          var c = codeById(id);
          return "<h2>" + esc(c ? c.full : id) + "</h2>" +
            byDoc[id].map(function (r) {
              return "<p>Статья " + esc(r.art.dn) + ". " + esc(r.art.t) + " — <b>" + esc(r.title) + "</b>" +
                (r.act ? " (" + esc(r.act) + (r.date ? " от " + fmtRed(r.date) : "") + ")" : "") + "</p>";
            }).join("");
        }).join("");
      saveDocx("reestr-utrativshih-silu.docx", "Реестр утративших силу норм", inner);
      toast("Файл .docx сохранён");
    });

    var t = $("#repTxt");
    if (t) t.addEventListener("click", function () {
      download("reestr-utrativshih-silu.txt", buildText(), "text/plain");
      toast("Файл сохранён");
    });

    var cp = $("#repCopy");
    if (cp) cp.addEventListener("click", function () { copyText(buildText(), "Реестр скопирован"); });
  }

  /* ------------------------------------------------------------------------
     Раздел «Аналитика и статистика».
     Считается на лету из уже загруженных данных (индекс, статусы, снимок
     свежести) — отдельного файла с цифрами не нужно, поэтому раздел всегда
     соответствует текущей базе, включая локальные обновления.
     ------------------------------------------------------------------------ */

  /* Горизонтальная полоса: подпись (может быть ссылкой), доля, значение. */
  function barRow(name, val, max, opt) {
    opt = opt || {};
    var pct = max > 0 ? Math.round(val / max * 100) : 0;
    var cls = opt.cls ? " " + opt.cls : "";
    var label = opt.go
      ? '<span data-go="' + esc(opt.go) + '">' + esc(name) + "</span>"
      : esc(name);
    return '<div class="bar-row" title="' + esc(name + " — " + val) + '">' +
      '<div class="bar-name">' + label + "</div>" +
      '<div class="bar-track"><div class="bar-fill' + cls + '" style="width:' + pct + '%"></div></div>' +
      '<div class="bar-val">' + barVal(val, opt) + "</div>" +
      "</div>";
  }

  function barVal(val, opt) {
    if (opt && opt.suffix) return val + opt.suffix;
    return String(val);
  }

  /* num вставляется как есть (в него передают разметку вида «12 <small>ист.</small>»),
     поэтому вызывающий обязан либо передать безопасное значение (число, год),
     либо обернуть данные в esc() сам. lbl и sub экранируются всегда. */
  function tile(num, lbl, sub) {
    /* Длинное значение — это не число, а название акта («Пленум ВС РФ № 23
       от 27.06.2023 …»). Крупным кеглем оно расползается на восемь строк и
       растягивает всю плитку, поэтому такие значения набираем мельче. */
    var wide = String(num).replace(/<[^>]*>/g, "").length > 18 ? " tile-wide" : "";
    return '<div class="tile' + wide + '"><div class="tile-num">' + num + "</div>" +
      '<div class="tile-lbl">' + esc(lbl) + "</div>" +
      (sub ? '<div class="tile-sub">' + esc(sub) + "</div>" : "") + "</div>";
  }

  /* Год из даты редакции/акта: "2026-08-15" → "2026". */
  function yearOf(s) { return s ? String(s).slice(0, 4) : ""; }

  function viewStats() {
    var docs = CODES.filter(function (c) { return !c.note; });
    var nArts = arts.length;

    /* --- распределение статей по источникам (топ-15) --- */
    var perDoc = docs.map(function (c) {
      return { c: c, n: (byCode[c.id] || []).length };
    }).filter(function (x) { return x.n > 0; }).sort(function (a, b) { return b.n - a.n; });
    var maxPerDoc = perDoc.length ? perDoc[0].n : 1;
    var topDocs = perDoc.slice(0, 15).map(function (x) {
      return barRow(x.c.short, x.n, maxPerDoc, { go: "#/code/" + x.c.id, suffix: "" });
    }).join("");

    /* --- статусы норм --- */
    var rep = repealedList();
    var nRep = rep.filter(function (r) { return r.st === "repealed"; }).length;
    var nSusp = rep.filter(function (r) { return r.st === "suspended"; }).length;
    var nVoid = rep.filter(function (r) { return r.st === "void"; }).length;
    var pctRep = nArts ? (rep.length / nArts * 100) : 0;

    /* --- возраст редакций --- */
    var now = new Date();
    var ages = { "<1 года": 0, "1–2 года": 0, "2–5 лет": 0, "5–10 лет": 0, ">10 лет": 0, "нет данных": 0 };
    docs.forEach(function (c) {
      var y = parseInt(yearOf(c.redaction), 10);
      if (!y) { ages["нет данных"]++; return; }
      var d = now.getFullYear() - y + (now.getMonth() >= 7 ? 0 : -1);   /* приблизительно, по году */
      if (d < 1) ages["<1 года"]++;
      else if (d < 2) ages["1–2 года"]++;
      else if (d < 5) ages["2–5 лет"]++;
      else if (d < 10) ages["5–10 лет"]++;
      else ages[">10 лет"]++;
    });
    var ageMax = Math.max.apply(null, Object.keys(ages).map(function (k) { return ages[k]; }));
    /* «нет данных» показываем только если такие источники реально есть —
       иначе полоса на нуле выглядит как ошибка, а не как факт. */
    var ageKeys = Object.keys(ages).filter(function (k) { return k !== "нет данных" || ages[k] > 0; });
    var ageBars = ageKeys.map(function (k) {
      var cls = k === "<1 года" ? "ok" : (k === "нет данных" ? "muted" : (k === ">10 лет" ? "warn" : ""));
      return barRow(k, ages[k], ageMax, { cls: cls, suffix: "", go: null });
    }).join("");

    /* --- изменения по годам (акты-основания) --- */
    var byYear = {};
    rep.forEach(function (r) {
      var y = yearOf(r.date);
      if (!y) return;
      byYear[y] = (byYear[y] || 0) + 1;
    });
    var years = Object.keys(byYear).sort();
    var recent = years.slice(-12);
    var yearMax = recent.length ? Math.max.apply(null, recent.map(function (y) { return byYear[y]; })) : 1;
    var yearBars = recent.length
      ? recent.map(function (y) {
          return barRow(y, byYear[y], yearMax, { go: "#/timeline/" + y, suffix: "" });
        }).join("")
      : '<p class="small muted">Данных об изменяющих актах нет.</p>';

    /* --- свежесть по группам источников --- */
    var groups = {};
    docs.forEach(function (c) {
      var g = KIND_TITLE[c.kind] || "Иные акты";
      if (!groups[g]) groups[g] = { n: 0, arts: 0, fresh: 0 };
      groups[g].n++;
      groups[g].arts += (byCode[c.id] || []).length;
    });
    var groupTiles = Object.keys(groups).map(function (g) {
      return tile(groups[g].n + " <small>ист.</small>", g, groups[g].arts + " статей");
    }).join("");

    /* --- источники без статей / без полного текста --- */
    var noArts = docs.filter(function (c) { return !(byCode[c.id] || []).length; });
    var withRedaction = docs.filter(function (c) { return !!c.redaction; }).length;

    /* --- самый «изменчивый» год и самый частый акт-основание --- */
    var topAct = {};
    rep.forEach(function (r) {
      var a = (r.act || "").trim();
      if (!a) return;
      topAct[a] = (topAct[a] || 0) + 1;
    });
    var actList = Object.keys(topAct).map(function (a) { return { a: a, n: topAct[a] }; })
      .sort(function (x, y) { return y.n - x.n; }).slice(0, 8);
    var actMax = actList.length ? actList[0].n : 1;
    var actBars = actList.length
      ? actList.map(function (x) { return barRow(x.a, x.n, actMax, { cls: "warn" }); }).join("")
      : '<p class="small muted">Акты-основания в текстах не распознаны.</p>';

    var busiest = years.length
      ? years.reduce(function (a, b) { return byYear[b] > byYear[a] ? b : a; }, years[0])
      : "—";

    return '<h1>Аналитика и статистика</h1>' +
      tabStrip(ANALYTICS_TABS, "stats") +
      '<p class="lead">Сводные показатели по базе: сколько норм действует, сколько утратило силу, ' +
      "насколько свежие редакции собраны и какие акты меняли тексты чаще всего. Всё считается " +
      "по загруженным данным прямо в браузере (включая ваши локальные обновления) и носит справочный характер.</p>" +

      '<div class="tiles" style="margin-bottom:16px">' +
        tile(nArts.toLocaleString("ru-RU"), "статей и подстатей", arts.length + " записей индекса") +
        tile(docs.length, "источников с текстом", "всего в реестре " + CODES.length) +
        tile(rep.length, "норм со статусом", pctRep.toFixed(1) + " % от всех статей") +
        tile(busiest, "самый «изменчивый» год", "по актам-основаниям") +
      "</div>" +

      '<div class="grid grid-2">' +
        '<div class="card"><h3 style="margin-top:0">Крупнейшие источники</h3>' +
          '<p class="small muted" style="margin-top:-4px">Число статей и подстатей. Нажмите, чтобы открыть.</p>' +
          '<div class="bars">' + topDocs + "</div></div>" +

        '<div class="card"><h3 style="margin-top:0">Статусы норм</h3>' +
          '<p class="small muted" style="margin-top:-4px">Распознано из официальных текстов.</p>' +
          '<div class="bars">' +
            barRow("Утратили силу", nRep, Math.max(nRep, nSusp, nVoid, 1), { cls: "warn", go: "#/repealed" }) +
            barRow("Приостановлены", nSusp, Math.max(nRep, nSusp, nVoid, 1), { cls: "warn", go: "#/repealed" }) +
            barRow("Недействующие", nVoid, Math.max(nRep, nSusp, nVoid, 1), { cls: "muted", go: "#/repealed" }) +
          "</div>" +
          '<div class="actions-row" style="margin:12px 0 0">' +
            '<button class="btn btn-primary" data-go="#/repealed">Открыть реестр</button>' +
            (years.length ? '<button class="btn" data-go="#/timeline">Лента изменений</button>' : "") +
          "</div></div>" +
      "</div>" +

      '<div class="grid grid-2" style="margin-top:12px">' +
        '<div class="card"><h3 style="margin-top:0">Возраст редакций</h3>' +
          '<p class="small muted" style="margin-top:-4px">Сколько источников собрано на редакции такого возраста.</p>' +
          '<div class="bars">' + ageBars + "</div>" +
          '<p class="small muted" style="margin-top:10px">' +
          (withRedaction === docs.length
            ? "Дата редакции известна у всех " + docs.length + " источников."
            : "У " + withRedaction + " из " + docs.length + " источников дата редакции известна. Остальные помечены как справочные.") +
          "</p></div>" +

        '<div class="card"><h3 style="margin-top:0">Изменения по годам</h3>' +
          '<p class="small muted" style="margin-top:-4px">Последние 12 лет, по актам-основаниям. Нажмите на год — откроется лента.</p>' +
          '<div class="bars">' + yearBars + "</div></div>" +
      "</div>" +

      '<div class="grid grid-2" style="margin-top:12px">' +
        '<div class="card"><h3 style="margin-top:0">Акты, менявшие нормы чаще всего</h3>' +
          '<p class="small muted" style="margin-top:-4px">Топ-8 по числу затронутых норм.</p>' +
          '<div class="bars">' + actBars + "</div></div>" +

        '<div class="card"><h3 style="margin-top:0">Состав реестра</h3>' +
          '<p class="small muted" style="margin-top:-4px">Источники и объём по видам актов.</p>' +
          '<div class="tiles">' + groupTiles + "</div>" +
          (noArts.length
            ? '<p class="small muted" style="margin-top:10px">Без статей в базе: ' +
              noArts.slice(0, 12).map(function (c) { return esc(c.short); }).join(", ") +
              (noArts.length > 12 ? " и ещё " + (noArts.length - 12) : "") + ".</p>"
            : "") +
        "</div>" +
      "</div>" +

      '<div class="disclaimer"><b>О цифрах.</b> Показатели считаются по загруженной базе и вашим локальным ' +
      "обновлениям редакций, поэтому могут отличаться от официальной статистики. Признаки утраты силы и " +
      "приостановления распознаются автоматически по формулировкам текста. Юридически значимые выводы делайте " +
      "по официальной публикации.</div>";
  }

  /* ------------------------------------------------------------------------
     Лента изменений по годам.
     Источник — те же статусы норм, у которых в тексте указан изменяющий акт
     и его дата. Группируем по годам, свежие сверху; при выборе года — только он.
     ------------------------------------------------------------------------ */
  function timelineYears() {
    var byYear = {};
    repealedList().forEach(function (r) {
      var y = yearOf(r.date);
      if (!y) return;
      (byYear[y] = byYear[y] || []).push(r);
    });
    return byYear;
  }

  function viewTimeline(year) {
    var byYear = timelineYears();
    var years = Object.keys(byYear).sort().reverse();
    var shown = year ? [year] : years.slice(0, 10);

    var chips = '<div class="chips" style="margin-bottom:14px">' +
      '<span class="chip' + (year ? "" : " on") + '" data-go="#/timeline">Все годы</span>' +
      years.slice(0, 24).map(function (y) {
        return '<span class="chip' + (year === y ? " on" : "") + '" data-go="#/timeline/' + y + '">' +
          esc(y) + " (" + byYear[y].length + ")</span>";
      }).join("") + "</div>";

    if (!shown.length || (year && !byYear[year])) {
      return '<h1>Лента изменений по годам</h1>' +
        '<p class="lead">Хронология норм, у которых в официальном тексте прямо указан изменяющий акт и его дата.</p>' +
        chips +
        '<div class="empty"><div class="ico">' + ic("activity") + '</div><div>За ' +
        (year ? esc(year) + " год" : "выбранный период") + " изменений не найдено.</div></div>";
    }

    var total = shown.reduce(function (s, y) { return s + byYear[y].length; }, 0);

    var body = shown.map(function (y) {
      var items = byYear[y].slice(0, 150);
      var rows = items.map(function (r) {
        var c = codeById(r.art.c) || { short: r.art.c };
        return '<div class="tl-item">' +
          '<span class="badge badge-code">' + esc(c.short) + "</span>" +
          '<span class="result-num">ст. ' + esc(r.art.dn) + "</span>" +
          '<span class="tl-item-title" data-go="#/article/' + encodeURIComponent(r.id) + '">' + esc(r.art.t) + "</span>" +
          '<span class="st ' + (r.st === "suspended" ? "st-warn" : "st-rep") + '">' + esc(r.title) + "</span>" +
          (r.act ? '<span class="tl-act">' + esc(r.act) + (r.date ? " · " + fmtRed(r.date) : "") + "</span>" : "") +
          "</div>";
      }).join("");
      return '<div class="tl-year"><span class="tl-year-badge">' + esc(y) + "</span> " +
        '<span class="small muted">' + byYear[y].length +
        " " + plural(byYear[y].length, ["норма", "нормы", "норм"]) + "</span></div>" +
        '<div class="tl-items">' + rows + "</div>" +
        (byYear[y].length > 150 ? '<p class="small muted">Показаны первые 150 записей за ' + esc(y) + " год.</p>" : "");
    }).join("");

    return '<h1>Лента изменений по годам' + (year ? ": " + esc(year) : "") + "</h1>" +
      tabStrip(ANALYTICS_TABS, "timeline") +
      '<p class="lead">Хронология норм, у которых в официальном тексте прямо указан изменяющий акт и его дата. ' +
      "Показывает " + total + " " + plural(total, ["запись", "записи", "записей"]) +
      (year ? "" : " за последние годы") + ". Нажмите на год, чтобы посмотреть подробнее, или на название — " +
      "чтобы открыть статью.</p>" +
      chips +
      '<div class="tl">' + body + "</div>" +
      (years.length > shown.length || !year
        ? '<p class="small muted" style="margin-top:16px">Показаны не все годы — выберите нужный выше. ' +
          "Нормы, утратившие силу вместе со всем актом, отдельной пометки в тексте не имеют и здесь не отображаются.</p>"
        : "") +
      '<div class="disclaimer"><b>О датах.</b> Год берётся из даты изменяющего акта, указанной в тексте нормы. ' +
      "Он означает, когда норма была изменена или отменена, а не когда вступило в силу.</div>";
  }

  /* ------------------------------------------------------------------------
     Граф перекрёстных ссылок между источниками.
     Узлы — акты (только те, что встречаются в ссылках), рёбра — сколько раз
     статьи одного акта ссылаются на другой. Рёбер внутри одного акта не
     рисуем: они образуют «петлю» и забивают картину. Раскладка — по кругу,
     без внешних библиотек (работает офлайн).
     ------------------------------------------------------------------------ */
  var GRAPH_NODE_LIMIT = 28;
  var graphState = { loading: false, ready: false, error: "" };
  /* Кэш построенного графа: { sig, g }. sig — отпечаток набора загруженных
     полных текстов. Сбрасывается в null при замене текста (applyOverride). */
  var graphCache = null;

  /* Для графа нужны полные тексты всех источников, а они подгружаются лениво.
     Грузим их пачками, чтобы не забивать сеть и не блокировать интерфейс. */
  function loadAllFull(done) {
    var ids = CODES.filter(function (c) { return !c.note; }).map(function (c) { return c.id; });
    var i = 0, failed = 0;
    (function step() {
      if (i >= ids.length) return done(failed ? new Error("не загружено текстов: " + failed) : null);
      var batch = ids.slice(i, i + 4);
      i += 4;
      var left = batch.length;
      batch.forEach(function (id) {
        loadFull(id, function (err) {
          if (err) failed++;
          if (--left === 0) step();
        });
      });
    })();
  }

  function buildGraph() {
    if (!XREF) return null;
    /* Результат детерминирован: он зависит только от того, какие полные тексты
       уже загружены. Пересчёт стоит ~0.6 с (обход всех 99 текстов, ~75 МБ), а
       раздел перерисовывается при каждом клике по узлу (меняется только focus).
       Поэтому кэшируем по «отпечатку» набора загруженных источников: как только
       подгружается новый текст, отпечаток меняется и граф строится заново. */
    var loaded = [];
    CODES.forEach(function (c) { if (FULL[c.id] && FULL[c.id].length) loaded.push(c.id); });
    var sig = loaded.length + ":" + loaded.join(",");
    if (graphCache && graphCache.sig === sig) return graphCache.g;

    /* для каждого источника считаем, на какие другие он ссылается */
    var link = {};   /* "from|to" -> count */
    var weight = {};
    CODES.forEach(function (c) {
      var rows = FULL[c.id];
      if (!rows || !rows.length) return;
      rows.forEach(function (row) {
        if (!row || !row[4]) return;
        var tg = XREF.targets(row[4], { doc: c.id, num: row[0] });
        var seen = {};
        tg.forEach(function (t) {
          if (t.doc === c.id || !CO[t.doc]) return;
          if (seen[t.doc]) return;
          seen[t.doc] = 1;
          var k = c.id + "|" + t.doc;
          link[k] = (link[k] || 0) + 1;
          weight[c.id] = (weight[c.id] || 0) + 1;
          weight[t.doc] = (weight[t.doc] || 0) + 1;
        });
      });
    });

    var nodes = Object.keys(weight)
      .sort(function (a, b) { return weight[b] - weight[a]; })
      .slice(0, GRAPH_NODE_LIMIT);

    var idx = {};
    nodes.forEach(function (id, i) { idx[id] = i; });

    var edges = [];
    Object.keys(link).forEach(function (k) {
      var p = k.split("|");
      if (idx[p[0]] === undefined || idx[p[1]] === undefined) return;
      edges.push({ a: p[0], b: p[1], n: link[k] });
    });

    var g = { nodes: nodes, idx: idx, edges: edges, weight: weight };
    graphCache = { sig: sig, g: g };
    return g;
  }

  function graphSvg(g, focus) {
    if (!g || !g.nodes.length) {
      return '<div class="graph-empty">В базе не найдено перекрёстных ссылок между источниками.</div>';
    }
    var W = 720, H = 560, cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 56;
    var n = g.nodes.length;
    var pos = {};
    g.nodes.forEach(function (id, i) {
      var ang = -Math.PI / 2 + i * 2 * Math.PI / n;
      pos[id] = { x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) };
    });

    var maxW = 1;
    g.nodes.forEach(function (id) { if (g.weight[id] > maxW) maxW = g.weight[id]; });
    function rad(id) { return 7 + 13 * Math.sqrt((g.weight[id] || 1) / maxW); }

    /* рёбра под узлами */
    var edgeSvg = g.edges.map(function (e) {
      var p1 = pos[e.a], p2 = pos[e.b];
      var on = focus && (e.a === focus || e.b === focus);
      var cls = "graph-edge" + (on ? " on" : (focus ? " dim" : ""));
      /* лёгкий изгиб, чтобы встречные связи не сливались */
      var mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
      var dx = mx - cx, dy = my - cy;
      var k = 0.22;
      var qx = mx + dx * k, qy = my + dy * k;
      var w = Math.min(1 + Math.log2(e.n + 1), 4);
      return '<path class="' + cls + '" d="M' + p1.x.toFixed(1) + " " + p1.y.toFixed(1) +
        " Q" + qx.toFixed(1) + " " + qy.toFixed(1) + " " + p2.x.toFixed(1) + " " + p2.y.toFixed(1) +
        '" stroke-width="' + w.toFixed(1) + '"></path>';
    }).join("");

    var nodeSvg = g.nodes.map(function (id) {
      var c = codeById(id) || { short: id };
      var p = pos[id];
      var r = rad(id);
      var conn = g.edges.filter(function (e) { return e.a === id || e.b === id; }).length;
      return '<g class="graph-node' + (focus === id ? " on" : "") + '" data-gnode="' + esc(id) + '">' +
        '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + r.toFixed(1) + '"></circle>' +
        '<text x="' + p.x.toFixed(1) + '" y="' + (p.y + r + 11).toFixed(1) + '">' + esc(c.abbr || c.short) + "</text>" +
        '<title>' + esc((c.abbr || c.short) + " — связей: " + conn + ", всего ссылок: " + (g.weight[id] || 0)) + "</title>" +
        "</g>";
    }).join("");

    return '<svg class="graph-svg" viewBox="0 0 ' + W + " " + H + '" role="img" ' +
      'aria-label="Граф перекрёстных ссылок между источниками">' +
      edgeSvg + nodeSvg + "</svg>";
  }

  function graphSide(g, focus) {
    if (!focus || !g) return "";
    var c = codeById(focus) || { short: focus, full: focus };
    var out = g.edges.filter(function (e) { return e.a === focus; })
      .sort(function (x, y) { return y.n - x.n; });
    var inc = g.edges.filter(function (e) { return e.b === focus; })
      .sort(function (x, y) { return y.n - x.n; });

    function list(arr, dir) {
      if (!arr.length) return '<span class="small muted">нет</span>';
      return arr.map(function (e) {
        var other = dir === "out" ? e.b : e.a;
        var oc = codeById(other) || { short: other };
        return '<div class="graph-side-item">' +
          '<span data-go="#/code/' + esc(other) + '"><b>' + esc(oc.short) + "</b></span>" +
          '<span class="mini muted">' + e.n + " " + plural(e.n, ["ссылка", "ссылки", "ссылок"]) + "</span></div>";
      }).join("");
    }

    return '<div class="graph-side">' +
      '<div style="font-weight:640;margin-bottom:4px">' + esc(c.short) + "</div>" +
      '<div class="small muted" style="margin-bottom:8px">Ссылается на другие акты:</div>' +
      list(out, "out") +
      '<div class="small muted" style="margin:10px 0 8px">На него ссылаются:</div>' +
      list(inc, "in") +
      '<div class="actions-row" style="margin:10px 0 0">' +
        '<button class="btn btn-primary" data-go="#/code/' + esc(focus) + '">Открыть акт</button>' +
      "</div></div>";
  }

  function viewGraph(focus) {
    if (graphState.loading || !graphState.ready) {
      return '<h1>Связи между источниками</h1>' +
        tabStrip(ANALYTICS_TABS, "graph") +
        '<p class="lead">Какие акты ссылаются друг на друга. Размер кружка — сколько ссылок ведёт к этому ' +
        "акту и из него; толщина линии — сколько раз акты ссылаются друг на друга. " +
        "Показаны самые связанные источники; нажмите на кружок, чтобы увидеть подробности.</p>" +
        '<div class="info-box"><span class="loading">Загружаем полные тексты и считаем ссылки…</span></div>' +
        (graphState.error ? '<div class="warn-box" style="margin-top:12px">Не удалось загрузить тексты: ' +
          esc(graphState.error) + "</div>" : "");
    }

    var g = buildGraph();
    var edgesTotal = g ? g.edges.reduce(function (s, e) { return s + e.n; }, 0) : 0;
    var freq = g ? g.edges.slice().sort(function (a, b) { return b.n - a.n; }).slice(0, 8) : [];
    var strong = freq.map(function (e) {
      var c1 = codeById(e.a) || { short: e.a }, c2 = codeById(e.b) || { short: e.b };
      return '<div class="graph-side-item">' +
        '<span data-go="#/code/' + esc(e.a) + '">' + esc(c1.short) + "</span>" +
        '<span class="mini muted">→</span>' +
        '<span data-go="#/code/' + esc(e.b) + '">' + esc(c2.short) + "</span>" +
        '<span class="mini muted" style="margin-left:auto">' + e.n + "</span></div>";
    }).join("");

    var canvas = g && g.nodes.length
      ? graphSvg(g, focus) + graphSide(g, focus)
      : '<div class="graph-empty">Перекрёстные ссылки не найдены.</div>';

    return '<h1>Связи между источниками</h1>' +
      tabStrip(ANALYTICS_TABS, "graph") +
      '<p class="lead">Какие акты ссылаются друг на друга. Размер кружка — сколько ссылок ведёт к этому ' +
      "акту и из него; толщина линии — сколько раз акты ссылаются друг на друга. Показаны " +
      (g ? g.nodes.length : 0) + " самых связанных источников. Нажмите на кружок, чтобы увидеть подробности.</p>" +

      '<div class="tiles" style="margin-bottom:14px">' +
        tile(g ? g.nodes.length : 0, "актов в графе", "из " + CODES.filter(function (c) { return !c.note; }).length + " в реестре") +
        tile(g ? g.edges.length : 0, "связей между актами", "направленных пар") +
        tile(edgesTotal.toLocaleString("ru-RU"), "ссылок всего", "с учётом повторов") +
        tile(freq.length ? esc((codeById(freq[0].a) || {}).short || "—") : "—", "самый активный", "источник по числу ссылок") +
      "</div>" +

      (focus ? '<div class="chips" style="margin-bottom:12px">' +
        '<span class="chip on">' + esc((codeById(focus) || {}).short || focus) + "</span>" +
        '<span class="chip" data-go="#/graph">Сбросить фокус</span></div>' : "") +

      '<div class="graph-wrap">' + canvas + "</div>" +

      '<div class="graph-legend"><span>● размер узла — степень связности</span>' +
      "<span>— толщина ребра — число ссылок</span></div>" +

      (graphState.error ? '<div class="warn-box" style="margin-top:12px">Часть текстов не загрузилась, ' +
        "граф построен по остальным: " + esc(graphState.error) + "</div>" : "") +

      (strong ? '<div class="card" style="margin-top:14px"><h3 style="margin-top:0">Самые частые связи</h3>' +
        '<div class="bars">' + strong + "</div></div>" : "") +

      '<div class="disclaimer"><b>О графе.</b> Учитываются ссылки вида «в соответствии со статьёй N такого-то ' +
      "акта», распознанные в текстах. Ссылки на нормативные акты, которых нет в базе, в граф не попадают. " +
      "Связи внутри одного акта не показаны, чтобы не загромождать картину.</div>";
  }


  function bindGraph() {
    $$("[data-gnode]").forEach(function (g) {
      g.addEventListener("click", function (e) {
        e.preventDefault();
        go("#/graph/" + this.getAttribute("data-gnode"));
      });
    });
    /* если тексты ещё не загружены — грузим и перерисовываем раздел */
    if (!graphState.ready && !graphState.loading) {
      graphState.loading = true;
      graphState.error = "";
      loadAllFull(function (err) {
        graphState.loading = false;
        graphState.ready = true;
        graphState.error = err ? (err.message || String(err)) : "";
        if (state.route.name === "graph") render();
      });
    }
  }




  /* ---------------------------------------------------------------- справка

     Было 12 раскрывающихся разделов подряд — эксан выглядел как простыня
     из кнопок, и найти нужное было не легче, чем в самом приложении.
     Теперь: сверху короткий ряд задач (сразу переход, раскрывать ничего не
     нужно), ниже — шесть смысловых разделов вместо двенадцати. */
  function viewHelp() {
    var sec = function (title, ico, body) {
      return '<details class="help-sec"><summary>' + ic(ico) + "<span>" + esc(title) + "</span></summary>" +
        '<div class="help-body">' + body + "</div></details>";
    };
    var start = '<div class="tiles help-start">' +
      quickCard("search", "Найти статью", "Номер, название или слова из текста — например «обыск в жилище»", "#/home", "blue") +
      quickCard("compass", "Разбор ситуации", "Опишите вопрос обычным языком — помощник покажет нормы и что делать", "#/assistant", "violet") +
      quickCard("calculator", "Калькуляторы", "Обычный счёт, процессуальные сроки, давность, пошлина, неустойка, сроки под стражей", "#/calc", "amber") +
      quickCard("activity", "Что нового", "Лента изменений по дням: новые статьи, редакции, утрата силы", "#/new", "rose") +
      quickCard("shield", "Памятки оперативнику", "Порядок действий: досмотр, задержание, ОРМ, приём заявлений", "#/scenarios", "teal") +
      quickCard("checkbox", "Чек-листы и шаблоны", "Действия по следственным мероприятиям и готовые бланки по отраслям", "#/templates", "green") +
      "</div>";

    return "<h1>Как пользоваться</h1>" +
      '<p class="lead">Начните с задачи выше — один клик, и вы на месте. ' +
      "Подробности разобраны ниже; всё считается прямо в браузере, данные никуда не передаются.</p>" +
      start +

      '<div class="help-grid">' +

      sec("Поиск: как спрашивать", "search",
        "<p>Номер статьи — <b>ст 105 ук</b>, <b>статья 91 УПК</b>, <b>упк 182</b>. Подстатьи — <b>159.1 УК</b>, <b>19.7.10-1 КоАП</b>. Слова — <b>обыск в жилище</b>, <b>получение взятки</b>.</p>" +
        "<p>Ищется и внутри полного текста статей: совпадения выводятся блоком «Найдено в текстах статей» с подсветкой. Слова приводятся к основе, поэтому «алименты» найдёт и «алиментов».</p>" +
        "<p>Запрос расширяется близкими по смыслу словами: по «кража» находятся и нормы о хищении, по «взятке» — о подкупе. Точные слова запроса всегда выше, расширение указано под строкой результатов.</p>" +
        "<p>Быстрый переход и поиск с клавиатуры — <b>Ctrl + K</b> (или <b>/</b>): статьи, разделы и источники без мыши.</p>") +

      sec("Помощник и памятки", "compass",
        "<p>Опишите ситуацию обычным языком — помощник определит отрасль, вероятный состав, объект и предмет, покажет квалификацию, санкцию, что нужно установить и что сделать, и уточнит детали вопросами.</p>" +
        "<p>Разбор строится <b>только по текстам, размещённым на сайте</b>: каждая ссылка ведёт на статью действующей редакции, а под разбором указаны источники с датами редакций. Сослаться на норму, которой в базе нет, помощник не может.</p>" +
        "<p>Упоминания норм в разборах, памятках и примечаниях — <b>кликабельные ссылки</b>: «ст. 105 УК РФ» или «п. 6 постановления Пленума ВС РФ № 29» ведут прямо на нужный пункт действующей редакции.</p>" +
        "<p>Разборы охватывают хищения и их формы, вред здоровью, наркотики, оружие, взятки, ДТП, задержание, обыск и выемку, личный досмотр, оперативно-розыскные мероприятия, угон, угрозы, приём заявлений (КУСП), миграцию, трудовые и имущественные споры.</p>") +

      sec("Источники, редакции и статусы", "book",
        "<p>В сайдбаре слева — все акты, сгруппированные по виду: Конституция, Кодексы, ФКЗ, ФЗ, постановления Правительства, Пленумы ВС РФ. Группу можно <b>свернуть и развернуть</b> кликом по заголовку — состояние запоминается.</p>" +
        "<p>99 постановлений Пленума ВС РФ — отдельный вид источников: разъяснения по квалификации, назначению наказания и процессуальным вопросам.</p>" +
        "<p>Приложение сверяет даты редакций «день в день» и показывает результат значком в панели. Нормы, утратившие силу, помечены зачёркиванием и серой плашкой; полный реестр — в разделе <b>«Утратившие силу»</b>, где список можно отсеять по периоду («за месяц», «за неделю») и по году с месяцем.</p>" +
        "<p><b>«Новое»</b> — лента изменений по дням: новые статьи, новые редакции, утрата силы. <b>«Сравнение»</b> — редакции источника построчно и две статьи бок о бок. <b>«Аналитика»</b> — сводные цифры, лента по годам и граф ссылок между актами.</p>") +

      sec("Свои данные: подборка, дела, экспорт", "clip",
        "<p>Кнопка «В подборку» есть на странице статьи и в поиске. <b>«Подборка норм»</b> хранит рабочий набор по делу с заметками и выгрузкой, <b>«Дела»</b> — папки по делам с журналом.</p>" +
        "<p>На странице статьи — «Скопировать ссылку», «с реквизитами», «Ссылка по ГОСТ» и «Скачать .docx».</p>" +
        "<p>Кнопка <b>Aa</b> — размер текста, межстрочный интервал и ширина колонки; <b>☾ / ☀</b> — тёмная и светлая тема. Подборка, избранное, дела, заметки и настройки хранятся только в вашем браузере.</p>") +

      sec("Роль: под кого работает подсказка", "user",
        "<p>Кнопка <b>роли</b> — в верхней панели справа (значок человека рядом с настройками чтения). Выберите оперативника, следователя, адвоката или госорган — приложение поднимет наверх то, что чаще нужно вашей работе.</p>" +
        "<p>Когда роль выбрана, её название видно прямо на кнопке и в полосе под верхней панелью на любой вкладке. Там же — кнопка «Снять роль».</p>" +
        "<p>Главная, чек-листы и шаблоны перестраиваются по приоритету роли, а в поиске результат помечается «по вашей роли» и отдельным блоком под выдачей. Основной порядок выдачи при этом не меняется: юридически верный ответ остаётся на своём месте.</p>") +

      sec("Состав базы", "scales",
        "<p>Конституция РФ, 24 кодекса, федеральные законы (включая ФЗ о полиции, об ОРД, о ФСБ, о Росгвардии, о прокуратуре, о Следственном комитете, об оружии, о наркотических средствах, о противодействии коррупции, о государственной тайне), 14 федеральных конституционных законов, постановления Правительства РФ (ПДД, правила регистрационного и миграционного учёта, правила оборота оружия, положение о воинском учёте и военно-врачебной экспертизе) и 99 постановлений Пленума Верховного Суда РФ. Всего — более 19 300 статей и пунктов в действующих редакциях.</p>" +
        "<p>Тексты получены с официального портала правовой информации <b>actual.pravo.gov.ru</b>; дата редакции указана у каждого источника и каждой статьи.</p>") +

      "</div>" +

      '<div class="disclaimer">Тексты правовых актов не являются объектами авторских прав (п. 6 ст. 1259 ГК РФ). ' +
      "Справочные аннотации и памятки подготовлены для приложения и не являются официальным текстом " +
      "нормативного правового акта; юридически значимые выводы делайте по официальной публикации.</div>";
  }

  /* ------------------------------------------------------------------ актуальность */

  var updates = {};      // id -> { redaction, hash } — доступные обновления
  var overrides = {};    // id -> сохранённое локальное обновление
  var freshState = { checkedAt: null, error: null, running: false, newDocs: [] };

  /* --- автообновление базы --------------------------------------------------
     Сборщик кладёт рядом с данными крошечный data/version.json — отпечаток
     содержимого data/ (tools/build-data.js). Метку времени он при подсчёте
     обнуляет, поэтому отпечаток меняется вместе с самими данными, а не каждую
     ночь. Открытая вкладка перечитывает файл в фоне и, если отпечаток
     разошёлся с загруженным, предлагает обновиться.

     Свежая загрузка страницы всегда отдаёт текущую сборку, поэтому
     уведомление адресовано тем, кто читает приложение в момент выкладки:
     для них перезагрузка — единственный способ получить новые тексты. */
  var BUILD_KEY = "buildDigest";       // отпечаток, с которым открыта вкладка
  var BUILD_URL = "data/version.json";
  var BUILD_EVERY = 45 * 60 * 1000;    // период фоновой перепроверки
  var BUILD_MIN_GAP = 5 * 60 * 1000;   // не чаще этого при возврате во вкладку

  var buildInfo = {
    digest: "",       // отпечаток загруженной сборки
    at: "",           // время сборки
    checkedAt: 0,     // когда последний раз удачно спросили сервер
    running: false,
    hidden: false,    // «Скрыть» — до конца сеанса
    latest: null,     // данные обнаруженной новой сборки
    timer: 0,
    bar: null
  };

  /* На file:// проверять нечего: отпечаток всё равно недоступен */
  function buildCanCheck() {
    return typeof fetch === "function" && /^https?:$/.test(location.protocol);
  }

  /* Метка версии для ленивых шардов (см. loadFtShard/loadFull/loadFtDict):
     без неё после выкладки браузер отдал бы из кеша старые тексты. */
  function buildQuery() {
    return buildInfo && buildInfo.digest ? "?v=" + encodeURIComponent(buildInfo.digest) : "";
  }

  /* Строка для раздела «Проверка актуальности» */
  function buildStampText() {
    if (!buildInfo.digest) return "не определена";
    return "№ " + buildInfo.digest +
      (buildInfo.at ? " от " + fmtDateTime(new Date(buildInfo.at)) : "");
  }

  function buildBarEl() {
    if (buildInfo.bar) return buildInfo.bar;
    var el = document.createElement("div");
    el.className = "update-bar";
    el.hidden = true;
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.innerHTML =
      '<span class="ub-ico">' + ic("refresh") + "</span>" +
      '<div class="ub-body">' +
        "<b>Вышла новая редакция базы</b>" +
        '<span class="ub-note" id="ubNote"></span>' +
      "</div>" +
      '<button class="btn btn-primary ub-go" id="ubGo" type="button">Обновить</button>' +
      '<button class="icon-btn ub-x" id="ubX" type="button" aria-label="Скрыть до конца сеанса">' +
        ic("close") + "</button>";
    document.body.appendChild(el);
    buildInfo.bar = el;
    el.querySelector("#ubGo").addEventListener("click", buildReload);
    el.querySelector("#ubX").addEventListener("click", function () {
      buildInfo.hidden = true;
      hideBuildBar();
    });
    return el;
  }

  function showBuildBar(j) {
    if (buildInfo.hidden) return;
    var el = buildBarEl();
    var note = el.querySelector("#ubNote");
    if (note) {
      note.textContent = "Статей: " + (j.articles || "—") +
        (j.at ? " · собрано " + fmtDateTime(new Date(j.at)) : "");
    }
    el.hidden = false;
    /* класс на body поднимает тост выше, чтобы тот не наехал на уведомление */
    document.body.classList.add("has-update");
    requestAnimationFrame(function () { el.classList.add("show"); });
  }

  function hideBuildBar() {
    var el = buildInfo.bar;
    if (!el || el.hidden) return;
    el.classList.remove("show");
    document.body.classList.remove("has-update");
    setTimeout(function () { if (!el.classList.contains("show")) el.hidden = true; }, 280);
  }

  /* Перезагрузка мимо кеша: в адресе появляется метка версии, поэтому и
     документ, и данные приходят из сети, а не из кеша браузера. */
  function buildReload() {
    var d = (buildInfo.latest && buildInfo.latest.digest) || buildInfo.digest || Date.now();
    location.replace(location.pathname + "?v=" + encodeURIComponent(d) + location.hash);
  }

  /* boot = первый опрос после загрузки страницы. В этом случае данные на
     экране уже этой сборки, поэтому расхождение с сохранённым отпечатком
     означает лишь «с прошлого визита база обновилась» — молча запоминаем. */
  function checkBuild(boot) {
    if (buildInfo.running || !buildCanCheck()) return;
    buildInfo.running = true;
    fetch(BUILD_URL + "?_=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .then(function (j) {
        buildInfo.running = false;
        if (!j || !j.digest) return;
        buildInfo.checkedAt = Date.now();
        var seen = LS.get(BUILD_KEY, "");
        if (!seen || seen === j.digest || boot) {
          if (seen !== j.digest) LS.set(BUILD_KEY, j.digest);
          buildInfo.digest = j.digest;
          buildInfo.at = j.at || "";
          buildInfo.latest = null;
          hideBuildBar();
          if (state.route.name === "freshness") render();
          return;
        }
        /* вкладка открыта со старой сборкой — предлагаем обновиться.
           digest не трогаем: ленивые шарды должны остаться версии загруженной
           сборки, иначе свежий шард разошёлся бы со старым индексом статей. */
        buildInfo.digest = seen;
        buildInfo.latest = j;
        showBuildBar(j);
      })
      .catch(function () { buildInfo.running = false; });
  }

  function startBuildWatch() {
    if (!buildCanCheck()) return;
    checkBuild(true);
    buildInfo.timer = setInterval(function () { checkBuild(false); }, BUILD_EVERY);
    /* возврат во вкладку — самый вероятный момент, когда человек заметит
       уведомление; но чаще, чем раз в 5 минут, сеть не дёргаем */
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - buildInfo.checkedAt < BUILD_MIN_GAP) return;
      checkBuild(false);
    });
  }

  /* --- ежедневный контроль актуальности ------------------------------------
     Требование: сведения о действующей редакции должны проверяться «день в
     день». При открытии приложения, если с прошлой удачной проверки прошли
     сутки, проверка запускается автоматически и в фоне: работа интерфейса
     не блокируется, результат пишется в localStorage и показывается значком.
     Ручная кнопка осталась — она просто форсирует проверку. */
  var DAILY_KEY = "freshCheck";
  var dailyFresh = {
    date: "",         // «ГГГГ-ММ-ДД» последней удачной проверки
    at: 0,            // метка времени последней удачной проверки
    newer: 0,         // сколько источников устарело
    newDocs: 0,       // сколько новых документов появилось в наборе
    error: "",        // текст последней ошибки, если была
    running: false
  };

  /* Разница в календарных днях между двумя датами (без времени) */
  function dayDiff(a, b) {
    var da = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    var db = new Date(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((db - da) / 86400000);
  }

  function todayKey(d) {
    var t = d || new Date();
    return t.getFullYear() + "-" + pad(t.getMonth() + 1) + "-" + pad(t.getDate());
  }

  function loadDaily() {
    var saved = LS.get(DAILY_KEY, null);
    if (!saved) return;
    dailyFresh.date = saved.date || "";
    dailyFresh.at = saved.at || 0;
    dailyFresh.newer = saved.newer || 0;
    dailyFresh.newDocs = saved.newDocs || 0;
    dailyFresh.error = saved.error || "";
    /* переносим в freshState, чтобы раздел «Проверка актуальности» показывал
       прошлый результат до новой проверки */
    if (dailyFresh.at) {
      freshState.checkedAt = new Date(dailyFresh.at);
      freshState.error = dailyFresh.error ? new Error(dailyFresh.error) : null;
    }
  }

  function saveDaily() {
    LS.set(DAILY_KEY, {
      date: dailyFresh.date, at: dailyFresh.at, newer: dailyFresh.newer,
      newDocs: dailyFresh.newDocs, error: dailyFresh.error
    });
  }

  /* Проверка нужна, если сегодня её ещё не было */
  function dailyCheckDue() {
    return dailyFresh.date !== todayKey();
  }

  /* Запускается из init(). Тихая: не перерисовывает раздел, если он не открыт,
     не показывает модальных сообщений — только значок и один разовый тост. */
  function runDailyCheck(manual) {
    if (dailyFresh.running || !FRESH || !FRESH.raw_base) return;
    if (typeof fetch !== "function") {
      dailyFresh.error = "среда не поддерживает сетевые запросы";
      freshState.error = new Error(dailyFresh.error);
      saveDaily();
      return;
    }
    dailyFresh.running = true;
    freshState.running = true;
    if (state.route.name === "freshness") render();

    checkFreshness(function (err, res) {
      dailyFresh.running = false;
      freshState.running = false;
      if (err) {
        /* сеть недоступна — дату не сдвигаем, попробуем при следующем открытии */
        dailyFresh.error = String(err.message || err);
        freshState.error = err;
        saveDaily();
        if (manual) toast("Не удалось проверить: " + dailyFresh.error);
      } else {
        dailyFresh.date = todayKey();
        dailyFresh.at = Date.now();
        dailyFresh.newer = res ? res.newer : 0;
        dailyFresh.newDocs = res ? (res.newDocs || []).length : 0;
        dailyFresh.error = "";
        saveDaily();
        if (manual) toast(dailyFresh.newer ? "Найдено обновлений: " + dailyFresh.newer : "Все редакции актуальны");
        else if (dailyFresh.newer) {
          toast("Проверка за сегодня: обновлений — " + dailyFresh.newer);
        }
      }
      buildNav();
      render();
    });
  }

  /* Значок состояния ежедневной проверки в боковой панели и на главной */
  function freshnessChip() {
    if (dailyFresh.running) return '<span class="st st-muted">проверка…</span>';
    if (dailyFresh.error) return '<span class="st st-warn">проверка недоступна</span>';
    if (!dailyFresh.at) return '<span class="st st-muted">не проверялось</span>';
    if (dailyFresh.newer) return '<span class="st st-warn">обновлений: ' + dailyFresh.newer + "</span>";
    return '<span class="st st-ok">актуально на ' + fmtDate(new Date(dailyFresh.at)) + "</span>";
  }


  /* Компактная дата манифеста «20260901» -> «2026-09-01» */
  function fmtCompact(s) {
    var m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(s || ""));
    return m ? m[1] + "-" + m[2] + "-" + m[3] : "";
  }

  /* --- локальное хранилище обновлений и версий (IndexedDB) --- */

  var IDB = (function () {
    var db = null, failed = false, name = "rflaws";
    var S_OV = "overrides";   // id -> текущая локально обновлённая редакция
    var S_VER = "versions";   // id|redaction -> снимок прежней редакции
    var VER = 2;

    function open(cb) {
      if (failed || typeof indexedDB === "undefined") { cb(null); return; }
      if (db) { cb(db); return; }
      var req;
      try { req = indexedDB.open(name, VER); } catch (e) { failed = true; cb(null); return; }
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains(S_OV)) d.createObjectStore(S_OV, { keyPath: "id" });
        if (!d.objectStoreNames.contains(S_VER)) {
          var vs = d.createObjectStore(S_VER, { keyPath: "vid" });
          vs.createIndex("doc", "id", { unique: false });
        }
      };
      req.onsuccess = function () { db = req.result; cb(db); };
      req.onerror = function () { failed = true; cb(null); };
      req.onblocked = function () { failed = true; cb(null); };
    }

    function run(store, mode, fn, cb) {
      open(function (d) {
        if (!d) { cb(null); return; }
        var t, r;
        try { t = d.transaction(store, mode); r = fn(t.objectStore(store)); }
        catch (e) { cb(null); return; }
        t.oncomplete = function () { cb(r && r.result !== undefined ? r.result : true); };
        t.onerror = function () { cb(null); };
        t.onabort = function () { cb(null); };
      });
    }

    return {
      available: function () { return typeof indexedDB !== "undefined"; },
      all: function (cb) { run(S_OV, "readonly", function (s) { return s.getAll(); }, function (r) { cb(r || []); }); },
      put: function (v, cb) { run(S_OV, "readwrite", function (s) { return s.put(v); }, function () { cb(true); }); },
      clear: function (cb) { run(S_OV, "readwrite", function (s) { return s.clear(); }, function () { cb(true); }); },

      /* версии прежних редакций */
      verAll: function (cb) {
        run(S_VER, "readonly", function (s) { return s.getAll(); }, function (r) { cb(r || []); });
      },
      verPut: function (v, cb) { run(S_VER, "readwrite", function (s) { return s.put(v); }, function () { cb(true); }); },
      verDel: function (vid, cb) { run(S_VER, "readwrite", function (s) { return s.delete(vid); }, function () { cb(true); }); },
      verClear: function (cb) { run(S_VER, "readwrite", function (s) { return s.clear(); }, function () { cb(true); }); }
    };
  })();

  /* Замена содержимого источника на обновлённый текст */
  function applyOverride(id, rows, redaction) {
    var old = (byCode[id] || []).slice();
    old.forEach(function (a) {
      delete byId[a.id];
      var i = arts.indexOf(a);
      if (i >= 0) arts.splice(i, 1);
    });
    byCode[id] = [];
    rows.forEach(function (r) {
      var a = pushArt(makeArt(id, r[0], r[1], r[2], false));
      var cur = byId[id + "-" + r[0]];
      if (cur) cur.row = r;
    });
    var c = CO[id];
    if (c) { if (redaction) c.redaction = redaction; c.count = rows.length; }
    FULL[id] = rows;
    delete updates[id];
    graphCache = null;   /* тексты изменились — граф пересоберётся */
  }

  /* Загрузка сохранённых обновлений при запуске */
  function loadOverrides(done) {
    IDB.all(function (list) {
      var n = 0;
      list.forEach(function (ov) {
        if (!ov || !ov.id || !ov.articles) return;
        overrides[ov.id] = ov;
        applyOverride(ov.id, ov.articles, ov.redaction);
        n++;
      });
      done(n);
    });
  }

  /* --- версии прежних редакций --- */

  var VERSIONS = {};        // id -> массив снимков (новые первыми)
  var VER_MAX = 6;          // сколько прежних редакций хранить на источник

  function verKey(id, redaction) { return id + "|" + (redaction || "б/д"); }

  /* Загрузка версий при запуске */
  function loadVersions(done) {
    IDB.verAll(function (list) {
      VERSIONS = {};
      (list || []).forEach(function (v) {
        if (!v || !v.id || !v.articles) return;
        (VERSIONS[v.id] = VERSIONS[v.id] || []).push(v);
      });
      Object.keys(VERSIONS).forEach(function (id) {
        VERSIONS[id].sort(function (a, b) {
          return String(b.redaction || "").localeCompare(String(a.redaction || ""));
        });
      });
      done(Object.keys(VERSIONS).length);
    });
  }

  /* Сохранить прежнюю редакцию перед перезаписью.
     snap: {id, redaction, hash, articles, updated_at, source} */
  function saveVersion(snap, cb) {
    if (!snap || !snap.id || !snap.articles || !snap.articles.length) { cb && cb(false); return; }
    var rec = {
      vid: verKey(snap.id, snap.redaction),
      id: snap.id,
      redaction: snap.redaction || "",
      hash: snap.hash || "",
      articles: snap.articles,
      saved_at: new Date().toISOString(),
      source: snap.source || ""
    };
    var list = VERSIONS[snap.id] = VERSIONS[snap.id] || [];
    var dup = list.some(function (v) { return v.vid === rec.vid; });
    if (!dup) list.unshift(rec);
    list.sort(function (a, b) {
      return String(b.redaction || "").localeCompare(String(a.redaction || ""));
    });
    /* лимит глубины: лишние — удаляем из памяти и из БД */
    var over = list.splice(VER_MAX);
    over.forEach(function (v) { IDB.verDel(v.vid); });
    IDB.verPut(rec, function () { cb && cb(true); });
  }

  function verList(id) { return (VERSIONS[id] || []).slice(); }

  function verGet(id, redaction) {
    var k = verKey(id, redaction);
    var list = VERSIONS[id] || [];
    for (var i = 0; i < list.length; i++) if (list[i].vid === k) return list[i];
    return null;
  }

  function verDrop(id, redaction) {
    var k = verKey(id, redaction);
    var list = VERSIONS[id] || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].vid === k) { list.splice(i, 1); break; }
    }
    IDB.verDel(k);
  }

  function verCount(id) { return (VERSIONS[id] || []).length; }

  /* ------------------------------------------------------------------ сравнение редакций */

  /* Разбиение текста на строки для построчного сравнения.
     Пустые строки выбрасываются — иначе они «разъезжаются» при любом сдвиге
     и дают ложные различия. Кириллица: \s работает (это Unicode-класс),
     поэтому здесь ловушка с \w/\b не проявляется. */
  function diffLines(text) {
    return String(text == null ? "" : text)
      .replace(/\u00a0/g, " ")
      .split(/\r\n|\r|\n/)
      .map(function (l) { return l.replace(/[ \t]+$/, ""); })
      .filter(function (l) { return l.trim() !== ""; });
  }

  /* LCS-диff по строкам.
     Возвращает массив {t:"="|"-"|"+", v:строка, o:индекс слева, n:индекс справа}.
     Классический DP по длине — тексты статей короткие (десятки строк), поэтому
     O(m*n) безопасен. Для больших кусков сверху стоит отсечка. */
  function lineDiff(a, b) {
    var m = a.length, n = b.length, i, j;
    /* защита от квадратичного взрыва на очень больших текстах */
    if (m * n > 4000000) {
      return a.map(function (v, k) { return { t: "=", v: v, o: k, n: k }; })
        .concat(b.slice(m).map(function (v, k) { return { t: "+", v: v, o: -1, n: m + k }; }));
    }
    var dp = [];
    for (i = 0; i <= m; i++) { dp.push(new Array(n + 1)); dp[i][0] = 0; }
    for (j = 0; j <= n; j++) dp[0][j] = 0;
    for (i = 1; i <= m; i++) {
      for (j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
    var out = [];
    i = m; j = n;
    while (i > 0 && j > 0) {
      if (a[i - 1] === b[j - 1]) { out.push({ t: "=", v: a[i - 1], o: i - 1, n: j - 1 }); i--; j--; }
      else if (dp[i - 1][j] >= dp[i][j - 1]) { out.push({ t: "-", v: a[i - 1], o: i - 1, n: -1 }); i--; }
      else { out.push({ t: "+", v: b[j - 1], o: -1, n: j - 1 }); j--; }
    }
    while (i > 0) { out.push({ t: "-", v: a[i - 1], o: i - 1, n: -1 }); i--; }
    while (j > 0) { out.push({ t: "+", v: b[j - 1], o: -1, n: j - 1 }); j--; }
    return out.reverse();
  }

  /* Сравнение двух наборов статей: [[n,t,g,red,text], ...]
     Возвращает {arts:[{n,t1,t2,status,parts,red1,red2}], added, removed, changed, kept} */
  function diffArticles(oldRows, newRows) {
    var map = function (rows) {
      var o = {};
      (rows || []).forEach(function (r) { o[String(r[0])] = r; });
      return o;
    };
    var A = map(oldRows), B = map(newRows);
    var keys = [], seen = {};
    (oldRows || []).concat(newRows || []).forEach(function (r) {
      var k = String(r[0]);
      if (!seen[k]) { seen[k] = 1; keys.push(k); }
    });
    keys.sort(cmpNumbers);

    var arts = [], added = 0, removed = 0, changed = 0, kept = 0;
    keys.forEach(function (k) {
      var a = A[k], b = B[k];
      if (a && !b) { removed++; arts.push({ n: k, status: "removed", t1: a[1], t2: "", parts: null }); return; }
      if (!a && b) { added++; arts.push({ n: k, status: "added", t1: "", t2: b[1], parts: null }); return; }
      var txt1 = String(a[4] == null ? "" : a[4]);
      var txt2 = String(b[4] == null ? "" : b[4]);
      var same = txt1 === txt2 && String(a[1] || "") === String(b[1] || "");
      if (same) {
        kept++;
        arts.push({ n: k, status: "same", t1: a[1], t2: b[1], parts: null });
      } else {
        changed++;
        var parts = lineDiff(diffLines(txt1), diffLines(txt2));
        var plus = 0, minus = 0;
        parts.forEach(function (p) { if (p.t === "+") plus++; else if (p.t === "-") minus++; });
        arts.push({
          n: k, status: "changed", t1: a[1], t2: b[1], parts: parts,
          plus: plus, minus: minus, red1: a[3] || "", red2: b[3] || ""
        });
      }
    });
    return { arts: arts, added: added, removed: removed, changed: changed, kept: kept };
  }

  /* Сортировка номеров статей: «159.1» идёт после «159» и перед «160» */
  function cmpNumbers(x, y) {
    var a = numParts(x), b = numParts(y);
    for (var i = 0; i < Math.max(a.length, b.length); i++) {
      var av = a[i], bv = b[i];
      if (av === undefined) return -1;
      if (bv === undefined) return 1;
      if (av === bv) continue;
      if (typeof av === "number" && typeof bv === "number") return av - bv;
      return String(av).localeCompare(String(bv), "ru");
    }
    return 0;
  }

  function numParts(x) {
    return String(x || "").split(/[.\-]/).map(function (p) {
      return /^\d+$/.test(p) ? parseInt(p, 10) : p;
    });
  }

  /* --- вид «Сравнение редакций» --- */

  var diffState = { loading: false, error: "", result: null, mode: "", from: "", to: "" };

  /* Текущий (рабочий) набор строк источника: обновлённый, если есть обновление */
  function currentRows(id) {
    if (FULL[id] && FULL[id].length) return FULL[id];
    var ov = overrides[id];
    if (ov && ov.articles) return ov.articles;
    return (byCode[id] || []).map(function (a) {
      return [a.n, a.t, a.g, a.red || "", a.text || ""];
    });
  }

  /* Варианты для выпадающих списков: текущая редакция + сохранённые версии */
  function versionOptions(id) {
    var opts = [];
    var c = CO[id] || {};
    var cur = overrides[id];
    opts.push({
      val: "current",
      label: "Текущая в базе — " + fmtRed((cur && cur.redaction) || c.redaction || "") +
        (cur ? " (обновлена локально)" : "")
    });
    verList(id).forEach(function (v) {
      opts.push({ val: v.vid, label: "Сохранённая — " + fmtRed(v.redaction) + " (" + v.articles.length + " ст.)" });
    });
    opts.push({ val: "online", label: "Онлайн-редакция с официального набора" });
    return opts;
  }

  function viewDiffIndex() {
    var withVer = CODES.filter(function (c) { return verCount(c.id) > 0; });
    var withUpd = CODES.filter(function (c) { return updates[c.id]; });

    var verCards = withVer.map(function (c) {
      var list = verList(c.id);
      return '<div class="card" data-go="#/diff/' + esc(c.id) + '" style="cursor:pointer">' +
        '<div style="font-weight:620">' + esc(c.short) + "</div>" +
        '<div class="small muted" style="margin-top:4px">' + esc(c.full) + "</div>" +
        '<div class="small muted" style="margin-top:8px">Сохранено редакций: ' + list.length +
          " · " + list.map(function (v) { return esc(fmtRed(v.redaction)); }).join(", ") + "</div></div>";
    }).join("");

    var updCards = withUpd.map(function (c) {
      return '<div class="card" data-go="#/diff/' + esc(c.id) + '" style="cursor:pointer">' +
        '<div style="font-weight:620">' + esc(c.short) + "</div>" +
        '<div class="small muted" style="margin-top:4px">' + esc(c.full) + "</div>" +
        '<div class="small muted" style="margin-top:8px">В базе ' + esc(fmtRed(c.redaction)) +
          " → в наборе " + esc(fmtRed(updates[c.id].redaction)) + " · <b>можно сравнить с онлайн-версией</b></div></div>";
    }).join("");

    var body;
    if (verCards || updCards) {
      body = (updCards ? '<h2>Доступно обновление</h2><div class="grid grid-2">' + updCards + "</div>" : "") +
        (verCards ? '<h2>Сохранённые прежние редакции</h2><div class="grid grid-2">' + verCards + "</div>" : "");
    } else {
      body = '<div class="info-box">Пока нечего сравнивать. Прежняя редакция источника сохраняется автоматически, ' +
        'когда вы обновляете его в разделе <a href="#/freshness" class="lnk">«Проверка актуальности»</a>. ' +
        "После первого обновления версии появятся здесь.</div>";
    }

    return '<h1>Сравнение редакций</h1>' +
      tabStrip(CMP_TABS, "diff") +
      '<p class="lead">Приложение сохраняет прежнюю редакцию документа перед каждым обновлением. Здесь видно, ' +
      "что именно изменилось: добавленные, исключённые и переписанные статьи — построчно.</p>" +
      body +
      '<div class="disclaimer">Сравнение строится по текстам, полученным из открытого набора данных; ' +
      "для юридически значимых выводов сверяйтесь с официальной публикацией.</div>";
  }

  function viewDiff(id) {
    if (!id) return viewDiffIndex();
    var c = CO[id];
    if (!c) return '<div class="empty"><div class="ico">' + ic("book") + '</div><div>Источник не найден.</div></div>';
    var opts = versionOptions(id);
    var hasVer = verList(id).length;
    var optHtml = function (sel) {
      return opts.map(function (o) {
        return '<option value="' + esc(o.val) + '"' + (o.val === sel ? " selected" : "") + ">" + esc(o.label) + "</option>";
      }).join("");
    };

    var box;
    if (diffState.loading) {
      box = '<div class="info-box"><span class="loading">Сравниваем редакции…</span></div>';
    } else if (diffState.error) {
      box = '<div class="warn-box"><b>Не удалось сравнить.</b> ' + esc(diffState.error) +
        (typeof fetch === "function" ? "" : ' <span class="small">Похоже, приложение открыто локально без сети — для сравнения с онлайн-редакцией нужен доступ в интернет.</span>') + "</div>";
    } else if (diffState.result) {
      box = diffResultHtml(diffState.result, c);
    } else {
      box = '<div class="info-box">' + (hasVer
        ? "Выберите две редакции и нажмите «Сравнить». Сохранено прежних редакций: <b>" + hasVer + "</b>."
        : "Приложение сохраняет прежнюю редакцию источника автоматически, когда вы обновляете его из набора. Пока сохранённых версий нет — можно сравнить текущую редакцию с онлайн-версией.") +
        "</div>";
    }

    return '<h1>Сравнение редакций</h1>' +
      tabStrip(CMP_TABS, "diff") +
      '<p class="lead">' + esc(c.full) + " · " + esc(c.short) + "</p>" +
      '<div class="card diff-ctl">' +
        '<div class="diff-sel"><label>Первая редакция</label><select class="input" id="diffFrom"' +
          (hasVer ? "" : ' data-forced="1"') + ">" + optHtml(diffState.from || (hasVer ? verList(id)[0].vid : "current")) + "</select></div>" +
        '<div class="diff-arrow">→</div>' +
        '<div class="diff-sel"><label>Вторая редакция</label><select class="input" id="diffTo">' +
          optHtml(diffState.to || "online") + "</select></div>" +
        '<div class="diff-act"><button class="btn btn-primary" id="diffRun">Сравнить</button></div>' +
      "</div>" +
      '<div class="actions-row">' +
        '<button class="btn btn-sm" data-go="#/code/' + esc(id) + '">← К источнику</button>' +
        (diffState.result ? '<button class="btn btn-sm" id="diffDocx">Выгрузить .docx</button>' +
          '<button class="btn btn-sm" id="diffTxt">Выгрузить .txt</button>' : "") +
      "</div>" +
      box;
  }

  function diffResultHtml(res, c) {
    var showAll = diffState.mode === "all";
    var head = '<div class="grid grid-4" style="margin:16px 0">' +
      stat(res.arts.length, "статей сопоставлено") +
      stat(res.changed, "изменилось") +
      stat(res.added, "добавлено") +
      stat(res.removed, "исключено") +
      "</div>";

    var interesting = res.arts.filter(function (a) { return a.status !== "same"; });
    if (!interesting.length) {
      return head + '<div class="info-box"><b>Различий нет.</b> Редакции совпадают по тексту и названиям статей.</div>';
    }

    var list = showAll ? res.arts : interesting;
    var rows = list.map(function (a) {
      if (a.status === "same") {
        return '<details class="diff-art diff-same"><summary><span class="diff-num">ст. ' + esc(a.n) +
          '</span><span class="diff-title">' + esc(a.t1) + '</span><span class="st st-muted">без изменений</span></summary></details>';
      }
      if (a.status === "added") {
        return '<div class="diff-art diff-added"><div class="diff-head"><span class="diff-num">ст. ' + esc(a.n) +
          '</span><span class="st st-ok">добавлена</span></div><div class="diff-title">' + esc(a.t2) + "</div></div>";
      }
      if (a.status === "removed") {
        return '<div class="diff-art diff-removed"><div class="diff-head"><span class="diff-num">ст. ' + esc(a.n) +
          '</span><span class="st st-warn">исключена</span></div><div class="diff-title">' + esc(a.t1) + "</div></div>";
      }
      var t1 = esc(a.t1 || ""), t2 = esc(a.t2 || "");
      var titleLine = t1 === t2
        ? '<div class="diff-title">' + t1 + "</div>"
        : '<div class="diff-title"><del>' + t1 + "</del> <ins>" + t2 + "</ins></div>";
      var body = a.parts.filter(function (p) { return p.t !== "="; }).map(function (p) {
        var cls = p.t === "+" ? "diff-ins" : "diff-del";
        var mark = p.t === "+" ? "+ " : "− ";
        return '<div class="diff-line ' + cls + '">' + mark + esc(p.v) + "</div>";
      }).join("");
      var ctx = '<div class="diff-counts"><span class="diff-ins-c">+' + (a.plus || 0) +
        '</span> <span class="diff-del-c">−' + (a.minus || 0) + "</span>" +
        (a.red1 || a.red2 ? ' <span class="small muted">' + esc(fmtRed(a.red1 || "")) + " → " + esc(fmtRed(a.red2 || "")) + "</span>" : "") + "</div>";
      return '<details class="diff-art diff-changed" open><summary><span class="diff-num">ст. ' + esc(a.n) +
        '</span><span class="st st-warn">изменена</span>' + ctx + "</summary>" +
        titleLine + '<div class="diff-body">' + body + "</div></details>";
    }).join("");

    var toggle = '<div class="small muted" style="margin:10px 0">Показано: ' +
      (showAll ? "все статьи" : "только изменённые (" + interesting.length + ")") +
      ' · <a href="#" id="diffToggle" class="lnk">' + (showAll ? "скрыть неизменённые" : "показать все статьи") + "</a></div>";

    return head + toggle + '<div class="diff-list">' + rows + "</div>";
  }

  function diffPlain(res) {
    var out = [];
    res.arts.forEach(function (a) {
      if (a.status === "same") return;
      if (a.status === "added") { out.push("+ Статья " + a.n + " " + (a.t2 || "") + " (добавлена)"); return; }
      if (a.status === "removed") { out.push("- Статья " + a.n + " " + (a.t1 || "") + " (исключена)"); return; }
      out.push("~ Статья " + a.n + " — изменена"
        + (a.red1 || a.red2 ? " (" + (a.red1 || "б/д") + " → " + (a.red2 || "б/д") + ")" : ""));
      a.parts.forEach(function (p) {
        if (p.t === "+") out.push("    + " + p.v);
        else if (p.t === "-") out.push("    - " + p.v);
      });
      out.push("");
    });
    return out.join("\n");
  }

  function bindDiff(id) {
    var run = $("#diffRun");
    if (run) {
      run.addEventListener("click", function () {
        var f = ($("#diffFrom") || {}).value || "current";
        var t = ($("#diffTo") || {}).value || "online";
        runDiff(id, f, t);
      });
    }
    var tog = $("#diffToggle");
    if (tog) {
      tog.addEventListener("click", function (e) {
        e.preventDefault();
        diffState.mode = diffState.mode === "all" ? "changed" : "all";
        var v = $("#view");
        v.innerHTML = viewDiff(id);
        bindDiff(id);
      });
    }
    var dx = $("#diffDocx");
    if (dx) dx.addEventListener("click", function () {
      var c = CO[id] || {};
      var head = "<h1>Сравнение редакций: " + esc(c.full) + "</h1>" +
        '<p class="m">' + esc(labelOfSide(id, diffState.from)) + " → " + esc(labelOfSide(id, diffState.to)) +
        " · сформировано " + fmtDateTime(new Date()) + "</p><hr>";
      var body = diffPlain(diffState.result).split("\n").map(function (l) {
        return "<p>" + esc(l || " ") + "</p>";
      }).join("");
      saveDocx("sravnenie-" + id + ".docx", "Сравнение редакций " + (c.short || id), head + body);
      toast("Файл .docx сохранён");
    });
    var dt = $("#diffTxt");
    if (dt) dt.addEventListener("click", function () {
      var c = CO[id] || {};
      download("sravnenie-" + id + ".txt",
        c.full + "\n\nСравнение редакций: " + labelOfSide(id, diffState.from) + " → " + labelOfSide(id, diffState.to) +
        "\nСформировано: " + fmtDateTime(new Date()) + "\n\n" + diffPlain(diffState.result),
        "text/plain");
      toast("Файл сохранён");
    });
  }

  function labelOfSide(id, which) {
    if (which === "online") return "Онлайн-редакция";
    if (which === "current") return "Текущая редакция в базе";
    var list = VERSIONS[id] || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].vid === which) return "Сохранённая редакция " + fmtRed(list[i].redaction);
    }
    return String(which);
  }

  /* --- вид «Сравнение двух статей» --- */

  function viewCompare(aId, bId) {
    aId = aId || ""; bId = bId || "";
    var a = aId ? byId[aId] : null;
    var b = bId ? byId[bId] : null;

    function slot(side, art) {
      if (art) {
        var c = codeById(art.c) || { short: art.c, color: "#888" };
        var col = c.color || "#888";
        return '<div class="cmp-slot cmp-filled">' +
          '<div class="cmp-slot-head">' +
            '<span class="badge" style="border-color:' + col + '44;color:' + col + '">' + esc(c.short) + '</span>' +
            '<span class="cmp-slot-num">ст. ' + esc(art.dn) + '</span>' +
            '<span class="cmp-slot-title">' + esc(art.t) + '</span>' +
          '</div>' +
          '<button class="btn btn-sm" data-cmp-clear="' + side + '">Сменить</button>' +
          '</div>';
      }
      var cap = side === "a" ? "А" : "Б";
      return '<div class="cmp-slot cmp-empty">' +
        '<label class="cmp-label" for="cmp' + side.toUpperCase() + 'Input">Статья ' + cap + '</label>' +
        '<input class="input" id="cmp' + side.toUpperCase() + 'Input" placeholder="Номер, название или слова из текста — напр. «ст 105 УК»" autocomplete="off">' +
        '<div class="cmp-results" id="cmp' + side.toUpperCase() + 'Results"></div>' +
        '</div>';
    }

    var actions = '<div class="actions-row" style="margin-top:14px">' +
      (a && b ? '<button class="btn btn-primary" data-cmp-run="1">Сравнить заново</button>'
              : '<span class="small muted">Выберите обе статьи, чтобы увидеть сравнение.</span>') +
      '</div>';

    return '<h1>Сравнение двух статей</h1>' +
      tabStrip(CMP_TABS, "compare") +
      '<p class="lead">Выберите две статьи — приложение покажет, чем отличаются их тексты построчно. ' +
        'Удобно сопоставить близкие составы (кража и грабёж) или разные редакции одной статьи из разных источников.</p>' +
      '<div class="cmp-grid">' +
        '<div class="cmp-col">' + slot("a", a) + '</div>' +
        '<div class="cmp-col">' + slot("b", b) + '</div>' +
      '</div>' + actions +
      '<div id="cmpResult"></div>' +
      '<div class="disclaimer">Сравнение строится по текстам из открытого набора данных; ' +
        'для юридически значимых выводов сверяйтесь с официальной публикацией.</div>';
  }

  function runCompare(aId, bId) {
    var a = byId[aId], b = byId[bId];
    var box = $("#cmpResult");
    if (!box) return;
    if (!a || !b) { box.innerHTML = '<div class="warn-box">Одна из статей не найдена — проверьте выбор.</div>'; return; }
    box.innerHTML = '<div class="info-box"><span class="loading">Загружаем полные тексты и сравниваем…</span></div>';

    var need = [];
    if (!hasFull(a.c)) need.push(a.c);
    if (!hasFull(b.c)) need.push(b.c);
    var done = 0;
    function paint() { paintCompare(); }
    if (!need.length) paint();
    else need.forEach(function (cid) {
      loadFull(cid, function () { if (++done === need.length) paint(); });
    });

    function paintCompare() {
      if (state.route.name !== "compare") return;
      var b2 = $("#cmpResult");
      if (!b2) return;
      var ra = findFull(a.c, a.n), rb = findFull(b.c, b.n);
      if (!ra || !rb) {
        b2.innerHTML = '<div class="warn-box">Полный текст одной из статей недоступен в открытом наборе данных. ' +
          'Сравнение возможно только для статей, включённых в набор полных текстов.</div>';
        return;
      }
      var textA = String(ra[4] || ""), textB = String(rb[4] || "");
      var ca = codeById(a.c) || {}, cb = codeById(b.c) || {};
      var parts = lineDiff(diffLines(textA), diffLines(textB));
      var ins = 0, del = 0, same = 0;
      parts.forEach(function (p) { if (p.t === "+") ins++; else if (p.t === "-") del++; else same++; });

      var rows = parts.map(function (p) {
        if (p.t === "=") return '<div class="cmp-row"><div class="cmp-cell">' + esc(p.v) + '</div><div class="cmp-cell">' + esc(p.v) + '</div></div>';
        if (p.t === "-") return '<div class="cmp-row"><div class="cmp-cell cmp-del">' + esc(p.v) + '</div><div class="cmp-cell cmp-gap"></div></div>';
        return '<div class="cmp-row"><div class="cmp-cell cmp-gap"></div><div class="cmp-cell cmp-ins">' + esc(p.v) + '</div></div>';
      }).join("");

      var summary = '<div class="grid grid-4" style="margin:18px 0">' +
        stat(ins, "только в «" + esc(ca.short || a.c) + "»") +
        stat(del, "только в «" + esc(cb.short || b.c) + "»") +
        stat(same, "совпадает") +
        stat(ins + del, "различий всего") +
        '</div>';

      b2.innerHTML = summary +
        '<div class="actions-row">' +
          '<button class="btn btn-sm" id="cmpTxt">Выгрузить .txt</button>' +
          '<button class="btn btn-sm" id="cmpDocx">Выгрузить .docx</button>' +
        '</div>' +
        '<div class="cmp-table">' +
          '<div class="cmp-row cmp-head">' +
            '<div class="cmp-cell cmp-h">' + esc(ca.short || a.c) + " · ст. " + esc(a.dn) + (ra[3] ? " (ред. " + esc(fmtRed(ra[3])) + ")" : "") + '</div>' +
            '<div class="cmp-cell cmp-h">' + esc(cb.short || b.c) + " · ст. " + esc(b.dn) + (rb[3] ? " (ред. " + esc(fmtRed(rb[3])) + ")" : "") + '</div>' +
          '</div>' + rows + '</div>';
    }
  }

  function comparePlain(aId, bId) {
    var a = byId[aId], b = byId[bId];
    if (!a || !b) return "";
    var ra = findFull(a.c, a.n), rb = findFull(b.c, b.n);
    var ca = codeById(a.c) || {}, cb = codeById(b.c) || {};
    var parts = lineDiff(diffLines(String(ra ? ra[4] : "")), diffLines(String(rb ? rb[4] : "")));
    var out = [];
    out.push("Сравнение двух статей");
    out.push((ca.short || a.c) + " · ст. " + a.dn + (ra && ra[3] ? " (ред. " + fmtRed(ra[3]) + ")" : ""));
    out.push((cb.short || b.c) + " · ст. " + b.dn + (rb && rb[3] ? " (ред. " + fmtRed(rb[3]) + ")" : ""));
    out.push("");
    out.push("Только в «" + (ca.short || a.c) + "»:");
    parts.forEach(function (p) { if (p.t === "-") out.push("  - " + p.v); });
    out.push("");
    out.push("Только в «" + (cb.short || b.c) + "»:");
    parts.forEach(function (p) { if (p.t === "+") out.push("  + " + p.v); });
    out.push("");
    out.push("Совпадает: " + parts.filter(function (p) { return p.t === "="; }).length + " строк.");
    return out.join("\n");
  }

  function downloadCompareTxt(aId, bId) {
    if (!byId[aId] || !byId[bId]) return;
    download("sravnenie-statey.txt", comparePlain(aId, bId), "text/plain");
    toast("Файл сохранён");
  }

  function downloadCompareDocx(aId, bId) {
    if (!byId[aId] || !byId[bId]) return;
    var a = byId[aId], b = byId[bId];
    var ca = codeById(a.c) || {}, cb = codeById(b.c) || {};
    var head = "<h1>Сравнение двух статей</h1>" +
      '<p class="m">' + esc(ca.full || a.c) + " · ст. " + esc(a.dn) + "</p>" +
      '<p class="m">' + esc(cb.full || b.c) + " · ст. " + esc(b.dn) + "</p><hr>";
    var body = comparePlain(aId, bId).split("\n").map(function (l) { return "<p>" + esc(l || " ") + "</p>"; }).join("");
    saveDocx("sravnenie-statey.docx", "Сравнение двух статей", head + body);
    toast("Файл .docx сохранён");
  }

  function bindCompare() {
    var r = state.route;
    if (!r || r.name !== "compare") return;
    var aId = r.a || "", bId = r.b || "";
    if (aId && bId) runCompare(aId, bId);

    var setup = function (side) {
      var inp = $("#cmp" + side.toUpperCase() + "Input");
      if (!inp) return;
      var box = $("#cmp" + side.toUpperCase() + "Results");
      var t;
      inp.addEventListener("input", function () {
        clearTimeout(t);
        var q = inp.value.trim();
        t = setTimeout(function () {
          if (q.length < 2) { box.innerHTML = ""; return; }
          var res = search(q).slice(0, 10).map(function (x) {
            var art = x.a;
            var cc = codeById(art.c) || { short: art.c, color: "#888" };
            return '<div class="cmp-res" data-cmp-pick="' + side + '" data-art="' + esc(art.id) + '">' +
              '<span class="badge" style="border-color:' + (cc.color || "#888") + '44;color:' + (cc.color || "#888") + '">' + esc(cc.short) + '</span>' +
              '<span class="cmp-res-num">ст. ' + esc(art.dn) + '</span>' +
              '<span class="cmp-res-title">' + esc(art.t) + '</span></div>';
          }).join("");
          box.innerHTML = res || '<div class="small muted" style="padding:6px 2px">Ничего не найдено.</div>';
        }, 140);
      });
      inp.addEventListener("blur", function () { setTimeout(function () { box.innerHTML = ""; }, 150); });
    };
    setup("a");
    setup("b");

    var tx = $("#cmpTxt");
    if (tx) tx.addEventListener("click", function () { downloadCompareTxt(aId, bId); });
    var dx = $("#cmpDocx");
    if (dx) dx.addEventListener("click", function () { downloadCompareDocx(aId, bId); });
  }

  /* Сборка строк для выбранного варианта: "current" | vid версии | "online" */
  function resolveSide(id, which, cb) {
    if (which === "online") {
      var d = FRESH && FRESH.docs[id];
      if (!d || !d.hash) { cb(new Error("Источник не входит в набор для онлайн-сверки — сравните с сохранённой версией.")); return; }
      if (d.group !== "codes" && d.group !== "laws") { cb(new Error("Онлайн-сверка доступна для кодексов и федеральных законов.")); return; }
      if (!PARSE || !PARSE.parseDoc) { cb(new Error("модуль разбора не загружен")); return; }
      var url = FRESH.raw_base + (d.group === "codes" ? "data/codes/" : "data/laws/") +
        encodeURIComponent(d.slug) + ".json";
      httpJSON(url).then(function (raw) {
        var res = PARSE.parseDoc(raw, { mode: "articles" });
        PARSE.dedupeNumbers(res.arts);
        cb(null, { rows: res.arts.map(function (a) { return [a.n, a.t, a.g, a.red, a.text]; }), red: raw.redaction_date || "" });
      }).catch(function (e) { cb(e); });
      return;
    }
    if (which === "current") {
      cb(null, { rows: currentRows(id), red: (overrides[id] && overrides[id].redaction) || (CO[id] || {}).redaction || "" });
      return;
    }
    var v = null, list = VERSIONS[id] || [];
    for (var i = 0; i < list.length; i++) if (list[i].vid === which) { v = list[i]; break; }
    if (!v) { cb(new Error("Сохранённая версия не найдена.")); return; }
    cb(null, { rows: v.articles, red: v.redaction || "" });
  }

  function runDiff(id, from, to) {
    diffState = { loading: true, error: "", result: null, mode: diffState.mode || "changed", from: from, to: to };
    var v = $("#view");
    if (v) { v.innerHTML = viewDiff(id); bindDiff(id); }
    resolveSide(id, from, function (e1, a) {
      if (e1) { diffState.loading = false; diffState.error = String(e1.message || e1); redrawDiff(id); return; }
      resolveSide(id, to, function (e2, b) {
        diffState.loading = false;
        if (e2) { diffState.error = String(e2.message || e2); redrawDiff(id); return; }
        diffState.result = diffArticles(a.rows, b.rows);
        diffState.aRed = a.red; diffState.bRed = b.red;
        redrawDiff(id);
      });
    });
  }

  function redrawDiff(id) {
    var v = $("#view");
    if (!v || state.route.name !== "diff") return;
    v.innerHTML = viewDiff(id);
    bindDiff(id);
  }

  /* --- онлайн-проверка: сравнение снимка с текущими манифестами --- */

  /* Сеть в этом приложении нужна только для проверки актуальности.
     Если среда не умеет fetch (или он запрещён), показываем понятное
     сообщение, а не «зависшую» кнопку. */
  function httpJSON(url) {
    if (typeof fetch !== "function") {
      return Promise.reject(new Error("среда не поддерживает сетевые запросы"));
    }
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function checkFreshness(cb) {
    if (!FRESH || !FRESH.raw_base) { cb(new Error("Снимок актуальности отсутствует")); return; }
    var base = FRESH.raw_base;
    var urls = [base + "data/codes/manifest.json", base + "data/laws/manifest.json"];
    var jobs;
    try {
      jobs = urls.map(httpJSON);
    } catch (e) {
      freshState.error = e; cb(e); return;
    }
    Promise.all(jobs).then(function (res) {
      var live = {}, known = {};
      [res[0], res[1]].forEach(function (man) {
        Object.keys(man || {}).forEach(function (h) {
          live[h] = man[h].redaction_date;
          known[h] = man[h];
        });
      });

      var newer = 0;
      Object.keys(FRESH.docs).forEach(function (id) {
        var d = FRESH.docs[id];
        if (!d.hash || live[d.hash] === undefined) { delete updates[id]; return; }
        var liveRed = fmtCompact(live[d.hash]);
        if (liveRed && d.redaction && liveRed > d.redaction) {
          updates[id] = { redaction: liveRed, hash: d.hash };
          newer++;
        } else {
          delete updates[id];
        }
      });

      // документы, появившиеся в наборе данных после сборки снимка
      var ours = {};
      Object.keys(FRESH.docs).forEach(function (id) { if (FRESH.docs[id].hash) ours[FRESH.docs[id].hash] = 1; });
      var newDocs = [];
      Object.keys(known).forEach(function (h) {
        if (!ours[h]) newDocs.push({ hash: h, slug: known[h].slug, number: known[h].number, redaction: fmtCompact(known[h].redaction_date) });
      });

      freshState.checkedAt = new Date();
      freshState.error = null;
      freshState.newDocs = newDocs;
      cb(null, { newer: newer, newDocs: newDocs });
    }, function (e) {
      freshState.error = e;
      cb(e);
    });
  }

  /* --- обновление одного документа из открытого набора --- */

  function updateDoc(id, cb) {
    var d = FRESH && FRESH.docs[id];
    if (!d) { cb(new Error("нет сведений об источнике")); return; }
    if (d.group !== "codes" && d.group !== "laws") {
      cb(new Error("Автоматическое обновление доступно для кодексов и федеральных законов. " +
        "Конституция и ФКЗ обновляются автоматически, отдельно от общей проверки."));
      return;
    }
    if (!PARSE || !PARSE.parseDoc) { cb(new Error("модуль разбора не загружен")); return; }
    var url = FRESH.raw_base + (d.group === "codes" ? "data/codes/" : "data/laws/") +
      encodeURIComponent(d.slug) + ".json";
    httpJSON(url).then(function (raw) {
      var res = PARSE.parseDoc(raw, { mode: "articles" });
      PARSE.dedupeNumbers(res.arts);
      var rows = res.arts.map(function (a) { return [a.n, a.t, a.g, a.red, a.text]; });
      var ov = {
        id: id, redaction: raw.redaction_date || "", hash: d.hash,
        articles: rows, updated_at: new Date().toISOString(), source: url
      };
      /* снимок прежней редакции — чтобы её можно было сравнить и вернуть */
      var oldRows = FULL[id] || (byCode[id] || []).map(function (a) {
        return [a.num != null ? a.num : a.n, a.t, a.g, a.red, a.text];
      });
      var c0 = CO[id] || {};
      saveVersion({
        id: id,
        redaction: (overrides[id] && overrides[id].redaction) || c0.redaction || "",
        hash: (overrides[id] && overrides[id].hash) || d.hash || "",
        articles: oldRows,
        source: (overrides[id] && overrides[id].source) || ""
      }, function () {
        applyOverride(id, rows, ov.redaction);
        overrides[id] = ov;
        IDB.put(ov, function () {
          cb(null, { count: rows.length, redaction: ov.redaction });
        });
      });
    }).catch(function (e) { cb(e); });
  }

  function updateAll(cb) {
    var ids = Object.keys(updates);
    var i = 0, ok = 0, fail = 0;
    (function next() {
      if (i >= ids.length) { cb(null, { ok: ok, fail: fail }); return; }
      var id = ids[i++];
      updateDoc(id, function (err) {
        if (err) fail++; else ok++;
        next();
      });
    })();
  }

  function resetOverrides(cb) {
    IDB.clear(function () {
      location.reload();
    });
  }

  /* --- вид «Проверка актуальности» --- */

  function docStatusRow(c) {
    var n = (byCode[c.id] || []).length;
    var upd = updates[c.id];
    var ov = overrides[c.id];
    var st, act = "";
    if (upd) {
      st = '<span class="st st-warn">доступно обновление</span>';
      act = '<button class="btn btn-sm btn-primary" data-upd="' + c.id + '">Обновить</button>';
    } else if (ov) {
      st = '<span class="st st-ok">обновлено ' + fmtDateTime(new Date(ov.updated_at)) + "</span>";
    } else {
      st = '<span class="st st-ok">актуально</span>';
    }
    var inSet = FRESH && FRESH.docs[c.id] && FRESH.docs[c.id].hash;
    if (!inSet) st += ' <span class="st st-muted">с портала</span>';
    if (!n) st += ' <span class="st st-warn">нет статей</span>';

    return "<tr><td><b>" + esc(c.short) + '</b><div class="small muted">' + esc(c.full) + "</div></td>" +
      "<td>" + esc(KIND_TITLE[c.kind] || c.kind || "") + "</td>" +
      "<td>" + esc(c.req || "—") + "</td>" +
      '<td class="term">' + (c.redaction ? fmtRed(c.redaction) : "—") + (upd ? '<div class="small muted">→ ' + fmtRed(upd.redaction) + "</div>" : "") + "</td>" +
      "<td>" + n + "</td>" +
      "<td>" + st + "</td>" +
      '<td class="row-act">' + act + "</td></tr>";
  }

  function viewFreshness() {
    var withText = CODES.filter(function (c) { return !c.note; });
    var noArts = withText.filter(function (c) { return !(byCode[c.id] || []).length; });
    var repealed = arts.filter(function (a) { return a.t === "Утратила силу"; }).length;
    var nUpd = Object.keys(updates).length;
    var nOv = Object.keys(overrides).length;

    var statusHtml;
    if (freshState.running) {
      statusHtml = '<div class="info-box"><span class="loading">Проверяем редакции на официальном источнике…</span></div>';
    } else if (freshState.error) {
      statusHtml = '<div class="warn-box"><b>Не удалось проверить онлайн.</b> ' + esc(String(freshState.error.message || freshState.error)) +
        "<br>Проверка требует доступа к сети. Локальная база продолжает работать — ниже показаны редакции, на которые она собрана." +
        (freshState.checkedAt ? '<div class="small muted" style="margin-top:6px">Последняя удачная проверка: ' + fmtDateTime(freshState.checkedAt) + "</div>" : "") +
        "</div>";
    } else if (freshState.checkedAt) {
      statusHtml = nUpd
        ? '<div class="warn-box"><b>Найдено обновлений: ' + nUpd + "</b> — эти источники пересобраны на официальном портале после того, как база была собрана. " +
          "Нажмите «Обновить все», чтобы загрузить действующие редакции.</div>"
        : '<div class="info-box"><b>Все редакции актуальны.</b> Проверено ' + fmtDateTime(freshState.checkedAt) +
          " по манифестам официального набора данных.</div>";
      if (freshState.newDocs.length) {
        statusHtml += '<div class="info-box" style="margin-top:10px">В наборе данных появились документы, которых нет в базе: <b>' +
          freshState.newDocs.length + "</b>. " +
          freshState.newDocs.slice(0, 8).map(function (d) { return '<span class="badge">' + esc(d.number || d.slug) + "</span>"; }).join(" ") +
          "</div>";
      }
    } else {
      statusHtml = '<div class="info-box">Проверка ещё не выполнялась. Нажмите «Проверить обновления» — приложение сверит даты редакций в базе с манифестами официального набора данных. ' +
        "Для этого нужен доступ к сети; всё остальное работает офлайн.</div>";
    }

    return '<h1>Проверка актуальности</h1>' +
      '<p class="lead">База собрана из официального набора данных на основе портала actual.pravo.gov.ru. ' +
      "Здесь можно сверить даты редакций с текущими, увидеть, какие источники изменились, и обновить их прямо в приложении.</p>" +

      /* ежедневный контроль «день в день» */
      '<div class="card" style="margin-bottom:16px">' +
        '<h3 style="margin-top:0">Ежедневный контроль</h3>' +
        '<p class="small muted" style="margin-top:-4px">Проверка запускается автоматически при первом открытии приложения в течение дня ' +
        "и сверяет даты редакций с официальным набором данных. Нужен доступ к сети; всё остальное работает офлайн.</p>" +
        '<div class="actions-row" style="margin:0">' +
          freshnessChip() +
          (dailyFresh.at ? '<span class="small muted">последняя проверка: ' + fmtDateTime(new Date(dailyFresh.at)) + "</span>" : "") +
        "</div>" +
        (dailyFresh.error ? '<div class="warn-box" style="margin-top:10px">Проверка за сегодня не удалась: ' +
          esc(dailyFresh.error) + ". Попробуем при следующем открытии.</div>" : "") +
        (dailyFresh.newDocs ? '<div class="warn-box" style="margin-top:10px">В наборе данных появились документы, которых нет в базе: <b>' +
          dailyFresh.newDocs + "</b>.</div>" : "") +
      "</div>" +

      '<div class="grid grid-4" style="margin-bottom:16px">' +
        stat(withText.length, "источников в базе") +
        stat(arts.length, "статей и подстатей") +
        stat(nUpd, "доступно обновлений") +
        stat(nOv, "обновлено локально") +
      "</div>" +

      '<div class="card">' +
        '<div class="actions-row" style="margin:0">' +
          '<button class="btn btn-primary" id="frCheck">Проверить обновления</button>' +
          (nUpd ? '<button class="btn" id="frUpdateAll">Обновить все (' + nUpd + ")</button>" : "") +
          (nOv ? '<button class="btn" id="frReset">Сбросить локальные обновления</button>' : "") +
        "</div>" +
        '<div class="small muted" style="margin-top:10px">Снимок базы собран: ' +
          (FRESH && FRESH.built_at ? fmtDateTime(new Date(FRESH.built_at)) : "н/д") +
          " · локальные обновления хранятся только в этом браузере" +
          (IDB.available() ? "" : " (хранилище недоступно — обновления действуют до перезагрузки страницы)") +
        "</div>" +
        '<div class="small muted" style="margin-top:6px">Версия базы в этой вкладке: ' +
          esc(buildStampText()) +
          " · при выходе новой сборки приложение предложит обновиться</div>" +
        '<div style="margin-top:12px">' + statusHtml + "</div>" +
      "</div>" +

      '<h2>Локальная проверка целостности</h2>' +
      '<div class="grid grid-4" style="margin-bottom:16px">' +
        stat(noArts.length, "источников без статей") +
        stat(repealed, "статей утратили силу") +
        stat(docGroups().length, "видов актов") +
        stat(FRESH && FRESH.docs ? Object.keys(FRESH.docs).length : 0, "в снимке редакций") +
      "</div>" +
      (noArts.length
        ? '<div class="warn-box">В этих источниках не разобрано ни одной статьи: ' +
          noArts.map(function (c) { return esc(c.short); }).join(", ") + "</div>"
        : '<div class="info-box">Все источники содержат разобранные статьи. Расхождений в структуре не обнаружено.</div>') +

      '<h2>Источники и их редакции</h2>' +
      '<div class="card" style="padding:0;overflow:hidden"><table class="tbl tbl-fresh"><thead><tr>' +
        "<th>Источник</th><th>Вид акта</th><th>Реквизиты</th><th>Редакция</th><th>Статей</th><th>Статус</th><th></th>" +
      "</tr></thead><tbody>" +
      CODES.filter(function (c) { return !c.note; }).map(docStatusRow).join("") +
      "</tbody></table></div>" +
      '<div class="small muted" style="margin:8px 2px 0">Значок «с портала» — источник загружен напрямую с actual.pravo.gov.ru ' +
      "(Конституция, ФКЗ и часть федеральных законов). Эти документы сверяются отдельно, минуя общий манифест.</div>" +

      '<div class="disclaimer"><b>Как это работает.</b> Проверка сравнивает дату редакции каждого источника в базе с датой, ' +
      "указанной в манифесте официального набора данных (даты формируются по порталу actual.pravo.gov.ru). " +
      "Если редакция изменилась, приложение загружает действующий текст, заново разбирает его на статьи тем же алгоритмом, что и при сборке, " +
      "и сохраняет результат в браузере. Обновлённые редакции имеют приоритет над базовыми. " +
      "Конституция и федеральные конституционные законы загружаются напрямую с официального портала.</div>";
  }

  function bindFreshness() {
    var chk = $("#frCheck");
    if (chk) chk.addEventListener("click", function () {
      runDailyCheck(true);
    });

    var all = $("#frUpdateAll");
    if (all) all.addEventListener("click", function () {
      all.disabled = true;
      all.textContent = "Обновляем…";
      updateAll(function (err, r) {
        toast(err ? "Не удалось обновить" : "Обновлено источников: " + r.ok + (r.fail ? ", ошибок: " + r.fail : ""));
        buildNav();
        render();
      });
    });

    var rst = $("#frReset");
    if (rst) rst.addEventListener("click", function () {
      if (!confirm("Сбросить локальные обновления и вернуться к базовым редакциям?")) return;
      resetOverrides();
    });

    $$("[data-upd]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-upd");
        b.disabled = true;
        b.textContent = "…";
        updateDoc(id, function (err, r) {
          if (err) { toast("Ошибка: " + err.message); b.disabled = false; b.textContent = "Обновить"; return; }
          toast("Обновлено: " + (CO[id] ? CO[id].short : id) + " — редакция " + fmtRed(r.redaction) + ", статей " + r.count);
          buildNav();
          render();
        });
      });
    });
  }

  /* --------------------------------------------------------- лента «Новое»

     Что изменилось в нормативных актах с момента прошлой проверки. Записи
     пишет tools/build-changelog.js: он сравнивает свежесобранные данные с
     предыдущим снимком, поэтому лента не требует сети — она уже лежит в
     собранной базе (data/changelog.js). */

  var MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря"];

  /* Тот же список в именительном падеже — для подписей «август 2026» в
     заголовках групп и в выпадающих списках, где родительный звучал бы
     как обрывок фразы. */
  var MONTHS_NOM = ["январь", "февраль", "март", "апрель", "май", "июнь",
    "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

  /* «2026-10-12» -> «12 октября 2026». Месяцы прописаны вручную, а не взяты
     форматированием даты по языку системы: лента должна читаться одинаково
     и на русской, и на любой другой машине. */
  function fmtDateLong(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    if (!m) return "дата неизвестна";
    var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return d.getUTCDate() + " " + MONTHS_GEN[d.getUTCMonth()] + " " + d.getUTCFullYear();
  }

  /* Фильтры ленты по виду изменения. */
  var NEW_FILTERS = [
    { id: "all", lbl: "Все", test: null },
    { id: "art", lbl: "Статьи", test: function (e) { return !e.fresh && !e.red && !e.rep && !e.res; } },
    { id: "red", lbl: "Новые редакции", test: function (e) { return !!e.red; } },
    { id: "st", lbl: "Статусы норм", test: function (e) { return !!(e.rep || e.res); } },
    { id: "doc", lbl: "Документы", test: function (e) { return !!e.fresh; } }
  ];

  function newUnread() {
    return Math.max(0, CHANGELOG.entries.length - (state.newSeen || 0));
  }

  /* Значок в сайдбаре + точка «есть непрочитанное». Вызывается после сборки
     меню и после отрисовки страницы. */
  function syncNewBadge() {
    var n = newUnread();
    var el = $("#newCount");
    if (el) el.textContent = n ? String(n) : "";
    $$('[data-nav="new"]').forEach(function (mi) { mi.classList.toggle("has-upd", n > 0); });
  }

  function markNewSeen() {
    state.newSeen = CHANGELOG.entries.length;
    LS.set("newSeen", state.newSeen);
    syncNewBadge();
  }

  var NEW_LIST_MAX = 14;

  /* Вид изменения — значок и подпись. */
  function changeKind(e) {
    if (e.fresh === 1) return { ico: "plus", cls: "cn-doc-new", lbl: "Добавлен в базу" };
    if (e.fresh === -1) return { ico: "minus", cls: "cn-doc-del", lbl: "Убран из базы" };
    if (e.red) return { ico: "book", cls: "cn-red", lbl: "Новая редакция" };
    if (e.rep || e.res) return { ico: "ban", cls: "cn-st", lbl: "Статусы норм" };
    return { ico: "file", cls: "cn-art", lbl: "Статьи" };
  }

  /* Номера статей в виде ссылок: «88, 101», «3, 12 и ещё 40». */
  function newArtLinks(src, nums, prefix) {
    if (!nums || !nums.length) return "";
    var html = nums.slice(0, NEW_LIST_MAX).map(function (n) {
      return '<a class="nlnk" href="#/article/' + encodeURIComponent(src + "-" + n) + '">' +
        (prefix ? esc(prefix) + "&nbsp;" : "") + esc(n) + "</a>";
    }).join("<span class=\"nsep\">,</span> ");
    if (nums.length > NEW_LIST_MAX) {
      html += '<span class="nmore"> и ещё ' + (nums.length - NEW_LIST_MAX) + "</span>";
    }
    return html;
  }

  /* Строка вида «Статьи 88, 101». */
  function newBits(src, nums, singular, few, many, prefix) {
    if (!nums || !nums.length) return "";
    return '<div class="nrow"><span class="nrow-l">' +
      nums.length + " " + plural(nums.length, [singular, few, many]) + "</span>" +
      '<span class="nrow-v">' + newArtLinks(src, nums, prefix) + "</span></div>";
  }

  function newEntryHtml(e) {
    var k = changeKind(e);
    var rows = [];

    if (e.fresh === 1) {
      rows.push('<div class="nrow"><span class="nrow-l">Появился в базе</span><span class="nrow-v">' +
        (e.arts ? e.arts + " " + plural(e.arts, ["статья", "статьи", "статей"]) : "без полного текста") + "</span></div>");
    }
    if (e.red) {
      rows.push('<div class="nrow"><span class="nrow-l">Редакция от</span><span class="nrow-v">' +
        '<b>' + esc(fmtRed(e.red)) + "</b>" +
        (e.redFrom ? ' <span class="muted">(была от ' + esc(fmtRed(e.redFrom)) + ")</span>" : "") +
        "</span></div>");
    }
    rows.push(newBits(e.s, e.add, "новая статья", "новые статьи", "новых статей"));
    rows.push(newBits(e.s, e.chg, "изменённая статья", "изменённые статьи", "изменённых статей"));
    rows.push(newBits(e.s, e.del, "исключённая статья", "исключённые статьи", "исключённых статей"));

    /* статусы норм: ссылка ведёт на статью, подпись — по её id */
    if (e.rep && e.rep.length) {
      rows.push('<div class="nrow"><span class="nrow-l">' + e.rep.length + " " +
        plural(e.rep.length, ["норма утратила силу", "нормы утратили силу", "норм утратили силу"]) +
        '</span><span class="nrow-v">' + e.rep.slice(0, NEW_LIST_MAX).map(function (id) {
          return '<a class="nlnk" href="#/article/' + encodeURIComponent(id) + '">' + esc(id.slice(id.lastIndexOf("-") + 1)) + "</a>";
        }).join("<span class=\"nsep\">,</span> ") +
        (e.rep.length > NEW_LIST_MAX ? '<span class="nmore"> и ещё ' + (e.rep.length - NEW_LIST_MAX) + "</span>" : "") +
        "</span></div>");
    }
    if (e.res && e.res.length) {
      rows.push('<div class="nrow"><span class="nrow-l">' + e.res.length + " " +
        plural(e.res.length, ["норма снова действует", "нормы снова действуют", "норм снова действуют"]) +
        '</span><span class="nrow-v">' + e.res.slice(0, NEW_LIST_MAX).map(function (id) {
          return '<a class="nlnk" href="#/article/' + encodeURIComponent(id) + '">' + esc(id.slice(id.lastIndexOf("-") + 1)) + "</a>";
        }).join("<span class=\"nsep\">,</span> ") +
        (e.res.length > NEW_LIST_MAX ? '<span class="nmore"> и ещё ' + (e.res.length - NEW_LIST_MAX) + "</span>" : "") +
        "</span></div>");
    }

    return '<div class="ncard ' + esc(k.cls) + '" data-ns="' + esc(e.s) + '">' +
      '<div class="ncard-h">' +
        '<span class="ncard-ico">' + ic(k.ico) + "</span>" +
        '<a class="ncard-t" href="#/code/' + esc(e.s) + '">' + esc(e.a) + "</a>" +
        '<span class="ncard-kind">' + esc(KIND_TITLE[e.k] || e.k || "") + "</span>" +
        '<span class="ncard-lbl">' + esc(k.lbl) + "</span>" +
      "</div>" +
      '<div class="ncard-b">' + rows.join("") + "</div>" +
      "</div>";
  }

  function viewNew(arg) {
    var filter = NEW_FILTERS.filter(function (f) { return f.id === arg; })[0] || NEW_FILTERS[0];
    var all = CHANGELOG.entries;
    var list = filter.test ? all.filter(filter.test) : all;

    /* сводка считается по всей ленте, а не по отфильтрованной: цифры «сколько
       всего» не должны меняться от нажатого фильтра */
    var nRed = all.filter(function (e) { return e.red; }).length;
    var nArt = all.reduce(function (n, e) {
      return n + (e.add ? e.add.length : 0) + (e.chg ? e.chg.length : 0) + (e.del ? e.del.length : 0);
    }, 0);
    var nRep = all.reduce(function (n, e) { return n + (e.rep ? e.rep.length : 0) + (e.res ? e.res.length : 0); }, 0);
    var docs = {};
    all.forEach(function (e) { docs[e.s] = 1; });

    var unread = newUnread();

    var chips = NEW_FILTERS.map(function (f) {
      var n = f.test ? all.filter(f.test).length : all.length;
      if (f.id !== "all" && !n) return "";
      return '<button type="button" class="chip' + (f.id === filter.id ? " on" : "") + '" data-nf="' + esc(f.id) + '">' +
        esc(f.lbl) + '<span class="cnt">' + n + "</span></button>";
    }).join("");

    var body;
    if (!list.length) {
      body = all.length
        ? '<div class="info-box">Под этот фильтр изменений нет. Выберите «Все».</div>'
        : '<div class="info-box"><b>Лента пока пуста.</b> Она заполняется автоматически: раз в сутки приложение ' +
          "скачивает официальные тексты с actual.pravo.gov.ru и sudact.ru, пересобирает базу и сравнивает её с предыдущим снимком. " +
          "Всё, что изменилось — новые редакции, добавленные и изменённые статьи, нормы, утратившие силу, — попадает сюда.</div>";
    } else {
      /* группировка по дате: даты в ленте отсортированы по убыванию */
      var html = "", lastD = "";
      list.forEach(function (e) {
        if (e.d !== lastD) {
          if (lastD) html += "</div>";
          html += '<div class="ndate"><span>' + esc(fmtDateLong(e.d)) + "</span></div><div class=\"ngroup\">";
          lastD = e.d;
        }
        html += newEntryHtml(e);
      });
      body = html + "</div>";
    }

    return '<h1>Новое</h1>' +
      '<p class="lead">Что изменилось в кодексах и законах с момента прошлой проверки. ' +
      "Записи появляются автоматически после ночной сборки; сеть для просмотра не нужна.</p>" +

      (unread ? '<div class="info-box" id="newUnreadBox"><b>Непрочитанных изменений: ' + unread + "</b></div>" : "") +

      '<div class="grid grid-4" style="margin-bottom:14px">' +
        stat(all.length, "записей в ленте", "activity") +
        stat(nRed, "новых редакций", "book") +
        stat(nArt, "статей затронуто", "file") +
        stat(nRep, "норм сменили статус", "ban") +
      "</div>" +

      '<div class="actions-row" style="margin:0 0 12px">' +
        '<button class="btn' + (unread ? " btn-primary" : "") + '" id="newSeenBtn"' + (unread ? "" : " disabled") + '>Отметить прочитанным</button>' +
        '<span class="small muted">Проверок за всё время: ' + all.length +
          " · документов затронуто: " + Object.keys(docs).length +
          (CHANGELOG.built_at ? " · база собрана " + esc(fmtDateTime(new Date(CHANGELOG.built_at))) : "") +
        "</span>" +
      "</div>" +

      (chips ? '<div class="chips" style="margin-bottom:14px">' + chips + "</div>" : "") +

      body +

      '<div class="disclaimer"><b>Откуда берутся данные.</b> Источники — официальный портал actual.pravo.gov.ru ' +
      "(«Тексты правовых актов с внесёнными изменениями»), открытый набор ruslaw-public и sudact.ru " +
      "для постановлений Пленума ВС РФ. Тексты правовых актов не являются объектами авторских прав (п. 6 ст. 1259 ГК РФ). " +
      "Лента фиксирует факт изменения в собранной базе; правовые последствия сверяйте с официальной публикацией.</div>";
  }

  function bindNew() {
    var b = $("#newSeenBtn");
    if (b) b.addEventListener("click", function () {
      markNewSeen();
      render();
      toast("Отмечено прочитанным");
    });

    /* фильтры по виду изменения: переход по хешу, чтобы ссылку можно было
       сохранить и вернуться к ней позже */
    $$("[data-nf]").forEach(function (b2) {
      b2.addEventListener("click", function () {
        var id = b2.getAttribute("data-nf");
        go(id === "all" ? "#/new" : "#/new/" + id);
      });
    });

    syncNewBadge();
  }

  /* ------------------------------------------------------------------ командная строка */

  var pal = { open: false, sel: 0, items: [] };

  function buildPalette(q) {
    var items = [];
    var navs = [
      { t: "Навигатор", h: "#/home", k: "главная начало" },
      { t: "Помощник", h: "#/assistant", k: "помощник разбор ситуации анализ консультант вопрос" },
      { t: "Памятки оперативнику", h: "#/scenarios", k: "памятка сценарий оперативник орм что делать порядок действий досмотр доставление кусп" },
      { t: "Калькуляторы", h: "#/calc", k: "калькулятор рассчитать посчитать арифметика сложить умножить разделить обычный счёт 5+5 срок давность пошлина неустойка проценты 395 госпошлина 333.19 зачёт стража задержание" },
      { t: "Процессуальные сроки", h: "#/deadlines", k: "сроки калькулятор" },
      { t: "Проверка актуальности", h: "#/freshness", k: "актуальность обновление редакция сверить" },
      { t: "Новое", h: "#/new", k: "новое изменения лента что поменялось новые статьи редакция утратила сила обновление базы" },
      { t: "Утратившие силу", h: "#/repealed", k: "утратила силу отменено недействующая приостановлено реестр исключена" },
      { t: "Сравнение редакций", h: "#/diff", k: "сравнить редакции версии изменения дифф что изменилось" },
      { t: "Чек-листы", h: "#/checklists", k: "чеклист следственные действия" },
      { t: "Шаблоны документов", h: "#/templates", k: "шаблон документ бланк постановление протокол иск жалоба ходатайство коап гражданский трудовой прокуратура орм" },
      { t: "Избранное", h: "#/favorites", k: "избранное сохраненное" },
      { t: "Подборка норм", h: "#/collection", k: "подборка выборка норм экспорт выгрузка цитата" },
      { t: "Дела", h: "#/cases", k: "дела папка заметки по делу журнал" },
      { t: "Лента изменений", h: "#/timeline", k: "лента хронология годы изменения поправки когда изменилось" },
      { t: "Аналитика и статистика", h: "#/stats", k: "статистика аналитика цифры сколько статей графики диаграммы" },
      { t: "Связи источников", h: "#/graph", k: "граф связи ссылки взаимосвязи между кодексами" },
      { t: "Справка", h: "#/help", k: "помощь как пользоваться" }
    ];
    var nq = norm(q);
    navs.forEach(function (n) {
      if (!nq || norm(n.t + " " + n.k).indexOf(nq) !== -1) items.push({ type: "nav", title: n.t, sub: "раздел", go: n.h });
    });
    (REF.scenarios || []).forEach(function (s) {
      if (!nq || norm(s.t + " " + (s.when || "") + " " + (s.group || "")).indexOf(nq) !== -1) {
        items.push({ type: "scen", title: s.t, sub: "памятка", go: "#/scenario/" + s.id });
      }
    });
    CODES.forEach(function (c) {
      if (nq && (norm(c.short + " " + c.full).indexOf(nq) !== -1)) items.push({ type: "code", title: c.short, sub: c.full, go: "#/code/" + c.id });
    });
    if (nq.length >= 1) {
      search(q).slice(0, 12).forEach(function (x) {
        var cc = codeById(x.a.c) || { short: x.a.c };
        items.push({ type: "art", num: x.a.dn, title: x.a.t, sub: cc.short, go: "#/article/" + encodeURIComponent(x.a.id) });
      });
    }
    return items.slice(0, 22);
  }

  function openPalette() {
    pal.open = true; pal.sel = 0;
    $("#palette").classList.add("open");
    var inp = $("#palInput"); inp.value = ""; inp.focus();
    drawPalette("");
  }
  function closePalette() { pal.open = false; $("#palette").classList.remove("open"); }

  function drawPalette(q) {
    pal.items = buildPalette(q);
    if (pal.sel >= pal.items.length) pal.sel = Math.max(0, pal.items.length - 1);
    var list = $("#palList");
    if (!pal.items.length) { list.innerHTML = '<div class="palette-item muted">Ничего не найдено</div>'; return; }
    list.innerHTML = pal.items.map(function (it, i) {
      return '<div class="palette-item' + (i === pal.sel ? " sel" : "") + '" data-i="' + i + '">' +
        (it.type === "art" ? '<span class="pi-num">ст. ' + esc(it.num) + "</span>" :
          '<span class="pi-num" style="color:var(--muted)">' + (it.type === "nav" ? "→" : it.type === "scen" ? "◈" : "§") + "</span>") +
        '<span class="pi-t">' + esc(it.title) + '</span><span class="pi-c">' + esc(it.sub) + "</span></div>";
    }).join("");
  }

  function paletteChoose(i) {
    var it = pal.items[i];
    if (!it) return;
    closePalette();
    go(it.go);
  }

  /* ------------------------------------------------------------------ события */

  function bindGlobal() {
    document.addEventListener("click", function (e) {
      /* e.target может быть самим document (клик по пустому месту) */
      if (!e.target || typeof e.target.closest !== "function") return;

      /* фильтры выдачи: источник, «только действующие», порядок сортировки.
         Перерисовываем только область результатов — адрес и прокрутка не
         меняются, иначе смена фильтра выбрасывала бы к началу страницы. */
      var sf = e.target.closest("[data-sfilter]");
      if (sf) {
        e.preventDefault();
        var fv = sf.getAttribute("data-sfilter");
        if (fv === "reset") searchOpts = { skipRepealed: false, src: "", sort: "rel" };
        else if (fv === "repealed") searchOpts.skipRepealed = !searchOpts.skipRepealed;
        else if (fv === "sort:src") searchOpts.sort = searchOpts.sort === "src" ? "rel" : "src";
        else if (fv.indexOf("src:") === 0) {
          var fid = fv.slice(4);
          searchOpts.src = searchOpts.src === fid ? "" : fid;
        }
        refreshSearch();
        return;
      }

      /* развернуть/свернуть все группы источников на главной: 227 карточек
         подряд — это несколько экранов прокрутки, поэтому по умолчанию
         группы свёрнуты и раскрываются по одной */
      var ka = e.target.closest("[data-kinds-all]");
      if (ka) {
        e.preventDefault();
        var open = ka.getAttribute("data-kinds-all") === "open";
        $$(".kind-block").forEach(function (d) { d.open = open; });
        toast(open ? "Источники развёрнуты" : "Список источников свёрнут");
        return;
      }

      /* подборка — раньше [data-go], потому что кнопка стоит внутри карточки результата */
      var ca = e.target.closest("[data-col-add]");      if (ca) {
        e.preventDefault();
        e.stopPropagation();
        var cid = ca.getAttribute("data-col-add");
        toggleCol(cid);
        paintColBtns(cid);
        return;
      }

      var cb = e.target.closest("[data-col-batch]");
      if (cb) {
        e.preventDefault();
        var added = 0;
        cb.getAttribute("data-col-batch").split(",").filter(Boolean).forEach(function (aid) {
          if (byId[aid] && !inCol(aid)) { state.col.push({ id: aid, note: "" }); added++; }
        });
        LS.set("col", state.col);
        syncColCount();
        toast(added ? "Добавлено статей: " + added + " (всего " + state.col.length + ")" : "Эти статьи уже в подборке");
        return;
      }

      var scx = e.target.closest("[data-scen-docx]");
      if (scx) {
        var sc = scenarioById(scx.getAttribute("data-scen-docx"));
        if (sc) {
          var inner = "<h1>" + esc(sc.t) + "</h1>" +
            (sc.when ? '<p class="m">' + esc(sc.when) + "</p>" : "") +
            "<h2>Порядок действий</h2><ol>" + (sc.steps || []).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ol>" +
            ((sc.terms && sc.terms.length) ? "<h2>Контрольные сроки и ориентиры</h2><ul>" +
              sc.terms.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") +
            "<h2>Статьи по ситуации</h2>" + (sc.articles || []).map(function (aid) {
              var a = byId[aid]; return a ? "<p>" + esc(citeLegal(a)) + "</p>" : "";
            }).join("");
          saveDocx("pamyatka-" + sc.id + ".docx", sc.t, inner);
          toast("Файл .docx сохранён");
        }
        return;
      }
      var scc = e.target.closest("[data-scen-copy]");
      if (scc) {
        var sc2 = scenarioById(scc.getAttribute("data-scen-copy"));
        if (sc2) copyText(scenarioText(sc2), "Текст памятки скопирован");
        return;
      }

      var scp = e.target.closest("[data-scen-print]");
      if (scp) {
        var sc3 = scenarioById(scp.getAttribute("data-scen-print"));
        if (sc3) {
          var inner3 = (sc3.when ? '<p class="m">' + esc(sc3.when) + "</p>" : "") +
            "<h2>Порядок действий</h2><ol>" + (sc3.steps || []).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ol>" +
            ((sc3.terms && sc3.terms.length) ? "<h2>Контрольные сроки и ориентиры</h2><ul>" +
              sc3.terms.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") +
            "<h2>Статьи по ситуации</h2>" + (sc3.articles || []).map(function (aid) {
              var a3 = byId[aid]; return a3 ? "<p>" + esc(citeLegal(a3)) + "</p>" : "";
            }).join("");
          printDoc(sc3.t, inner3);
        }
        return;
      }

      var goEl = e.target.closest("[data-go]");
      if (goEl) {
        /* внутри результата есть кнопки — не переходим при клике по ним */
        if (e.target.closest("button, a, textarea, input")) return;
        e.preventDefault(); go(goEl.getAttribute("data-go")); return;
      }

      var hrEl = e.target.closest("[data-href]");
      if (hrEl) { e.preventDefault(); go(hrEl.getAttribute("data-href")); return; }

      var favEl = e.target.closest("[data-fav]");
      if (favEl) { var id = favEl.getAttribute("data-fav"); toggleFav(id); render(); return; }

      var noteSave = e.target.closest("[data-note-save]");
      if (noteSave) {
        var nid = noteSave.getAttribute("data-note-save");
        var area = $("#noteArea");
        if (area) setNote(nid, area.value);
        var st = $("#noteStatus"); if (st) st.textContent = "Сохранено " + new Date().toLocaleTimeString();
        toast("Заметка сохранена"); render(); return;
      }
      var noteDel = e.target.closest("[data-note-del]");
      if (noteDel) { setNote(noteDel.getAttribute("data-note-del"), ""); toast("Заметка удалена"); render(); return; }

      var cmpPick = e.target.closest("[data-cmp-pick]");
      if (cmpPick) {
        var side = cmpPick.getAttribute("data-cmp-pick");
        var art = cmpPick.getAttribute("data-art");
        var rr = parseHash();
        var na = rr.a || "", nb = rr.b || "";
        if (side === "a") na = art; else nb = art;
        go("#/compare/" + encodeURIComponent(na) + "/" + encodeURIComponent(nb));
        return;
      }
      var cmpClear = e.target.closest("[data-cmp-clear]");
      if (cmpClear) {
        var cs = cmpClear.getAttribute("data-cmp-clear");
        var rr2 = parseHash();
        var na2 = rr2.a || "", nb2 = rr2.b || "";
        if (cs === "a") na2 = ""; else nb2 = "";
        go("#/compare/" + encodeURIComponent(na2) + "/" + encodeURIComponent(nb2));
        return;
      }
      var cmpRun = e.target.closest("[data-cmp-run]");
      if (cmpRun) {
        var rr3 = parseHash();
        runCompare(rr3.a, rr3.b);
        return;
      }

      var cp = e.target.closest("[data-copy-cite]");
      if (cp) { copyText(cp.getAttribute("data-copy-cite"), "Ссылка скопирована"); return; }

      var cf = e.target.closest("[data-copy-full]");
      if (cf) {
        var af = byId[cf.getAttribute("data-copy-full")];
        if (af) copyText(citeLegal(af) + "\n" + officialUrl(af), "Ссылка с реквизитами скопирована");
        return;
      }

      var cg = e.target.closest("[data-copy-gost]");
      if (cg) {
        var ag = byId[cg.getAttribute("data-copy-gost")];
        if (ag) copyText(citeGost(ag), "Ссылка по ГОСТ скопирована");
        return;
      }

      var dx = e.target.closest("[data-docx-art]");
      if (dx) {
        var ad = byId[dx.getAttribute("data-docx-art")];
        if (!ad) return;
        var cd = codeById(ad.c) || { full: ad.c };
        var rowD = hasFull(ad.c) ? findFull(ad.c, ad.n) : null;
        var bodyD = rowD ? rowD[4] : (ad.s || "");
        var inner = "<h1>" + esc(cd.full) + "</h1>" +
          '<h2 style="margin-top:2pt">Статья ' + esc(ad.dn) + ". " + esc(ad.t) + "</h2>" +
          '<p class="m">' + esc(citeLegal(ad)) + "</p>" +
          '<p class="m">Источник: ' + esc(officialUrl(ad)) +
          (rowD && rowD[3] ? " · редакция статьи от " + fmtRed(rowD[3]) : "") + "</p><hr>" +
          (bodyD || "").split("\n").filter(function (l) { return l.trim(); })
            .map(function (l) { return "<p>" + esc(l.trim()) + "</p>"; }).join("");
        saveDocx(ad.c + "-" + ad.n + ".docx", cite(ad), inner);
        toast("Файл .docx сохранён");
        return;
      }

      var ct = e.target.closest("[data-copy-art]");
      if (ct) {
        var a = byId[ct.getAttribute("data-copy-art")];
        if (a) {
          var row = hasFull(a.c) ? findFull(a.c, a.n) : null;
          var body = row ? row[4] : (a.s + (a.p ? "\n\n" + a.p : ""));
          copyText(cite(a) + ". " + a.t + "\n\n" + body, "Текст статьи скопирован");
        }
        return;
      }
      var cr = e.target.closest("[data-copy-raw]");
      if (cr) { copyText(decodeURIComponent(cr.getAttribute("data-copy-raw")), "Скопировано"); return; }

      var dl = e.target.closest("[data-dl]");
      if (dl) {
        var parts = dl.getAttribute("data-dl").split("|");
        download(decodeURIComponent(parts[0]) + ".txt", decodeURIComponent(parts[1]), "text/plain");
        toast("Файл сохранён"); return;
      }
      var fc = e.target.closest("#favClear");
      if (fc) {
        state.fav = []; LS.set("fav", state.fav); render(); toast("Избранное очищено"); return;
      }
    });

    var si = $("#searchInput");
    si.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        var q = si.value.trim();
        if (q) { pushHist(q); go("#/search/" + encodeURIComponent(q)); }
      }
    });

    $("#themeBtn").addEventListener("click", function () {
      state.theme = state.theme === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", state.theme);
      LS.set("theme", state.theme);
      $("#themeBtn").innerHTML = ic(state.theme === "dark" ? "sun" : "moon");
    });

    /* --- кнопка-бургер: на широком экране сворачивает панель, на узком
           выдвигает её поверх содержимого --- */
    var burger = $("#burgerBtn");
    if (burger) burger.addEventListener("click", function () {
      if (wideLayout()) {
        navHidden = !navHidden;
        LS.set("navHidden", navHidden);
        applyNav();
        return;
      }
      var open = !sidebarIsOpen();
      setSidebar(open);
      if (open) toggleReadMenu(false);
    });
    var sideClose = $("#sideClose");
    if (sideClose) sideClose.addEventListener("click", function () { setSidebar(false); });
    var back = $("#sideBackdrop");
    if (back) back.addEventListener("click", function () { setSidebar(false); });

    /* --- кнопка «наверх» --- */
    var toTop = $("#toTop");
    if (toTop) {
      toTop.addEventListener("click", function () {
        try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch (e) { try { window.scrollTo(0, 0); } catch (e2) {} }
      });
      var syncTop = function () {
        var show = (window.pageYOffset || document.documentElement.scrollTop || 0) > 480;
        if (show) toTop.removeAttribute("hidden"); else toTop.setAttribute("hidden", "");
      };
      window.addEventListener("scroll", syncTop, { passive: true });
      syncTop();
    }

    /* --- настройки чтения --- */
    var readBtn = $("#readBtn");
    if (readBtn) {
      readBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        toggleReadMenu();
      });
      $("#readMenu").addEventListener("click", function (e) { e.stopPropagation(); });
      $$("#readMenu [data-read]").forEach(function (b) {
        b.addEventListener("click", function () {
          var k = b.getAttribute("data-read");
          if (k === "fs+") setRead("fs", 1);
          else if (k === "fs-") setRead("fs", -1);
          else if (k === "lh+") setRead("lh", 0.1);
          else if (k === "lh-") setRead("lh", -0.1);
          else if (k === "w+") setRead("w", 1);
          else if (k === "w-") setRead("w", -1);
        });
      });
      var rr = $("#readReset");
      if (rr) rr.addEventListener("click", function () {
        state.read = { fs: 15, lh: 1.65, w: 0 };
        LS.set("read", state.read);
        applyRead();
        toast("Настройки чтения сброшены");
      });
      /* закрыть меню по клику вне */
      document.addEventListener("click", function () { toggleReadMenu(false); });    }

    /* --- роль в верхней панели --- */
    var roleBtn = $("#roleBtn");
    if (roleBtn) {
      roleBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        toggleRoleMenu();
      });
      /* клик внутри меню не закрывает его: выбор роли ловит общий обработчик
         bindRoleSwitch на document, а он перерисует страницу и закроет меню */
      document.addEventListener("click", function (e) {
        var t = e.target;
        if (t && t.closest && t.closest("#roleCtl")) return;
        toggleRoleMenu(false);
      });
    }

    /* командная строка открывается только с клавиатуры: Ctrl+K и «/» */
    $("#palette").addEventListener("click", function (e) {
      if (e.target === $("#palette")) closePalette();
      var it = e.target.closest(".palette-item");
      if (it && it.getAttribute("data-i") != null) paletteChoose(parseInt(it.getAttribute("data-i"), 10));
    });
    $("#palInput").addEventListener("input", function () { pal.sel = 0; drawPalette(this.value); });

    document.addEventListener("keydown", function (e) {
      /* активация навигационных элементов с клавиатуры */
      if ((e.key === "Enter" || e.key === " ") && !pal.open) {
        var el = document.activeElement;
        if (el && el.getAttribute && el.getAttribute("data-a11y") === "1") {
          e.preventDefault();
          var t = el.getAttribute("data-go") || el.getAttribute("data-href");
          if (el.hasAttribute("data-go")) el.click();
          else if (t) go(t);
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); pal.open ? closePalette() : openPalette(); return; }
      if (e.key === "Escape") {
        if (pal.open) { closePalette(); return; }
        if (sidebarIsOpen()) { setSidebar(false); var bb = $("#burgerBtn"); if (bb) bb.focus(); return; }
        toggleReadMenu(false);
        toggleRoleMenu(false);
        return;
      }
      /* клавиатура обычного калькулятора: цифры и операторы без мыши.
         Идёт до ветки «/» (открытие командной строки), иначе деление
         перехватывалось бы палитрой. */
      if (scKey(e)) return;
      if (e.key === "/" && !pal.open && !/input|textarea|select/i.test((document.activeElement || {}).tagName || "")) {
        e.preventDefault(); openPalette(); return;
      }
      if (!pal.open) return;
      if (e.key === "ArrowDown") { e.preventDefault(); pal.sel = Math.min(pal.sel + 1, pal.items.length - 1); drawPalette($("#palInput").value); }
      else if (e.key === "ArrowUp") { e.preventDefault(); pal.sel = Math.max(pal.sel - 1, 0); drawPalette($("#palInput").value); }
      else if (e.key === "Enter") { e.preventDefault(); paletteChoose(pal.sel); }
    });

    window.addEventListener("hashchange", render);
  }

  /* ------------------------------------------------------------------ инициализация */

  function buildNav() {
    $("#totalCount").textContent = arts.length;
    var rp = $("#repCount");
    if (rp) rp.textContent = STATUS_META.total || 0;
    syncNewBadge();
    var docs = CODES.filter(function (c) { return !c.note; });
    var nCodes = docs.filter(function (c) { return (c.kind || "code") === "code"; }).length;
    var nLaws = docs.filter(function (c) { return c.kind === "law"; }).length;
    var nFkz = docs.filter(function (c) { return c.kind === "fkz"; }).length;
    var nDec = docs.filter(function (c) { return c.kind === "decree"; }).length;
    var nPlen = docs.filter(function (c) { return c.kind === "plenum"; }).length;
    $("#versionTag").textContent = "v4.0 · " + nCodes + " " + plural(nCodes, ["кодекс", "кодекса", "кодексов"]) +
      " · " + nLaws + " " + plural(nLaws, ["закон", "закона", "законов"]) + " · " + nFkz + " ФКЗ" +
      (nDec ? " · " + nDec + " " + plural(nDec, ["постановление", "постановления", "постановлений"]) : "") +
      (nPlen ? " · " + nPlen + " Пленум" + (nPlen % 10 === 1 && nPlen % 100 !== 11 ? "" : "ов") : "");

    var collapsed = navCollapsed();
    $("#codeNav").innerHTML = docGroups().map(function (g) {
      var items = g.items.filter(function (c) { return !c.note; });
      if (!items.length) return "";
      var isOpen = collapsed.indexOf(g.kind) === -1;
      return '<div class="nav-sub-wrap' + (isOpen ? "" : " collapsed") + '" data-kind="' + esc(g.kind) + '">' +
        '<div class="nav-sub" data-toggle-kind="' + esc(g.kind) + '">' + esc(g.title) +
          '<span class="cnt">' + items.length + "</span>" +
          '<span class="nav-caret">▾</span></div>' +
        '<div class="nav-sub-items">' +
          items.map(function (c) {
            var n = (byCode[c.id] || []).length;
            return '<div class="nav-item' + (updates[c.id] ? " has-upd" : "") + '" data-href="#/code/' + c.id + '">' +
              '<span class="dot" style="background:' + c.color + '"></span>' +
              '<span class="lbl">' + esc(c.short) + '</span><span class="cnt">' + n + "</span></div>";
          }).join("") +
        "</div></div>";
    }).join("");

    /* значок ежедневной проверки в подвале панели */
    var fchip = $("#freshChip");
    if (fchip) fchip.innerHTML = freshnessChip();
  }

  function init() {
    document.documentElement.setAttribute("data-theme", state.theme);
    $("#themeBtn").innerHTML = ic(state.theme === "dark" ? "sun" : "moon");
    applyRead();
    paintIcons();

    /* панель могла быть свёрнута пользователем в прошлый раз */
    applyNav();

    /* постоянный переключатель роли в сайдбаре — доступен со всех страниц */
    var rs = $("#roleSwitch");
    if (rs) rs.innerHTML = roleSwitchHtml();

    /* сворачивание групп источников в сайдбаре (делегирование — один слушатель) */
    var cn = $("#codeNav");
    if (cn) cn.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var h = t.closest("[data-toggle-kind]");
      if (!h) return;
      e.preventDefault();
      var wrap = h.closest(".nav-sub-wrap");
      if (!wrap) return;
      var kind = h.getAttribute("data-toggle-kind");
      var collapsedNow = wrap.classList.toggle("collapsed");
      var set = navCollapsed();
      var ix = set.indexOf(kind);
      if (collapsedNow && ix === -1) set.push(kind);
      else if (!collapsedNow && ix !== -1) set.splice(ix, 1);
      LS.set("collapsedKinds", set);
    });

    bindGlobal();
    if (!location.hash) location.hash = "#/home";
    render();

    /* при возврате в браузер (bfcache) меню не должно оставаться открытым */
    window.addEventListener("pageshow", function () { setSidebar(false); applyNav(); });
    /* resize через requestAnimationFrame: applyNav читает ширину окна и
       пишет классы, поэтому без троттлинга на каждом кадре перетаскивания
       окна получался бы цикл «чтение → запись» (layout thrash) */
    var resizeRaf = 0;
    window.addEventListener("resize", function () {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(function () {
        resizeRaf = 0;
        if (wideLayout() && sidebarIsOpen()) setSidebar(false);
        applyNav();
      });
    });

    /* Сохранённые обновления подхватываются асинхронно и заменяют
       базовые редакции соответствующих источников. */
    loadOverrides(function (n) {
      /* прежние редакции нужны для сравнения; грузим после обновлений,
         чтобы кнопка «Сравнить» была доступна сразу */
      loadVersions(function () {
        buildNav();
        if (!n) return;
        render();
        toast("Применено локальных обновлений: " + n);
      });
    });

    /* Ежедневный контроль актуальности: проверяем «день в день», но только
       один раз за календарный день и после того, как интерфейс отрисован. */
    loadDaily();
    buildNav();

    /* автообновление базы: тихий опрос data/version.json и уведомление,
       если на хостинге появилась новая сборка (см. checkBuild) */
    startBuildWatch();
    if (dailyCheckDue()) {
      setTimeout(function () { runDailyCheck(false); }, 1200);
    } else {
      freshState.checkedAt = dailyFresh.at ? new Date(dailyFresh.at) : freshState.checkedAt;
      render();
    }

    /* вступительный экран — показывается при каждом открытии: он коротко
       объясняет, что это за справочник. Кнопки нет, закрывается нажатием
       в любом месте (или Escape). Отметку «уже видел» не ставим — иначе
       при следующем заходе экран бы пропал. */
    setupIntro();
  }

  function setupIntro() {
    var el = $("#intro");
    if (!el) return;
    el.hidden = false;
    el.addEventListener("click", dismissIntro);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && el && !el.hidden) dismissIntro();
    });
  }

  function dismissIntro() {
    var el = $("#intro");
    if (!el || el.hidden || el.classList.contains("hide")) return;
    el.classList.add("hide");
    setTimeout(function () { el.hidden = true; }, 320);
  }

  document.addEventListener("DOMContentLoaded", init);

  /* Точка входа для проверок качества поиска и внешних сценариев: те же
     функции, что вызывают интерфейс, без обходов через DOM. */
  window.RF_SEARCH = {
    parse: parseQuery,
    search: search,
    ft: ftSearch,
    snippet: ftSnippet,
    stems: function (s) { return FT ? FT.stems(s) : []; },
    doclen: DOCLEN,
    meta: function () { return FT_META; }
  };

  /* Точка входа для проверок качества «Помощника»: разбор ситуации по тексту
     без обращения к DOM — чтобы стенд мерил движок, а не вёрстку. */
  window.RF_ASSIST = {
    help: helpScore,
    intents: assistantScore,
    result: assistantResult,
    confidence: assistantConfidence,
    primary: assistantPrimary,
    found: assistantFound,
    norm: norm
  };

  /* Точка входа для проверок автообновления: опрос отпечатка сборки,
     показ и скрытие уведомления — без ожидания реальной выкладки на хостинг. */
  window.RF_BUILD = {
    check: checkBuild,
    start: startBuildWatch,
    show: showBuildBar,
    hide: hideBuildBar,
    reload: buildReload,
    query: buildQuery,
    stamp: buildStampText,
    state: function () { return buildInfo; },
    key: BUILD_KEY,
    url: BUILD_URL
  };
})();
