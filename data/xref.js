/* =========================================================================
   Правовой консультант :: перекрёстные ссылки между статьями
   -------------------------------------------------------------------------
   Находит в тексте статьи упоминания других статей и определяет, на какой
   именно документ и какую статью они указывают:

     «предусмотренных статьей 105 Уголовного кодекса Российской Федерации»
     «в соответствии со статьями 5 и 6 настоящего Федерального закона»
     «статьей 6 Федерального закона от 12 августа 1995 г. № 144-ФЗ
      «Об оперативно-розыскной деятельности»»
     «(часть вторая статьи 167)»
     «ГК РФ (часть первая), статья 395»

   Модуль общий (UMD): тот же код работает в браузере и в проверках Node.
   В приложение копируется как data/xref.js (tools/build-data.js).

   Принцип: ссылка создаётся только тогда, когда документ определён уверенно
   И указанная статья в нём действительно существует. Лучше не поставить
   ссылку, чем поставить неверную.
   ========================================================================= */
"use strict";

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RF_XREF = factory();
})(typeof self !== "undefined" ? self : this, function () {

  /* ------------------------------------------------------------ словари */

  /* Сокращения кодексов. Массивы — семейства (ГК и НК состоят из частей). */
  var ACR = {
    "ук": ["uk"], "упк": ["upk"], "коап": ["koap"], "коапрф": ["koap"],
    "гк": ["gk1", "gk2", "gk3", "gk4"], "нк": ["nk1", "nk2"],
    "тк": ["tk"], "ск": ["sk"], "жк": ["zhk"], "зк": ["zk"], "грк": ["grk"],
    "бк": ["bk"], "уик": ["uik"], "лк": ["lk"], "вк": ["vk"], "взк": ["vozk"],
    "ктм": ["ktm"], "кввт": ["kvvt"], "апк": ["apk"], "гпк": ["gpk"], "кас": ["kas"]
  };

  /* Полные наименования кодексов. Порядок важен: частные случаи — раньше.
     Все шаблоны регистронезависимые: в тексте встречается и «Уголовного
     кодекса», и «уголовного кодекса». */
  var STEMS = [
    [/уголовно[\s-]?исполнительн[а-яё]*/i, ["uik"]],
    [/уголовно[\s-]?процессуальн[а-яё]*/i, ["upk"]],
    [/уголовн[а-яё]*\s+кодекс[а-яё]*/i, ["uk"]],
    [/гражданск[а-яё]*\s+процессуальн[а-яё]*/i, ["gpk"]],
    [/гражданск[а-яё]*\s+кодекс[а-яё]*/i, ["gk1", "gk2", "gk3", "gk4"]],
    [/арбитражн[а-яё]*\s+процессуальн[а-яё]*/i, ["apk"]],
    [/кодекс[а-яё]*\s+административного\s+судопроизводства/i, ["kas"]],
    [/административных\s+правонарушени[а-яё]*/i, ["koap"]],
    [/налогов[а-яё]*\s+кодекс[а-яё]*/i, ["nk1", "nk2"]],
    [/трудов[а-яё]*\s+кодекс[а-яё]*/i, ["tk"]],
    [/семейн[а-яё]*\s+кодекс[а-яё]*/i, ["sk"]],
    [/жилищн[а-яё]*\s+кодекс[а-яё]*/i, ["zhk"]],
    [/земельн[а-яё]*\s+кодекс[а-яё]*/i, ["zk"]],
    [/градостроительн[а-яё]*\s+кодекс[а-яё]*/i, ["grk"]],
    [/бюджетн[а-яё]*\s+кодекс[а-яё]*/i, ["bk"]],
    [/лесн[а-яё]*\s+кодекс[а-яё]*/i, ["lk"]],
    [/водн[а-яё]*\s+кодекс[а-яё]*/i, ["vk"]],
    [/воздушн[а-яё]*\s+кодекс[а-яё]*/i, ["vozk"]],
    [/торгового\s+мореплавания/i, ["ktm"]],
    [/внутреннего\s+водного\s+транспорта/i, ["kvvt"]],
    /* «Конституции», но не «Конституционного Суда» */
    [/конституци(?!он)[а-яё]*/i, ["kons"]]
  ];

  /* «статья 105» / «ст. 105» + надстрочный номер подстатьи «205 1» */
  var ART_SRC = "(?:стать[а-яё]{0,4}|ст\\.)\\s*(?:№\\s*)?(\\d+(?:\\.\\d+)*)(?:\\s+(\\d{1,2})(?!\\d))?";

  /* Продолжение перечня: «статьями 5, 6 и 7» */
  var CONT_SRC = "^(\\s*(?:,\\s*|\\s+и\\s+|\\s+либо\\s+)(\\d+(?:\\.\\d+)*)(?:\\s+(\\d{1,2})(?!\\d))?)";

  var SELF_SRC = "настоящ[а-яё]*";
  var NUM_SRC = "(?:федеральн[а-яё]*\\s+(?:конституционн[а-яё]*\\s+)?закон[а-яё]*|настоящ[а-яё]*\\s+закон[а-яё]*)[^№]{0,90}?№\\s*(\\d{1,4})\\s*[-\\u2011\\u2013]?\\s*(ФКЗ|ФЗ|I{1,2})";
  var TITLE_SRC = "закон[а-яё]*\\s*[«\"„]([^»\"“]{3,140})[»\"“]";
  var GLAW_SRC = "федеральн[а-яё]*\\s+(?:конституционн[а-яё]*\\s+)?закон";
  var GKODEKS_SRC = "кодекс[а-яё]*";

  var PART_WORDS = { "перв": 1, "втор": 2, "трет": 3, "четверт": 4 };
  var ROMAN = { "I": 1, "II": 2, "III": 3, "IV": 4 };

  var WINDOW = 150;      // на сколько символов вперёд ищем указание на документ
  var MAX_CONT = 6;      // максимум продолжений перечня после основного номера

  /* ------------------------------------------------------------ утилиты */

  function normNum(s) {
    return String(s == null ? "" : s)
      .replace(/[\u2011\u2013\u2014]/g, "-")
      .replace(/\s+/g, "")
      .toUpperCase();
  }

  function normTitle(s) {
    return String(s == null ? "" : s).toLowerCase()
      .replace(/[«»""„“”'`()\[\]]/g, " ")
      .replace(/федеральн[а-яё]*\s+конституционн[а-яё]*\s+закон[а-яё]*/g, " ")
      .replace(/федеральн[а-яё]*\s+закон[а-яё]*/g, " ")
      .replace(/российской\s+федерации/g, " ")
      .replace(/[^а-яё0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function kindOf(doc) { return doc ? doc.kind : ""; }

  /* «часть вторая» / «часть II» → 2 */
  function partHint(w) {
    var m = /част[а-яё]*\s+(перв|втор|трет|четверт)[а-яё]*/i.exec(w);
    if (m) return PART_WORDS[m[1].toLowerCase()] || 0;
    m = /част[а-яё]*\s+(I{1,3}V?|IV)\b/i.exec(w);
    if (m) return ROMAN[m[1].toUpperCase()] || 0;
    return 0;
  }

  /* ------------------------------------------------------------ создание */

  /* opts.docs — реестр источников [{id, kind, short, full, number, adopted}]
     opts.has(docId, num) — существует ли такая статья */
  function create(opts) {
    opts = opts || {};
    var docs = (opts.docs || []).filter(Boolean);
    var hasFn = opts.has || function () { return false; };

    var byId = {}, byNum = {}, titles = [];
    docs.forEach(function (d) {
      byId[d.id] = d;
      /* Постановления Пленума ВС РФ в byNum не кладём: у них простые номера
         («29»), а этот индекс разрешает упоминания вида «закон № N» — иначе
         номер постановления мог бы «перехватить» ссылку на закон. */
      var n = normNum(d.number);
      if (n && d.kind !== "plenum") (byNum[n] = byNum[n] || []).push(d);
      if (d.kind === "law" || d.kind === "fkz") {
        titles.push({ d: d, t: normTitle(d.full) });
        /* abbr — компактное сокращение («ФЗ о ФСБ»); short теперь содержит
           полное отображаемое имя («ФЗ «О ФСБ» № 40») и для разбора текста
           пригодно хуже. */
        var s = normTitle(d.abbr || d.short);
        if (s && s.length > 3) titles.push({ d: d, t: s });
      }
    });
    titles.sort(function (a, b) { return b.t.length - a.t.length; });

    function has(id, num) {
      if (!id || !num) return false;
      if (!byId[id]) return false;
      return !!hasFn(id, String(num));
    }

    /* семейство документов (ГК ч. I–IV, НК ч. I–II) → подходящий по номеру */
    function pickFamily(ids, num, part) {
      var order = [];
      if (part && ids[part - 1]) order.push(ids[part - 1]);
      ids.forEach(function (id) { if (order.indexOf(id) === -1) order.push(id); });
      for (var i = 0; i < order.length; i++) if (has(order[i], num)) return order[i];
      return null;
    }

    /* ---------------------------------------------------------- кандидаты */

    function candidates(w) {
      var out = [], m;
      var re;

      re = new RegExp(SELF_SRC, "gi");
      while ((m = re.exec(w))) out.push({ i: m.index, prio: 2, type: "self" });

      re = /[А-Яа-яЁё]+/g;
      var seen = {};
      while ((m = re.exec(w))) {
        var tok = m[0].toLowerCase();
        if (!ACR[tok] || seen[tok]) continue;
        seen[tok] = 1;
        var tail = w.slice(m.index + m[0].length);
        var ok = /^\s*(?:РФ|Российской|России|Федерации)?\s*(?:[)\]},.;:«»"'\u2014\u2013-]|$)/.test(tail) ||
                 /^\s*(?:РФ|Российской|России|Федерации)?\s+(?:и|или|либо)\s/.test(tail);
        if (ok) out.push({ i: m.index, prio: 2, type: "doc", ids: ACR[tok] });
      }

      STEMS.forEach(function (s) {
        var mm = s[0].exec(w);
        if (mm) out.push({ i: mm.index, prio: 2, type: "doc", ids: s[1] });
      });

      re = new RegExp(NUM_SRC, "gi");
      while ((m = re.exec(w))) {
        out.push({ i: m.index, prio: 0, type: "number", number: normNum(m[1] + "-" + m[2]) });
      }

      re = new RegExp(TITLE_SRC, "gi");
      while ((m = re.exec(w))) out.push({ i: m.index, prio: 1, type: "title", title: normTitle(m[1]) });

      re = new RegExp(GLAW_SRC, "gi");
      while ((m = re.exec(w))) out.push({ i: m.index, prio: 3, type: "genericLaw" });

      re = new RegExp(GKODEKS_SRC, "gi");
      while ((m = re.exec(w))) out.push({ i: m.index, prio: 4, type: "genericKodeks" });

      out.sort(function (a, b) { return (a.i - b.i) || (a.prio - b.prio); });
      return out;
    }

    /* ---------------------------------------------------------- разрешение */

    /* В окне есть прямое указание на ДРУГОЙ закон (номер, название в кавычках
       или дата принятия). Если его не удалось опознать, ссылку не ставим:
       подставлять «свой» документ здесь нельзя. */
    function otherLawHint(w) {
      return /\u2116\s*\d/.test(w) ||
        /закон[а-яё]*\s+от\s+\d{1,2}\s+[а-яё]/i.test(w) ||
        /закон[а-яё]*\s*[«"]/i.test(w);
    }

    function resolveCand(c, ctx, num, w) {
      if (c.type === "self") return ctx.doc;
      if (c.type === "doc") return pickFamily(c.ids, num, partHint(w));
      if (c.type === "number") {
        var list = byNum[c.number] || [];
        if (list.length === 1) return list[0].id;
        if (list.length > 1) {
          var yr = /(19\d{2}|20\d{2})/.exec(w);
          if (yr) {
            for (var i = 0; i < list.length; i++) {
              if (String(list[i].adopted || "").indexOf(yr[1]) !== -1) return list[i].id;
            }
          }
          return null;
        }
        return null;
      }
      if (c.type === "title") {
        for (var j = 0; j < titles.length; j++) {
          var t = titles[j].t;
          if (t.length >= 4 && (t === c.title || t.indexOf(c.title) !== -1 || c.title.indexOf(t) !== -1)) {
            return titles[j].d.id;
          }
        }
        return null;
      }
      if (c.type === "genericLaw") {
        if (otherLawHint(w)) return null;
        var k = kindOf(byId[ctx.doc]);
        return (k === "law" || k === "fkz") ? ctx.doc : null;
      }
      if (c.type === "genericKodeks") return kindOf(byId[ctx.doc]) === "code" ? ctx.doc : null;
      return null;
    }

    /* Подбор документа для номера статьи: ближайшее указание в окне после номера */
    function resolveDoc(text, end, ctx, num) {
      var w = text.slice(end, end + WINDOW);
      var cands = candidates(w);
      for (var i = 0; i < cands.length; i++) {
        var id = resolveCand(cands[i], ctx, num, w);
        if (id && has(id, num)) return id;
      }
      /* указаний нет — считаем, что ссылка на «свой» документ */
      if (otherLawHint(w)) return null;
      if (has(ctx.doc, num)) return ctx.doc;
      return null;
    }

    /* -------------------------------------------------------------- скан */

    function scan(text, ctx) {
      if (!text || !ctx || !ctx.doc) return [];
      var out = [];
      var re = new RegExp(ART_SRC, "gi");
      var m;
      while ((m = re.exec(text))) {
        var num = m[1] + (m[2] ? "." + m[2] : "");
        var end = m.index + m[0].length;

        /* Заголовок самой статьи («Статья 3. Гражданское законодательство…»)
           ссылкой не является. */
        if (num === ctx.num && /^\s*$/.test(text.slice(0, m.index))) { re.lastIndex = end; continue; }

        var doc = resolveDoc(text, end, ctx, num);
        if (doc) out.push({ i: m.index, len: m[0].length, doc: doc, num: num });

        /* продолжения перечня: «статьями 5, 6 и 7 настоящего ...» */
        if (doc) {
          var pos = end, k = 0, cm;
          var cre = new RegExp(CONT_SRC);
          while (k++ < MAX_CONT) {
            cm = cre.exec(text.slice(pos, pos + 40));
            if (!cm) break;
            var cnum = cm[2] + (cm[3] ? "." + cm[3] : "");
            if (!has(doc, cnum)) break;
            out.push({ i: pos + cm[1].indexOf(cm[2]), len: cm[2].length + (cm[3] ? cm[3].length + 1 : 0), doc: doc, num: cnum });
            pos += cm[1].length;
          }
        }
        re.lastIndex = end;
      }

      /* убираем ссылку статьи на саму себя и наложения */
      var res = [], last = -1;
      out.sort(function (a, b) { return a.i - b.i; });
      out.forEach(function (r) {
        if (r.i < last) return;
        if (r.doc === ctx.doc && r.num === ctx.num) { return; }
        last = r.i + r.len;
        res.push(r);
      });
      return res;
    }

    /* Только уникальные цели (для панели «Ссылается на») */
    function targets(text, ctx) {
      var seen = {}, res = [];
      scan(text, ctx).forEach(function (r) {
        var k = r.doc + "-" + r.num;
        if (seen[k]) return;
        seen[k] = 1;
        res.push({ doc: r.doc, num: r.num });
      });
      return res;
    }

    return {
      docs: byId, has: has, scan: scan, targets: targets,
      resolveDoc: resolveDoc, normNum: normNum, normTitle: normTitle
    };
  }

  return {
    create: create,
    ACR: ACR,
    STEMS: STEMS,
    normNum: normNum,
    normTitle: normTitle,
    partHint: partHint
  };
});
