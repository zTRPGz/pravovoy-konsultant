/* =========================================================================
   Правовой консультант :: загрузка Конституции, федеральных конституционных законов
              и метаданных документов
   -------------------------------------------------------------------------
   Источник: официальный сервис «Тексты правовых актов с внесёнными
   изменениями» — actual.pravo.gov.ru (публичная база ebpi).

   Что делает:
     1) для каждого документа из манифестов (кодексы и федеральные законы)
        запрашивает карточку card() и сохраняет метаданные: официальное
        наименование, вид акта, дату принятия, состояние (meta.json);
     2) находит по точному названию и выгружает полный текст:
          • Конституции Российской Федерации           -> konst.json
          • федеральных конституционных законов (ФКЗ)  -> fkz.json
        Цепочка: attrsearch -> card -> redactions -> redtext.
        redtext отдаёт HTML (экспорт из Word) — он преобразуется в структуру
        { chapter, number, title, text }, как у остальных источников.

   Запуск:  node tools/fetch-extra.js
            node tools/fetch-extra.js --probe   (только проверка поиска ФКЗ)

   Запросы выполняются последовательно с паузой, повторный запуск
   пропускает уже полученные файлы.
   ========================================================================= */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "vendor", "ruslaw");
const SRC_LAWS = path.join(SRC, "laws");
const PATCH_DIR = path.join(SRC, "patch");

const API = "http://actual.pravo.gov.ru:8000/api/ebpi/";
const BPA = "ebpi";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/128.0.0.0 Safari/537.36 pravovoy-konsultant/0.4 (open legal reference tool)";
const GAP = 1200; // мс между запросами — вежливая нагрузка на официальный сервис

/* Конституция ищется по точному названию (оно уникально в базе). */
const KONST_NAME = "Конституция Российской Федерации";

/* Дополнительные федеральные законы, которых нет в открытом наборе данных,
   но которые необходимы для работы юриста, следователя и госоргана.
   Загружаются напрямую с официального портала по номеру и дате принятия. */
