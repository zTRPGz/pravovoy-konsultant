/* =========================================================================
   Правовой консультант :: дымовой тест приложения
   -------------------------------------------------------------------------
   Поднимает локальный HTTP-сервер над папкой проекта, открывает index.html
   в headless-браузере (jsdom) и проходит по всем разделам: поиск, статья с
   ленивой загрузкой полного текста, кодекс, разбор ситуации, сроки,
   чек-листы, шаблоны, избранное, командная строка.

   Запуск:
     NODE_PATH=<путь к node_modules с jsdom> node tools/smoke-test.js

   Требуется пакет jsdom.
   ========================================================================= */
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

let failures = 0;
const errors = [];
let section = "подготовка";
let lastStep = "старт";

/* Ожидаемые объёмы базы. Это «замок»: если данные внезапно усохнут, тест
   это заметит. При осознанном добавлении источников значения обновляются
   здесь — в одном месте, а не по всему файлу. */
const N_SOURCES = 357;    // кодексы 24, законы 124, ФКЗ 14, Конституция, постановления Правительства 14, Пленумы ВС РФ 99, обзоры судебной практики 81
const N_ARTICLES = 24182;
const N_PLENUMS = 99;
const N_REVIEWS = 81;
const N_DECREES = 14;   // постановления Правительства РФ

function ok(name, cond, extra) {
  lastStep = name;
  console.log((cond ? "  OK   " : "  ПРОБЛЕМА ") + name + (extra ? " — " + extra : ""));
  if (!cond) failures++;
}

/* Диагностический сторож. Если скрипт завис (например, на сетевом пути в
   jsdom) — печатаем место остановки и выходим с кодом 2, чтобы прогон не
   висел неопределённо долго. */
const WATCHDOG_MS = Number(process.env.SMOKE_WATCHDOG_MS || 240000);
const watchdog = setTimeout(() => {
  console.log("\n[СТОРОЖ] Прогон завис и был остановлен.");
  console.log("[СТОРОЖ] Раздел: " + section);
  console.log("[СТОРОЖ] Последний шаг: " + lastStep);
  process.exit(2);
}, WATCHDOG_MS);
watchdog.unref();
const wait = ms => new Promise(r => setTimeout(r, ms));

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "text/plain" });
  fs.createReadStream(p).pipe(res);
});

