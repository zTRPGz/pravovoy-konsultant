/* =========================================================================
   Правовой консультант :: общий модуль разбора правовых текстов
   -------------------------------------------------------------------------
   Один и тот же код используется:
     • в Node — сборщик данных (tools/build-data.js);
     • в браузере — автообновление документов (data/parse.js).

   Поэтому модуль оформлен как UMD: в Node он отдаётся через module.exports,
   в браузере — через window.RF_PARSE.

   Задачи модуля:
     1) нормализация «типографских» пробелов и переносов;
     2) восстановление разорванных номеров подстатей («Статья 159\n1\n.»);
     3) разбиение документа на статьи и подстатьи;
     4) извлечение глав и разделов;
     5) определение даты последней редакции статьи.
   ========================================================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RF_PARSE = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* Строка-заголовок статьи: «Статья 159.1. Мошенничество…».
     Заголовок никогда не склеивается с последующим текстом. */
  var HDR_LINE = /^Статья[ \t]+\d+(?:[.-]\d+)*[ \t]*\.[ \t]/;

  /* ВНИМАНИЕ: заголовки глав и разделов в источниках пишутся по-разному:
       «ГЛАВА 5. СУД» (УПК, УК), «Глава 5. Права…» (ЖК, АПК), «ГЛАВА I. ОБЩИЕ
     ПОЛОЖЕНИЯ» (ЗК, КТМ, ВзК — римские номера), «РАЗДЕЛ II» (ЖК).
     Регистр и система счисления здесь, в normalize и в extractMarkers должны
     учитываться ВСЕМИ вариантами, иначе заголовок не считается маркером,
     склеивается с текстом при нормализации и целая глава теряется. */
  var MARK = /^(Статья\s+\d|ГЛАВА\s+(?:\d|[IVXLC])|Глава\s+(?:\d|[IVXLC])|Раздел\s+[IVXLC]|РАЗДЕЛ\s+[IVXLC]|ЧАСТЬ\s|ОБЩАЯ ЧАСТЬ|ОСОБЕННАЯ ЧАСТЬ|Примечани|\(В редакции|\(С учетом|\(Статья|\(Часть|\(Пункт|\(Абзац|\(Введена|\(Наименование|Список изменяющих|Список утративших|Одобрен|Принят|ПРЕЗИДЕНТ|Москва, Кремль|Федеральный закон|^\d+(\.\d+)*\.\s|^[а-я]\)\s|^[-–—]\s)/;

  /* ---------------------------------------------------------------- нормализация */

  function normalize(raw) {
    // Источник активно использует неразрывные пробелы (U+00A0) и другие
    // «типографские» пробелы. Без приведения к обычному пробелу ломается
    // определение границы «Статья N. Название» — название склеивается с текстом.
    var t = String(raw || "")
      .replace(/\r\n?/g, "\n")
      .replace(/[\u00a0\u1680\u2000-\u200b\u202f\u205f\u3000\ufeff]/g, " ")
      .replace(/[^\S\n]+/g, " ");

    // 1. разорванный номер статьи/подстатьи.
    //    Источник разрывает номер в произвольном месте и переносит строку:
    //      «Статья 159\n1\n. Мошенничество…»      -> «Статья 159.1.»
    //      «Статья 6.1\n1\n. Побои»              -> «Статья 6.1.1.»
    //      «Статья 19.7\n10-1\n. Неисполнение…»  -> «Статья 19.7.10-1.»
    //      «Статья 29\n1\n.1. Направление…»      -> «Статья 29.1.1.»
    //    Надёжный признак: цифры стоят на отдельной строке, а следующая строка
    //    открывается точкой. Обычный пункт всегда пишется слитно — «1. текст».
    t = t.replace(
      /Статья([ \t]+)(\d+(?:[.-]\d+)*)[ \t]*\n[ \t]*(\d+(?:-\d+)?)[ \t]*\n[ \t]*\.(\d+(?:[.-]\d+)*[ \t]*\.)?/g,
      function (m, sp, base, sub, more) {
        var num = base + "." + sub;
        if (more) num += "." + more.replace(/[ \t]*\.$/, "");
        return "Статья" + sp + num + ". ";
      });

    // 1b. разорванный номер ГЛАВЫ и РАЗДЕЛА — тот же приём источника:
    //      «Глава 25\n4\n. Налог…»         -> «Глава 25.4.»
    //      «Глава 36\n1\n. ПРОИЗВОДСТВО…»  -> «Глава 36.1.»
    //      «РАЗДЕЛ VIII\n1\nСПЕЦИАЛЬНЫЕ…»  -> «РАЗДЕЛ VIII.1»
    //      «РАЗДЕЛ III\n2\nНАЕМНЫЕ ДОМА»   -> «РАЗДЕЛ III.2»
    //    Без этой склейки номер главы/раздела не распознаётся, и заголовок
    //    (вместе с целой главой) склеивается с предыдущим текстом.
    t = t.replace(
      /([Гг][Лл][Аа][Вв][Аа])([ \t]+)(\d+|[IVXLC]+)[ \t]*\n[ \t]*(\d+(?:-\d+)?)[ \t]*\n[ \t]*\./g,
      "$1$2$3.$4. ");
    t = t.replace(
      /([Рр][Аа][Зз][Дд][Ее][Лл])([ \t]+)([IVXLC]+)[ \t]*\n[ \t]*(\d+)[ \t]*\n/g,
      "$1$2$3.$4\n");

    // 2. маркеры разделов и глав — на отдельную строку
    t = t.replace(/([^\n])\s*(ГЛАВА\s+(?:\d+(?:\.\d+)?|[IVXLC]+)\s*\.|Глава\s+(?:\d+(?:\.\d+)?|[IVXLC]+)\s*\.)/g, "$1\n\n$2");
    t = t.replace(/([^\n])\s*(Раздел\s+[IVXLC]+\s*\.|РАЗДЕЛ\s+[IVXLC]+\s*\.)/g, "$1\n\n$2");

    // 3. перенос строки внутри предложения -> пробел
    var lines = t.split("\n").map(function (l) { return l.replace(/[ \t]+/g, " ").trim(); });
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (!l) { out.push(""); continue; }
      var prev = out.length ? out[out.length - 1] : "";
      // заголовок статьи всегда остаётся отдельной строкой — иначе название
      // «слипается» с первым абзацем текста
      var prevOpen = prev && !HDR_LINE.test(prev) && !/[.;:!?»)]$/.test(prev) && !/^[а-я]\)/.test(prev);
      var isMark = MARK.test(l);
      if (prevOpen && !isMark && !/^\d+\)/.test(l)) {
        out[out.length - 1] = prev + " " + l;
      } else {
        out.push(l);
      }
    }

    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  /* ---------------------------------------------------------------- разбор */

  function extractMarkers(text) {
    var marks = [];
    var re = /^(ГЛАВА\s+(?:\d+(?:\.\d+)?|[IVXLC]+)\s*\.[^\n]*|Глава\s+(?:\d+(?:\.\d+)?|[IVXLC]+)\s*\.[^\n]*|Раздел\s+[IVXLC]+[^\n]*|РАЗДЕЛ\s+[IVXLC]+[^\n]*)$/gm;
    var m;
    while ((m = re.exec(text)) !== null) marks.push({ index: m.index, line: m[1].trim() });
    return marks;
  }

  function splitArticles(text, declaredNum, declaredTitle) {
    var re = /^Статья\s+(\d+(?:[.-]\d+)*)\s*\.\s*([^\n]*)$/gm;
    var hits = [];
    var m;
    while ((m = re.exec(text)) !== null) {
      hits.push({ index: m.index, len: m[0].length, num: m[1], title: (m[2] || "").trim() });
    }
    if (!hits.length) return [];
    var res = [];
    for (var i = 0; i < hits.length; i++) {
      var start = hits[i].index;
      var end = i + 1 < hits.length ? hits[i + 1].index : text.length;
      var body = text.slice(start + hits[i].len, end).trim();
      var title = hits[i].title;
      // название из поля источника надёжнее разобранного, но только для основной
      // статьи записи и только если оно содержательнее
      if (i === 0 && declaredNum != null && String(declaredNum) === hits[i].num && declaredTitle) {
        if (!title || declaredTitle.length > title.length) title = declaredTitle;
      }
      if (!title) {
        var first = (body.split("\n")[0] || "").trim();
        if (/утратил/i.test(first)) title = "Утратила силу";
        else if (first.length < 120 && !/[.;]$/.test(first)) title = first.replace(/^[.\s]+/, "").trim();
      }
      title = title.replace(/\s*[.\s]+$/, "").replace(/^[.\s]+/, "");
      if (!title) title = "Статья " + hits[i].num;
      res.push({
        n: hits[i].num,
        t: title,
        text: ("Статья " + hits[i].num + ". " + (title === "Статья " + hits[i].num ? "" : title) + "\n" + body).trim()
      });
    }
    return res;
  }

  function lastRedaction(text) {
    var dates = [];
    var re = /от\s+(\d{2})\.(\d{2})\.(\d{4})\s*№/g;
    var m;
    while ((m = re.exec(text)) !== null) dates.push(m[3] + "-" + m[2] + "-" + m[1]);
    dates.sort();
    return dates.length ? dates[dates.length - 1] : "";
  }

  function tidy(s) { return s.replace(/\s+/g, " ").replace(/\.\s*$/, "").trim(); }

  function joinG(razdel, chapter) {
    if (razdel && chapter) return chapter;
    return chapter || razdel || "";
  }

  /* ---------------------------------------------------------------- документ */

  /* Разбор одного документа источника.
     raw  — { articles: [{number, title, text}] }
     opts — { mode: "articles" | "plain" }

       mode "articles" (по умолчанию) — кодексы и федеральные законы:
         текст нормализуется, разбивается по заголовкам «Статья N. Название»,
         подстатьи выделяются в отдельные записи, главы и разделы извлекаются
         из маркеров внутри текста.

       mode "plain" — Конституция и федеральные конституционные законы:
         каждая запись источника уже является отдельной статьёй; глава берётся
         из поля entry.chapter, подстатьи не выделяются.

     Возвращает { arts:[{n,t,g,text,red}], sub, stubs }. */
  function parseDoc(raw, opts) {
    opts = opts || {};
    var mode = opts.mode || "articles";
    var arts = [], subCount = 0, stubCount = 0;
    var chapter = "", razdel = "";

    (raw.articles || []).forEach(function (entry) {
      /* --- режим "plain" --- */
      if (mode === "plain") {
        if (entry.chapter != null) chapter = entry.chapter;
        if (entry.razdel != null) razdel = entry.razdel;
        var pt = normalize(entry.text);
        if (entry.number == null) {
          if (pt) arts.push({ n: "0", t: entry.title || "Преамбула и вводная часть", g: "", text: pt, red: lastRedaction(pt) });
          return;
        }
        if (String(entry.number).indexOf(".") !== -1) subCount++;
        arts.push({
          n: String(entry.number),
          t: entry.title || ("Статья " + entry.number),
          g: joinG(razdel, chapter),
          text: pt,
          red: lastRedaction(pt)
        });
        return;
      }

      /* --- режим "articles" --- */
      var text = normalize(entry.text);

      // Записи-заглушки источника: «Пункт N. Дополнение с ДД.ММ.ГГГГ - Федеральный
      // закон». Это не статьи, а отложенные примечания о будущих изменениях,
      // ошибочно пронумерованные как статьи. В индекс не включаем.
      if (/^Дополнение с \d{2}\.\d{2}\.\d{4}/.test((entry.title || "").trim()) &&
          /^(Пункт|Дополнение)\s/i.test(text)) { stubCount++; return; }

      // Выгрузки с официального портала (заплатки и дополнительные законы)
      // держат главу и раздел в ПОЛЯХ записи, а не маркерами внутри текста:
      // «Глава 1. Общие положения» лежит в entry.chapter, тогда как текст
      // статьи начинается сразу со «Статья N». Без этой подстановки у целого
      // закона не было бы ни одной главы — и в оглавлении он выглядел бы
      // сплошным списком статей. У набора данных (кодексы, законы ruslaw)
      // таких полей нет, поэтому для них ничего не меняется; если маркеры в
      // тексте всё же есть, они идут следом и перекрывают поле.
      if (entry.chapter) chapter = tidy(String(entry.chapter));
      if (entry.razdel) razdel = tidy(String(entry.razdel));

      var marks = extractMarkers(text);
      var before = arts.length;

      // Одна запись источника может содержать несколько глав: маркеры глав и
      // разделов делят её на сегменты. Раньше весь текст после первого маркера
      // отбрасывался — вместе с целыми главами (например, апелляционным
      // производством УПК). Теперь каждый сегмент разбирается со своей главой,
      // а состояние главы переносится на следующие записи.
      var segs = [];
      var cursor = 0;
      var curR = razdel, curC = chapter;
      marks.forEach(function (mk) {
        var piece = text.slice(cursor, mk.index).trim();
        if (piece) segs.push({ text: piece, chapter: curC, razdel: curR });
        if (/^ГЛАВА/i.test(mk.line)) curC = tidy(mk.line);
        else if (/^Раздел/i.test(mk.line)) { curR = tidy(mk.line); curC = ""; }
        cursor = mk.index + mk.line.length;
      });
      var tail = text.slice(cursor).trim();
      if (tail) segs.push({ text: tail, chapter: curC, razdel: curR });
      razdel = curR; chapter = curC;

      // Преамбула
      if (entry.number == null) {
        if (segs.length && segs[0].text) {
          arts.push({ n: "0", t: "Преамбула и список изменений", g: "", text: segs[0].text, red: lastRedaction(text) });
        }
        return;
      }

      var declaredTitle = (entry.title || "").trim();
      var primaryUsed = false;
      segs.forEach(function (seg) {
        var g = joinG(seg.razdel, seg.chapter);
        var parts = splitArticles(seg.text, primaryUsed ? null : entry.number, declaredTitle);
        if (!parts.length) {
          // в сегменте нет заголовков «Статья N» — это продолжение текста
          if (arts.length) { arts[arts.length - 1].text += "\n" + seg.text; return; }
          arts.push({ n: String(entry.number), t: declaredTitle || ("Статья " + entry.number), g: g, text: seg.text, red: lastRedaction(seg.text) });
          primaryUsed = true;
          return;
        }
        parts.forEach(function (p) {
          if (String(p.n).indexOf(".") !== -1) subCount++;
          arts.push({ n: p.n, t: p.t, g: g, text: p.text, red: lastRedaction(p.text) });
        });
        if (String(parts[0].n) === String(entry.number)) primaryUsed = true;
      });

      // запись без разобранных статей — сохраняем как есть, чтобы ничего не потерять
      if (arts.length === before) {
        arts.push({
          n: String(entry.number), t: declaredTitle || ("Статья " + entry.number),
          g: joinG(razdel, chapter), text: text, red: lastRedaction(text)
        });
      }
    });

    return { arts: arts, sub: subCount, stubs: stubCount };
  }

  /* Служебный «*» у продублированных номеров.
     Номер может повториться более двух раз (например, постановление
     Правительства: пункты основного текста и приложений нумеруются заново),
     поэтому «*» добавляется до тех пор, пока номер не станет уникальным. */
  function dedupeNumbers(arts) {
    var seen = {}, dup = 0;
    arts.forEach(function (a) {
      if (seen[a.n]) {
        do { a.n = a.n + "*"; } while (seen[a.n]);
        dup++;
      }
      seen[a.n] = true;
    });
    return dup;
  }

  /* ------------------------------------------------------- статус нормы
     Источники помечают утрату силы и приостановление прямо в тексте статьи
     или в примечании к ней — отдельного поля статуса нет. Формы, которые
     встречаются в наборе данных (проверено по всем 99 источникам):

       «Статья 52. (Статья утратила силу - Федеральный закон от 08.12.2003 № 162-ФЗ)»
       «(Утратила силу - Федеральный закон от 03.07.2016 № 325-ФЗ)»
       «(Часть утратила силу - ...)»  /  «(Пункт утратил силу - ...)»
       «Статья 10 настоящего Федерального закона вступает в силу...»  — НЕ статус

     Возвращает { status, act, date, note } либо null.
     status: "repealed" (утратила силу) | "suspended" (приостановлена)
             | "void" (признана недействующей) | "future" (вступает в силу)
     act   — реквизиты акта-основания; date — дата этого акта (ГГГГ-ММ-ДД). */

  /* Граница слова после глагола обязательна: «(исключение) из образовательной
     организации» — это диспозиция, а не утрата силы, и без проверки
     `(?![а-яёА-ЯЁ])` регексп видел в слове «исключение» маркер «исключен» и
     вытаскивал актом-основанием обрывок «ие». */
  var STATUS_RE = /\(\s*(?:Статья|Часть|Пункт|Абзац|Подпункт|Статьи|Части|Пункты|Глава|Наименование)?\s*(?:настоящего\s+\w+\s+)?(утратил[аио]?\s+силу(?![а-яёА-ЯЁ])|приостановлен[аоы]?(?![а-яёА-ЯЁ])|признан[аоы]?\s+недействующ[а-яёА-ЯЁ]*(?![а-яёА-ЯЁ])|исключ[её]н[аоы]?(?![а-яёА-ЯЁ])|отмен[её]н[аоы]?(?![а-яёА-ЯЁ]))\s*[-–—]?\s*([^)]{0,220})\)/i;

  /* «Статья N настоящего Кодекса вступает в силу…» — это НЕ утрата силы */
  var FUTURE_RE = /вступает\s+в\s+силу|вводится\s+в\s+действие|применяется\s+с/i;

  /* Реквизиты акта-основания. «Федеральный закон от 08.12.2003 № 162-ФЗ».
     ВАЖНО: в JavaScript \w и \b — ASCII-только и кириллицу не покрывают,
     поэтому здесь используется явный класс [а-яёА-ЯЁ].
     После года допускается «г.» («от 30.12.2005 г. № 847») — иначе у
     постановлений Правительства дата не извлекалась и оставалась пустой. */
  var ACT_RE = /((?:[Фф]едеральн[а-яё]+[\s\u00a0]+(?:конституционн[а-яё]+[\s\u00a0]+)?закон[а-яё]*|[Кк]одекс[а-яё]*|[Зз]акон[\s\u00a0]+РФ|[Уу]каз[\s\u00a0]+Президента|[Пп]остановление[\s\u00a0]+Правительства)[^,;)]{0,120}?)[\s\u00a0]+от[\s\u00a0]+(\d{2})\.(\d{2})\.(\d{4})[\s\u00a0]*(?:г\.?)?[\s\u00a0]*(?:№|N|No)?[\s\u00a0]*(\d+(?:-[а-яёА-ЯЁ]+)?)/;

  function detectStatus(text) {
    var s = String(text || "").replace(/\s+/g, " ").trim();
    if (!s) return null;

    /* проверяем только начало записи и примечания к ней: статус стоит в первых
       строках либо внутри скобок, а не в глубине диспозиции */
    var head = s.slice(0, 700);
    var m = STATUS_RE.exec(head);
    if (!m) return null;

    var marker = m[1].toLowerCase();
    if (FUTURE_RE.test(head.slice(0, m.index + m[0].length + 40)) && /вступает/i.test(marker)) return null;

    var status = "repealed";
    if (/приостановлен/.test(marker)) status = "suspended";
    else if (/недействующ/.test(marker)) status = "void";
    /* «исключён» пишется и с ё — класс [её] обязателен, иначе такая норма
       молча попадала бы в «утратила силу». */
    else if (/исключ[её]н|отмен[её]н/.test(marker)) status = "void";

    /* «Статья 10 настоящего ФЗ вступает в силу» — ложное срабатывание, отсекаем */
    if (/настоящего\s+(Федерального\s+закона|Кодекса)/i.test(m[0]) && /вступает/i.test(m[0])) return null;

    var tail = m[2] || "";
    var act = "", date = "";
    var am = ACT_RE.exec(tail);
    if (am) {
      act = am[0].replace(/\s*[-–—]\s*$/, "").trim();
      date = am[4] + "-" + am[3] + "-" + am[2];
    } else {
      /* иногда реквизиты уходят за скобку — берём короткий хвост после неё */
      var after = s.slice(m.index + m[0].length, m.index + m[0].length + 200);
      var am2 = ACT_RE.exec(after);
      if (am2) { act = am2[0].replace(/\s*[-–—]\s*$/, "").trim(); date = am2[4] + "-" + am2[3] + "-" + am2[2]; }
      else {
        /* Хвост после маркера — обычно реквизиты акта, но иногда просто слово
           из текста. Оставляем его только если он похож на акт: есть номер
           либо дата. Иначе лучше честное «акт не указан», чем мусор. */
        var cand = tidy(tail).slice(0, 160);
        act = /№|от\s+\d{2}\.\d{2}\.\d{4}/.test(cand) ? cand : "";
      }
    }

    return { status: status, act: act, date: date, note: tidy(m[0]) };
  }

  /* Статус части/пункта внутри статьи — по абзацу. Возвращает массив
     { status, act, date } по строкам, где статус найден (для подсветки). */
  function detectPartStatuses(text) {
    var out = [];
    String(text || "").split("\n").forEach(function (l) {
      var st = detectStatus(l);
      if (st) out.push({ line: l.trim(), status: st.status, act: st.act, date: st.date });
    });
    return out;
  }

  return {
    HDR_LINE: HDR_LINE,
    normalize: normalize,
    extractMarkers: extractMarkers,
    splitArticles: splitArticles,
    lastRedaction: lastRedaction,
    tidy: tidy,
    joinG: joinG,
    parseDoc: parseDoc,
    dedupeNumbers: dedupeNumbers,
    detectStatus: detectStatus,
    detectPartStatuses: detectPartStatuses
  };
});