const EXTRA_LAWS = [
  { id: "fz3pol",   number: "3-ФЗ",   date: "07.02.2011", short: "ФЗ о полиции", branch: "Административное право", name: "О полиции" },
  { id: "fz144ord", number: "144-ФЗ", date: "12.08.1995", short: "ФЗ об ОРД", branch: "Уголовный процесс", name: "Об оперативно-розыскной деятельности" },
  { id: "fz2202prok", number: "2202-I", date: "17.01.1992", short: "ФЗ о прокуратуре", branch: "Судебный процесс", name: "О прокуратуре Российской Федерации" },
  { id: "fz59obr",  number: "59-ФЗ",  date: "02.05.2006", short: "ФЗ об обращениях граждан", branch: "Административное право", name: "О порядке рассмотрения обращений граждан Российской Федерации" },
  { id: "fz63adv",  number: "63-ФЗ",  date: "31.05.2002", short: "ФЗ об адвокатуре", branch: "Судебный процесс", name: "Об адвокатской деятельности и адвокатуре в Российской Федерации" },
  { id: "fz103siz", number: "103-ФЗ", date: "15.07.1995", short: "ФЗ о содержании под стражей", branch: "Уголовный процесс", name: "О содержании под стражей подозреваемых и обвиняемых в совершении преступлений" },
  { id: "fz128dakt", number: "128-ФЗ", date: "25.07.1998", short: "ФЗ о дактилоскопии", branch: "Уголовный процесс", name: "О государственной дактилоскопической регистрации в Российской Федерации" },
  { id: "fz323zdrav", number: "323-ФЗ", date: "21.11.2011", short: "ФЗ об охране здоровья", branch: "Социальное право", name: "Об основах охраны здоровья граждан в Российской Федерации" },
  { id: "fz135konk", number: "135-ФЗ", date: "26.07.2006", short: "ФЗ о защите конкуренции", branch: "Гражданское право", name: "О защите конкуренции" },
  { id: "fz257dor", number: "257-ФЗ", date: "08.11.2007", short: "ФЗ об автодорогах", branch: "Транспортное право", name: "Об автомобильных дорогах и о дорожной деятельности в Российской Федерации и о внесении изменений в отдельные законодательные акты Российской Федерации" },
  { id: "fz403sk",  number: "403-ФЗ", date: "28.12.2010", short: "ФЗ о Следственном комитете", branch: "Уголовный процесс", name: "О Следственном комитете Российской Федерации" },
  { id: "fz35terror", number: "35-ФЗ", date: "06.03.2006", short: "ФЗ о противодействии терроризму", branch: "Уголовное право", name: "О противодействии терроризму" },
  { id: "fz114ekstr", number: "114-ФЗ", date: "25.07.2002", short: "ФЗ о противодействии экстремизму", branch: "Уголовное право", name: "О противодействии экстремистской деятельности" },
  { id: "fz150oruzh", number: "150-ФЗ", date: "13.12.1996", short: "ФЗ об оружии", branch: "Уголовное право", name: "Об оружии" },
  { id: "fz3narko", number: "3-ФЗ",  date: "08.01.1998", short: "ФЗ о наркотических средствах", branch: "Уголовное право", name: "О наркотических средствах и психотропных веществах" },
  /* --- блок безопасности и правоохранительной службы --- */
  { id: "fz40fsb",    number: "40-ФЗ",   date: "03.04.1995", short: "ФЗ о ФСБ", branch: "Административное право", name: "О федеральной службе безопасности" },
  { id: "fz390bez",   number: "390-ФЗ",  date: "28.12.2010", short: "ФЗ о безопасности", branch: "Административное право", name: "О безопасности" },
  { id: "fz57ohr",    number: "57-ФЗ",   date: "27.05.1996", short: "ФЗ о государственной охране", branch: "Административное право", name: "О государственной охране" },
  { id: "fz5razv",    number: "5-ФЗ",    date: "10.01.1996", short: "ФЗ о внешней разведке", branch: "Административное право", name: "О внешней разведке" },
  { id: "fz226rosgv", number: "226-ФЗ",  date: "03.07.2016", short: "ФЗ о Росгвардии", branch: "Административное право", name: "О войсках национальной гвардии Российской Федерации" },
  { id: "fz118prist", number: "118-ФЗ",  date: "21.07.1997", short: "ФЗ о судебных приставах", branch: "Судебный процесс", name: "О судебных приставах" },
  { id: "fz2487chd",  number: "2487-I",  date: "11.03.1992", short: "ФЗ о частной охранной деятельности", branch: "Административное право", name: "О частной детективной и охранной деятельности в Российской Федерации" },
  { id: "fz273kor",   number: "273-ФЗ",  date: "25.12.2008", short: "ФЗ о противодействии коррупции", branch: "Уголовное право", name: "О противодействии коррупции" },
  { id: "fz45zash",   number: "45-ФЗ",   date: "20.04.1995", short: "ФЗ о госзащите судей и сотрудников", branch: "Уголовный процесс", name: "О государственной защите судей, должностных лиц правоохранительных и контролирующих органов" },
  { id: "fz119zash",  number: "119-ФЗ",  date: "20.08.2004", short: "ФЗ о госзащите потерпевших и свидетелей", branch: "Уголовный процесс", name: "О государственной защите потерпевших, свидетелей и иных участников уголовного судопроизводства" },
  { id: "fz5485taina",number: "5485-I",  date: "21.07.1993", short: "ФЗ о государственной тайне", branch: "Административное право", name: "О государственной тайне" },
  { id: "fz64admnadz",number: "64-ФЗ",   date: "06.04.2011", short: "ФЗ об административном надзоре", branch: "Административное право", name: "Об административном надзоре за лицами, освобожденными из мест лишения свободы" },
  { id: "fz242genom", number: "242-ФЗ",  date: "03.12.2008", short: "ФЗ о геномной регистрации", branch: "Уголовный процесс", name: "О государственной геномной регистрации в Российской Федерации" },
  { id: "fz16trans",  number: "16-ФЗ",   date: "09.02.2007", short: "ФЗ о транспортной безопасности", branch: "Транспортное право", name: "О транспортной безопасности" },
  { id: "fz187kii",   number: "187-ФЗ",  date: "26.07.2017", short: "ФЗ о безопасности КИИ", branch: "Информационное право", name: "О безопасности критической информационной инфраструктуры Российской Федерации" },
  /* --- миграция, гражданство, общественный порядок --- */
  { id: "fz115inostr",number: "115-ФЗ",  date: "25.07.2002", short: "ФЗ о правовом положении иностранных граждан", branch: "Административное право", name: "О правовом положении иностранных граждан в Российской Федерации" },
  { id: "fz114vyezd", number: "114-ФЗ",  date: "15.08.1996", short: "ФЗ о порядке выезда и въезда", branch: "Административное право", name: "О порядке выезда из Российской Федерации и въезда в Российскую Федерацию" },
  { id: "fz62graj",   number: "62-ФЗ",   date: "31.05.2002", short: "ФЗ о гражданстве", branch: "Конституционное право", name: "О гражданстве Российской Федерации" },
  { id: "fz54miting", number: "54-ФЗ",   date: "19.06.2004", short: "ФЗ о митингах и собраниях", branch: "Административное право", name: "О собраниях, митингах, демонстрациях, шествиях и пикетированиях" },
  { id: "fz125sovest",number: "125-ФЗ",  date: "26.09.1997", short: "ФЗ о свободе совести", branch: "Конституционное право", name: "О свободе совести и о религиозных объединениях" },
  { id: "fz262suds",  number: "262-ФЗ",  date: "22.12.2008", short: "ФЗ о доступе к информации о судах", branch: "Судебный процесс", name: "Об обеспечении доступа к информации о деятельности судов в Российской Федерации" },
  /* --- военная служба --- */
  { id: "fz76voen",   number: "76-ФЗ",   date: "27.05.1998", short: "ФЗ о статусе военнослужащих", branch: "Административное право", name: "О статусе военнослужащих" },
  { id: "fz53voin",   number: "53-ФЗ",   date: "28.03.1998", short: "ФЗ о воинской обязанности", branch: "Административное право", name: "О воинской обязанности и военной службе" }
];

/* Постановления Правительства Российской Федерации, необходимые в работе
   сотрудника: регистрационный и миграционный учёт, оборот оружия, правила
   дорожного движения, освидетельствование на состояние опьянения и др.
   Загружаются с официального портала по номеру и дате принятия.
   Структура документа — не «Статья N», а пункты («1.», «1.1.») и разделы
   («I. Общие положения»), поэтому текст разбирается отдельным конвертером
   paragraphsToItems(). */