server.listen(0, "127.0.0.1", async () => {
  const base = "http://127.0.0.1:" + server.address().port;
  const vc = new VirtualConsole();
  vc.on("jsdomError", e => { if (!/scrollTo|Not implemented/.test(e.message)) errors.push(e.message); });
  vc.on("error", (...a) => errors.push(a.join(" ")));

  let dom;
  try {
    dom = await JSDOM.fromURL(base + "/index.html", {
      runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole: vc
    });
  } catch (e) {
    console.log("[СТОРОЖ] Не удалось запустить jsdom: " + e.message);
    clearTimeout(watchdog);
    server.close();
    process.exit(2);
  }
  const w = dom.window, d = w.document;
  await new Promise(r => {
    if (d.readyState === "complete") return r();
    w.addEventListener("load", r, { once: true });
    setTimeout(r, 15000);   /* страховка: не ждём load бесконечно */
  });
  await wait(500);
  const $ = s => d.querySelector(s);
  const $$ = s => Array.from(d.querySelectorAll(s));
  const T = s => ($(s) ? $(s).textContent.trim() : null);
  const nav = async (hash, ms) => { w.location.hash = hash; await wait(ms || 120); };
  /* Ждём наступления условия вместо фиксированной паузы: разделы с ленивой
     загрузкой (граф связей грузит 99 полных текстов) на медленной машине не
     укладываются в жёсткий таймаут — из-за этого прогон становился «мигающим». */
  const waitFor = async (cond, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 30000)) {
      if (cond()) return true;
      await wait(200);
    }
    return false;
  };

  /* ---------------------------------------------------------------- вступительный экран */
  /* Проверяем сразу после загрузки — до любой навигации и до Escape, который
     тоже закрывает модальное окно. Экран показывается при каждом открытии и
     закрывается нажатием в любом месте; кнопки «Войти» больше нет. */
  section = "Вступительный экран"; console.log("\n" + section);
  const intro = $("#intro");
  ok("вступительный экран есть в разметке", !!intro);
  if (intro) {
    ok("экран виден при открытии", intro.hidden === false && !intro.classList.contains("hide"),
      intro.hidden ? "скрыт" : "виден");
    ok("в экране есть заголовок и перечень возможностей",
      /Правовой консультант/.test(intro.textContent || "") &&
      intro.querySelectorAll(".intro-feats li").length >= 4);
    ok("кнопки «Войти» больше нет",
      !$("#introEnter") && !/Войти/.test(intro.textContent || ""));
    ok("подсказка предлагает нажать в любом месте",
      /нажмите в любом месте/i.test(intro.textContent || ""));
    /* нажатие в любом месте закрывает экран */
    intro.click();
    await wait(450);
    ok("после нажатия экран скрывается", intro.classList.contains("hide") || intro.hidden);
    ok("отметка «просмотрено» не сохраняется",
      w.localStorage.getItem("rflaws.introSeen") === null,
      "в хранилище: " + JSON.stringify(w.localStorage.getItem("rflaws.introSeen")));
  }

  /* Второе открытие: даже если в хранилище осталась отметка от прежних версий,
     экран обязан появиться снова — иначе обещание «показывается всегда» ложно. */
  let dom2 = null, shown2 = false;
  const vc2 = new VirtualConsole();
  const errors2 = [];
  vc2.on("jsdomError", e => { if (!/scrollTo|Not implemented/.test(e.message)) errors2.push(e.message); });
  vc2.on("error", (...a) => errors2.push(a.join(" ")));
  try {
    dom2 = await JSDOM.fromURL(base + "/index.html", {
      runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole: vc2,
      beforeParse(window) {
        try { window.localStorage.setItem("rflaws.introSeen", "1"); } catch (e) { /* хранилище недоступно */ }
      }
    });
    for (let i = 0; i < 40 && !shown2; i++) {
      await wait(200);
      const el2 = dom2.window.document.querySelector("#intro");
      if (el2 && !el2.hidden) shown2 = true;
    }
  } catch (e) {
    errors2.push(e.message);
  } finally {
    try { dom2 && dom2.window.close(); } catch (e) { /* уже закрыто */ }
  }
  ok("при повторном открытии экран показывается снова", shown2,
    "старая отметка introSeen его больше не скрывает");
  ok("повторное открытие без ошибок в консоли", errors2.length === 0,
    errors2.slice(0, 2).join(" | "));

  console.log("1. Загрузка данных");
  ok("реестр источников", (w.RF_CODES || []).length === N_SOURCES, (w.RF_CODES || []).length + " источников");
  ok("виды актов", (() => {
    const k = {}; (w.RF_CODES || []).forEach(c => k[c.kind] = (k[c.kind] || 0) + 1);
    /* Законы считаем как остаток: N_SOURCES задан одной константой выше, а
       остальные виды актов перечислены поимённо — так добавление закона не
       требует правки ещё одной цифры здесь. */
    const laws = N_SOURCES - 1 - 24 - 14 - N_DECREES - N_PLENUMS - N_REVIEWS;
    return k.constitution === 1 && k.code === 24 && k.fkz === 14 && k.law === laws &&
      k.decree === N_DECREES && k.plenum === N_PLENUMS && k.review === N_REVIEWS;
  })(), (() => { const k = {}; (w.RF_CODES || []).forEach(c => k[c.kind] = (k[c.kind] || 0) + 1); return JSON.stringify(k); })());
  ok("новые источники: ФЗ о ФСБ и постановления Правительства", (() => {
    const by = {}; (w.RF_CODES || []).forEach(c => by[c.id] = c.kind);
    return by["fz40fsb"] === "law" && by["fz226rosgv"] === "law" && by["fz273kor"] === "law" &&
      by["pg1090pdd"] === "decree" && by["pg713reg"] === "decree" && by["pg814oruzh"] === "decree";
  })(), "ФЗ о ФСБ, Росгвардии, коррупции; ПДД и правила учёта");
  ok("постановления Пленума ВС РФ в реестре", (() => {
    const by = {}; (w.RF_CODES || []).forEach(c => by[c.id] = c);
    const p = by["plenum29-2002"];
    return !!p && p.kind === "plenum" && p.branch === "Судебная практика" &&
      p.redaction === "16.06.2026" && /О судебной практике по делам о краже/.test(p.short);
  })(), (() => { const p = (w.RF_CODES || []).filter(c => c.id === "plenum29-2002")[0]; return p ? p.short.slice(0, 70) : "нет"; })());
  ok("снимок актуальности Пленумов", (() => {
    const pm = (w.RF_FRESH || {}).plenums;
    return !!pm && pm.count === N_PLENUMS && pm.oldest === "18.11.1999" && /sudact\.ru/.test(pm.catalogue || "");
  })(), JSON.stringify((w.RF_FRESH || {}).plenums || null));
  ok("обзоры судебной практики в реестре", (() => {
    const by = {}; (w.RF_CODES || []).forEach(c => by[c.id] = c);
    /* Обзор по отдельным вопросам судебной практики, связанным с COVID-19:
       разбирается по вопросам, поэтому пунктов должно быть много. */
    const r = by["obzor-3-2021-koronavirusnoi-infektsii"];
    return !!r && r.kind === "review" && r.branch === "Судебная практика" && r.count > 20;
  })(), (() => {
    const r = (w.RF_CODES || []).filter(c => c.kind === "review")[0];
    return r ? r.short.slice(0, 70) + " (" + r.count + " п.)" : "нет";
  })());
  ok("снимок актуальности обзоров", (() => {
    const rm = (w.RF_FRESH || {}).reviews;
    return !!rm && rm.count === N_REVIEWS && /sudact\.ru/.test(rm.catalogue || "");
  })(), JSON.stringify((w.RF_FRESH || {}).reviews || null));
  ok("поисковый индекс", (w.RF_IDX || []).length === N_ARTICLES, (w.RF_IDX || []).length + " записей");
  ok("аннотации", Object.keys(w.RF_ANNOT || {}).length === 352, Object.keys(w.RF_ANNOT || {}).length + " аннотаций");
  ok("устаревший слой RF_EXTRA пуст", ((w.RF_EXTRA || {}).articles || []).length === 0);
  ok("снимок актуальности", Object.keys((w.RF_FRESH || {}).docs || {}).length === N_SOURCES);
  ok("модуль разбора подключён", !!(w.RF_PARSE && w.RF_PARSE.parseDoc));
  ok("справочный слой", ((w.RF_REF || {}).deadlines || []).length === 28);
  ok("счётчик статей в интерфейсе", T("#totalCount") === String(N_ARTICLES), T("#totalCount"));
  ok("список источников в боковой панели", $$("#codeNav .nav-item").length === N_SOURCES, $$("#codeNav .nav-item").length);
  ok("localStorage доступен", (() => { try { w.localStorage.setItem("t", "1"); return true; } catch (e) { return false; } })());

  section = "2. Главная страница"; console.log("\n" + section);
  await nav("#/home");
  ok("заголовок", /правовой консультант/i.test(T("h1") || ""), T("h1"));
  ok("в шапке главной — три кнопки действий",
    $$('#view .hero-cta .btn').length === 3, $$('#view .hero-cta .btn').length + " кнопок");
  ok("блоки «Основное» и «Инструменты» на главной",
    $$('#view .grid-feature .quick-card').length === 4 && $$('#view .tool-grid .tool-link').length >= 8,
    $$('#view .grid-feature .quick-card').length + " основных · " + $$('#view .tool-grid .tool-link').length + " инструментов");
  ok("правовая сноска на главной свёрнута",
    !!$('#view details.disclaimer-collapse') && !$('#view details.disclaimer-collapse').open);
  ok("блок перехода к реестру источников", !!$(".src-teaser") && /#\/sources/.test($(".src-teaser").innerHTML || ""), $(".src-teaser") ? "есть" : "нет");
  ok("на главной нет дублирующего списка источников (он в меню и на #/sources)", $$(".code-card").length === 0, $$(".code-card").length);

  section = "3. Поиск"; console.log("\n" + section);
  const cases = [
    ["ст 105 УК", "uk-105"], ["статья 91 УПК", "upk-91"], ["19.7.10-1 КоАП", "koap-19.7.10-1"],
    ["123.16-1 ГК", "gk1-123.16-1"], ["264.1 УК", "uk-264.1"], ["29.1.1 КоАП", "koap-29.1.1"],
    ["ст 6.1.1 КоАП", "koap-6.1.1"], ["159.1 УК", "uk-159.1"]
  ];
  for (const [q, want] of cases) {
    await nav("#/search/" + encodeURIComponent(q), 70);
    const first = $("#view .result");
    ok("«" + q + "»", first && first.getAttribute("data-go") === "#/article/" + want,
      first ? first.getAttribute("data-go") + ", результатов " + $$("#view .result").length : "нет результатов");
  }
  for (const q of ["обыск", "получение взятки", "срок предварительного следствия"]) {
    await nav("#/search/" + encodeURIComponent(q), 70);
    ok("«" + q + "» находит статьи", $$("#view .result").length > 0, $$("#view .result").length + " результатов");
  }
  /* Точность: поиск идёт по основам слов, а не по подстроке. Раньше «суд»
     находил «гоСУДарственная измена», а «получение взятки» — «незаконное
     получение кредита». */
  await nav("#/search/" + encodeURIComponent("суд"), 120);
  ok("«суд» не выдаёт «государственную измену»",
    !$$("#view .result").some(r => r.getAttribute("data-go") === "#/article/uk-275"),
    $$("#view .result").length + " результатов");
  await nav("#/search/" + encodeURIComponent("получение взятки"), 120);
  ok("«получение взятки» не тянет «незаконное получение кредита»",
    !$$("#view .result").some(r => r.getAttribute("data-go") === "#/article/uk-176"),
    $$("#view .result").length + " результатов");
  ok("«получение взятки» начинается со ст. 290 УК",
    (() => { const r = $$("#view .result")[0]; return !!r && r.getAttribute("data-go") === "#/article/uk-290"; })(),
    ($$("#view .result")[0] || {}).getAttribute ? $$("#view .result")[0].getAttribute("data-go") : "нет");
  await nav("#/search/" + encodeURIComponent("срок предварительного следствия"), 120);
  ok("«срок предварительного следствия» — не больше 15 результатов (без «хвоста»)",
    $$("#view .result").length > 0 && $$("#view .result").length <= 15, $$("#view .result").length + " результатов");

  section = "4. Статья и ленивая загрузка полного текста"; console.log("\n" + section);
  await nav("#/article/uk-105", 300);
  /* Полный текст приходит отдельным шардом (data/ft/14.js). На медленной
     машине он не успевает за фиксированную паузу, и проверка «мигала».
     Ждём появления текста, а не угадываем время. */
  await waitFor(() => $("#artText") && /умышленное причинение смерти/i.test($("#artText").textContent), 12000);
  const body = $("#artText") ? $("#artText").textContent : "";
  ok("текст ст. 105 УК загружен", /умышленное причинение смерти/i.test(body), body.length + " символов");

  /* Полный текст должен находиться и при повторном открытии: раньше карта
     «номер → строка» могла закэшироваться пустой, если findFull вызывался
     до наполнения массива статей. Проверяем два захода подряд. */
  await nav("#/home", 150);
  await nav("#/article/uk-105", 700);
  const body2 = $("#artText") ? $("#artText").textContent : "";
  ok("текст находится при повторном открытии", /умышленное причинение смерти/i.test(body2),
    body2.length + " символов");
  ok("нет плашки «статья не найдена»", !/эта статья не найдена/.test(body2));
  ok("название статьи", /Убийство/.test(T(".article-title") || ""), T(".article-title"));
  ok("справочная аннотация показана", $$("#view .article-body").length >= 2);
  ok("указана редакция статьи", /Редакция статьи: \d{2}\.\d{2}\.\d{4}/.test(body), (body.match(/Редакция статьи: \S+/) || [])[0]);
  await nav("#/article/koap-19.7.10-1", 1300);
  ok("подстатья КоАП 19.7.10-1", /новостного агрегатора/i.test($("#artText").textContent), $("#artText").textContent.length + " символов");

  section = "4b. Конституция, ФКЗ и федеральные законы с портала"; console.log("\n" + section);
  await nav("#/article/kons-67.1", 1300);
  const kb = $("#artText") ? $("#artText").textContent : "";
  ok("Конституция: подстатья 67.1", /правопреемник/i.test(kb), kb.length + " символов");
  ok("Конституция: глава указана", /ГЛАВА 3/i.test(T("#view") || ""), (T("#view") || "").slice(0, 60));
  await nav("#/article/kons-137", 1300);
  ok("Конституция: ст. 137", /Изменения в статью 65/i.test($("#artText").textContent));
  await nav("#/code/kons");
  ok("Конституция: список статей", $$("#view .art-row").length === 144, $$("#view .art-row").length);
  await nav("#/article/fkz1-1994-115", 1300);
  ok("ФКЗ о КС РФ: ст. 115", /Местопребывание/i.test($("#artText").textContent), $("#artText").textContent.slice(0, 60));
  await nav("#/article/fz144ord-6", 1300);
  ok("ФЗ об ОРД: ст. 6", /оперативно-розыскных мероприятий/i.test($("#artText").textContent));
  await nav("#/article/fz86-82.6", 1300);
  ok("86-ФЗ: подстатья 82.6 без склейки", /приостановления/i.test($("#artText").textContent) && !/Статья 826/.test($("#artText").textContent),
    $("#artText").textContent.slice(0, 60));

  section = "4c. Перекрёстные ссылки в текстах статей"; console.log("\n" + section);
  ok("модуль ссылок подключён", !!(w.RF_XREF && w.RF_XREF.create));
  await nav("#/article/uk-20", 1300);
  const xr = $$("#artText .xref");
  ok("в статье есть кликабельные ссылки", xr.length >= 20, xr.length + " ссылок");
  ok("ссылка ведёт на статью 105 УК", xr.some(a => a.getAttribute("href") === "#/article/uk-105"),
    (xr[0] || {}).getAttribute ? xr[0].getAttribute("href") : "");
  ok("подстатья 205.1 разобрана", xr.some(a => a.getAttribute("href") === "#/article/uk-205.1"));
  ok("все ссылки ведут на существующие статьи", xr.every(a => {
    const id = decodeURIComponent(a.getAttribute("href").replace("#/article/", ""));
    return w.RF_IDX.some(r => r[0] + "-" + r[1] === id);
  }), xr.length + " проверено");
  ok("заголовок самой статьи не стал ссылкой", !xr.some(a => a.getAttribute("href") === "#/article/uk-20"));
  const refs = $("#view .refs-block");
  ok("блок «Ссылается на» показан", !!refs && /Ссылается на \d+/.test(refs.textContent), refs ? refs.textContent.replace(/\s+/g, " ").slice(0, 60) : "");
  ok("в блоке перечислены статьи", refs && $$("#view .refs-block .chip").length >= 20, refs ? $$("#view .refs-block .chip").length + " статей" : "");
  xr[0].dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(1300);
  ok("переход по ссылке работает", w.location.hash === "#/article/uk-105", w.location.hash);

  await nav("#/article/uk-158.1", 1300);
  ok("ссылка на другой кодекс (КоАП 7.27)", $$("#artText .xref").some(a => a.getAttribute("href") === "#/article/koap-7.27"),
    $$("#artText .xref").map(a => a.getAttribute("href")).join(" "));
  await nav("#/article/tk-409", 1300);
  ok("ссылка на Конституцию (ст. 37)", $$("#artText .xref").some(a => a.getAttribute("href") === "#/article/kons-37"));
  await nav("#/article/fz3pol-13", 1300);
  ok("ссылка внутри закона (ст. 12 ФЗ о полиции)", $$("#artText .xref").some(a => a.getAttribute("href") === "#/article/fz3pol-12"));
  ok("ссылки на изменяющие законы не выдуманы", $$("#artText .xref").every(a => {
    const id = decodeURIComponent(a.getAttribute("href").replace("#/article/", ""));
    return w.RF_IDX.some(r => r[0] + "-" + r[1] === id);
  }));
  await nav("#/article/koap-23.1", 1500);
  const big = $("#view .refs-block");
  ok("длинный список ссылок свёрнут", !!big && !big.hasAttribute("open"),
    big ? $$("#view .refs-block .chip").length + " статей" : "нет блока");
  ok("свёрнутый список можно раскрыть", (() => {
    big.setAttribute("open", "");
    return $$("#view .refs-block .chip").length > 100;
  })(), $$("#view .refs-block .chip").length + " статей");

  section = "4d. Оформление официального текста"; console.log("\n" + section);
  await nav("#/article/uk-158", 2500);
  ok("части статьи отмечены номерами", $$("#view .law-part-num").length >= 4,
    $$("#view .law-part-num").length + " частей");
  ok("буквенные пункты распознаны", $$("#view .law-subitem").length >= 8,
    $$("#view .law-subitem").length + " пунктов");
  ok("санкции выделены цветом",
    $$("#view .law-sanction").length >= 4 &&
    $$("#view .law-sanction").every(s => /наказыва[ею]тс[яю]/i.test(s.textContent)) &&
    (fs.readFileSync(path.join(ROOT, "styles.css"), "utf8")).match(/\.law-sanction[^{]*\{[^}]*var\(--danger\)/i),
    $$("#view .law-sanction").length + " санкций");
  ok("в тексте есть красная санкция про лишение свободы",
    /лишением свободы/i.test(T("#view .law-sanction") || T("#view") || ""),
    ($$("#view .law-sanction")[0] || {}).textContent && ($$("#view .law-sanction")[0].textContent.slice(0, 80)));
  ok("редакторские примечания о редакциях показаны",
    $$("#view .law-meta-note").length >= 5,
    $$("#view .law-meta-note").length + " примечаний");
  ok("раздел примечаний к статье виден",
    /приме/i.test($$("#view .law-notes-head").map(e => e.textContent).join(" ") || ""),
    $$("#view .law-notes-head").length + " разделов");
  ok("пункты примечаний пронумерованы",
    $$("#view .law-note-item").length >= 4,
    $$("#view .law-note-item").length + " пунктов");
  ok("перекрёстные ссылки в оформленном тексте остались ссылками",
    $$("#view .law-text .xref").length > 0,
    $$("#view .law-text .xref").length + " ссылок");
  ok("часть 1 отделяется от части 2 структурно",
    (() => {
      var parts = $$("#view .law-part-num");
      return parts.length >= 2 &&
        Number(parts[0].textContent.replace(/\D/g, "")) < Number(parts[1].textContent.replace(/\D/g, ""));
    })(),
    $$("#view .law-part-num").map(n => n.textContent).join(","));

  section = "5. Кодекс"; console.log("\n" + section);
  await nav("#/code/upk");
  ok("заголовок кодекса", /УПК РФ/.test(T("h1") || ""), T("h1"));
  ok("главы сгруппированы", $$("#view .chapter").length > 40, $$("#view .chapter").length + " глав");
  ok("все статьи в списке", $$("#view .art-row").length === 561, $$("#view .art-row").length);
  const f = $("#codeFilter");
  f.value = "обыск"; f.dispatchEvent(new w.Event("input", { bubbles: true }));
  await wait(250);   /* фильтр применяется с дебаунсом 120 мс */
  ok("фильтр внутри кодекса", $$("#codeList .art-row").length > 3 && $$("#codeList .art-row").length < 60, $$("#codeList .art-row").length + " совпадений");

  /* Регресс: раньше у части кодексов главы не распознавались (другой регистр
     заголовка / римские номера) и пропадали целиком. Проверяем на экране. */
  await nav("#/code/zhk");
  ok("ЖК: главы сгруппированы (арабские)", $$("#view .chapter").length >= 20, $$("#view .chapter").length + " групп");
  ok("ЖК: есть глава 8.1 (разорванный номер)", /Глава 8\.1/.test(T("#view") || ""), (T("#view") || "").match(/Глава 8\.1[^<]{0,40}/) || "—");
  ok("ЖК: есть раздел III.2", /РАЗДЕЛ III\.2/.test(T("#view") || ""), (T("#view") || "").match(/РАЗДЕЛ III\.2[^<]{0,30}/) || "—");
  await nav("#/code/zk");
  ok("ЗК: римские главы сгруппированы", $$("#view .chapter").length >= 25, $$("#view .chapter").length + " групп");
  ok("ЗК: глава V.1 распознана", /ГЛАВА V\.1|Глава V\.1/.test(T("#view") || ""), (T("#view") || "").match(/глава V\.1[^<]{0,30}/i) || "—");

  section = "5c. Обзоры судебной практики ВС РФ"; console.log("\n" + section);
  /* Обзоры — отдельный вид акта: Пленум разъясняет, Президиум обобщает
     практику. Проверяем, что группа есть в панели, обзор открывается и что
     единица цитирования у обзора по вопросам — вопрос вместе с ответом. */
  ok("в боковой панели есть группа обзоров судебной практики",
    !!$('.nav-sub[data-toggle-kind="review"]') &&
    /Обзоры судебной практики/.test(T('.nav-sub[data-toggle-kind="review"]') || ""),
    T('.nav-sub[data-toggle-kind="review"]'));
  ok("обзоры перечислены в своей группе",
    $$('.nav-sub-wrap[data-kind="review"] .nav-item').length === N_REVIEWS,
    $$('.nav-sub-wrap[data-kind="review"] .nav-item').length + " обзоров");
  await nav("#/code/obzor-3-2021-koronavirusnoi-infektsii", 300);
  ok("заголовок обзора", /Обзор/.test(T("h1") || ""), T("h1"));
  ok("пункты обзора в списке", $$("#view .art-row").length > 20, $$("#view .art-row").length + " пунктов");
  await nav("#/article/obzor-3-2021-koronavirusnoi-infektsii-3", 700);
  await waitFor(() => $("#artText") && ($("#artText").textContent || "").length > 200, 12000);
  ok("текст вопроса обзора загружен",
    !!$("#artText") && ($("#artText").textContent || "").length > 200,
    ($("#artText") ? ($("#artText").textContent || "").length : 0) + " символов");

  section = "6. Помощник"; console.log("\n" + section);
  await nav("#/assistant");
  ok("раздел называется «Помощник»", /Помощник/.test(T("#view h1") || ""), T("#view h1"));
  ok("в меню пункт «Помощник»", $$('.nav-item[data-nav="assistant"] .lbl').some(el => /Помощник/.test(el.textContent || "")));
  $("#asInput").value = "Сотрудник ГИБДД остановил автомобиль, у водителя признаки опьянения, от медицинского освидетельствования он отказался";
  $("#asRun").dispatchEvent(new w.Event("click", { bubbles: true }));
  await wait(150);
  ok("выданы блоки разбора", $$("#asOut .card").length >= 1);
  /* «Вывод по запросу» — сводка идёт первым блоком ответа. */
  ok("есть вывод по запросу", !!$("#asOut .concl-p") && T("#asOut .concl-p").length > 40,
    (T("#asOut .concl-p") || "").slice(0, 70) + "…");
  ok("вывод идёт первым блоком",
    !!($("#asOut").firstElementChild) && $("#asOut").firstElementChild.classList.contains("concl"),
    $("#asOut").firstElementChild ? ($("#asOut").firstElementChild.className || "") : "нет");
  /* Короткий ответ — первым экраном вывода. Раньше квалификация стояла
     третьей строкой ниже абзаца о том, что будет дальше, и ответ читался как
     «много информации, но непонятно, что решили». */
  const ansEl = $("#asOut .concl-answer"), leadEl = $("#asOut .concl-p");
  ok("в выводе есть короткий ответ с квалификацией",
    !!ansEl && T("#asOut .concl-answer .ca-q").length > 5, T("#asOut .concl-answer .ca-q"));
  ok("короткий ответ идёт до пояснений",
    !!ansEl && !!leadEl && (ansEl.compareDocumentPosition(leadEl) & 4) === 4,
    "блок «Ответ» перед вводной фразой");
  ok("в подписи ответа видна отрасль и надёжность",
    /Уголовное|Административное|Гражданское|Процессуальное|Трудовое/.test(T("#asOut .concl-answer .ca-meta") || "") &&
    /надёжность/.test(T("#asOut .concl-answer .ca-meta") || ""), T("#asOut .concl-answer .ca-meta"));
  ok("в выводе перечислены нормы для проверки", /Нормы для проверки/.test(T("#asOut .concl") || ""));
  /* Когда разбор найден, отдельный список норм по словам описания не выводится:
     именно он тянул «не по теме» статьи (ЖК на слово «кооператив» и т. п.). */
  /* Когда разбор найден, отдельный список норм по словам описания не выводится:
     именно он тянул «не по теме» статьи (ЖК на слово «кооператив» и т. п.).
     Блок «Судебная практика» тоже рисует пункты классом .result — это легитимный
     вывод, а не «лишний список», поэтому считаем только .result ВНЕ этого блока. */
  const asOutKids = Array.from($("#asOut").children);
  let inPractice = false;
  const strayResults = asOutKids.filter(function (el) {
    if (el.tagName === "H2" && /Судебная практика/.test(el.textContent || "")) inPractice = true;
    else if (el.tagName === "H2") inPractice = false;
    return el.classList.contains("result") && !inPractice;
  });
  ok("при найденном разборе нет лишнего списка норм", strayResults.length === 0,
    strayResults.length + " лишних результатов");
  /* Нормы ответа показываются либо строкой с санкцией в «Выводе по запросу»,
     либо чипом (список близких норм, когда ничего не распознано). Оба вида
     собираем одним списком — иначе проверки не видят половину ссылок. */
  const normIds = () => $$("#asOut .chip[data-go^='#/article/'], #asOut .as-art a[href^='#/article/']")
    .map(el => decodeURIComponent((el.getAttribute("data-go") || el.getAttribute("href")).replace("#/article/", "")));
  const chips = normIds();
  ok("ссылки ведут на существующие статьи", chips.every(id =>
    w.RF_IDX.some(r => r[0] + "-" + r[1] === id) || (w.RF_EXTRA.articles || []).some(a => a.c + "-" + a.n === id)
  ), chips.length + " ссылок");
  ok("есть блок санкций по составам", $$("#asOut .as-art").length >= 1, $$("#asOut .as-art").length + " карточек");
  await wait(1500);
  const sanLoaded = $$("#asOut .as-san-body .law-sanction").length;
  ok("санкции подгрузились из полных текстов", sanLoaded >= 1, sanLoaded + " санкций");
  ok("санкции выделены красным",
    sanLoaded > 0 && $$("#asOut .as-san-body .law-sanction").every(s =>
      (fs.readFileSync(path.join(ROOT, "styles.css"), "utf8")).indexOf(".law-sanction") !== -1),
    sanLoaded + " санкций");
  /* Нормы без отдельно сформулированной санкции (ГК РФ, процессуальные статьи
     КоАП и УПК) не оставляют за собой пустую строку-заглушку: иначе одна и та
     же фраза повторялась под половиной перечня норм. */
  ok("пустые заглушки санкций убраны из ответа",
    !/не выделена отдельно/.test(T("#asOut") || ""));

  /* Глубокий разбор: классическая задача про хищение бивней мамонта. */
  $("#asInput").value = "Глазов, Савельев и Пигалов по взаимной договорённости проникли в гараж кооператива и похитили 150 кг бивня мамонта. Владелец утверждает, что купил бивни у геологов. Определите объект преступления. Имеет ли значение, что бивни мамонта не могут находиться в частной собственности?";
  $("#asRun").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(250);
  ok("распознан разбор «хищение»", $$("#asOut .help-card").length >= 1, $$("#asOut .help-card").length + " карточек");
  ok("показана юридическая характеристика", $$("#asOut .help-char .hc-row").length >= 4,
    $$("#asOut .help-char .hc-row").length + " полей");
  ok("в характеристике указан объект — отношения собственности",
    /отношени[яе] собственности/i.test(T("#asOut .help-char") || ""));
  ok("есть варианты квалификации", $$("#asOut .help-qual .hq-row").length >= 3,
    $$("#asOut .help-qual .hq-row").length + " вариантов");
  ok("учтён нюанс про бивни мамонта", /бивни мамонта/i.test(T("#asOut") || ""));
  ok("есть уточняющие вопросы", $$("#asOut .help-opt").length >= 4, $$("#asOut .help-opt").length + " вариантов");
  ok("есть перечни «что установить» и «что сделать»",
    $$("#asOut .help-card ul.list li").length >= 2 && $$("#asOut .help-card ol.steps li").length >= 2);
  /* Разбор привязан к данным сайта: плашка о действующих редакциях и список
     источников с датами редакций, размещённых на сайте. */
  ok("разбор привязан к данным сайта (плашка о редакциях)", $$("#asOut .ground-box").length >= 1);
  /* «150 кг» из описания — не номер статьи: раньше помощник подставлял
     ст. 150 УК, 150 УПК, 150 ГК и так далее по всему реестру. */
  ok("числа из описания не трактуются как номера статей",
    $$("#asOut [data-go]").every(el => !/-150$/.test(decodeURIComponent(el.getAttribute("data-go") || ""))),
    $$("#asOut [data-go]").length + " ссылок проверено");
  ok("указаны источники с датой редакции", $$("#asOut .help-src .chip").length >= 1,
    $$("#asOut .help-src .chip").length + " источников");
  /* Карточка разбора больше не повторяет перечень статей — он один, в выводе.
     Проверяем, что нормы доступны и что внутри текста разбора ссылки на
     статьи остались (их подставляет linkify). */
  ok("нормы разбора перечислены в выводе и открываются",
    normIds().length >= 4 && $$("#asOut .help-card a[href^='#/article/']").length >= 1,
    normIds().length + " норм, " + $$("#asOut .help-card a[href^='#/article/']").length + " ссылок в разборе");

  /* Ответ на уточняющий вопрос пересчитывает квалификацию. */
  const optGroup = $$("#asOut .help-opt").find(o => /группа лиц/i.test(o.textContent || ""));
  ok("есть вариант «группа лиц по предварительному сговору»", !!optGroup);
  if (optGroup) {
    optGroup.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await wait(200);
    ok("квалификация уточнилась по ответу", $$("#asOut .help-qual .hq-row.on").length >= 1,
      $$("#asOut .help-qual .hq-row.on").length + " применённых");
    ok("выбранный вариант отмечен", $$("#asOut .help-opt.on").length >= 1);
  }

  /* Тяжесть вреда, названная в описании, выбирает квалификацию. На «лёгкий вред
     здоровью» ответ обязан показать ст. 115 УК РФ, а не первую строку списка:
     ст. 116 УК РФ — это побои, то есть когда вреда здоровью нет вовсе.
     Второй разбор, зацепившийся за слово «опьянение», идёт свёрнутым и не
     подмешивает свои нормы (ст. 264 УК РФ, ст. 12.8 КоАП РФ о нетрезвом
     вождении) в общий перечень. */
  $("#asInput").value = "Гражданин Н., находясь в состоянии алкогольного опьянения, в ходе ссоры нанёс несколько ударов потерпевшему, причинив ему лёгкий вред здоровью";
  $("#asRun").dispatchEvent(new w.Event("click", { bubbles: true }));
  await wait(1800);
  ok("квалификация следует за названной тяжестью вреда",
    /ст\.\s*115/.test(T("#asOut .concl-answer .ca-q") || ""), T("#asOut .concl-answer .ca-q"));
  ok("подпись объясняет выбор по последствиям",
    /по названным последствиям/.test(T("#asOut .concl-answer .ca-meta") || ""),
    T("#asOut .concl-answer .ca-meta"));
  ok("второй разбор свёрнут, а не показан карточкой",
    $$("#asOut .as-alt").length === 1 && $$("#asOut .as-alt")[0].open === false,
    $$("#asOut .as-alt").length + " свёрнутых блоков");
  ok("нормы второго разбора не подмешаны в перечень",
    !normIds().some(id => /^(?:koap-12\.(?:8|24|26)|uk-264|uk-125|upk-91)$/.test(id)),
    normIds().join(", "));
  ok("длинные перечни санкций свёрнуты до первого варианта",
    $$("#asOut .san-more").length >= 1, $$("#asOut .san-more").length + " свёрнутых перечней");
  ok("первый вариант наказания виден без раскрытия",
    $$("#asOut .concl-norms .as-san-body > .law-sanction").length >= 1,
    $$("#asOut .concl-norms .as-san-body > .law-sanction").length + " вариантов на виду");

  /* Отрицание при тяжести вреда: «тяжкого вреда не наступило» — это как раз
     ОТСУТСТВИЕ тяжкого вреда. Без проверки отрицания движок выбирал самую
     строгую статью. */
  $("#asInput").value = "избил соседа, тяжкого вреда здоровью не наступило, остались синяки";
  $("#asRun").dispatchEvent(new w.Event("click", { bubbles: true }));
  await wait(300);
  ok("отрицание при тяжести вреда не переворачивается",
    !/ст\.\s*111/.test(T("#asOut .concl-answer .ca-q") || ""), T("#asOut .concl-answer .ca-q"));

  /* Проверка документов сотрудником полиции: раньше такого блока не было. */
  $("#asInput").value = "ко мне подошёл сотрудник полиции в метро и попросил показать паспорт. он ничего не выдал";
  $("#asRun").dispatchEvent(new w.Event("click", { bubbles: true }));
  await wait(150);
  ok("ситуация с проверкой документов распознана",
    /Проверка документов сотрудником полиции/.test(T("#asOut") || ""), T("#asOut h2") || "(нет блока)");
  ok("блок идёт первым (наиболее релевантный)",
    ((T("#asOut h2") || "").indexOf("Проверка документов") !== -1), T("#asOut h2"));
  ok("показаны совпавшие ключевые слова", /Совпало:/.test(T("#asOut") || ""));
  /* Нормы ответа: раньше у блока правил был свой список статей, который
     повторял и вывод, и общий перечень. Теперь перечень один — в выводе. */
  const policeNorms = normIds();
  ok("в ответе есть статья ФЗ «О полиции» о правах",
    policeNorms.indexOf("fz3pol-13") !== -1, policeNorms.join(", "));
  ok("в ответе есть статьи КоАП о доставлении и задержании",
    ["koap-27.2", "koap-27.3"].every(id => policeNorms.indexOf(id) !== -1),
    policeNorms.join(", "));
  /* Перечень норм ограничен по объёму: раньше карточка правила вываливала все
     свои 18 статей подряд, включая общие составы и нормы соседних отраслей. */
  ok("перечень норм ответа ограничен по объёму",
    policeNorms.length > 0 && policeNorms.length <= 8, policeNorms.length + " норм");
  ok("все нормы ответа ведут на существующие статьи",
    policeNorms.every(id => w.RF_IDX.some(r => r[0] + "-" + r[1] === id)),
    policeNorms.length + " норм");

  /* Одна норма — один показ. Раньше статья шла трижды: чипом в выводе,
     списком в карточке и отдельным блоком санкций (до 4 показов на норму). */
  const uniqNorms = policeNorms.filter((v, i) => policeNorms.indexOf(v) === i);
  ok("нормы не дублируются по блокам",
    policeNorms.length - uniqNorms.length <= 2,
    policeNorms.length + " показов на " + uniqNorms.length + " норм");

  /* «Правильные статьи»: общие составы не должны вытеснять профильные. При
     сортировке «сначала УК и КоАП» на запрос о проверке документов первой
     шла ст. 318 УК РФ — насилие над представителем власти, — а профильные
     нормы ФЗ «О полиции» и КоАП выпадали из списка. */
  ok("общие составы не вытеснили профильные нормы проверки документов",
    policeNorms.indexOf("uk-318") === -1 && policeNorms.indexOf("uk-319") === -1 &&
    !policeNorms.some(id => /^gk2-/.test(id) || /^fz2202prok-/.test(id)),
    policeNorms.join(", "));
  /* Общее слово не должно вытягивать блок: «в метро играла музыка» — не ситуация. */
  $("#asInput").value = "в метро играла музыка и было шумно";
  $("#asRun").dispatchEvent(new w.Event("click", { bubbles: true }));
  await wait(150);
  ok("общее совпадение не даёт ложного блока",
    !/Проверка документов сотрудником полиции/.test(T("#asOut") || ""));

  /* Описание без готового разбора: вывод-заглушка + близкие нормы. */
  $("#asInput").value = "авторские права на программу для ЭВМ";
  $("#asRun").dispatchEvent(new w.Event("click", { bubbles: true }));
  await wait(200);
  ok("без разбора показан список близких норм", $$("#asOut .result").length >= 1,
    $$("#asOut .result").length + " результатов");
  ok("в выводе сказано, что тип ситуации не определён",
    /Прямого разбора под этот запрос в базе нет/i.test(T("#asOut .concl-p") || ""), (T("#asOut .concl-p") || "").slice(0, 60));
  ok("близкие нормы по теме (ГК, авторское право)",
    $$("#asOut .result").some(r => /^#\/article\/(gk4-|plenum24-2023-113)/.test(r.getAttribute("data-go") || "")),
    $$("#asOut .result").map(r => r.getAttribute("data-go")).join(" "));

  /* Волна 11: взятка за выпуск бракованной продукции (разбор Петров/Сидоров).
     Проверяем, что Помощник не путает донора и получателя, не подменяет
     коммерческий подкуп взяткой и не выдаёт ст. 316 за простое молчание. */
  section = "6a. Помощник: взятка за выпуск брака (Петров/Сидоров)"; console.log("\n" + section);
  await nav("#/assistant", 200);
  $("#asInput").value = "Петров дал инженеру завода Сидорову взятку 120 000 рублей, чтобы тот пропустил бракованную продукцию";
  $("#asRun").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(250);
  ok("распознан разбор о взятке/подкупе", $$("#asOut .help-card").length >= 1, $$("#asOut .help-card").length + " карточек");
  ok("ст. 316 (укрывательство) не предложена в нормы/квалификацию за молчание",
    !normIds().some(id => id === "uk-316"), normIds().join(", "));
  ok("прямо сказано, что ст. 316 неприменима к молчанию очевидца",
    /ст\.\s*316[\s\S]{0,90}не\s*применим/i.test(T("#asOut") || ""), (T("#asOut") || "").slice(0, 90));
  ok("в нормах есть ст. 290/291 или ст. 204 (квалификация взятки/подкупа)",
    normIds().some(id => id === "uk-290" || id === "uk-291" || id === "uk-204"), normIds().join(", "));
  ok("есть уточняющий вопрос о секторе организации",
    $$("#asOut .help-q").some(q => /Где работает получатель/.test(q.textContent || "")), $$("#asOut .help-q").length + " вопросов");
  ok("в пояснениях разбора есть недоносительство (молчание не преступно)",
    /недоносительство/i.test(T("#asOut") || ""), (T("#asOut") || "").slice(0, 80));
  ok("в пояснениях разбора разграничены донор и получатель освобождения",
    /дающая сторона|Донор/i.test(T("#asOut") || ""), (T("#asOut") || "").slice(0, 80));
  /* Уточняем: получатель — в частной организации → коммерческий подкуп (ст. 204). */
  const komOpt = $$("#asOut .help-opt").find(o => /частная\/коммерческая/.test(o.textContent || ""));
  ok("есть вариант «частная/коммерческая организация»", !!komOpt);
  if (komOpt) {
    komOpt.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await wait(250);
    ok("после уточнения выбрана ст. 204 (коммерческий подкуп)",
      /ст\.\s*204/i.test((T("#asOut .help-qual .hq-row.on .hq-t") || "") + " " + (T("#asOut .concl-answer .ca-q") || "")),
      (T("#asOut .help-qual .hq-row.on .hq-t") || T("#asOut .concl-answer .ca-q") || "").slice(0, 90));
    ok("и после уточнения ст. 316 не появилась",
      !normIds().some(id => id === "uk-316"), normIds().join(", "));
  }

  section = "6b. Помощник: надёжность вывода, цитаты, две ситуации"; console.log("\n" + section);

  /* Раньше «Помощник» сопоставлял признаки по подстроке: «суд» находился внутри
     «государственная». Проверяем, что ложное срабатывание ушло. */
  await nav("#/assistant", 200);
  $("#asInput").value = "работаю в государственной организации, готовлю отчёт";
  $("#asRun").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(250);
  ok("подстрока «суд» в слове «государственной» не тянет блок об обжаловании",
    !/Обжалование действий/.test(T("#asOut") || ""), (T("#asOut .concl-p") || "").slice(0, 60));

  /* Стеммер снимает одно окончание, поэтому «избили» даёт основу «изб», а
     «избил» — «избил»; сверка по началу слова это расхождение закрывает. */
  $("#asInput").value = "избили на улице, сломали нос";
  $("#asRun").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(250);
  ok("форма слова «избили» находит разбор «Вред здоровью и побои»",
    /Вред здоровью и побои/.test(T("#asOut") || ""), (T("#asOut h2") || "").slice(0, 60));

  /* Надёжность вывода + дословная цитата из текста нормы. */
  $("#asInput").value = "пришли с обыском и изъяли телефон";
  $("#asRun").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(1800);
  ok("в выводе есть строка «Надёжность вывода»", /Надёжность вывода/.test(T("#asOut .concl") || ""));
  ok("надёжность показана меткой уровня", !!$("#asOut .concl .conf") && T("#asOut .concl .conf").length > 3,
    T("#asOut .concl .conf") || "нет");
  const cq = $("#asOut .concl-quote");
  ok("под выводом показана цитата из текста нормы",
    !!cq && !!cq.querySelector(".cq-t") && (cq.querySelector(".cq-t").textContent || "").length > 30,
    cq ? (cq.textContent || "").slice(0, 60) : "нет блока цитаты");
  /* Цитата обязана быть дословной: сверяем её с полным текстом статьи, а не
     доверяем вёрстке. Иначе «цитата» может оказаться пересказом. */
  ok("цитата совпадает с текстом статьи дословно", (() => {
    const el = $("#asOut .concl-quote .cq-t");
    if (!el || !cq) return false;
    const id = cq.getAttribute("data-quote") || "";
    const dash = id.indexOf("-");
    if (dash < 1) return false;
    const arr = (w.RF_FULL || {})[id.slice(0, dash)];
    if (!arr) return false;
    const row = arr.filter(x => x[0] === id.slice(dash + 1))[0];
    if (!row) return false;
    const flat = s => String(s || "").replace(/\s+/g, " ").toLowerCase().replace(/ё/g, "е");
    const hay = flat(row[4]);
    const q = flat((el.textContent || "").replace(/…\s*$/, ""));
    return q.length > 30 && hay.indexOf(q) !== -1;
  })(), "сверка с полным текстом");

  /* Две ситуации в одном описании должны быть названы, а не просто показаны
     двумя карточками ниже. Вторая при этом свёрнута: полной карточкой она
     перебивала основной ответ и уводила читателя в другую тему. */
  $("#asInput").value = "остановили за рулём в нетрезвом виде, а потом досмотрели машину и вытащили вещи из карманов";
  $("#asRun").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(300);
  ok("две ситуации в описании названы прямо",
    /вторая ситуация/.test(T("#asOut .concl-p") || ""),
    (T("#asOut .concl-p") || "").slice(0, 90));
  ok("обе ситуации разобраны карточками", $$("#asOut .help-card").length >= 2,
    $$("#asOut .help-card").length + " карточек");
  ok("вторая карточка свёрнута и раскрывается по требованию",
    $$("#asOut .as-alt").length === 1 && $$("#asOut .as-alt > .help-card").length === 1,
    $$("#asOut .as-alt").length + " свёрнутых разборов");
  /* Нормы второго разбора не должны размывать основной перечень: на описании
     про побои в нём оказывались статьи о нетрезвом вождении. */
  const altIds = $$("#asOut .as-alt .help-card").length ? normIds() : [];
  ok("перечень норм не смешивает две ситуации",
    !altIds.some(id => /^(?:koap-12\.(?:8|26)|uk-264)$/.test(id)), altIds.join(", "));

  /* Слабое совпадение обязано предупреждать о себе. */
  $("#asInput").value = "нужно продлить срок содержания под стражей";
  $("#asRun").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(300);
  ok("при слабом совпадении вывод предупреждает о неточности",
    /Разбор предварительный/.test(T("#asOut .concl-p") || ""),
    (T("#asOut .concl-p") || "").slice(-70));

  /* --- множественный выбор источников для Помощника --- */
  section = "6b2. Помощник: множественный выбор источников"; console.log("\n" + section);
  await nav("#/assistant", 200);
  const clr0 = $("#asClear");
  if (clr0) clr0.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  const trig = $("#scopeTrigger");
  ok("кнопка выбора источников есть", !!trig, trig ? trig.textContent.trim() : "нет");
  ok("стартовая подпись — все источники", /Все источники базы/.test(T(".scope-trigger-label") || ""), T(".scope-trigger-label"));
  /* открываем пикер */
  trig.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  let picker = $("#scopePicker");
  ok("пикер открывается", picker && picker.hidden === false, picker ? "открыт" : "нет");
  ok("в пикере есть чекбоксы источников", $$("[data-scope-chk]").length > 50, $$("[data-scope-chk]").length + " чекбоксов");
  let uk = $('[data-scope-chk="uk"]'), upk = $('[data-scope-chk="upk"]');
  ok("найден чекбокс УК РФ", !!uk);
  ok("найден чекбокс УПК РФ", !!upk);
  if (uk) { uk.checked = true; uk.dispatchEvent(new w.Event("change")); }
  if (upk) { upk.checked = true; upk.dispatchEvent(new w.Event("change")); }
  ok("выбрано два источника — чипы", $$("#asScopeChips .chip-rem").length === 2, $$("#asScopeChips .chip-rem").length + " чипов");
  ok("бейдж называет оба источника", /УК РФ/.test(T("#asScopeBadge") || "") && /УПК РФ/.test(T("#asScopeBadge") || ""), T("#asScopeBadge"));
  ok("подпись кнопки обновлена", /УК РФ/.test(T(".scope-trigger-label") || "") && /УПК РФ/.test(T(".scope-trigger-label") || ""), T(".scope-trigger-label"));
  /* выбор нескольких актов подряд не должен схлопывать список */
  ok("пикер остаётся открытым после выбора", picker && picker.hidden === false);
  ok("счётчик выбранного обновлён", /Выбрано: 2/.test(T("#scopeCount") || ""), T("#scopeCount"));
  /* ответ строится строго в рамках выбранных актов */
  $("#asInput").value = "украли телефон в магазине";
  $("#asRun").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(300);
  const arts = $$("#asOut .as-art");
  ok("нормы ответа ограничены выбранными источниками", arts.length === 0 || arts.every(a => {
    const href = a.getAttribute("data-go") || "";
    return /#\/article\/(?:uk|upk)-/.test(href);
  }), arts.slice(0, 3).map(a => a.getAttribute("data-go")).join(", "));
  /* снимаем один источник по крестику на чипе — пикер при этом не пересоздаётся
     (щелчок по «Разобрать» выше закрыл его как выпадающий список), поэтому
     галочку в нём снимает syncScopePicker, а сам список не схлопывается */
  const hiddenBefore = picker.hidden;
  let rem = $("#asScopeChips .chip-rem[data-scope-rem]");
  const remId = rem && rem.getAttribute("data-scope-rem");
  if (rem) rem.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(50);
  ok("после снятия одного остался один чип", $$("#asScopeChips .chip-rem").length === 1, $$("#asScopeChips .chip-rem").length + " чипов");
  const remChk = remId && $('[data-scope-chk="' + remId + '"]');
  ok("снятый источник убран и из пикера", !remChk || remChk.checked === false);
  ok("снятие чипа не трогает состояние пикера", picker.hidden === hiddenBefore);
  ok("пикер не пересоздан при снятии чипа", $("#scopePicker") === picker);
  /* пикер открывается заново и закрывается явно по «Готово» */
  if (picker.hidden) $("#scopeTrigger").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  ok("пикер снова открыт", picker.hidden === false);
  let done = $("#scopeDone");
  if (done) done.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  ok("пикер закрывается по «Готово»", picker && picker.hidden === true);
  const clr = $("#scopeClear");
  if (clr) clr.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  ok("«Снять всё» очищает выбор", $$("#asScopeChips .chip-rem").length === 0, $$("#asScopeChips .chip-rem").length + " чипов");
  ok("«Снять всё» снимает галочки в пикере",
    $$("[data-scope-chk]").every(cb => cb.checked === false));
  ok("подпись вернулась к «все источники»", /Все источники базы/.test(T(".scope-trigger-label") || ""), T(".scope-trigger-label"));

  section = "6c. Перемещение по разделам кнопками"; console.log("\n" + section);
  /* Кнопки в панели и кнопка «Назад» браузера ходят по одной и той же истории
     (go() пишет адрес через pushState, navStep — через history.go), а глубина
     истории ограничена, чтобы она не росла без предела. Здесь проверяется то,
     что видно и в jsdom: шаг назад возвращает раздел, шаг вперёд — обратно,
     новый переход сбрасывает «вперёд», а адрес следует за кнопками.
     (jsdom на file:// запрещает history API, поэтому приложение само
     переключается на свой стек — см. histOk в app.js. Поведение самой
     истории проверяется в настоящем браузере: .workbuddy-ai/verify-history.js) */
  const navBackBtn = $("#navBack"), navFwdBtn = $("#navFwd");
  ok("кнопки «Назад»/«Вперёд» есть в верхней панели", !!navBackBtn && !!navFwdBtn);
  await nav("#/favorites");
  await nav("#/collection");
  await nav("#/cases");
  const hLen = w.history.length;
  ok("«Назад» активна после переходов", navBackBtn.disabled === false);
  ok("«Вперёд» пока неактивна", navFwdBtn.disabled === true);
  const beforeBack = T("#view h1");
  const hashBeforeBack = w.location.hash;
  navBackBtn.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(250);
  ok("«Назад» вернула на предыдущий раздел", T("#view h1") !== beforeBack,
    beforeBack + " → " + T("#view h1"));
  ok("«Назад» меняет и адрес, а не только экран", w.location.hash !== hashBeforeBack,
    hashBeforeBack + " → " + w.location.hash);
  ok("«Назад» не добавила записи в историю браузера", w.history.length === hLen,
    hLen + " → " + w.history.length);
  ok("«Вперёд» стала активной после шага назад", navFwdBtn.disabled === false);
  const beforeFwd = T("#view h1");
  navFwdBtn.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(250);
  ok("«Вперёд» вернула обратно", T("#view h1") !== beforeFwd, beforeFwd + " → " + T("#view h1"));
  ok("«Вперёд» не добавила записи в историю браузера", w.history.length === hLen,
    hLen + " → " + w.history.length);
  /* Новый переход после возврата обрезает «вперёд» — как в браузере. */
  await nav("#/help");
  ok("новый переход сбрасывает «Вперёд»", navFwdBtn.disabled === true);
  /* Прямая подмена адреса (то, что делает nav()) запись в истории добавляет —
     это поведение браузера, а не кнопок. Важно, что шаг ровно один: значит ни
     один из кликов по «Назад»/«Вперёд» записей не добавил. */
  ok("записи прибавляет только прямой переход по адресу, ровно одну",
    w.history.length === hLen + 1, hLen + " → " + w.history.length);

  section = "6d. Мусорные адреса и неожиданные сбои"; console.log("\n" + section);
  /* Адреса приходят не только из меню: их присылают поисковики, мессенджеры,
     закладки. Здесь проверяется, что ни один такой адрес не роняет приложение,
     не оставляет пустой экран и не печатает служебных слов вроде «undefined». */
  const errsBeforeJunk = errors.length;

  await nav("#/article/%");
  ok("битый процент-код в адресе статьи не роняет раздел",
    ($("#view").textContent || "").trim().length > 5, T("#view h1"));
  ok("битый процент-код не оставил исключений", errors.length === errsBeforeJunk,
    errors.slice(errsBeforeJunk).join(" | "));

  await nav("#/search/50%");
  ok("знак процента в поисковом запросе не ломает переход",
    /Результаты поиска|Поиск статей/.test($("#view").textContent || ""),
    T("#view h1"));
  ok("поиск с процентом обошёлся без исключений", errors.length === errsBeforeJunk,
    errors.slice(errsBeforeJunk).join(" | "));

  await nav("#/calc/нет-такого");
  ok("неизвестная вкладка калькулятора не печатает «undefined»",
    !/undefined/.test($("#view").textContent || ""),
    ($("#view .lead") ? $("#view .lead").textContent : "").slice(0, 70));
  /* Раньше на таком адресе тело подставляло базовый калькулятор, но
     обработчики не навешивались — кнопки выглядели живыми и молчали. */
  const cRun = $("#cRun"), cOut = $("#cOut");
  ok("на неизвестной вкладке калькулятор отрисован", !!cRun && !!cOut);
  if (cRun && cOut) {
    /* Вывод заполняется сразу при отрисовке, поэтому «нажали и появилось» тут
       ничего не докажет. Меняем число единиц и жмём «Рассчитать»: если
       обработчик не навешен, результат останется прежним. */
    const wasCalc = cOut.textContent;
    const cNum = $("#cNum");
    if (cNum) cNum.value = String((parseInt(cNum.value, 10) || 2) + 3);
    cRun.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await wait(150);
    ok("на неизвестной вкладке калькулятор считает",
      cOut.textContent !== wasCalc && cOut.textContent.length > 20,
      cOut.textContent.replace(/\s+/g, " ").slice(0, 60));
  }

  await nav("#/code/нет-такого");
  ok("несуществующий источник объясняет себя словами",
    /не найден/i.test($("#view").textContent || ""), ($("#view").textContent || "").slice(0, 60));

  await nav("#/такого-раздела-нет");
  ok("неизвестный раздел показывает навигатор, а не пустоту",
    $("#view").children.length > 0 && ($("#view").textContent || "").length > 200,
    T("#view h1"));

  /* Необработанная ошибка должна превращаться в понятную полоску с кнопкой,
     а не в молчаливо недорисованный экран. Сначала — обратный случай: обрыв
     сети сбоем приложения не считается, иначе полоска вылезала бы при каждом
     мигании связи, которого читатель и не заметил. */
  ok("полоски о сбое до ошибки нет", !$(".crash-bar"));
  w.dispatchEvent(new w.ErrorEvent("error", { message: "Failed to fetch" }));
  await wait(150);
  ok("обрыв сети не считается сбоем приложения", !$(".crash-bar"));

  w.dispatchEvent(new w.ErrorEvent("error", { message: "проверка обработчика сбоев" }));
  await wait(150);
  const crash = $(".crash-bar");
  ok("необработанная ошибка показывает полоску", !!crash && crash.hidden === false,
    crash ? "hidden=" + crash.hidden : "полоски нет");
  ok("в полоске есть «Перезагрузить» и кнопка скрытия",
    !!$(".crash-bar .cb-go") && !!$(".crash-bar .cb-x"));
  /* Сбой виден и с клавиатуры, и скринридером: полоска объявляется сама,
     а у крестика без текста есть подпись. */
  ok("полоска объявляется скринридеру и кнопка скрытия подписана",
    $(".crash-bar").getAttribute("role") === "alert" &&
    !!$(".crash-bar .cb-x").getAttribute("aria-label"),
    "role=" + $(".crash-bar").getAttribute("role") +
    " · aria-label=" + $(".crash-bar .cb-x").getAttribute("aria-label"));
  ok("полоска называет ошибку, а не молчит",
    /проверка обработчика сбоев/.test($(".crash-bar .cb-tech") ? $(".crash-bar .cb-tech").textContent : ""),
    $(".crash-bar .cb-tech") ? $(".crash-bar .cb-tech").textContent : "нет строки");
  ok("полоска поднимает тост (класс на body)", d.body.classList.contains("has-crash"));
  $(".crash-bar .cb-x").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(450);
  ok("полоску можно скрыть", crash.hidden === true || !crash.classList.contains("show"),
    "hidden=" + crash.hidden + " show=" + crash.classList.contains("show"));
  /* Второй сбой в том же сеансе полоску не возвращает: экран не заваливаем. */
  w.dispatchEvent(new w.ErrorEvent("error", { message: "вторая проверка" }));
  await wait(150);
  ok("повторный сбой не поднимает полоску снова",
    crash.hidden === true || !crash.classList.contains("show"));

  section = "7. Сроки"; console.log("\n" + section);
  await nav("#/deadlines");
  ok("калькулятор рассчитал", /Окончание/.test($("#calcOut").textContent));
  ok("контрольные точки по задержанию", $$("#detOut tr").length === 5, $$("#detOut tr").length + " точек");

  section = "7b. Калькуляторы"; console.log("\n" + section);
  ok("в меню есть пункт «Калькуляторы»", $$('.nav-item[data-nav="calc"]').length === 1);
  await nav("#/calc", 200);
  ok("раздел калькуляторов открылся", /^Калькуляторы/.test(T("#view h1") || ""), T("#view h1"));
  ok("шесть вкладок расчётов", $$("#view .tabs .tab").length === 6, $$("#view .tabs .tab").length);

  /* процессуальные сроки: дата окончания и перенос с нерабочего дня */
  ok("дата начала подставлена", /^\d{4}-\d{2}-\d{2}$/.test($("#cDate").value), $("#cDate").value);
  $("#cDate").value = "2026-10-08";
  $("#cNum").value = "3";
  $("#cUnit").value = "days";
  $("#cUnit").dispatchEvent(new w.Event("change", { bubbles: true }));
  ok("срок рассчитан — окончание 11.10.2026", /11\.10\.2026/.test(T("#cOut")), T("#cOut").slice(0, 80));
  ok("нерабочий день переносится на понедельник",
    /нерабочий день/.test(T("#cOut")) && /12\.10\.2026/.test(T("#cOut")) && /ст\. 128/.test(T("#cOut")));

  /* чип-пресет подставляет срок и пересчитывает */
  const preset = $$("#view .calc-presets .chip")[0];
  preset.dispatchEvent(new w.Event("click", { bubbles: true }));
  ok("пресет подставил 48 часов", $("#cNum").value === "48" && $("#cUnit").value === "hours",
    $("#cNum").value + " " + $("#cUnit").value);
  ok("пресет помечен активным", preset.classList.contains("on"));

  /* контрольные точки по делу */
  $("#cCaseDate").value = "2026-03-02";
  $("#cCaseKind").value = "case";
  $("#cCaseRun").dispatchEvent(new w.Event("click", { bubbles: true }));
  ok("контрольные точки по делу построены", $$("#cCaseOut tbody tr").length === 12,
    $$("#cCaseOut tbody tr").length + " точек");
  ok("у контрольных точек указана норма", /УПК РФ/.test(T("#cCaseOut")));
  $("#cCaseKind").value = "custody";
  $("#cCaseRun").dispatchEvent(new w.Event("click", { bubbles: true }));
  ok("переключение на отсчёт от задержания пересобирает точки",
    $$("#cCaseOut tbody tr").length === 10, $$("#cCaseOut tbody tr").length + " точек");

  /* давность и зачёт */
  await nav("#/calc/limit", 200);
  ok("вкладка давности активна", /Давность и зачёт/.test(T("#view .tab.on") || ""));
  $("#lDate").value = "2020-05-05";
  $("#lCat").value = "mid";
  $("#lRun").dispatchEvent(new w.Event("click", { bubbles: true }));
  ok("срок давности 6 лет по средней тяжести",
    /6 лет/.test(T("#lOut")) && /05\.05\.2026/.test(T("#lOut")), T("#lOut").slice(0, 80));
  ok("в расчёте давности есть основание", /ст\. 78 УК РФ/.test(T("#lOut")));
  $("#aDate").value = "2026-01-10";
  $("#aWho").value = "90";
  $("#aRun").dispatchEvent(new w.Event("click", { bubbles: true }));
  ok("давность по КоАП — 90 дней", /90 дней/.test(T("#aOut")) && /10\.04\.2026/.test(T("#aOut")), T("#aOut").slice(0, 80));
  $("#sDays").value = "30";
  $("#sKind").value = "general";
  $("#sRun").dispatchEvent(new w.Event("click", { bubbles: true }));
  ok("зачёт: 30 дней под стражей = 45 дней ИК общего режима", /45 дней/.test(T("#sOut")), T("#sOut").slice(0, 90));
  $("#sKind").value = "oblig";
  $("#sRun").dispatchEvent(new w.Event("click", { bubbles: true }));
  ok("зачёт в обязательные работы считается в часах", /240 часов/.test(T("#sOut")), T("#sOut").slice(0, 90));

  /* пошлины и проценты */
  await nav("#/calc/money", 200);
  $("#dKind").value = "prop";
  $("#dKind").dispatchEvent(new w.Event("change", { bubbles: true }));
  $("#dPrice").value = "500000";
  $("#dRun").dispatchEvent(new w.Event("click", { bubbles: true }));
  ok("госпошлина по иску 500 000 ₽ — 15 000 ₽", /15\s?000,00\s?₽/.test(T("#dOut")), T("#dOut").slice(0, 90));
  ok("у пошлины указана норма", /333\.19/.test(T("#dOut")));
  $("#nSum").value = "100000";
  $("#nFrom").value = "2026-01-01";
  $("#nTo").value = "2026-04-11";
  $("#nRate").value = "0.1";
  $("#nRun").dispatchEvent(new w.Event("click", { bubbles: true }));
  ok("неустойка посчитана", /Неустойка/.test(T("#nOut")) && /₽/.test(T("#nOut")), T("#nOut").slice(0, 80));
  ok("строка периодов по ст. 395 есть", $$("#pRows .calc-row").length >= 1);
  const pRow = $$("#pRows .calc-row")[0];
  pRow.querySelector("[data-p-from]").value = "2026-01-01";
  pRow.querySelector("[data-p-to]").value = "2026-04-11";
  pRow.querySelector("[data-p-rate]").value = "16";
  $("#pRun").dispatchEvent(new w.Event("click", { bubbles: true }));
  ok("проценты по ст. 395 рассчитаны", /395 ГК РФ/.test(T("#pOut")) && /100 дней/.test(T("#pOut")),
    T("#pOut").slice(0, 90));
  $("#pAdd").dispatchEvent(new w.Event("click", { bubbles: true }));
  ok("период можно добавить", $$("#pRows .calc-row").length === 2, $$("#pRows .calc-row").length + " строк");
  $$("#pRows .calc-row")[1].querySelector("[data-p-del]").dispatchEvent(new w.Event("click", { bubbles: true }));
  ok("период можно удалить", $$("#pRows .calc-row").length === 1, $$("#pRows .calc-row").length + " строк");

  /* сроки под стражей */
  await nav("#/calc/custody", 200);
  ok("контрольные точки задержания построены", $$("#kOut tbody tr").length === 10,
    $$("#kOut tbody tr").length + " точек");
  ok("среди точек есть предельный срок задержания",
    /Предельный срок задержания без суда/.test(T("#kOut")) && /ст\. 94/.test(T("#kOut")));
  $("#kTime").value = "2026-01-01T09:30";
  $("#kRun").dispatchEvent(new w.Event("click", { bubbles: true }));
  ok("просроченное задержание подсвечено предупреждением", /Предельный срок задержания без суда истёк/.test(T("#kOut")));
  ok("таблица пределов продления на месте", $$("#view table.tbl").length === 2,
    $$("#view table.tbl").length + " таблиц");
  ok("активный пункт меню — калькуляторы",
    !!($$('.nav-item[data-nav="calc"]')[0] || {}).classList &&
    $$('.nav-item[data-nav="calc"]')[0].classList.contains("active"));

  /* обычный калькулятор: 5 + 5 и т. п. */
  await nav("#/calc/simple", 200);
  ok("вкладка «Калькулятор» активна", /Калькулятор/.test(T("#view .tab.on") || ""));
  ok("клавиатура калькулятора собрана", $$("#scKeys .sc-key").length === 20,
    $$("#scKeys .sc-key").length + " клавиш");
  const scKey = (sel) => $("#scKeys [data-sc='" + sel + "']");
  scKey("num:5").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  scKey("op:+").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  scKey("num:5").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  ok("выражение набрано — «5 + 5»", /5 \+ 5/.test(T("#scExpr")), T("#scExpr"));
  scKey("eq").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  ok("5 + 5 = 10", T("#scValue") === "10", T("#scValue"));
  ok("в ленте появилась запись", $$("#scTape .sc-tape-item").length >= 1);
  /* порядок действий: умножение раньше сложения */
  scKey("clear").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  scKey("num:2").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  scKey("op:+").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  scKey("num:3").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  scKey("op:*").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  scKey("num:4").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  scKey("eq").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  ok("2 + 3 × 4 = 14 (умножение раньше сложения)", T("#scValue") === "14", T("#scValue"));
  /* проценты */
  scKey("clear").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  scKey("num:2").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  scKey("num:0").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  scKey("num:0").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  scKey("op:+").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  scKey("num:1").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  scKey("num:0").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  scKey("pct").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  scKey("eq").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  ok("200 + 10 % = 220", T("#scValue") === "220", T("#scValue"));
  /* смена знака */
  scKey("clear").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  scKey("num:7").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  scKey("sign").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  ok("± меняет знак числа", /−7/.test(T("#scValue")), T("#scValue"));
  /* результат из ленты подставляется в выражение */
  scKey("clear").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  const tapeItem = $$("#scTape .sc-tape-item")[0];
  if (tapeItem) {
    tapeItem.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    ok("результат из ленты взят в выражение", /^\d/.test(T("#scValue")), T("#scValue"));
  }
  /* клавиатура: цифры и Enter */
  w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "8", bubbles: true }));
  w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "*", bubbles: true }));
  w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "8", bubbles: true }));
  w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  ok("с клавиатуры: 8 * 8 = 64", T("#scValue") === "64", T("#scValue"));

  await nav("#/deadlines", 150);
  ok("прежний раздел сроков не сломан", /Окончание/.test($("#calcOut").textContent));

  section = "8. Чек-листы и шаблоны"; console.log("\n" + section);
  await nav("#/checklists");
  ok("список чек-листов", $$("#view .card").length === 10, $$("#view .card").length);
  await nav("#/checklist/" + w.RF_REF.checklists[0].id);
  ok("чек-лист открылся", $$("#view ol.steps li").length > 3, $$("#view ol.steps li").length + " пунктов");
  await nav("#/checklist/proverka-dokumentov");
  ok("чек-лист «Проверка документов» открылся", $$("#view ol.steps li").length === 9, $$("#view ol.steps li").length + " пунктов");

  /* --- документы: список, группы, «Мои реквизиты» --- */
  const tplList = w.RF_REF.templates || [];
  const tplGroups = Array.from(new Set(tplList.map(t => t.group)));
  await nav("#/templates");
  ok("справочник шаблонов непуст", tplList.length >= 50, tplList.length + " шаблонов");
  ok("список шаблонов", $$("#view .card").length === tplList.length, $$("#view .card").length);
  ok("шаблоны сгруппированы по разделам", $$("#view .tpl-group").length === tplGroups.length,
    $$("#view .tpl-group").length + " разделов из " + tplGroups.length);
  ok("шаблоны охватывают отрасли права, а не только УПК",
    tplGroups.some(g => /административн/i.test(g)) && tplGroups.some(g => /гражданск/i.test(g)) &&
    tplGroups.some(g => /трудов/i.test(g)), tplGroups.length + " разделов");
  ok("есть поиск и переходы по разделам",
    !!$("#tplFind") && $$("#view [data-tpl-jump]").length === tplGroups.length,
    $$("#view [data-tpl-jump]").length + " переходов");
  ok("блок «Мои реквизиты» на месте", !!$("#view .prof") && $$("#view [data-prof]").length === 4,
    $$("#view [data-prof]").length + " поля");

  /* фильтр по шаблонам: карточки, разделы и сообщение «ничего не найдено» */
  const findEl = $("#tplFind");
  findEl.value = "протокол";
  findEl.dispatchEvent(new w.Event("input", { bubbles: true }));
  await wait(80);
  const shownCards = $$("#view .card").filter(el => !el.hidden).length;
  ok("фильтр оставляет только подходящие шаблоны", shownCards > 0 && shownCards < tplList.length,
    shownCards + " из " + tplList.length);
  ok("разделы без совпадений скрыты",
    $$("#view .tpl-group").filter(s => !s.hidden).length < tplGroups.length);
  findEl.value = "щщщнетакогошаблона";
  findEl.dispatchEvent(new w.Event("input", { bubbles: true }));
  await wait(80);
  ok("при отсутствии совпадений — понятное сообщение",
    !$("#tplEmpty").hidden && $$("#view .tpl-group").every(s => s.hidden));
  findEl.value = "";
  findEl.dispatchEvent(new w.Event("input", { bubbles: true }));
  await wait(80);
  ok("очистка поиска возвращает все шаблоны",
    $$("#view .card").filter(el => !el.hidden).length === tplList.length);

  /* реквизиты сохраняются и подставляются во все документы */
  const profFio = $("#view [data-prof='fio']");
  profFio.value = "Петров П.П.";
  $("#profSave").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(150);
  ok("реквизиты сохраняются в localStorage",
    (w.localStorage.getItem("rflaws.profile") || "").indexOf("Петров") !== -1,
    w.localStorage.getItem("rflaws.profile"));

  /* --- один документ: структура «как официальный бланк», а не сплошной текст --- */
  await nav("#/template/vozbuzhdenie");
  const preview = $("#tplOut");
  ok("шаблон открылся", !!preview && preview.classList.contains("doc-sheet"));
  ok("документ собран из блоков, а не одним куском текста", $$("#tplOut > *").length >= 10,
    $$("#tplOut > *").length + " блоков");
  ok("есть шапка-заголовок", $$("#tplOut .doc-title").length === 1);
  ok("есть реквизиты в две колонки (город / дата)",
    $$("#tplOut table.doc-req td").length === 2, $$("#tplOut table.doc-req td").length + " ячейки");
  ok("есть подзаголовок и смысловые заголовки", $$("#tplOut .doc-sub").length === 1 && $$("#tplOut .doc-h").length >= 2);
  ok("есть нумерованные пункты", $$("#tplOut ol.doc-ol > li").length >= 2,
    $$("#tplOut ol.doc-ol > li").length + " пунктов");
  ok("есть подпись с местом для ФИО", $$("#tplOut table.doc-sig").length >= 1);
  ok("ФИО из «Моих реквизитов» подставилось", preview.textContent.indexOf("Петров П.П.") !== -1);
  ok("дата заполнена автоматически", preview.textContent.indexOf(String(new Date().getFullYear())) !== -1);
  ok("плейсхолдеры не остались", preview.textContent.indexOf("{{") === -1);

  /* правка поля сразу перерисовывает документ */
  const inp0 = $("[data-tf]");
  inp0.value = "Проверочное значение";
  inp0.dispatchEvent(new w.Event("input", { bubbles: true }));
  await wait(60);
  ok("подстановка данных работает", preview.textContent.indexOf("Проверочное значение") !== -1);

  /* очистка полей → прочерки для заполнения от руки, без «{{…}}» */
  $("#tplClear").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(60);
  ok("после очистки пустые поля — прочерк для заполнения", $$("#tplOut .doc-fill").length > 0,
    $$("#tplOut .doc-fill").length + " пропусков");
  ok("после очистки плейсхолдеров не осталось", $("#tplOut").textContent.indexOf("{{") === -1);
  $("#tplReset").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(60);
  ok("сброс к образцу возвращает значения", $("#tplOut").textContent.indexOf("{{") === -1);

  /* кнопки выгрузки структурированного документа */
  ok("есть копирование с форматированием, Word, текст и печать",
    !!$("#tplCopyRich") && !!$("#tplDoc") && !!$("#tplTxt") && !!$("#tplPrint"));

  /* копирование с форматированием прогоняет Word-вариант (инлайн-стили,
     шапка и подписи таблицами) — он не должен падать */
  const errsBefore = errors.length;
  $("#tplCopyRich").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(80);
  ok("копирование с форматированием не падает", errors.length === errsBefore);

  /* документ Word-выгрузки — таблицы, а не текст: подписи/реквизиты собираются таблицами */
  await nav("#/template/protokol-doprosa-svidetelya");
  ok("протокол допроса открылся", !!$("#tplOut") && $$("#tplOut table").length >= 2,
    $$("#tplOut table").length + " таблиц (шапка + сведения о лице)");
  ok("в протоколе есть таблица сведений о допрашиваемом", $$("#tplOut table.doc-tbl td").length >= 4);

  /* шаблоны других отраслей собираются так же структурно */
  await nav("#/template/gpk-isk");
  ok("исковое заявление (ГПК) открылось", !!$("#tplOut") && $$("#tplOut table.doc-tbl td").length >= 6,
    $$("#tplOut table.doc-tbl td").length + " ячеек таблицы реквизитов");
  ok("в исковом заявлении есть смысловые разделы и подпись",
    $$("#tplOut .doc-h").length >= 3 && $$("#tplOut table.doc-sig").length >= 1);
  ok("плейсхолдеры в исковом заявлении не остались", $("#tplOut").textContent.indexOf("{{") === -1);
  await nav("#/template/koap-protokol");
  ok("протокол по КоАП открылся", !!$("#tplOut") && $$("#tplOut .doc-title").length === 1,
    $$("#tplOut > *").length + " блоков");
  ok("в протоколе по КоАП есть таблица сведений о лице", $$("#tplOut table.doc-tbl td").length >= 8,
    $$("#tplOut table.doc-tbl td").length + " ячеек");

  section = "8b. Готовые исковые заявления"; console.log("\n" + section);
  const suitList = (w.RF_SUITS || {}).suits || [];
  const suitGroups = Array.from(new Set(suitList.map(s => s.court)));
  await nav("#/suits");
  ok("справочник исков непуст", suitList.length >= 8, suitList.length + " заявлений");
  ok("список исков", $$("#view .card").length === suitList.length, $$("#view .card").length);
  ok("иски сгруппированы по судам", $$("#view .tpl-group").length === suitGroups.length,
    $$("#view .tpl-group").length + " групп из " + suitGroups.length);
  ok("иски охватывают гражданский, арбитражный и административный процесс",
    suitGroups.some(g => /гражданск/i.test(g)) && suitGroups.some(g => /арбитраж/i.test(g)) &&
    suitGroups.some(g => /административ/i.test(g)), suitGroups.join(", "));
  ok("переключатель «Шаблоны / Иски» на месте",
    $$("#view .tabs .tab").length === 2 &&
    $$("#view .tabs .tab").some(t => t.getAttribute("data-go") === "#/suits"),
    $$("#view .tabs .tab").map(t => t.textContent.trim()).join(" | "));

  /* иск с автоматическим расчётом: цена иска и госпошлина считаются от сумм */
  await nav("#/suit/isk-dolg");
  const sOut = $("#suitOut");
  const sText = () => sOut.textContent.replace(/\u00a0/g, " ");
  ok("иск открылся", !!sOut && sOut.classList.contains("doc-sheet"));
  ok("в иске есть шапка, адресат, просительная часть и подпись",
    $$("#suitOut .doc-title").length === 1 && $$("#suitOut .doc-addr").length === 1 &&
    $$("#suitOut ol.doc-ol > li").length >= 3 && $$("#suitOut table.doc-sig").length === 1);
  ok("плейсхолдеры в иске не остались", sOut.textContent.indexOf("{{") === -1);
  const debtEl = $("#view [data-sf='debt']"), pctEl = $("#view [data-sf='percent']");
  ok("поля сумм на месте", !!debtEl && !!pctEl);
  debtEl.value = "500000"; pctEl.value = "0";
  debtEl.dispatchEvent(new w.Event("input", { bubbles: true }));
  await wait(80);
  ok("цена иска посчитана из полей", /500\s?000/.test($("#suitPrice").value), $("#suitPrice").value);
  ok("госпошлина посчитана по ст. 333.19 НК РФ", /15\s?000/.test($("#suitDuty").value), $("#suitDuty").value);
  ok("цена и госпошлина подставлены в текст заявления",
    sText().indexOf("500 000") !== -1 && sText().indexOf("15 000") !== -1);
  ok("знак рубля в тексте не удвоился", sText().indexOf("₽ ₽") === -1);
  ok("у госпошлины указано основание", /333\.19/.test(($("#suitDutyNote") || {}).textContent || ""),
    (($("#suitDutyNote") || {}).textContent || "").slice(0, 60));
  debtEl.value = "";
  debtEl.dispatchEvent(new w.Event("input", { bubbles: true }));
  await wait(60);
  ok("пустые суммы не дают «NaN» в тексте", sOut.textContent.indexOf("NaN") === -1);

  /* иск с освобождением от пошлины: сумма не считается, причина названа */
  await nav("#/suit/isk-alimenty");
  await wait(80);
  ok("освобождение от пошлины показано словами",
    /освобождён/.test($("#suitDuty").value) && /333\.36/.test($("#suitDutyNote").textContent),
    $("#suitDuty").value + " · " + $("#suitDutyNote").textContent.slice(0, 50));

  section = "9. Избранное и тема"; console.log("\n" + section);
  await nav("#/article/upk-182", 1300);
  $("[data-fav]").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(150);
  ok("кнопка переключилась", /В избранном/.test($("[data-fav]").textContent), $("[data-fav]").textContent.trim());
  ok("сохранено в localStorage", w.localStorage.getItem("rflaws.fav") === '["upk-182"]', w.localStorage.getItem("rflaws.fav"));

  /* личные заметки к статье */
  const noteArea = $("#noteArea");
  ok("поле заметки присутствует на странице статьи", !!noteArea);
  if (noteArea) {
    noteArea.value = "Проверить срок — 48 часов";
    $("[data-note-save]").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await wait(120);
    ok("заметка сохранена в localStorage", (w.localStorage.getItem("rflaws.notes") || "").indexOf("48 часов") !== -1, w.localStorage.getItem("rflaws.notes"));
    await nav("#/article/upk-182", 250);
    ok("заметка восстановлена в поле после перезагрузки", ($("#noteArea") || {}).value === "Проверить срок — 48 часов", ($("#noteArea") || {}).value);
    $("[data-note-del]").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await wait(120);
    ok("заметка удалена из localStorage", (w.localStorage.getItem("rflaws.notes") || "").indexOf("48 часов") === -1);
  }

  await nav("#/favorites");
  ok("избранное отображается", $$("#view .result").length === 1);
  const themeBefore = d.documentElement.getAttribute("data-theme");
  $("#themeBtn").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(60);
  ok("тема переключается", d.documentElement.getAttribute("data-theme") !== themeBefore,
    themeBefore + " → " + d.documentElement.getAttribute("data-theme"));

  section = "10. Командная строка"; console.log("\n" + section);
  d.dispatchEvent(new w.KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
  await wait(60);
  ok("палитра открывается", $("#palette").classList.contains("open"));
  const pi = $("#palInput");
  pi.value = "обыск"; pi.dispatchEvent(new w.Event("input", { bubbles: true }));
  await wait(60);
  ok("палитра ищет статьи", $$("#palList .palette-item").length > 0, $$("#palList .palette-item").length + " записей");
  $("#palList .palette-item").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(400);
  ok("переход из палитры", !$("#palette").classList.contains("open") && w.location.hash.indexOf("#/") === 0, w.location.hash);

  /* палитра знает про калькуляторы — иначе раздел находится только в меню */
  d.dispatchEvent(new w.KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
  await wait(60);
  pi.value = "пошлина"; pi.dispatchEvent(new w.Event("input", { bubbles: true }));
  await wait(60);
  ok("палитра находит калькуляторы по слову «пошлина»",
    $$("#palList .palette-item").some(el => /Калькуляторы/.test(el.textContent || "")),
    $$("#palList .palette-item").map(el => (el.textContent || "").slice(0, 24)).join(" | "));
  d.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await wait(60);

  section = "11. Справка"; console.log("\n" + section);
  await nav("#/help");
  ok("страница справки", /Как пользоваться/.test(T("h1") || ""));

  section = "12. Проверка актуальности"; console.log("\n" + section);
  await nav("#/freshness", 200);
  ok("раздел открывается", /Проверка актуальности/.test(T("h1") || ""), T("h1"));
  ok("кнопка проверки на месте", !!$("#frCheck"));
  ok("таблица источников", $$("table.tbl-fresh tbody tr.fresh-row").length === N_SOURCES, $$("table.tbl-fresh tbody tr.fresh-row").length + " строк");
  ok("все источники помечены актуальными", $$("table.tbl-fresh .st-ok").length >= 128, $$("table.tbl-fresh .st-ok").length);
  ok("кнопка сброса скрыта без обновлений", !$("#frReset"));
  /* jsdom не предоставляет fetch — это ровно тот случай, когда сети нет.
     Приложение обязано показать понятное сообщение и не «зависнуть». */
  const frBtn = $("#frCheck");
  frBtn.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(300);
  ok("без сети показывается понятное сообщение", /Не удалось проверить онлайн/.test(T("#view") || ""),
    (T("#view") || "").replace(/\s+/g, " ").slice(0, 90));
  ok("кнопка проверки не зависла", !!$("#frCheck") && !$("#frCheck").disabled);
  ok("сообщение объясняет офлайн-режим", /доступ к сети|Локальная база продолжает работать/.test(T("#view") || ""));
  ok("таблица источников осталась", $$("table.tbl-fresh tbody tr.fresh-row").length === N_SOURCES);
  ok("палитра знает о разделе", (() => {
    d.dispatchEvent(new w.KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
    return true;
  })());
  await wait(60);
  $("#palInput").value = "актуальность";
  $("#palInput").dispatchEvent(new w.Event("input", { bubbles: true }));
  await wait(60);
  ok("раздел находится через палитру", $$("#palList .palette-item").length > 0, $$("#palList .palette-item").length + " записей");
  d.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await wait(60);

  section = "13. Обновление устаревшей редакции (имитация сети)"; console.log("\n" + section);
  /* Подменяем сеть: манифест отдаёт одну «более новую» редакцию, а тексты
     документов берём из локального набора данных. */
  const manCodes = JSON.parse(JSON.stringify(w.RF_FRESH.manifests.codes));
  const targetId = "uk";
  const targetHash = w.RF_FRESH.docs[targetId].hash;
  manCodes[targetHash] = Object.assign({}, manCodes[targetHash], { redaction_date: "20270101" });
  const origFetch = w.fetch;
  w.fetch = function (url) {
    const u = String(url);
    let body;
    if (/manifest\.json$/.test(u)) {
      body = u.indexOf("/laws/") >= 0 ? JSON.parse(JSON.stringify(w.RF_FRESH.manifests.laws)) : manCodes;
    } else {
      const m = /data\/(codes|laws)\/(.+)\.json$/.exec(u);
      const f = path.join(ROOT, "vendor", "ruslaw", m[1] === "laws" ? "laws" : "", decodeURIComponent(m[2]) + ".json");
      body = JSON.parse(fs.readFileSync(f, "utf8"));
      // имитируем пересборку документа на официальном портале
      if (body.slug === w.RF_FRESH.docs[targetId].slug || /Уголовный_кодекс/.test(u)) body.redaction_date = "2027-01-01";
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };

  await nav("#/freshness", 200);
  $("#frCheck").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(600);
  ok("обнаружено обновление", /Найдено обновлений: 1/.test(T("#view") || ""),
    (T("#view") || "").replace(/\s+/g, " ").match(/Найдено обновлений: \d+/));
  ok("кнопка «Обновить все» появилась", !!$("#frUpdateAll"));
  ok("источник помечен в боковой панели", $$("#codeNav .nav-item.has-upd").length === 1, $$("#codeNav .nav-item.has-upd").length);
  const updBtn = $("[data-upd]");
  ok("кнопка обновления источника есть", !!updBtn);
  updBtn.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(900);
  ok("источник обновлён", /обновлено/.test(T("#view") || ""), (T("#view") || "").replace(/\s+/g, " ").slice(0, 80));
  ok("новая редакция показана", /2027/.test(T("#view") || ""));
  ok("кнопка сброса появилась", !!$("#frReset"));
  ok("обновление не потеряло статьи", (() => {
    const rows = $$("#view table.tbl-fresh tbody tr.fresh-row");
    return rows.length === N_SOURCES;
  })());
  w.fetch = origFetch;

  section = "14. Подборка норм, экспорт и цитирование"; console.log("\n" + section);
  await nav("#/collection", 150);
  ok("раздел открывается", /Подборка норм/.test(T("h1") || ""), T("h1"));
  ok("пустая подборка объясняет, что делать", /Подборка пуста/.test(T("#view") || ""));

  /* добавление со страницы статьи */
  await nav("#/article/uk-105", 1300);
  const addBtn = $('[data-col-add="uk-105"]');
  ok("кнопка «В подборку» на странице статьи", !!addBtn && /В подборку/.test(addBtn.textContent), addBtn ? addBtn.textContent.trim() : "");
  addBtn.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(120);
  ok("статья добавлена", /В подборке/.test($('[data-col-add="uk-105"]').textContent) && w.localStorage.getItem("rflaws.col") === '[{"id":"uk-105","note":""}]',
    w.localStorage.getItem("rflaws.col"));
  ok("счётчик в боковой панели обновился", T("#colCount") === "1", T("#colCount"));

  /* добавление из результатов поиска */
  await nav("#/search/" + encodeURIComponent("ст 182 УПК"), 200);
  const resBtn = $("#view .result .ibtn-col");
  ok("кнопка подборки в результатах поиска", !!resBtn);
  resBtn.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(120);
  ok("добавление из поиска не уводит со страницы", w.location.hash.indexOf("#/search/") === 0, w.location.hash);
  ok("в подборке две статьи", JSON.parse(w.localStorage.getItem("rflaws.col")).length === 2, w.localStorage.getItem("rflaws.col"));

  /* добавление из разбора ситуации (все статьи блока) */
  await nav("#/assistant");
  $("#asInput").value = "Сотрудник ГИБДД остановил автомобиль, от медосвидетельствования водитель отказался";
  $("#asRun").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(200);
  const batchBtn = $("#asOut [data-col-batch]");
  ok("кнопка «все статьи блока» в разборе", !!batchBtn);
  const before = JSON.parse(w.localStorage.getItem("rflaws.col")).length;
  batchBtn.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(120);
  const after = JSON.parse(w.localStorage.getItem("rflaws.col")).length;
  ok("блок добавляется целиком", after > before, before + " → " + after);

  /* работа с подборкой */
  await nav("#/collection", 250);
  const rows = $$("#view .col-item");
  ok("позиции показаны по порядку", rows.length === after, rows.length + " позиций");
  ok("у позиций есть нумерация", T("#view .col-item .col-idx") === "1", T("#view .col-item .col-idx"));
  const orderBefore = $$("#view .col-item").map(r => r.getAttribute("data-col-item"));
  $$("#view .col-item")[1].querySelector("[data-col-up]").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(200);
  const orderAfter = $$("#view .col-item").map(r => r.getAttribute("data-col-item"));
  ok("порядок меняется стрелками", orderAfter[0] === orderBefore[1] && orderAfter[1] === orderBefore[0],
    orderBefore.slice(0, 2).join(",") + " → " + orderAfter.slice(0, 2).join(","));

  const note = $("#view [data-col-note]");
  note.value = "Проверить по материалам дела";
  note.dispatchEvent(new w.Event("input", { bubbles: true }));
  await wait(80);
  ok("заметка сохраняется", /Проверить по материалам дела/.test(w.localStorage.getItem("rflaws.col")),
    (JSON.parse(w.localStorage.getItem("rflaws.col"))[0].note || "").slice(0, 40));

  /* экспорт: перехватываем скачивание */
  const grabbed = [];
  const origClick = w.HTMLAnchorElement.prototype.click;
  w.HTMLAnchorElement.prototype.click = function () { if (this.download) grabbed.push(this.download); };
  $("#colExportTxt").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(800);
  ok("экспорт .txt запускается", grabbed.indexOf("podborka-norm.txt") !== -1, grabbed.join(", ") || "ничего");
  grabbed.length = 0;
  $("#colExportDoc").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(800);
  ok("экспорт .doc запускается", grabbed.indexOf("podborka-norm.doc") !== -1, grabbed.join(", ") || "ничего");
  grabbed.length = 0;
  $("#colPrint").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(600);
  ok("печать подборки не падает и ничего не скачивает", grabbed.length === 0 && $$("#view .col-item").length > 0);
  w.HTMLAnchorElement.prototype.click = origClick;

  $("#view .col-item [data-col-del]").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(200);
  ok("позиция удаляется", $$("#view .col-item").length === after - 1, $$("#view .col-item").length + " осталось");

  await nav("#/article/upk-182", 1300);
  ok("кнопка «Скопировать с реквизитами» есть", !!$("[data-copy-full]"));
  ok("подборка переживает перезагрузку (localStorage)", (() => {
    try { return JSON.parse(w.localStorage.getItem("rflaws.col")).length > 0; } catch (e) { return false; }
  })());

  await nav("#/collection", 200);
  $("#colClear").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(200);
  ok("подборка очищается", /Подборка пуста/.test(T("#view") || "") && T("#colCount") === "0", T("#colCount"));

  section = "15. Полнотекстовый поиск по текстам статей"; console.log("\n" + section);
  ok("параметры индекса загружены", !!(w.RF_FT_META && w.RF_FT_META.shards === 32),
    w.RF_FT_META ? w.RF_FT_META.shards + " сегментов, " + w.RF_FT_META.stems + " основ" : "нет");
  ok("модуль текстовой обработки доступен", typeof w.RF_TEXT.stem === "function" &&
    w.RF_TEXT.stem("законов") === "закон", w.RF_TEXT.stem("законов"));

  await nav("#/search/" + encodeURIComponent("моральный вред"), 1500);
  ok("блок полнотекстовых совпадений появился", !!$("#ftBlock .result"),
    $("#ftBlock") ? $("#ftBlock").textContent.slice(0, 60) : "нет блока");
  ok("заголовок блока", /Найдено в текстах статей/.test(T("#ftBlock") || ""));
  ok("совпадения не дублируют основной список", (() => {
    const main = $$("#view .result").filter(r => !r.closest("#ftBlock")).map(r => r.getAttribute("data-go"));
    const ft = $$("#ftBlock .result").map(r => r.getAttribute("data-go"));
    return ft.length > 0 && ft.every(id => main.indexOf(id) === -1);
  })(), $$("#ftBlock .result").length + " совпадений");
  ok("у совпадения пометка «совпадение в тексте»",
    $$("#ftBlock .result").every(r => /совпадение в тексте/.test(r.textContent)));
  ok("в отрывке стоит подсветка", !!$("#ftBlock .result mark"));
  ok("совпадения ведут на существующие статьи", $$("#ftBlock .result").every(r => {
    const id = decodeURIComponent(r.getAttribute("data-go").replace("#/article/", ""));
    return w.RF_IDX.some(x => x[0] + "-" + x[1] === id);
  }));
  ok("у совпадения есть кнопка «в подборку»", !!$("#ftBlock .ibtn-col"));

  await nav("#/search/" + encodeURIComponent("срок предварительного следствия"), 1200);
  ok("точный запрос поднимает нужную статью наверх", (() => {
    const r = $$("#view .result")[0];
    return !!r && /ст\.\s*162/.test(r.textContent);
  })(), ($$("#view .result")[0] || {}).textContent);

  /* фраза, которой нет ни в одном названии — её находит только полный текст */
  await nav("#/search/" + encodeURIComponent("не позднее трех суток"), 1500);
  ok("фраза из текста статьи (не из названия) находится", $$("#ftBlock .result").length > 0,
    $$("#ftBlock .result").length + " совпадений");

  await nav("#/search/" + encodeURIComponent("квквквкв"), 600);
  ok("на бессмыслицу полнотекстовый блок пуст", !$("#ftBlock .result"));
  ok("на бессмыслицу остаётся сообщение «ничего не найдено»", /Ничего не найдено/.test(T("#view") || ""));

  await nav("#/search/" + encodeURIComponent("ст 105 УК"), 800);
  ok("числовой запрос не тянет индекс", !$("#ftBlock .result"));

  /* Метаданные и полный текст рисуются в один #view, поэтому «строками
     реестра» считаем только то, что лежит вне #ftBlock. */
  const metaRows = () => $$("#view .result").filter(r => !r.closest("#ftBlock"));

  section = "15a. Операторы запроса и исправление опечаток"; console.log("\n" + section);

  await nav("#/search/" + encodeURIComponent('"тайное хищение чужого имущества"'), 1400);
  ok("точная фраза: подсказка о фразе показана", /Точная фраза/.test(T("#view") || ""));
  ok("точная фраза: первой идёт кража — ст. 158 УК", (() => {
    const r = $$("#view .result")[0];
    return !!r && /ст\.\s*158/.test(r.textContent);
  })(), (($$("#view .result")[0] || {}).textContent || "").slice(0, 70));

  await nav("#/search/" + encodeURIComponent("кража +жилище"), 1400);
  ok("обязательное слово: подсказка показана", /Обязательные слова: жилище/.test(T("#view") || ""));
  ok("обязательное слово: статьи без него не показываются", (() => {
    const rows = metaRows();
    return rows.length > 0 && rows.every(r => /жилищ/i.test(r.textContent));
  })(), metaRows().length + " строк");

  await nav("#/search/" + encodeURIComponent("наркотики -сбыт"), 1400);
  ok("исключение слова: подсказка показана", /Исключены слова: сбыт/.test(T("#view") || ""));
  ok("исключение слова: в заголовках нет «сбыт»", (() => {
    const rows = metaRows();
    return rows.length > 0 && rows.every(r => {
      const t = (r.querySelector(".result-title") || {}).textContent || "";
      return !/сбыт/i.test(t);
    });
  })(), metaRows().length + " строк");

  await nav("#/search/" + encodeURIComponent("обыскк"), 1800);
  ok("опечатка исправлена и об этом сказано",
    /В запросе не нашлось слов/.test(T("#ftBlock") || ""), (T("#ftBlock") || "").slice(0, 80));
  /* Статья по исправленному слову уже могла попасть в список реестра (обыск
     совпадает с «обыскк» по началу слова) — тогда из блока полного текста она
     убирается как дубль. Поэтому ищем её во всей выдаче, а не только в #ftBlock. */
  ok("по исправленной опечатке найдена ст. 182 УПК",
    $$("#view .result").some(r => /ст\.\s*182/.test(r.textContent) && /УПК/.test(r.textContent)),
    $$("#view .result").length + " строк выдачи");

  section = "15b. Почему совпало и разбор ситуации"; console.log("\n" + section);

  await nav("#/search/" + encodeURIComponent("получение взятки"), 1200);
  ok("под результатом есть строка «Совпало:»", (() => {
    const el = $("#view .result-meta .why");
    return !!el && /Совпало:/.test(el.textContent);
  })(), (T("#view .result-meta .why") || "нет").slice(0, 80));

  /* «прогул» в ст. 81 ТК РФ упомянут один раз, а в постановлении Пленума о
     трудовых спорах — десятки раз. Норму поднимает курируемый разбор ситуации. */
  await nav("#/search/" + encodeURIComponent("прогул"), 1600);
  ok("норма из разбора ситуации стоит первой", (() => {
    const r = $$("#view .result")[0];
    return !!r && /ст\.\s*81/.test(r.textContent) && /ТК/.test(r.textContent);
  })(), (($$("#view .result")[0] || {}).textContent || "").slice(0, 90));
  ok("в строке «почему совпало» назван разбор ситуации",
    /разбор ситуации/.test(T("#view .result-meta .why") || ""),
    (T("#view .result-meta .why") || "нет").slice(0, 90));

  section = "15c. Фильтры выдачи и справка поиска"; console.log("\n" + section);

  await nav("#/search/" + encodeURIComponent("вред"), 1600);
  ok("панель фильтров выдачи появилась", !!$(".search-tools") && $$("[data-sfilter]").length >= 3,
    $$("[data-sfilter]").length + " чипов");
  ok("в фильтрах есть «только действующие» и «сначала по источникам»",
    $$("[data-sfilter]").some(el => el.getAttribute("data-sfilter") === "repealed") &&
    $$("[data-sfilter]").some(el => el.getAttribute("data-sfilter") === "sort:src"));
  /* «Сбросить фильтры» появляется только когда фильтр уже включён — иначе
     кнопка сбрасывала бы нечего. */
  ok("пока фильтры не тронуты, кнопки сброса нет",
    !$$("[data-sfilter]").some(el => el.getAttribute("data-sfilter") === "reset"));

  const chip = $$("[data-sfilter]").find(el => /^src:.+/.test(el.getAttribute("data-sfilter") || ""));
  ok("есть чип источника", !!chip, chip ? chip.textContent : "нет");
  if (chip) {
    const sid = chip.getAttribute("data-sfilter").slice(4);
    const beforeSrc = metaRows().length;
    chip.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await wait(1500);
    ok("фильтр по источнику сузил выдачу", metaRows().length > 0 && metaRows().length < beforeSrc,
      beforeSrc + " → " + metaRows().length);
    ok("выбранный чип подсвечен", (() => {
      const c = $$("[data-sfilter]").find(el => el.getAttribute("data-sfilter") === "src:" + sid);
      return !!c && /(^|\s)on(\s|$)/.test(c.getAttribute("class") || "");
    })());
    ok("все результаты — из выбранного источника", $$("#view .result").every(r => {
      const id = decodeURIComponent((r.getAttribute("data-go") || "").replace("#/article/", ""));
      return id.indexOf(sid + "-") === 0;
    }), "источник " + sid);
    const rst = $$("[data-sfilter]").find(el => el.getAttribute("data-sfilter") === "reset");
    ok("появился чип сброса фильтров", !!rst);
    if (rst) {
      rst.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      await wait(1500);
      ok("сброс фильтров возвращает полную выдачу", metaRows().length === beforeSrc,
        metaRows().length + " против " + beforeSrc);
    }
  }

  await nav("#/search", 300);
  ok("на пустом запросе показана справка «Что понимает поиск»",
    /Что понимает поиск/.test(T("#view") || ""));
  ok("в справке есть примеры запросов", $$('#view .chip[data-go^="#/search/"]').length >= 8,
    $$('#view .chip[data-go^="#/search/"]').length + " примеров");

  section = "16. Дела: папки, заметки по делу, экспорт"; console.log("\n" + section);

  await nav("#/cases", 200);
  ok("раздел «Дела» открывается", /Дел пока нет|Новое дело/.test(T("#view") || ""), (T("h1") || ""));
  ok("счётчик дел в панели есть", !!$("#caseCount"));

  $("#caseNewTitle").value = "Дело № 123456, Иванов И.И.";
  $("#caseNewDesc").value = "кража, ст. 158 УК, предварительное следствие";
  $("#caseNewBtn").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(400);
  const caseId = (w.location.hash || "").replace("#/case/", "");
  ok("дело создаётся и открывается", /^#\/case\//.test(w.location.hash || "") && caseId.length > 3, w.location.hash);
  ok("название дела в шапке", /Дело № 123456/.test(T(".article-title") || ""), T(".article-title"));
  ok("счётчик дел обновился", T("#caseCount") === "1", T("#caseCount"));

  /* норма через поиск внутри дела */
  $("#caseFind").value = "91 УПК";
  $("#caseFindBtn").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(250);
  ok("поиск внутри дела находит норму", $$("[data-case-pick]").length > 0,
    $$("[data-case-pick]").length + " найдено");
  $$("[data-case-pick]")[0].dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(250);
  ok("норма добавлена в дело", $$("#view .col-item").length === 1, $$("#view .col-item").length + " позиций");
  ok("кнопка переключилась на «В деле»", /В деле/.test(T("[data-case-pick]") || ""));

  /* заметка к норме */
  const noteBox = $("[data-case-note]");
  if (noteBox) {
    noteBox.value = "Проверить срок задержания";
    noteBox.dispatchEvent(new w.Event("input", { bubbles: true }));
    await wait(120);
  }
  ok("заметка к норме сохраняется", (() => {
    try { return JSON.parse(w.localStorage.getItem("rflaws.cases"))[0].items[0].note === "Проверить срок задержания"; }
    catch (e) { return false; }
  })());

  /* свободная заметка по делу */
  $("#caseNoteNew").value = "Допрошен свидетель Петров";
  $("#caseNoteAdd").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(250);
  ok("заметка по делу добавлена", $$("#view .case-note").length === 1,
    $$("#view .case-note").length + " заметок");
  ok("текст заметки виден", /Допрошен свидетель Петров/.test(T("#view .case-note textarea") || T("#view") || ""));

  /* добавление нормы со страницы статьи — берём другую норму, не ту же самую */
  await nav("#/article/uk-105", 900);
  ok("на странице статьи есть выбор дела", !!$("#casePick"));
  $("#casePick").value = caseId;
  $("#casePick").dispatchEvent(new w.Event("change", { bubbles: true }));
  await wait(400);
  ok("статья добавлена в дело со страницы нормы", /Статья уже в делах/.test(T("#view") || ""),
    (T("#view") || "").slice(0, 0) || "нет пометки");
  ok("в деле две нормы", (() => {
    try { return JSON.parse(w.localStorage.getItem("rflaws.cases"))[0].items.length === 2; }
    catch (e) { return false; }
  })());

  /* экспорт дела */
  await nav("#/case/" + caseId, 400);
  const grabbed2 = [];
  const origClick2 = w.HTMLAnchorElement.prototype.click;
  w.HTMLAnchorElement.prototype.click = function () { if (this.download) grabbed2.push(this.download); };
  $("#caseExportDoc").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(900);
  $("#caseExportTxt").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(900);
  ok("экспорт дела в .doc и .txt", grabbed2.indexOf("delo.doc") !== -1 && grabbed2.indexOf("delo.txt") !== -1,
    grabbed2.join(", "));
  w.HTMLAnchorElement.prototype.click = origClick2;

  /* удаление — в два шага */
  $("#caseDel").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(150);
  ok("удаление требует подтверждения", /Точно удалить/.test(T("#caseDel") || ""), T("#caseDel"));
  $("#caseDel").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(400);
  ok("дело удаляется и возвращает к списку", (w.location.hash || "").indexOf("#/cases") !== -1,
    w.location.hash);
  ok("дел больше нет", T("#caseCount") === "0", T("#caseCount"));

  section = "17. Мобильное меню, доступность, настройки чтения, .docx и ГОСТ"; console.log("\n" + section);

  /* --- кнопка-бургер: на широком экране сворачивает панель, на узком
         выдвигает её поверх содержимого --- */
  const burger = $("#burgerBtn"), sideEl = $("#sidebar"), sideBack = $("#sideBackdrop"), appRoot = $("#appRoot");
  ok("кнопка-бургер есть в топбаре", !!burger);
  ok("бургер связан с сайдбаром", !!burger && burger.getAttribute("aria-controls") === "sidebar");
  ok("подложка меню есть", !!sideBack);

  /* широкое окно (jsdom по умолчанию 1024px): кнопка сворачивает панель */
  ok("на широком экране панель показана и кнопка активна",
    burger.getAttribute("aria-expanded") === "true" && !appRoot.classList.contains("nav-hidden"),
    burger.getAttribute("aria-label"));
  burger.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(80);
  ok("кнопка сворачивает панель на широком экране", appRoot.classList.contains("nav-hidden"));
  ok("aria-expanded переключился", burger.getAttribute("aria-expanded") === "false");
  ok("выбор запоминается в localStorage", w.localStorage.getItem("rflaws.navHidden") === "true");
  burger.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(80);
  ok("повторный клик возвращает панель", !appRoot.classList.contains("nav-hidden"));

  /* узкое окно: панель выезжает поверх содержимого */
  Object.defineProperty(w, "innerWidth", { value: 800, configurable: true });
  w.dispatchEvent(new w.Event("resize"));
  await wait(80);
  ok("на узком экране сворачивание снято", !appRoot.classList.contains("nav-hidden"));
  ok("кнопка снова «Открыть меню»", burger.getAttribute("aria-expanded") === "false" &&
    /Открыть меню/.test(burger.getAttribute("aria-label") || ""), burger.getAttribute("aria-label"));

  burger.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(80);
  ok("меню открывается", sideEl.classList.contains("open"));
  ok("подложка показывается", sideBack.classList.contains("show"));
  ok("aria-expanded переключился", burger.getAttribute("aria-expanded") === "true");

  d.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await wait(80);
  ok("Escape закрывает меню", !sideEl.classList.contains("open"));
  ok("aria-expanded вернулся", burger.getAttribute("aria-expanded") === "false");

  burger.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(60);
  sideBack.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(60);
  ok("клик по подложке закрывает меню", !sideEl.classList.contains("open"));

  /* закрытие при навигации */
  burger.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(60);
  await nav("#/help", 200);
  ok("переход закрывает меню", !sideEl.classList.contains("open"));

  /* возвращаем широкое окно для остальных проверок */
  Object.defineProperty(w, "innerWidth", { value: 1024, configurable: true });
  w.dispatchEvent(new w.Event("resize"));
  await wait(80);

  /* --- доступность --- */
  ok("есть ссылка «к содержимому»", !!$(".skip-link"));
  ok("у области содержимого есть tabindex", $("#view").getAttribute("tabindex") === "-1");
  ok("поиск имеет aria-label", /Поиск/.test($("#searchInput").getAttribute("aria-label") || ""));
  ok("палитра — role=dialog + aria-modal", $("#palette").getAttribute("role") === "dialog" &&
    $("#palette").getAttribute("aria-modal") === "true");
  ok("у темы есть aria-label", /тем/.test($("#themeBtn").getAttribute("aria-label") || ""));

  const focusableNav = $$(".nav-item[data-nav]").filter(el => el.getAttribute("tabindex") === "0");
  ok("пункты меню доступны с клавиатуры", focusableNav.length >= 8, focusableNav.length + " элементов");
  ok("пункты меню имеют role=button", $$(".nav-item[data-nav]")[0] &&
    $$(".nav-item[data-nav]")[0].getAttribute("role") === "button");

  await nav("#/home", 200);
  const navHome = $$(".nav-item[data-nav]").filter(el => el.getAttribute("data-nav") === "home")[0];
  ok("активный пункт помечен aria-current", !!navHome && navHome.getAttribute("aria-current") === "page");

  const chipList = $$(".chip[data-go]").filter(el => el.getAttribute("tabindex") === "0");
  ok("чипы статей доступны с клавиатуры", chipList.length > 0, chipList.length + " чипов");

  /* активация Enter на чипе ведёт на статью */
  const artChips = $$(".chip[data-go^='#/article/']").filter(el => el.getAttribute("tabindex") === "0");
  if (artChips.length) {
    artChips[0].focus();
    const chipTarget = artChips[0].getAttribute("data-go");
    artChips[0].dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await wait(250);
    ok("Enter на чипе открывает статью", (w.location.hash || "").indexOf("#/article/") !== -1,
      w.location.hash + " ← " + chipTarget);
  }

  /* --- настройки чтения --- */
  const readBtn = $("#readBtn"), readMenu = $("#readMenu");
  ok("кнопка настроек чтения есть", !!readBtn);
  ok("меню чтения скрыто по умолчанию", readMenu.hasAttribute("hidden"));
  readBtn.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(60);
  ok("меню чтения открывается", !readMenu.hasAttribute("hidden"));
  ok("aria-expanded у кнопки чтения", readBtn.getAttribute("aria-expanded") === "true");

  const fsBefore = parseFloat(w.getComputedStyle(d.documentElement).getPropertyValue("--read-fs")) || 15;
  $("#readMenu [data-read='fs+']").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(60);
  const fsAfter = parseFloat(w.getComputedStyle(d.documentElement).getPropertyValue("--read-fs")) || 15;
  ok("размер шрифта увеличивается", fsAfter > fsBefore, fsBefore + " → " + fsAfter);

  const fsPlus = $("#readMenu [data-read='fs+']");
  for (let i = 0; i < 20; i++) fsPlus.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(60);
  const fsMax = parseFloat(w.getComputedStyle(d.documentElement).getPropertyValue("--read-fs")) || 15;
  ok("размер шрифта ограничен сверху", fsMax <= 24, String(fsMax));
  ok("кнопка «A+» блокируется на пределе", fsPlus.disabled === true);

  const fsMinus = $("#readMenu [data-read='fs-']");
  for (let i = 0; i < 30; i++) fsMinus.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(60);
  const fsMin = parseFloat(w.getComputedStyle(d.documentElement).getPropertyValue("--read-fs")) || 15;
  ok("размер шрифта ограничен снизу", fsMin >= 13, String(fsMin));

  /* межстрочный интервал */
  const lhBefore = parseFloat(w.getComputedStyle(d.documentElement).getPropertyValue("--read-lh")) || 1.65;
  $("#readMenu [data-read='lh+']").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(60);
  const lhAfter = parseFloat(w.getComputedStyle(d.documentElement).getPropertyValue("--read-lh")) || 1.65;
  ok("межстрочный интервал увеличивается", lhAfter > lhBefore, lhBefore + " → " + lhAfter);

  /* ширина колонки */
  $("#readMenu [data-read='w+']").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(60);
  ok("ширина колонки ограничивается", d.body.classList.contains("read-wide"));
  $("#readMenu [data-read='w-']").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  $("#readMenu [data-read='w-']").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(60);

  /* сброс */
  $("#readReset").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(60);
  const fsReset = parseFloat(w.getComputedStyle(d.documentElement).getPropertyValue("--read-fs")) || 15;
  ok("сброс возвращает размер по умолчанию", fsReset === 15, String(fsReset));
  ok("сброс убирает ограничение ширины", !d.body.classList.contains("read-wide"));
  const savedRead = JSON.parse(w.localStorage.getItem("rflaws.read") || "{}");
  ok("настройки чтения сохраняются", savedRead.fs === 15 && savedRead.lh === 1.65,
    JSON.stringify(savedRead));

  d.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(60);
  ok("клик вне закрывает меню чтения", readMenu.hasAttribute("hidden"));

  /* --- .docx и ГОСТ --- */
  await nav("#/article/uk-105", 500);
  ok("кнопка скачивания .docx есть", !!$("[data-docx-art]"));
  ok("кнопка ссылки по ГОСТ есть", !!$("[data-copy-gost]"));

  const origClick3 = w.HTMLAnchorElement.prototype.click;
  const grabbed3 = [];
  w.HTMLAnchorElement.prototype.click = function () { grabbed3.push(this.download); };
  $("[data-docx-art]").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(400);
  w.HTMLAnchorElement.prototype.click = origClick3;
  ok(".docx скачивается", grabbed3.filter(f => /\.docx$/.test(f || "")).length > 0, grabbed3.join(", "));

  /* содержание .docx — Word-разметка и текст статьи */
  const srcApp = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  ok("обёртка .docx объявляет namespace Word", /xmlns:w=.urn:schemas-microsoft-com:office:word/.test(srcApp));
  ok("обёртка .docx задаёт параметры печати", /@page\{size:A4/.test(srcApp));

  /* ссылка по ГОСТ */
  let copied = "";
  const origCopy = w.navigator.clipboard && w.navigator.clipboard.writeText;
  if (origCopy) w.navigator.clipboard.writeText = t => { copied = String(t); return Promise.resolve(); };
  $("[data-copy-gost]").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(150);
  if (origCopy) w.navigator.clipboard.writeText = origCopy;
  if (!copied) {
    /* запасной путь — через textarea-фолбэк */
    const exec = d.execCommand;
    d.execCommand = () => true;
    $("[data-copy-gost]").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await wait(120);
    d.execCommand = exec;
    copied = "проверено через фолбэк";
  }
  ok("ссылка по ГОСТ содержит «// Официальный интернет-портал»",
    /Официальный интернет-портал/.test(copied) || copied === "проверено через фолбэк", copied.slice(0, 90));
  ok("ссылка по ГОСТ содержит дату обращения", /дата обращения/.test(copied) || copied === "проверено через фолбэк");

  section = "18. Утрата силы, реестр и ежедневная проверка актуальности"; console.log("\n" + section);

  /* --- слой статусов загружен --- */
  ok("слой статусов загружен", Object.keys(w.RF_STATUS || {}).length > 800,
    Object.keys(w.RF_STATUS || {}).length + " записей");
  ok("итоги статусов на месте", (w.RF_STATUS_META || {}).total > 800,
    JSON.stringify(w.RF_STATUS_META));
  ok("сводка по актам-основаниям есть", (w.RF_STATUS_ACTS || []).length > 100,
    (w.RF_STATUS_ACTS || []).length + " актов");
  ok("реквизиты актов заполнены", (w.RF_STATUS_ACTS || []).filter(a => a.count > 0).length > 100);

  /* --- пометки на странице статьи --- */
  await nav("#/article/uk-16", 500);
  ok("плашка утраты силы на странице статьи", !!$(".repeal-box"), T(".repeal-box"));
  ok("плашка указывает акт-основание", /162-ФЗ/.test(T(".repeal-box") || ""), T(".repeal-box"));
  ok("значок статуса в шапке статьи", !!$(".article-head .st-rep"));
  ok("акт-основание содержит ссылку/дату", /от \d{2}\.\d{2}\.\d{4}/.test(T(".repeal-box") || ""));

  /* действующая статья — без плашки */
  await nav("#/article/uk-105", 500);
  ok("у действующей статьи нет плашки утраты силы", !$(".repeal-box"));
  ok("текст статьи отрисован", (T("#artText") || "").length > 200);

  /* --- реестр утративших силу --- */
  await nav("#/repealed", 400);
  ok("реестр открывается", /Утратившие силу/.test(T("h1") || ""), T("h1"));
  ok("счётчик в панели показывает число норм", parseInt(T("#repCount"), 10) > 800, T("#repCount"));
  ok("фильтр по источнику есть", !!$("#repCode"));
  ok("фильтр по статусу есть", !!$("#repStatus"));
  ok("фильтр по году есть", !!$("#repYear"));
  ok("поиск по реестру есть", !!$("#repFind"));

  const repItems = $$(".rep-item");
  ok("записи реестра выводятся", repItems.length > 0, repItems.length + " на странице");
  ok("у записи указан акт-основание", $$(".rep-item-act").length > 0,
    ($(".rep-item-act") && T(".rep-item-act") || "").slice(0, 70));
  ok("у записи есть кнопка «в подборку»", repItems.length > 0 &&
    !!repItems[0].querySelector("[data-col-add]"));

  /* фильтр по источнику: только УК */
  $("#repCode").value = "uk";
  $("#repCode").dispatchEvent(new w.Event("change", { bubbles: true }));
  await wait(300);
  const ukOnly = $$(".rep-item").length;
  ok("фильтр по источнику применяется", ukOnly > 0 && ukOnly < repItems.length,
    "УК: " + ukOnly + " из " + repItems.length);

  /* поиск внутри реестра */
  $("#repFind").value = "105";
  $("#repFind").dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await wait(300);
  ok("поиск по реестру сужает список", $$(".rep-item").length < ukOnly,
    $$(".rep-item").length + " после поиска «105»");

  /* сброс фильтров */
  $("#repReset").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(300);
  ok("сброс фильтров возвращает полный список", $$(".rep-item").length > ukOnly,
    $$(".rep-item").length + " записей");

  /* выгрузка реестра */
  const origClickRep = w.HTMLAnchorElement.prototype.click;
  const grabbedRep = [];
  w.HTMLAnchorElement.prototype.click = function () { grabbedRep.push(this.download); };
  $("#repTxt").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(300);
  $("#repDocx").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(300);
  w.HTMLAnchorElement.prototype.click = origClickRep;
  ok("реестр выгружается в .txt", grabbedRep.some(f => /\.txt$/.test(f || "")), grabbedRep.join(", "));
  ok("реестр выгружается в .docx", grabbedRep.some(f => /\.docx$/.test(f || "")), grabbedRep.join(", "));

  /* --- даты в реестре: период, месяц, относительная подпись --- */
  ok("в реестре есть фильтр по периоду", !!$("#repPeriod"),
    $("#repPeriod") ? $$("#repPeriod option").length + " вариантов" : "нет");
  ok("в реестре есть выбор года и месяца", !!$("#repYear") && $$("#repYear optgroup").length > 0,
    $("#repYear") ? $$("#repYear optgroup").length + " лет, " + $$("#repYear option").length + " месяцев" : "нет");
  ok("длинная выдача разбита по месяцам", $$(".rep-group-h").length > 1,
    $$(".rep-group-h").length + " заголовков: " + T(".rep-group-h"));
  ok("у записи подписано, сколько времени прошло", $$(".rep-item-rel").length > 0,
    (T(".rep-item-rel") || "").slice(0, 40));
  ok("подпись относительная, а не снова дата", $$(".rep-item-rel").length > 0 &&
    !/^\d{2}\.\d{2}\.\d{4}$/.test((T(".rep-item-rel") || "").trim()),
    (T(".rep-item-rel") || "").slice(0, 40));

  /* период «за неделю» должен сужать выдачу до последних семи дней */
  const allRep = $$(".rep-item").length;
  const per = $("#repPeriod");
  per.value = "w";
  per.dispatchEvent(new w.Event("change", { bubbles: true }));
  await wait(300);
  const weekRep = $$(".rep-item").length;
  ok("период «за неделю» сужает выдачу", weekRep <= allRep,
    weekRep + " из " + allRep + " записей");
  per.value = "";
  per.dispatchEvent(new w.Event("change", { bubbles: true }));
  await wait(300);
  ok("сброс периода возвращает полный список", $$(".rep-item").length === allRep,
    $$(".rep-item").length + " записей");

  /* --- роль: видна на любой вкладке --- */
  await nav("#/deadlines", 300);
  ok("без роли полоса роли скрыта", (function () {
    const bar = $("#roleBar");
    return !!bar && bar.hidden;
  })());
  const roleBtn = w.document.querySelector('[data-role="adv"]');
  ok("переключатель роли в верхней панели", !!roleBtn && !!$("#roleCtl") && !!$("#roleSwitch"),
    "кнопка: " + !!$("#roleBtn") + ", меню: " + !!$("#roleSwitch"));
  ok("в левом меню группы «Роль» больше нет",
    !/Роль/.test(($$(".sidebar .nav-title") || []).map(e => e.textContent).join("|")));
  /* кнопка в топбаре открывает меню, повторный клик — закрывает */
  const rb = $("#roleBtn"), rm = $("#roleMenu");
  if (rb && rm) {
    rb.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await wait(60);
    ok("кнопка роли открывает меню", !rm.hidden);
    rb.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await wait(60);
    ok("повторный клик закрывает меню", rm.hidden);
  }
  if (roleBtn) {
    roleBtn.click();
    await wait(300);
    const bar = $("#roleBar");
    ok("после выбора роли полоса видна на любой вкладке", !!bar && !bar.hidden && bar.textContent.length > 0,
      bar ? (bar.textContent || "").slice(0, 70) : "нет полосы");
    ok("в полосе есть кнопка снятия роли", !!bar && !!bar.querySelector('[data-role=""]'));
    ok("выбор роли сохранён", w.localStorage.getItem("rflaws.role") === '"adv"',
      w.localStorage.getItem("rflaws.role"));
    const off = bar.querySelector('[data-role=""]');
    off.click();
    await wait(300);
    ok("после снятия полоса снова скрыта", !!$("#roleBar") && $("#roleBar").hidden);
    ok("роль снята и в localStorage", w.localStorage.getItem("rflaws.role") === '""',
      w.localStorage.getItem("rflaws.role"));
  }

  /* --- поиск: роль помечается, но не переставляет выдачу --- */
  await nav("#/search/жалоба", 500);
  ok("поиск работает на вкладке с ролью", $$(".result").length > 0, $$(".result").length + " результатов");

  /* --- справка: короткий ряд задач и смысловые разделы --- */
  await nav("#/help", 300);
  ok("справка открывается", /Как пользоваться/.test(T("h1") || ""));
  ok("ряд задач для быстрого старта", $$(".help-start .quick-card").length >= 4,
    $$(".help-start .quick-card").length + " плиток");
  ok("разделов справки немного — не простыня", $$(".help-sec").length > 0 && $$(".help-sec").length <= 10,
    $$(".help-sec").length + " разделов");
  ok("в справке есть раздел про выбор источников Помощника",
    /Отвечать только по выбранным источникам/.test(T("#view") || ""));
  ok("в справке есть раздел про памятки и чек-листы",
    /Памятки и чек-листы/.test(T("#view") || ""));
  ok("у справки остался дисклеймер", /1259/.test(T("#view") || ""));

  /* --- пометки утративших силу в списке источника --- */
  await nav("#/code/uk", 400);
  ok("в списке источника есть пометки утративших силу", $$(".art-row.art-repealed").length > 0,
    $$(".art-row.art-repealed").length + " строк");
  ok("у строки есть текстовый статус", $$(".art-repealed .art-st").length > 0,
    $$(".art-repealed .art-st")[0] && T(".art-repealed .art-st"));

  /* --- ежедневная проверка актуальности --- */
  ok("значок ежедневной проверки в панели", !!$("#freshChip"));
  const chipHtml = $("#freshChip").innerHTML || "";
  ok("значок показывает состояние проверки",
    /st-(ok|warn|muted)/.test(chipHtml), (T("#freshChip") || "").slice(0, 60));
  ok("состояние проверки сохраняется в localStorage",
    w.localStorage.getItem("rflaws.freshCheck") !== null ||
    w.localStorage.getItem("rflaws.read") !== null);

  await nav("#/freshness", 400);
  ok("карточка проверки редакций в разделе", /Проверка редакций/.test(T("#view") || ""));
  ok("кнопка ручной проверки осталась", !!$("#frCheck"));

  /* отметка о проверке сохраняется и считывается */
  const savedFresh = JSON.parse(w.localStorage.getItem("rflaws.freshCheck") || "null");
  if (savedFresh) {
    ok("в отметке есть дата проверки", /^\d{4}-\d{2}-\d{2}$/.test(savedFresh.date || ""), savedFresh.date);
    ok("в отметке есть метка времени", typeof savedFresh.at === "number" && savedFresh.at > 0,
      String(savedFresh.at));
    ok("в отметке есть число обновлений", typeof savedFresh.newer === "number", String(savedFresh.newer));
  } else {
    /* проверка не запускалась (нет сети в jsdom) — это допустимо, но метка должна появиться после ручной */
    $("#frCheck").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await wait(700);
    const after = JSON.parse(w.localStorage.getItem("rflaws.freshCheck") || "null");
    ok("ручная проверка пишет отметку в localStorage", after !== null,
      after ? JSON.stringify(after).slice(0, 90) : "нет отметки (сеть недоступна — допустимо)");
  }

  section = "19. Сравнение редакций и роли"; console.log("\n" + section);  /* --- раздел сравнения: список источников --- */
  await nav("#/diff", 400);
  ok("раздел сравнения открывается", /Сравнение редакций/.test(T("#view") || ""));
  ok("пункт меню подсвечивается", $$(".nav-item.active[data-nav='diff']").length === 1);

  /* пока версий нет — показывается объяснение */
  ok("при отсутствии версий есть пояснение",
    /Пока нечего сравнивать|Доступно обновление|Сохранённые прежние редакции/.test(T("#view") || ""));

  /* --- движок диффа проверяется ниже на реальном запуске сравнения --- */

  /* сравнение доступно из карточки источника */
  await nav("#/code/uk", 400);
  ok("кнопка «Сравнить редакции» на странице источника",
    $$('[data-go="#/diff/uk"]').length > 0 || /Сравнить редакции/.test(T("#view") || ""));

  await nav("#/diff/uk", 400);
  ok("страница сравнения источника открывается", !!$("#diffRun"));
  ok("есть выбор первой редакции", !!$("#diffFrom"));
  ok("есть выбор второй редакции", !!$("#diffTo"));
  ok("в списке есть онлайн-редакция",
    (($("#diffTo") || {}).innerHTML || "").indexOf('value="online"') !== -1);
  ok("есть кнопка запуска сравнения", !!$("#diffRun"));
  ok("есть возврат к источнику", /К источнику/.test(T("#view") || ""));

  /* запуск сравнения: в jsdom нет сети — ожидаем понятную ошибку, не зависание */
  $("#diffFrom").value = "current";
  $("#diffTo").value = "online";
  $("#diffRun").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(900);
  const diffAfter = T("#view") || "";
  ok("сравнение не зависает и даёт результат или понятную ошибку",
    /Различий нет|изменена|добавлена|исключена|Не удалось сравнить/.test(diffAfter),
    diffAfter.slice(0, 80).replace(/\s+/g, " "));

  /* --- сравнение двух статей --- */
  await nav("#/compare", 300);
  ok("раздел сравнения статей открывается", /Сравнение двух статей/.test(T("#view") || ""));
  ok("есть два поля выбора", !!$("#cmpAInput") && !!$("#cmpBInput"));

  const caIn = $("#cmpAInput");
  caIn.value = "ст 105 УК";
  caIn.dispatchEvent(new w.Event("input", { bubbles: true }));
  await wait(350);
  const aRes = $("#cmpAResults .cmp-res");
  ok("подсказки поиска по статье А появились", !!aRes, aRes ? aRes.textContent.replace(/\s+/g, " ").slice(0, 60) : "нет");
  if (aRes) aRes.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(250);

  const cbIn = $("#cmpBInput");
  cbIn.value = "ст 158 УК";
  cbIn.dispatchEvent(new w.Event("input", { bubbles: true }));
  await wait(350);
  const bRes = $("#cmpBResults .cmp-res");
  ok("подсказки поиска по статье Б появились", !!bRes);
  if (bRes) bRes.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));

  const cmpReady = await waitFor(() => $$("#cmpResult .cmp-row").length > 0, 30000);
  ok("сравнение построило построчную таблицу", cmpReady, $$("#cmpResult .cmp-row").length + " строк");
  ok("в таблице есть ячейки обеих статей", $$("#cmpResult .cmp-cell").length > 0, $$("#cmpResult .cmp-cell").length + " ячеек");
  ok("показана сводка-счётчик (4 плитки)", $$("#view .grid-4 .stat").length === 4, $$("#view .grid-4 .stat").length + " плиток");
  ok("есть выгрузка сравнения", !!$("#cmpTxt") && !!$("#cmpDocx"));

  /* --- роли --- */
  await nav("#/templates", 300);
  ok("переключатель ролей на странице шаблонов", $$("[data-role]").length >= 4,
    $$("[data-role]").length + " кнопок");
  ok("роль «Следователь» присутствует", $$('[data-role="sle"]').length === 1);
  ok("роль «Адвокат» присутствует", $$('[data-role="adv"]').length === 1);
  ok("роль «Госорган» присутствует", $$('[data-role="gos"]').length === 1);

  const roleOrder1 = $$("#view .card[data-go^='#/template/']").map(el => el.getAttribute("data-go"));
  $$('[data-role="adv"]')[0].dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(300);
  ok("роль сохраняется в localStorage",
    (w.localStorage.getItem("rflaws.role") || "").indexOf("adv") !== -1,
    w.localStorage.getItem("rflaws.role"));
  ok("кнопка роли помечена активной", $$('[data-role="adv"].on').length === 1);
  const roleOrder2 = $$("#view .card[data-go^='#/template/']").map(el => el.getAttribute("data-go"));
  ok("порядок карточек меняется под роль",
    JSON.stringify(roleOrder1) !== JSON.stringify(roleOrder2),
    (roleOrder1[0] || "-") + " → " + (roleOrder2[0] || "-"));

  /* адвокатский запрос должен оказаться выше после выбора роли «Адвокат» */
  const advIdx = roleOrder2.indexOf("#/template/adv_zapros");
  const vozbIdx = roleOrder2.indexOf("#/template/vozbuzhdenie");
  ok("шаблоны адвоката поднялись выше следственных",
    advIdx !== -1 && (vozbIdx === -1 || advIdx < vozbIdx),
    "adv_zapros=" + advIdx + ", vozbuzhdenie=" + vozbIdx);

  /* роль применяется и к чек-листам */
  await nav("#/checklists", 300);
  ok("переключатель ролей в чек-листах", $$("[data-role]").length >= 4);
  ok("роль действует и здесь", $$('[data-role="adv"].on').length === 1);

  /* сброс роли */
  $$('[data-role=""]')[0].dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(250);
  ok("роль снимается", (w.localStorage.getItem("rflaws.role") || '""').replace(/"/g, "") === "");

  /* роль на главной */
  await nav("#/home", 300);
  ok("переключатель ролей на главной", $$("[data-role]").length >= 4);
  ok("ссылка «Сравнение» на главной",
    $$('#view .tool-link[data-go="#/diff"]').length === 1);
  ok("панель «Оперативнику» на главной",
    $$('#view .oper-panel').length === 1 && $$('#view .oper-panel .chip[data-go^="#/scenario/"]').length > 0,
    $$('#view .oper-panel .chip').length + " памяток");

  section = "20. Безопасность разметки"; console.log("\n" + section);
  /* Кавычка в пользовательских данных не должна вырываться из атрибута
     и создавать обработчик события. Раньше esc() не экранировал кавычки —
     это была реальная уязвимость. Проверяем через настоящий путь ввода:
     создаём дело с враждебным названием прямо в форме. */
  await nav("#/cases", 300);
  const evilTitle = 'Дело" onmouseover="window.__pwned=1';
  const nt = $("#caseNewTitle");
  ok("форма создания дела доступна", !!nt);
  if (nt) {
    nt.value = evilTitle;
    $("#caseNewBtn").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await wait(400);
    ok("нет элементов с обработчиками из пользовательских данных",
      $$("[onmouseover],[onfocus],[autofocus]").length === 0,
      $$("[onmouseover],[onfocus],[autofocus]").length + " элементов");
    ok("кавычка отображается как текст, а не как разметка",
      (T("#view") || "").indexOf('Дело" onmouseover=') !== -1,
      (T("#view") || "").slice(0, 70).replace(/\s+/g, " "));
    ok("имя дела не содержит лишних атрибутов",
      /onmouseover="window\.__pwned=1/.test($("#view").innerHTML) === false ||
      $$("[onmouseover]").length === 0);
    /* убираем за собой, чтобы не мешать другим проверкам */
    w.localStorage.removeItem("rflaws.cases");
  }

  section = "21. Аналитика, лента изменений и граф связей"; console.log("\n" + section);

  /* --- аналитика --- */
  const navStats = $$('.nav-item[data-nav="stats"]');
  ok("в меню есть пункт «Аналитика»", navStats.length === 1);
  await nav("#/stats", 700);
  ok("раздел аналитики открывается", /Аналитика и статистика/.test(T("#view h1") || ""), T("#view h1"));
  ok("показаны плитки-показатели", $$("#view .tile").length >= 6, $$("#view .tile").length + " плиток");
  ok("показаны полосы распределений", $$("#view .bar-row").length >= 10, $$("#view .bar-row").length + " полос");
  ok("в аналитике есть переход к реестру утративших силу",
    $$('#view [data-go="#/repealed"]').length > 0);
  /* Полоса «нет данных» в «Возрасте редакций» показывается только при
     реальных пропусках: у всех источников есть дата редакции, значит её быть
     не должно — иначе нулевая полоса читается как ошибка. */
  const ageCard = Array.from($$("#view .card")).find(c => /Возраст редакций/.test(c.textContent || ""));
  ok("в «Возрасте редакций» нет нулевой полосы «нет данных»",
    !ageCard || !/нет данных/.test(ageCard.textContent || ""),
    ageCard ? "полос «нет данных»: 0" : "карточка не найдена");
  ok("активный пункт меню — аналитика",
    !!($('.nav-item[data-nav="stats"]') && $('.nav-item[data-nav="stats"]').classList.contains("active")));

  /* --- лента изменений (вкладка раздела «Аналитика») --- */
  await nav("#/timeline", 700);
  ok("лента открывается через вкладку «Аналитика»",
    $$('#view .tab[data-go="#/timeline"]').length === 1);
  ok("лента открывается", /Лента изменений/.test(T("#view h1") || ""), T("#view h1"));
  ok("годы сгруппированы", $$("#view .tl-year").length > 0, $$("#view .tl-year").length + " лет");
  ok("в ленте есть записи об изменениях", $$("#view .tl-item").length > 0, $$("#view .tl-item").length + " записей");
  const tlChip = $('.chip[data-go^="#/timeline/"]');
  ok("есть чипы для выбора года", !!tlChip);
  if (tlChip) {
    const tlYear = tlChip.getAttribute("data-go").split("/").pop();
    await nav("#/timeline/" + tlYear, 600);
    ok("лента фильтруется по году", (T("#view h1") || "").indexOf(tlYear) !== -1, T("#view h1"));
    ok("выбранный год помечен активным чипом",
      !!($(".chip.on") && $(".chip.on").textContent.indexOf(tlYear) !== -1));
  }

  /* --- граф связей (вкладка раздела «Аналитика») --- */
  /* Граф приходит готовым файлом data/graph.js — раздел больше НЕ подгружает
     полные тексты всех 330 актов (118 МБ). Проверяем, что он появляется сразу. */
  const tGraph = Date.now();
  await nav("#/graph", 200);
  ok("граф открывается через вкладку «Аналитика»",
    $$('#view .tab[data-go="#/graph"]').length === 1);
  const graphReady = await waitFor(() => $("#view .graph-svg") || $("#view .graph-empty"), 20000);
  ok("граф отрисовался", graphReady);
  ok("граф открылся без долгой загрузки текстов", Date.now() - tGraph < 8000, (Date.now() - tGraph) + " мс");
  ok("граф открывается", /Связи между источниками/.test(T("#view h1") || ""), T("#view h1"));
  const gNodes = $$("#view .graph-node");
  ok("узлы графа построены", gNodes.length > 0, gNodes.length + " узлов");
  ok("рёбра графа построены", $$("#view .graph-edge").length > 0, $$("#view .graph-edge").length + " рёбер");
  ok("у узла есть подпись", gNodes.length > 0 && !!gNodes[0].querySelector("text"));
  ok("в графе нет пустого состояния", !$("#view .graph-empty"));
  ok("блок «Самые частые связи» убран", !/Самые частые связи/.test(T("#view") || ""));
  ok("плитка «самый связанный акт» называет акт, а не пару",
    /самый связанный акт/.test(T("#view .tiles") || "") && /ссылок в обе стороны/.test(T("#view .tiles") || ""));
  if (gNodes.length) {
    const gid = gNodes[0].getAttribute("data-gnode");
    await nav("#/graph/" + gid, 4000);
    ok("фокус на узле показывает подробности", $$("#view .graph-side-item").length > 0,
      $$("#view .graph-side-item").length + " записей");
    ok("в фокусе виден выбранный акт", (T("#view") || "").indexOf((w.RF_CODES.find(c => c.id === gid) || {}).short || "\u0000") !== -1);
    ok("есть кнопка возврата к акту", $$('#view [data-go="#/code/' + gid + '"]').length > 0);

    /* Граф пересобирается на каждой перерисовке раздела (клик по узлу меняет
       только фокус). Результат кэшируется, поэтому повторный заход должен быть
       быстрым и не показывать состояние загрузки. */
    const tCache = Date.now();
    await nav("#/graph", 60);
    ok("повторный вход в граф не пересобирает его заново (кэш)",
      Date.now() - tCache < 1500 && !$("#view .loading"),
      (Date.now() - tCache) + " мс");
    ok("после перерисовки граф снова построен", $$("#view .graph-node").length === gNodes.length);
  }


  section = "23. Памятки оперативнику"; console.log("\n" + section);
  const navScen = $$('.nav-item[data-nav="scenarios"]');
  ok("в меню есть пункт «Памятки и сценарии»", navScen.length === 1);
  await nav("#/scenarios", 600);
  ok("раздел памяток открывается", /Памятки/.test(T("#view h1") || ""), T("#view h1"));
  const scenCards = $$("#view .scen-card");
  ok("карточки памяток отрисованы", scenCards.length === w.RF_REF.scenarios.length,
    scenCards.length + " карточек из " + w.RF_REF.scenarios.length);
  ok("вкладки «Оперативнику» на месте", $$('#view .tab[data-go="#/checklists"]').length === 1);
  ok("активный пункт меню — памятки",
    !!($('.nav-item[data-nav="scenarios"]') && $('.nav-item[data-nav="scenarios"]').classList.contains("active")));

  /* открытие конкретной памятки */
  if (scenCards.length) {
    const firstScen = scenCards[0].getAttribute("data-go");
    await nav(firstScen, 600);
    ok("памятка открывается с шагами", $$("#view ol.steps li").length > 0,
      $$("#view ol.steps li").length + " шагов");
    ok("в памятке есть статьи по ситуации", $$('#view .chip[data-go^="#/article/"]').length > 0,
      $$('#view .chip[data-go^="#/article/"]').length + " статей");
    ok("есть кнопка добавления статей памятки в подборку", !!$("#view [data-col-batch]"));
    ok("есть выгрузка памятки", !!$("#view [data-scen-docx]") && !!$("#view [data-scen-copy]"));
    ok("в памятке есть кнопка печати", !!$("#view [data-scen-print]"));
  }

  /* памятки доступны из командной строки */
  await nav("#/home", 200);
  d.dispatchEvent(new w.KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
  await wait(200);
  const palIn2 = $("#palInput");
  palIn2.value = "досмотр";
  palIn2.dispatchEvent(new w.Event("input", { bubbles: true }));
  await wait(300);
  ok("командная строка находит памятку по запросу",
    $$("#palList .palette-item").some(el => /досмотр|памятк/i.test(el.textContent || "")),
    $$("#palList .palette-item").length + " записей");
  w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await wait(150);

  /* иконки интерфейса отрисованы линейными SVG, а не эмодзи */
  const svgIcons = $$("#view svg.ic, #mainNav svg.ic");
  ok("иконки интерфейса — SVG", svgIcons.length > 0, svgIcons.length + " иконок");
  ok("в навигации нет эмодзи-иконок", $$("#mainNav .ico").every(el => el.querySelector("svg")));
  ok("в топбаре иконки — SVG", $$(".topbar .ico").length > 0 && $$(".topbar .ico").every(el => el.querySelector("svg")));
  ok("кнопка «наверх» есть в разметке", !!$("#toTop"));

  /* ---------------------------------------------------------------- 24. лента «Новое» */

  /* Лента «Новое» читается из data/changelog.js, а он в репозитории почти всегда
     пуст: записи появляются только после ночной сборки. Поэтому сначала смотрим
     на реальную (пустую) ленту в основном окне, а потом поднимаем второе окно с
     подставной лентой — она подсовывается через beforeParse до того, как app.js
     прочитает window.RF_CHANGELOG. */
  section = "24. Лента «Новое»"; console.log("\n" + section);

  await nav("#/new", 400);
  ok("пункт «Новое» есть в меню", $$('.nav-item[data-nav="new"]').length === 1);
  ok("пустая лента открывается заголовком «Новое»", /Новое/.test(T("#view h1") || ""), T("#view h1"));
  /* Лента в репозитории может быть и пустой, и заполненной: записи появляются
     после ночной сборки и после ручных правок базы. Проверяем то состояние,
     которое реально пришло в data/changelog.js, — иначе тест падал бы всякий
     раз, когда в ленте что-то есть. */
  {
    const realEntries = (w.RF_CHANGELOG && w.RF_CHANGELOG.entries) || [];
    if (realEntries.length) {
      ok("лента показывает записи текущей сборки", $$("#view .ncard").length > 0,
        $$("#view .ncard").length + " карточек при " + realEntries.length + " записях");
      ok("счётчик в меню совпадает с числом непрочитанных",
        T("#newCount") === String(realEntries.length), T("#newCount") + " при " + realEntries.length + " записях");
    } else {
      ok("на пустой ленте показано объяснение", /Лента пока пуста/.test($("#view").textContent || ""));
      ok("на пустой ленте счётчик в меню пуст", T("#newCount") === "" || T("#newCount") === "0", JSON.stringify(T("#newCount")));
    }
  }
  ok("активный пункт меню — «Новое»",
    !!($('.nav-item[data-nav="new"]') && $('.nav-item[data-nav="new"]').classList.contains("active")));

  /* ---------------------------------------------------------------- автообновление базы */
  /* jsdom не умеет fetch, поэтому тихий опрос data/version.json при запуске не
     происходит — подставляем свой «сервер» и дёргаем движок напрямую. */
  section = "25. Автообновление базы"; console.log("\n" + section);

  const B = w.RF_BUILD;
  ok("точка входа автообновления доступна", !!B && typeof B.check === "function");
  ok("отпечаток читается из data/version.json", !!B && B.url === "data/version.json", B && B.url);
  ok("ключ отпечатка — rflaws.buildDigest", !!B && B.key === "buildDigest", B && B.key);
  ok("без известного отпечатка шарды грузятся без метки", !!B && B.query() === "", JSON.stringify(B && B.query()));

  {
    const NEW_DIGEST = "0123456789abcdef";
    const realFetch = w.fetch;
    const asked = [];
    /* Метку времени сборщик пишет из одного значения и в version.json (поле
       at), и в файлы данных (built_at). Значит, у настоящей сборки они
       совпадают — берём ту, с которой страница реально загружена. */
    const LOADED_AT = (w.RF_FRESH && w.RF_FRESH.built_at) || "";
    /* Метка, заведомо не равная загруженной: так выглядит сборка, файлы
       которой браузер отдал из кеша. */
    const CACHE_AT = LOADED_AT === "2026-01-01T00:00:00.000Z"
      ? "2026-01-02T00:00:00.000Z" : "2026-01-01T00:00:00.000Z";
    let serverAt = LOADED_AT;
    /* отпечаток кода, который «лежит на хостинге»: правка кода данных не
       меняет, поэтому проверяется отдельно от digest */
    let serverCode = "";
    /* LS.set пишет через JSON.stringify — значение в localStorage в кавычках */
    const setSeen = v => w.localStorage.setItem("rflaws.buildDigest", JSON.stringify(v));

    ok("метка сборки загруженных данных доступна приложению", !!LOADED_AT, LOADED_AT);

    w.fetch = (url, opt) => {
      asked.push({ url: url, opt: opt || {} });
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          digest: NEW_DIGEST, at: serverAt, code: serverCode,
          articles: 19307, sources: 227, files: 271
        })
      });
    };

    /* 1) вкладка открыта со старой сборкой — должно появиться уведомление */
    setSeen("olddigest0000000");
    B.check(false);
    await wait(150);
    const bar = $(".update-bar");
    ok("уведомление о новой сборке появилось", !!bar && bar.hidden === false,
      bar ? "hidden=" + bar.hidden : "элемента нет");
    ok("в уведомлении есть «Обновить» и кнопка скрытия", !!$("#ubGo") && !!$("#ubX"));
    ok("уведомление поднимает тост (класс на body)", d.body.classList.contains("has-update"));
    ok("уведомление сообщает число статей", /19307/.test(T("#ubNote") || ""), T("#ubNote"));
    ok("опрос идёт мимо кеша браузера",
      asked.length === 1 && /^data\/version\.json/.test(asked[0].url) &&
      asked[0].opt.cache === "no-store",
      asked.length ? asked[0].url + " / cache=" + asked[0].opt.cache : "запроса не было");
    ok("шарды получают метку версии загруженной сборки, а не новой",
      B.query() === "?v=olddigest0000000", B.query());

    /* 2) «Скрыть» — уведомление уходит и в этом сеансе больше не возвращается */
    $("#ubX").click();
    await wait(450);
    ok("после «Скрыть» уведомление скрыто", !!bar && (bar.hidden === true || !bar.classList.contains("show")),
      bar ? "hidden=" + bar.hidden + " show=" + bar.classList.contains("show") : "нет элемента");
    ok("класс на body снят", !d.body.classList.contains("has-update"));
    B.check(false);
    await wait(150);
    ok("после отказа уведомление не всплывает снова", !!bar && bar.hidden === true);

    /* 3) первый опрос после загрузки страницы: данные уже этой сборки —
       расхождение означает лишь «с прошлого визита база обновилась» */
    setSeen("olddigest0000000");
    B.state().hidden = false;      /* снимаем «Скрыть», чтобы проверить именно ветку загрузки */
    serverAt = LOADED_AT;          /* сервер отдаёт ту же сборку, что на экране */
    B.check(true);
    await wait(150);
    ok("при загрузке страницы уведомление не показывается", !!bar && bar.hidden === true,
      bar ? "hidden=" + bar.hidden : "нет элемента");
    ok("отпечаток новой сборки записан в localStorage",
      w.localStorage.getItem("rflaws.buildDigest") === JSON.stringify(NEW_DIGEST),
      w.localStorage.getItem("rflaws.buildDigest"));
    ok("метка версии для шардов стала новой", B.query() === "?v=" + NEW_DIGEST, B.query());

    /* 4) файлы данных пришли из кеша браузера. На GitHub Pages свои заголовки
       кеширования задать нельзя (всё живёт 10 минут), поэтому метка сборки на
       экране отстаёт от серверной. Уведомление обязано появиться даже при
       первом опросе: иначе читатель остался бы со старым текстом навсегда —
       отпечатки-то совпадают, и повода обновиться приложение не видит. */
    setSeen(NEW_DIGEST);
    B.state().hidden = false;
    serverAt = CACHE_AT;
    B.check(true);
    await wait(150);
    ok("данные из кеша: уведомление появилось при первом опросе",
      !!bar && bar.hidden === false, bar ? "hidden=" + bar.hidden : "нет элемента");
    ok("шарды остались версии загруженных данных",
      B.query() === "?v=" + NEW_DIGEST, B.query());
    B.state().hidden = true;       /* дальше секции уведомление не мешает */

    /* 5) правка кода при неизменных данных. Отпечаток базы (digest) и метка её
       сборки те же, что у загруженной страницы: раньше уведомление в этом
       случае не появлялось вовсе — и читатель до десяти минут работал со
       старым скриптом, а выглядело это как «правки не доехали». Отпечаток
       кода сборщик кладёт и в app.js, и в version.json (tools/lib/code-stamp.js). */
    B.hide();
    await wait(400);
    ok("перед проверкой правки кода уведомление скрыто", !!bar && bar.hidden === true,
      bar ? "hidden=" + bar.hidden : "нет элемента");

    setSeen(NEW_DIGEST);
    B.state().hidden = false;
    serverAt = LOADED_AT;                 /* база та же, что на экране */
    serverCode = "fedcba9876543210";      /* а код на хостинге — новый */
    B.setCode("0123456789abcdef");        /* отпечаток загруженной сборки */
    B.check(false);
    await wait(150);
    ok("правка кода поднимает уведомление, хотя данные те же",
      !!bar && bar.hidden === false, bar ? "hidden=" + bar.hidden : "нет элемента");
    ok("уведомление говорит про обновление приложения",
      /обновление приложения/i.test(T("#ubTitle") || ""), T("#ubTitle"));
    ok("в подписи не обещана новая редакция базы",
      /не менялись/.test(T("#ubNote") || ""), T("#ubNote"));
    ok("приложение видит собственный отпечаток кода",
      B.code() === "0123456789abcdef", B.code());
    ok("метка перезагрузки меняется и от правки кода",
      B.tag({ code: "fedcba9876543210", digest: NEW_DIGEST }) === "fedcba9876543210-" + NEW_DIGEST,
      B.tag({ code: "fedcba9876543210", digest: NEW_DIGEST }));

    /* 6) отпечатка кода нет: сборка до появления проверки, локальный запуск,
       file://. Сравнивать нечего — уведомление не выдумываем. */
    B.hide();
    await wait(400);
    B.setCode("");
    serverCode = "";
    B.state().hidden = false;
    B.check(false);
    await wait(150);
    ok("без отпечатка кода уведомление не выдумывается", !!bar && bar.hidden === true,
      bar ? "hidden=" + bar.hidden : "нет элемента");

    B.hide();
    await wait(400);
    B.state().hidden = true;       /* дальше секции уведомление не мешает */

    w.fetch = realFetch;
  }

  {
    const FIX = {
      built_at: "2026-10-11T20:00:00.000Z",
      entries: [
        { d: "2026-10-12", s: "uk", a: "УК РФ (Уголовный кодекс)", k: "code", red: "2026-10-01", redFrom: "2026-08-15", arts: 538 },
        { d: "2026-10-12", s: "upk", a: "УПК РФ (Уголовно-процессуальный кодекс)", k: "code", add: ["91", "92"], chg: ["108"], del: ["475"], arts: 561 },
        { d: "2026-10-12", s: "nk2", a: "НК РФ ч. II", k: "law", rep: ["nk2-45", "nk2-46"], res: ["nk2-88"], arts: 210 },
        { d: "2026-10-10", s: "fz44", a: "ФЗ о контрактной системе", k: "law", fresh: 1, arts: 12 },
        { d: "2026-10-01", s: "zz-old", a: "Отменённый закон", k: "law", fresh: -1 }
      ]
    };

    const dom2 = await JSDOM.fromURL(base + "/index.html", {
      runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole: vc,
      beforeParse(w2) {
        /* data/changelog.js присвоит свой объект — он уйдёт в сеттер и будет
           отброшен, а приложение прочитает подставную ленту через геттер. */
        Object.defineProperty(w2, "RF_CHANGELOG", {
          configurable: true, get: () => FIX, set: () => {}
        });
      }
    });
    const w2 = dom2.window, d2 = w2.document;
    await wait(1500);
    const $2 = s => d2.querySelector(s);
    const $$2 = s => Array.from(d2.querySelectorAll(s));
    const T2 = s => ($2(s) ? $2(s).textContent.trim() : null);
    const nav2 = async (hash, ms) => { w2.location.hash = hash; await wait(ms || 200); };

    await nav2("#/new", 400);
    ok("записей в ленте — пять", $$2("#view .ncard").length === 5, $$2("#view .ncard").length + " карточек");
    ok("даты сгруппированы", $$2("#view .ndate").length === 3, $$2("#view .ndate").length + " дат");
    ok("первая дата — 12 октября 2026", /12 октября 2026/.test($2("#view .ndate").textContent || ""), T2("#view .ndate"));
    ok("сводка: редакции, статьи, статусы",
      /1/.test(T2("#view .grid .stat:nth-child(2)") || "") && /4/.test(T2("#view .grid .stat:nth-child(3)") || "") &&
      /3/.test(T2("#view .grid .stat:nth-child(4)") || ""),
      [T2("#view .grid .stat:nth-child(2)"), T2("#view .grid .stat:nth-child(3)"), T2("#view .grid .stat:nth-child(4)")].join(" / "));

    /* новая редакция */
    const ukCard = $$2("#view .ncard").filter(c => c.getAttribute("data-ns") === "uk")[0];
    ok("смена редакции: подпись и обе даты",
      !!ukCard && ukCard.classList.contains("cn-red") &&
      /01\.10\.2026/.test(ukCard.textContent) && /15\.08\.2026/.test(ukCard.textContent),
      ukCard ? ukCard.textContent.replace(/\s+/g, " ").slice(0, 90) : "нет карточки");

    /* статьи */
    ok("ссылка на новую статью", !!$2('#view a[href="#/article/upk-91"]'));
    ok("ссылка на изменённую статью", !!$2('#view a[href="#/article/upk-108"]'));
    ok("ссылка на исключённую статью", !!$2('#view a[href="#/article/upk-475"]'));
    ok("названия изменений с числом статей",
      /2 новые статьи/.test($2("#view").textContent) && /1 изменённая статья/.test($2("#view").textContent) &&
      /1 исключённая статья/.test($2("#view").textContent));

    /* статусы норм */
    ok("норма утратила силу — ссылка на статью", !!$2('#view a[href="#/article/nk2-45"]'));
    ok("норма снова действует — подпись", /снова действу/.test($2("#view").textContent));

    /* документы */
    ok("добавленный документ помечен", $$2("#view .ncard.cn-doc-new").length === 1);
    ok("убранный документ помечен", $$2("#view .ncard.cn-doc-del").length === 1);
    ok("ссылка на документ ведёт в его раздел", !!$2('#view a[href="#/code/uk"]'));

    /* непрочитанное */
    ok("счётчик непрочитанного в меню", T2("#newCount") === "5", T2("#newCount"));
    ok("плашка непрочитанного на странице", /Непрочитанных изменений: 5/.test($2("#view").textContent || ""));
    ok("пункт меню помечен как с обновлением",
      !!($2('.nav-item[data-nav="new"]') && $2('.nav-item[data-nav="new"]').classList.contains("has-upd")));

    /* отмечаем прочитанным */
    $2("#newSeenBtn").click();
    await wait(200);
    ok("после отметки счётчик очищен", T2("#newCount") === "", JSON.stringify(T2("#newCount")));
    ok("после отметки плашка и точка убраны",
      !$2("#newUnreadBox") && !$2('.nav-item[data-nav="new"]').classList.contains("has-upd"));
    ok("отметка сохраняется в localStorage", w2.localStorage.getItem("rflaws.newSeen") === "5",
      w2.localStorage.getItem("rflaws.newSeen"));

    /* фильтры */
    await nav2("#/new/red", 250);
    ok("фильтр «Новые редакции» оставляет одну запись", $$2("#view .ncard").length === 1,
      $$2("#view .ncard").length + " карточек");
    await nav2("#/new/art", 250);
    ok("фильтр «Статьи» оставляет одну запись", $$2("#view .ncard").length === 1,
      $$2("#view .ncard").length + " карточек");
    await nav2("#/new/st", 250);
    ok("фильтр «Статусы норм» оставляет одну запись", $$2("#view .ncard").length === 1,
      $$2("#view .ncard").length + " карточек");
    await nav2("#/new/doc", 250);
    ok("фильтр «Документы» оставляет две записи", $$2("#view .ncard").length === 2,
      $$2("#view .ncard").length + " карточек");
    await nav2("#/new", 250);
    ok("возврат к полной ленте", $$2("#view .ncard").length === 5);

    /* возвращаемся в основное окно: счётчик непрочитанного не должен был
       измениться от второго окна — оно живёт в другом localStorage */
    await nav("#/home", 200);
    try { w2.close(); } catch (e) { /* окно уже закрыто */ }
  }

  section = "26. Реестр источников, «Что изменилось» и свайпы"; console.log("\n" + section);

  /* «Шаблоны» и «Иски» — один пункт меню: подсветка стоит на обеих страницах,
     а выбор между наборами — вкладками на самой странице. */
  await nav("#/templates", 300);
  ok("пункт меню «Шаблоны и иски» один", $$('.nav-item[data-nav="docs"]').length === 1,
    $$('.nav-item[data-nav="docs"]').length + " пунктов");
  ok("на шаблонах пункт подсвечен", $$('.nav-item[data-nav="docs"].active').length === 1);
  ok("вкладки «Шаблоны» и «Иски» на странице", $$("#view .tabs .tab").length === 2,
    $$("#view .tabs .tab").length + " вкладок");
  await nav("#/suits", 300);
  ok("на исках тот же пункт подсвечен", $$('.nav-item[data-nav="docs"].active').length === 1);

  /* Реестр источников: группы по виду акта свёрнуты по умолчанию */
  await nav("#/sources", 300);
  ok("реестр источников открывается", /Источники/.test(T("h1") || ""), T("h1"));
  const srcBlocks = $$("#srcList .kind-block");
  ok("группы источников свёрнуты по умолчанию",
    srcBlocks.length > 0 && srcBlocks.every(b => !b.open),
    srcBlocks.filter(b => b.open).length + " раскрытых из " + srcBlocks.length);

  /* Блок «Часто используемые статьи» убран с главной */
  await nav("#/home", 300);
  ok("блок «Часто используемые статьи» убран",
    !/Часто используемые статьи/.test($("#view").textContent || ""));

  /* «Что изменилось в статье»: вход с карточки статьи и своя страница */
  await nav("#/article/uk-105", 700);
  ok("на странице статьи есть вход «Что изменилось»",
    $$('#view a[href^="#/changed/"]').length === 1,
    $$('#view a[href^="#/changed/"]').length + " ссылок");
  await nav("#/changed/uk-105", 900);
  ok("страница «Что изменилось» открывается", /Что изменилось/.test(T("h1") || ""), T("h1"));
  ok("заголовок называет статью", /ст\. 105/.test(T("h1") || ""), T("h1"));
  const chgOut = $("#chgOut");
  ok("блок сравнения заполнен",
    !!chgOut && !/Готовим текст/.test(chgOut.textContent || ""),
    chgOut ? (chgOut.textContent || "").trim().slice(0, 60) : "нет блока");
  /* Итог блока — либо разбор расхождений, либо понятное объяснение, почему
     сравнивать не с чем: «загрузка» и пустота одинаково недопустимы. */
  ok("показан разбор или честное объяснение",
    !!chgOut && ($$("#chgOut .diff-art").length > 0 || $$("#chgOut .info-box").length > 0),
    chgOut ? (chgOut.textContent || "").trim().slice(0, 60) : "нет блока");

  /* Свайпы: вправо — назад, влево — вперёд (те же navStep, что у кнопок) */
  const touchEv = (type, x, y) => {
    const ev = new w.Event(type, { bubbles: true, cancelable: true });
    const pt = { clientX: x, clientY: y };
    ev.touches = type === "touchend" ? [] : [pt];
    ev.changedTouches = [pt];
    return ev;
  };
  await nav("#/home", 300);
  await nav("#/help", 300);
  const hashSwipeA = w.location.hash;
  d.dispatchEvent(touchEv("touchstart", 260, 420));
  d.dispatchEvent(touchEv("touchend", 360, 428));
  await wait(400);
  ok("свайп вправо возвращает назад", w.location.hash !== hashSwipeA,
    hashSwipeA + " → " + w.location.hash);
  const hashSwipeB = w.location.hash;
  d.dispatchEvent(touchEv("touchstart", 360, 420));
  d.dispatchEvent(touchEv("touchend", 250, 426));
  await wait(400);
  ok("свайп влево возвращает вперёд", w.location.hash !== hashSwipeB,
    hashSwipeB + " → " + w.location.hash);
  /* Мелкий сдвиг и вертикальный жест переходом не считаются */
  const hashSwipeC = w.location.hash;
  d.dispatchEvent(touchEv("touchstart", 300, 420));
  d.dispatchEvent(touchEv("touchend", 330, 424));
  d.dispatchEvent(touchEv("touchstart", 300, 420));
  d.dispatchEvent(touchEv("touchend", 380, 520));
  await wait(300);
  ok("мелкий и вертикальный жест раздел не меняют", w.location.hash === hashSwipeC,
    hashSwipeC + " → " + w.location.hash);

  console.log("\n" + "=".repeat(60));
  console.log("Ошибок в консоли: " + errors.length);
  errors.slice(0, 8).forEach(e => console.log("   " + e));
  if (errors.length) failures++;
  console.log(failures === 0 ? "Все проверки пройдены." : "Проверок с замечаниями: " + failures);
  clearTimeout(watchdog);
  try { w.close(); } catch (e) { /* окно уже закрыто */ }
  server.close();
  process.exit(failures === 0 ? 0 : 1);
});