const DECREES = [
  { id: "pg1090pdd",    number: "1090", date: "23.10.1993", short: "ПДД РФ", branch: "Транспортное право", name: "О правилах дорожного движения" },
  { id: "pg713reg",     number: "713",  date: "17.07.1995", short: "Правила регистрационного учёта", branch: "Административное право", name: "Об утверждении Правил регистрации и снятия граждан Российской Федерации с регистрационного учета по месту пребывания и по месту жительства в пределах Российской Федерации и перечня лиц, ответственных за прием и передачу в органы регистрационного учета документов для регистрации и снятия с регистрационного учета граждан Российской Федерации по месту пребывания и по месту жительства в пределах Российской Федерации" },
  { id: "pg814oruzh",   number: "814",  date: "21.07.1998", short: "Правила оборота оружия", branch: "Уголовное право", name: "О мерах по регулированию оборота гражданского и служебного оружия и патронов к нему на территории Российской Федерации" },
  { id: "pg9migr",      number: "9",    date: "15.01.2007", short: "Правила миграционного учёта", branch: "Административное право", name: "О порядке осуществления миграционного учета иностранных граждан и лиц без гражданства в Российской Федерации" },
  { id: "pg719voin",    number: "719",  date: "27.11.2006", short: "Положение о воинском учёте", branch: "Административное право", name: "Об утверждении Положения о воинском учете" },
  { id: "pg565vve",     number: "565",  date: "04.07.2013", short: "Положение о военно-врачебной экспертизе", branch: "Социальное право", name: "Об утверждении Положения о военно-врачебной экспертизе" }
];

/* Замены для документов открытого набора данных, которые оказались
   неполными или подменёнными (проверено при сборке). */
const PATCH = [
  { id: "fz86", number: "86-ФЗ", date: "10.07.2002", short: "ФЗ о Банке России", branch: "Финансовое право", name: "О Центральном банке Российской Федерации (Банке России)" },
  { id: "fz196", number: "196-ФЗ", date: "10.12.1995", short: "ФЗ о БДД", branch: "Транспортное право", name: "О безопасности дорожного движения" }
];
const FKZ_LIST = [
  { number: "1-ФКЗ", date: "21.07.1994", short: "ФКЗ о КС РФ",   name: "О Конституционном Суде Российской Федерации" },
  { number: "1-ФКЗ", date: "28.04.1995", short: "ФКЗ об АС",     name: "Об арбитражных судах в Российской Федерации" },
  { number: "1-ФКЗ", date: "31.12.1996", short: "ФКЗ о суд. системе", name: "О судебной системе Российской Федерации" },
  { number: "1-ФКЗ", date: "26.02.1997", short: "ФКЗ об УПЧ",    name: "Об Уполномоченном по правам человека в Российской Федерации" },
  { number: "1-ФКЗ", date: "23.06.1999", short: "ФКЗ о воен. судах", name: "О военных судах Российской Федерации" },
  { number: "1-ФКЗ", date: "25.12.2000", short: "ФКЗ о флаге",   name: "О Государственном флаге Российской Федерации" },
  { number: "2-ФКЗ", date: "25.12.2000", short: "ФКЗ о гербе",   name: "О Государственном гербе Российской Федерации" },
  { number: "3-ФКЗ", date: "25.12.2000", short: "ФКЗ о гимне",   name: "О Государственном гимне Российской Федерации" },
  { number: "3-ФКЗ", date: "30.05.2001", short: "ФКЗ о ЧП",      name: "О чрезвычайном положении" },
  { number: "6-ФКЗ", date: "17.12.2001", short: "ФКЗ о новом субъекте", name: "О порядке принятия в Российскую Федерацию и образования в ее составе нового субъекта Российской Федерации" },
  { number: "1-ФКЗ", date: "30.01.2002", short: "ФКЗ о ВП",      name: "О военном положении" },
  { number: "5-ФКЗ", date: "28.06.2004", short: "ФКЗ о референдуме", name: "О референдуме Российской Федерации" },
  { number: "3-ФКЗ", date: "05.02.2014", short: "ФКЗ о ВС РФ",   name: "О Верховном Суде Российской Федерации" },
  { number: "4-ФКЗ", date: "06.11.2020", short: "ФКЗ о Правительстве", name: "О Правительстве Российской Федерации" }
];

/* ---------------------------------------------------------------- сеть */

let lastReq = 0;
async function api(pathname) {
  const wait = GAP - (Date.now() - lastReq);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  const res = await fetch(API + pathname, { headers: { "User-Agent": UA } });
  lastReq = Date.now();
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}
const q = (o) => encodeURIComponent(JSON.stringify(o));

const card = (hash) => api("card/?bpa=" + BPA + "&t=" + q({ hash: hash }));
const redactions = (hash) => api("redactions/?bpa=" + BPA + "&t=" + q({ hash: hash, ttl: 4 }));
const redtext = (redid) => api("redtext?bpa=" + BPA + "&t=" + redid + "&ttl=0");
const attrsearch = (attrs) => api("attrsearch/?bpa=" + BPA + "&q=" + q(attrs));

/* Поиск по точному названию (AttrMode 0) */
async function findByExactName(name) {
  const r = await attrsearch([{ AttrId: 7, AttrMode: 0, Words: [name] }]);
  const docs = (r.docs || []).filter(d => (d.docnames || "").trim() === name);
  return docs.length ? docs[0] : null;
}

/* Поиск документа по номеру и дате принятия.
   Номера актов повторяются ежегодно, поэтому результат фильтруется по виду
   акта (kindRe) и по дате в официальном наименовании (docpassing). */
async function findByNumberDate(number, date, kindRe) {
  kindRe = kindRe || /^Федеральный конституционный закон/;
  const r = await attrsearch([{ AttrId: 6, AttrMode: 0, Words: [number] }]);
  const docs = (r.docs || []).filter(d =>
    kindRe.test(d.docpassing || "") && (d.docpassing || "").indexOf(date) !== -1);
  return docs.length ? docs[0] : null;
}
const FZ_RE = /^(Федеральный закон|Закон Российской Федерации|Закон РФ)/;
const PG_RE = /^Постановление/;

/* Актуальная редакция документа по его хэшу */
async function actualRedaction(hash) {
  const reds = await redactions(hash);
  const list = reds.redactions || [];
  let cand = list.filter(r => r.actual)[0];
  if (!cand) {
    cand = list.filter(r => r.redcompleted)
      .sort((a, b) => String(b.reddate || "").localeCompare(String(a.reddate || "")))[0];
  }
  return cand || null;
}

/* ---------------------------------------------------------------- HTML -> статьи */

const ENT = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', laquo: "«", raquo: "»", mdash: "—", ndash: "–", deg: "°" };

function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => (ENT[n.toLowerCase()] != null ? ENT[n.toLowerCase()] : m));
}

/* Экспорт Word: тело документа — последовательность <p>. */
function htmlToParagraphs(html) {
  const body = (/<body[^>]*>([\s\S]*)<\/body>/i.exec(html) || [null, html])[1];
  const blocks = body
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    // Word разрывает номер отдельным прогоном стиля W9:
    //   «Статья 67<span class="W9">1</span>»          ->  «Статья 67.1»
    //   «Статья 82</span><span class="W9">6</span>»   ->  «Статья 82.6»
    //   «статьей 82</span><span class="W9">5</span>»  ->  «статьей 82.5»
    //   «Глава XIII<span class="W9">1</span>»         ->  «Глава XIII.1»
    //   «ж<span class="W9">1</span>»                  ->  «ж.1»
    // Правило: прогон из цифр, приклеенный вплотную (без пробела) к букве или
    // цифре, — это продолжение номера, а не новое слово.
    // Без этого подстатьи 67.1, 82.6, 76.11 склеиваются в 671, 826, 7611.
    .replace(/([0-9A-Za-zА-Яа-яЁё])(?:<\/span>)*<span class="W\d+"[^>]*>(\d+(?:-\d+)?)<\/span>/g, "$1.$2")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h\d|li)>/gi, "\n</$1>")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(blocks)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(l => l.replace(/[\u00a0\u1680\u2000-\u200b\u202f\u205f\u3000\ufeff]/g, " ").replace(/[^\S\n]+/g, " ").trim())
    .filter(Boolean);
}

/* Преобразование списка абзацев в статьи с главами и разделами.
   Структура документа: преамбула -> «РАЗДЕЛ …» -> «ГЛАВА N» + название ->
   «Статья N.» + текст. У Конституции и ФКЗ статьи не имеют заголовков, а
   «раздел без статей» (РАЗДЕЛ ВТОРОЙ Конституции, РАЗДЕЛ ШЕСТОЙ ФКЗ о КС РФ)
   оформляется отдельной записью. */
function paragraphsToArticles(paras) {
  const arts = [];
  let chapter = "", razdel = "";
  let cur = null, section = null, pre = [];

  const flushCur = () => { if (cur) { arts.push(cur); cur = null; } };
  const flushSection = () => { if (section) { arts.push(section); section = null; } };
  const flushPre = () => {
    if (pre.length) { arts.push({ number: null, title: "Преамбула", chapter: "", razdel: "", text: pre.join("\n") }); pre = []; }
  };

  // «РАЗДЕЛ ПЕРВЫЙ», «РАЗДЕЛ I.», «РАЗДЕЛ ШЕСТОЙ. ВСТУПЛЕНИЕ … В СИЛУ»
  const RAZ = /^РАЗДЕЛ\s+([А-ЯЁ]+|[IVXLC]+)\.?\s*(.*)$/i;
  // «ГЛАВА 1», «ГЛАВА I. Общие положения», «ГЛАВА 12.1. …»
  const GLAV = /^ГЛАВА\s+(\d+(?:\.\d+)?|[IVXLC]+)\.?\s*(.*)$/i;
  // Продолжение названия главы/раздела, перенесённое на следующую строку
  // («ГЛАВА II. Статус судьи Конституционного Суда Российской» + «Федерации»).
  const titleLike = (t) => !!t && t.length <= 110 &&
    !/^Статья\s+\d/i.test(t) && !/^\(/.test(t) && !/[.;:!?]$/.test(t) &&
    !GLAV.test(t) && !RAZ.test(t);
  // Заголовок статьи — это «Статья N» (в Конституции — без точки) либо
  // «Статья N. Название». Если после номера идёт пробел и текст без точки,
  // это не заголовок, а продолжение предыдущей статьи (напр. «Статья 10
  // настоящего Федерального закона вступает в силу с 1 января 2003 года…»).
  const ART = /^Статья\s+(\d+(?:\.\d+)*)(?:\.(?:\s+(.+))?)?$/;

  // Названия глав и разделов часто переносятся на следующую строку —
  // склеиваем их до основного разбора.
  const joined = [];
  for (let i = 0; i < paras.length; i++) {
    let t = paras[i];
    const mg = GLAV.exec(t), mr = mg ? null : RAZ.exec(t);
    if ((mg || mr) && t.length < 200) {
      let sep = (mg ? mg[2] : mr[2]) ? " " : ". ", k = 0;
      while (i + 1 < paras.length && k < 3 && titleLike(paras[i + 1])) { t += sep + paras[++i]; sep = " "; k++; }
    }
    joined.push(t);
  }

  joined.forEach((t) => {
    if (GLAV.test(t) && t.length < 200) { flushCur(); flushSection(); flushPre(); chapter = t.replace(/\s+/g, " ").trim(); return; }
    if (RAZ.test(t) && t.length < 200) { flushCur(); flushSection(); flushPre(); razdel = t.replace(/\s+/g, " ").trim(); chapter = ""; return; }

    const m = ART.exec(t);
    if (m) {
      flushPre(); flushSection(); flushCur();
      cur = { number: m[1], title: "", chapter: chapter, razdel: razdel, text: "Статья " + m[1] + "." };
      if (m[2]) cur.text += " " + m[2].trim();
      return;
    }
    if (cur) { cur.text += "\n" + t; return; }
    // текст вне статьи: преамбула до первой статьи либо «раздел без статей»
    if (arts.length || chapter || razdel) {
      // отложенная оговорка о редакции (напр. «(Наименование в редакции …)»)
      // относится к заголовку раздела и отдельной записью не становится
      if (/^\(/.test(t)) return;
      if (!section) section = { number: sectionNum(razdel), title: razdel || "Заключительные положения", chapter: "", razdel: razdel, text: t };
      else section.text += "\n" + t;
      return;
    }
    pre.push(t);
  });
  flushPre(); flushCur(); flushSection();

  // Заголовок для поиска: Конституция и ФКЗ не имеют заголовков статей,
  // поэтому берём первое предложение текста статьи.
  arts.forEach(a => {
    if (a.title) return;
    const body = a.text.replace(/^Статья\s+\d+(?:\.\d+)*\s*\.?\s*/, "");
    let first = body.split(/\n/)[0].trim();
    first = first.replace(/^\d+(?:\.\d+)*[.)]\s*/, "");   // снять нумерацию пункта («1. …»)
    let t = first.split(/(?<=[.!?])\s+/)[0] || first;
    if (t.length > 150) t = t.slice(0, 150).replace(/\s+\S*$/, "") + "…";
    a.title = t.replace(/\s*[.\s]+$/, "") || ("Статья " + a.number);
  });
  return arts;
}

/* Номер «раздела без статей»: РАЗДЕЛ ВТОРОЙ -> II, РАЗДЕЛ VI -> VI */
const ROMAN = {
  "ПЕРВЫЙ": "I", "ВТОРОЙ": "II", "ТРЕТИЙ": "III", "ЧЕТВЕРТЫЙ": "IV", "ЧЕТВЁРТЫЙ": "IV",
  "ПЯТЫЙ": "V", "ШЕСТОЙ": "VI", "СЕДЬМОЙ": "VII", "ВОСЬМОЙ": "VIII",
  "ДЕВЯТЫЙ": "IX", "ДЕСЯТЫЙ": "X"
};
function sectionNum(razdel) {
  const m = /РАЗДЕЛ\s+([А-ЯЁ]+|[IVXLC]+)/i.exec(razdel || "");
  if (!m) return "0.1";
  const w = m[1].toUpperCase();
  return ROMAN[w] || (/^[IVXLC]+$/.test(w) ? w : m[1]);
}

/* Преобразование списка абзацев постановления Правительства в записи-пункты.
   У постановлений нет статей: основной текст разбит на пункты «1.», «2.»,
   «1.1.», подпункты «а)», а приложения («ПРАВИЛА», «ПОЛОЖЕНИЕ») — на разделы
   с римской нумерацией и собственные пункты.

   Возвращает [{ number, title, chapter, text }] — тот же вид, что у
   paragraphsToArticles(), поэтому дальше документ собирается режимом
   «plain» общего модуля разбора (tools/lib/parse.js). */
function paragraphsToItems(paras) {
  const items = [];
  const pre = [];
  let chapter = "";
  let cur = null;
  let inAppx = false;   // внутри «ПРИЛОЖЕНИЯ» нумерованные строки — знаки/разметка, не разделы

  const flushPre = () => {
    if (pre.length) { items.push({ number: null, title: "Преамбула", chapter: "", text: pre.join("\n") }); pre.length = 0; }
  };

  // «I. Общие положения», «II. Освидетельствование …»
  const ROMAN = /^([IVXLC]{1,7})\.\s+(\S.*)$/;
  // «1.», «2.», «1.1.», «9.2.» в начале абзаца; у дорожных знаков — «1.1* "…"»
  const ITEM = /^(\d+(?:\.\d+)*)(?:\*\.|\*|\.)\s*(.*)$/;
  // Заголовок приложения: отдельная строка «ПРАВИЛА» / «ПОЛОЖЕНИЕ» / «ПЕРЕЧЕНЬ»
  const ANNEX = /^(ПРАВИЛА|ПОЛОЖЕНИЕ|ПЕРЕЧЕНЬ|ПОРЯДОК|ОСНОВНЫЕ ПОЛОЖЕНИЯ|ПРАВИЛА И НОРМЫ)$/;
  // Приложение: «ПРИЛОЖЕНИЕ № 1», «Приложение N 2», просто «ПРИЛОЖЕНИЕ».
  // Внимание: \b здесь не работает — он ASCII-только и не видит границу после «Е».
  const APPX = /^Приложение(?=\s|$)/i;
  /* Служебные строки, которые идут между номером приложения и его названием:
     «к Правилам дорожного движения», «Российской Федерации», «УТВЕРЖДЕНЫ»,
     «постановлением Совета Министров —», «(по ГОСТу …)», «Список изменяющих…». */
  const SKIP = /^(_+|к\s|Российской Федерации$|УТВЕРЖДЕН|постановлением|Правительства Российской|от\s+\d|\(|Список изменяющих)/i;

  /* Заголовок раздела отличается от пункта тем, что за ним идут подпункты
     с тем же номером: «23. ПЕРЕВОЗКА ГРУЗОВ» -> «23.1. …». Это надёжнее
     любых догадок по регистру букв: в ПДД заголовки разделов то сплошь
     заглавные («23. ПЕРЕВОЗКА ГРУЗОВ»), то с прописными («11. Обгон,
     опережение, встречный разъезд»). Описания дорожных знаков отличаем по
     кавычкам: «1.2 "Железнодорожный переезд без шлагбаума"» — не раздел.
     Между заголовком и первым пунктом часто стоит сноска «(Раздел в редакции
     Постановления …)» — при проверке её пропускаем. */
  const isSection = (line, paras, i) => {
    const m = ITEM.exec(line);
    if (!m || m[1].indexOf(".") !== -1) return false;
    if (line.length > 100) return false;
    if (/["«»(]/.test(m[2] || "")) return false;
    if (/утратил|исключен|дополнен|изменен/i.test(m[2] || "")) return false;
    for (let k = i + 1; k < Math.min(i + 5, paras.length); k++) {
      const s = paras[k].trim();
      if (!s || /^\(/.test(s)) continue;   // «(Раздел в редакции …)» — служебная сноска
      const nm = /^(\d+)\.\d+\./.exec(s);
      return !!nm && nm[1] === m[1];
    }
    return false;
  };

  for (let i = 0; i < paras.length; i++) {
    const t = paras[i];

    // заголовок приложения: строка целиком заглавными + название на след. строке
    if (ANNEX.test(t) && i + 1 < paras.length && /^[а-яё]/.test(paras[i + 1])) {
      chapter = t + " " + paras[++i].replace(/\s*[.;]$/, "");
      inAppx = false;
      continue;
    }

    /* Приложение («ПРИЛОЖЕНИЕ № 1», «Приложение N 2», просто «ПРИЛОЖЕНИЕ»).
       Между номером и названием стоят служебные строки — их пропускаем,
       а название («Дорожные знаки», «ДОРОЖНАЯ РАЗМЕТКА…») берём как заголовок. */
    if (APPX.test(t) && t.length < 60 && !/утратил|исключен|дополнен|изменен/i.test(t)) {
      const head = t.replace(/\s+/g, " ").trim();
      let title = "", j = i + 1, guard = 0;
      while (j < paras.length && guard < 12) {
        const s = paras[j].trim();
        guard++;
        // встретили следующий заголовок — название не нашли, не «съедаем» его
        if (ANNEX.test(s) || ROMAN.test(s) || isSection(s, paras, j) || /^\d/.test(s)) break;
        if (!s || SKIP.test(s)) { j++; continue; }
        title = s; j++; break;
      }
      // сразу после названия могут идти «(по ГОСТу …)» и «Список изменяющих…»
      while (j < paras.length && (/^\(/.test(paras[j].trim()) || /^Список изменяющих/i.test(paras[j].trim()))) j++;
      chapter = head + (title ? " · " + title.replace(/\s*[.;]$/, "") : "");
      inAppx = true;   // внутри приложения «1. …» — это знак/разметка, а не раздел
      i = j - 1;
      continue;
    }

    // раздел «I. Общие положения»
    const mr = ROMAN.exec(t);
    if (mr && t.length < 160 && !/^\d/.test(t)) {
      chapter = t.replace(/\s+/g, " ").trim();
      inAppx = false;
      continue;
    }

    // раздел «23. ПЕРЕВОЗКА ГРУЗОВ» — только если дальше идут пункты «23.1.»
    if (!inAppx && isSection(t, paras, i)) {
      chapter = t.replace(/\s+/g, " ").trim();
      continue;
    }

    const mi = ITEM.exec(t);
    if (mi) {
      flushPre();
      // текст пункта оставляем дословно — так, как он напечатан в источнике
      cur = { number: mi[1], title: "", chapter: chapter, text: t };
      items.push(cur);
      continue;
    }

    if (cur) { cur.text += "\n" + t; continue; }
    pre.push(t);
  }
  flushPre();

  // Заголовок пункта — первое предложение текста без его номера
  items.forEach((a) => {
    if (a.title) return;
    let first = String(a.text || "").split(/\n/)[0].trim();
    first = first.replace(/^\d+(?:\.\d+)*[.)]?\s*/, "");
    let t = first.split(/(?<=[.!?])\s+/)[0] || first;
    if (t.length > 150) t = t.slice(0, 150).replace(/\s+\S*$/, "") + "…";
    a.title = t.replace(/\s*[.\s]+$/, "") || ("Пункт " + a.number);
  });
  return items;
}

/* Полная выгрузка документа */
async function fetchDoc(found, name, extra, converter) {
  if (!found) return { error: "не найдено: " + name };
  const hash = found.dochash;
  const c = await card(hash);
  const red = await actualRedaction(hash);
  if (!red) return { error: "нет актуальной редакции: " + name };
  const txt = await redtext(red.redid);
  const html = txt.redtext || "";
  const arts = (converter || paragraphsToArticles)(htmlToParagraphs(html));
  const adopt = (c.adoptions || [])[0] || {};
  const redDate = String(red.reddate || "");
  return {
    slug: name,
    number: adopt.onumber || found.docpass0number || "",
    name: c.docname || name,
    kind: adopt.type || "",
    organ: adopt.organ || "",
    adopted: adopt.odate || "",
    docstate: c.docstate || "",
    redaction_date: /^\d{8}$/.test(redDate) ? redDate.slice(0, 4) + "-" + redDate.slice(4, 6) + "-" + redDate.slice(6, 8) : "",
    redid: red.redid,
    hash: hash,
    source_url: "http://actual.pravo.gov.ru/content/content.html#hash=" + hash + "&ttl=1",
    license: "official text of a legal act, not copyrightable under Russian Civil Code Art. 1259(6)",
    fetched_at: new Date().toISOString(),
    n_articles: arts.length,
    articles: arts,
    ...(extra || {})
  };
}

/* ---------------------------------------------------------------- метаданные */

async function collectMeta() {
  const out = {};
  const jobs = [];
  const codesM = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
  const lawsM = JSON.parse(fs.readFileSync(path.join(SRC_LAWS, "manifest.json"), "utf8"));
  Object.entries(codesM).forEach(([h, v]) => jobs.push(["code", h, v]));
  Object.entries(lawsM).forEach(([h, v]) => jobs.push(["law", h, v]));

  console.log("Метаданные: " + jobs.length + " документов (карточки card())");
  for (const [group, hash, v] of jobs) {
    if (out[hash]) continue;
    try {
      const c = await card(hash);
      const a = (c.adoptions || [])[0] || {};
      out[hash] = {
        group: group, slug: v.slug, number: v.number,
        docname: c.docname || "", docpassing: c.docpassing || "",
        docstate: c.docstate || "", kind: a.type || "", organ: a.organ || "",
        adopted: a.odate || "", redaction_date: v.redaction_date || "", redid: v.redid
      };
    } catch (e) {
      console.log("  ошибка " + v.slug + ": " + e.message);
    }
  }
  fs.writeFileSync(path.join(SRC, "meta.json"), JSON.stringify(out, null, 1), "utf8");
  console.log("  сохранено: vendor/ruslaw/meta.json (" + Object.keys(out).length + " записей)");
  return out;
}

/* ---------------------------------------------------------------- запуск */

/* При подключении как модуля (для тестов) скрипт не выполняется */
if (require.main !== module) {
  module.exports = { htmlToParagraphs, paragraphsToArticles, paragraphsToItems, sectionNum, decodeEntities };
  return;
}

(async () => {
  const probe = process.argv.indexOf("--probe") !== -1;

  if (probe) {
    console.log("Проверка поиска документов\n");
    try {
      const d = await findByExactName(KONST_NAME);
      console.log((d ? "  OK   " : "  —    ") + KONST_NAME + (d ? "  ->  " + d.docpassing : ""));
    } catch (e) { console.log("  ERR  " + KONST_NAME + " -> " + e.message); }
    for (const f of FKZ_LIST) {
      try {
        const d = await findByNumberDate(f.number, f.date);
        console.log((d ? "  OK   " : "  —    ") + (f.number + " " + f.date).padEnd(20) + (d ? d.docpassing : "не найдено"));
      } catch (e) {
        console.log("  ERR  " + f.number + " " + f.date + " -> " + e.message);
      }
    }
    for (const f of EXTRA_LAWS) {
      try {
        const d = await findByNumberDate(f.number, f.date, FZ_RE);
        console.log((d ? "  OK   " : "  —    ") + (f.number + " " + f.date).padEnd(20) + (d ? d.docpassing : "не найдено"));
      } catch (e) {
        console.log("  ERR  " + f.number + " " + f.date + " -> " + e.message);
      }
    }
    return;
  }

  const FORCE = process.argv.includes("--force");
  fs.mkdirSync(SRC, { recursive: true });

  // 1. Конституция
  const konstFile = path.join(SRC, "konst.json");
  if (fs.existsSync(konstFile) && !FORCE) {
    console.log("Конституция: уже загружена (vendor/ruslaw/konst.json)");
  } else {
    console.log("Конституция Российской Федерации…");
    const d = await fetchDoc(await findByExactName(KONST_NAME), KONST_NAME,
      { short: "Конституция РФ", kind: "Конституция Российской Федерации", branch: "Конституционное право" });
    if (d.error) { console.log("  ОШИБКА: " + d.error); }
    else { fs.writeFileSync(konstFile, JSON.stringify(d, null, 1), "utf8"); console.log("  статей: " + d.n_articles + ", редакция " + d.redaction_date); }
  }

  // 2. Федеральные конституционные законы
  const fkzFile = path.join(SRC, "fkz.json");
  if (fs.existsSync(fkzFile) && !FORCE) {
    console.log("ФКЗ: уже загружены (vendor/ruslaw/fkz.json)");
  } else {
    console.log("\nФедеральные конституционные законы: " + FKZ_LIST.length);
    const list = [];
    for (const f of FKZ_LIST) {
      try {
        const found = await findByNumberDate(f.number, f.date);
        const d = await fetchDoc(found, f.name, { short: f.short, kind: "Федеральный конституционный закон", branch: "Конституционное право" });
        if (d.error) { console.log("  —    " + f.number + " " + f.date + "  (" + d.error + ")"); continue; }
        list.push(d);
        console.log("  OK   " + (d.number + " от " + d.adopted).padEnd(22) + " статей " + String(d.n_articles).padStart(3) + "  ред. " + d.redaction_date + "  " + d.name);
      } catch (e) {
        console.log("  ERR  " + f.number + " " + f.date + " -> " + e.message);
      }
    }
    fs.writeFileSync(fkzFile, JSON.stringify(list, null, 1), "utf8");
    console.log("  сохранено: vendor/ruslaw/fkz.json (" + list.length + ")");
  }

  // 3. Дополнительные федеральные законы (нет в наборе данных)
  const extraFile = path.join(SRC, "laws-extra.json");
  if (fs.existsSync(extraFile) && !FORCE) {
    console.log("Доп. федеральные законы: уже загружены (vendor/ruslaw/laws-extra.json)");
  } else {
    console.log("\nДополнительные федеральные законы: " + EXTRA_LAWS.length);
    const list = [];
    for (const f of EXTRA_LAWS) {
      try {
        const found = await findByNumberDate(f.number, f.date, FZ_RE);
        const d = await fetchDoc(found, f.name, { id: f.id, short: f.short, branch: f.branch, kind: "Федеральный закон" });
        if (d.error) { console.log("  —    " + f.number + " " + f.date + "  (" + d.error + ")"); continue; }
        d.app_id = f.id;
        list.push(d);
        console.log("  OK   " + (d.number + " от " + d.adopted).padEnd(22) + " статей " + String(d.n_articles).padStart(3) + "  ред. " + d.redaction_date + "  " + f.short);
      } catch (e) {
        console.log("  ERR  " + f.number + " " + f.date + " -> " + e.message);
      }
    }
    fs.writeFileSync(extraFile, JSON.stringify(list, null, 1), "utf8");
    console.log("  сохранено: vendor/ruslaw/laws-extra.json (" + list.length + ")");
  }

  // 4. Постановления Правительства (пункты, а не статьи)
  const decFile = path.join(SRC, "decrees.json");
  if (fs.existsSync(decFile) && !FORCE) {
    console.log("Постановления Правительства: уже загружены (vendor/ruslaw/decrees.json)");
  } else {
    console.log("\nПостановления Правительства: " + DECREES.length);
    const list = [];
    for (const f of DECREES) {
      try {
        const found = await findByNumberDate(f.number, f.date, PG_RE);
        const d = await fetchDoc(found, f.name, { id: f.id, short: f.short, branch: f.branch, kind: "Постановление Правительства Российской Федерации" }, paragraphsToItems);
        if (d.error) { console.log("  —    " + f.number + " " + f.date + "  (" + d.error + ")"); continue; }
        d.app_id = f.id;
        list.push(d);
        console.log("  OK   " + (d.number + " от " + d.adopted).padEnd(22) + " пунктов " + String(d.n_articles).padStart(4) + "  ред. " + d.redaction_date + "  " + f.short);
      } catch (e) {
        console.log("  ERR  " + f.number + " " + f.date + " -> " + e.message);
      }
    }
    fs.writeFileSync(decFile, JSON.stringify(list, null, 1), "utf8");
    console.log("  сохранено: vendor/ruslaw/decrees.json (" + list.length + ")");
  }

  // 5. Заплатки: документы, которые в наборе данных оказались неполными
  fs.mkdirSync(PATCH_DIR, { recursive: true });
  console.log("\nЗаплатки с официального портала: " + PATCH.length);
  for (const f of PATCH) {
    const out = path.join(PATCH_DIR, f.id + ".json");
    if (fs.existsSync(out) && !FORCE) { console.log("  есть  " + f.id); continue; }
    try {
      const found = await findByNumberDate(f.number, f.date, FZ_RE);
      const d = await fetchDoc(found, f.name, { id: f.id, short: f.short, branch: f.branch, kind: "Федеральный закон" });
      if (d.error) { console.log("  —    " + f.id + "  (" + d.error + ")"); continue; }
      d.app_id = f.id;
      fs.writeFileSync(out, JSON.stringify(d, null, 1), "utf8");
      console.log("  OK   " + (d.number + " от " + d.adopted).padEnd(22) + " статей " + String(d.n_articles).padStart(3) + "  " + f.short);
    } catch (e) {
      console.log("  ERR  " + f.id + " -> " + e.message);
    }
  }

  // 6. Метаданные по всем документам набора данных
  if (fs.existsSync(path.join(SRC, "meta.json")) && !FORCE) {
    console.log("\nМетаданные: уже собраны (vendor/ruslaw/meta.json)");
  } else {
    await collectMeta();
  }

  console.log("\nГотово.");
})().catch(e => { console.error("Сбой: " + (e && e.stack || e)); process.exitCode = 1; });
