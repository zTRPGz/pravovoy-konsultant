/* =========================================================================
   Правовой консультант :: сборщик данных
   -------------------------------------------------------------------------
   Превращает JSON-файлы из vendor/ruslaw/ в данные приложения:

     data/registry.js   — реестр всех источников (кодексы, федеральные
                          законы, Конституция, ФКЗ) с датой редакции
     data/index.js      — компактный индекс всех статей для поиска
     data/full/<id>.js  — полные тексты статей, загружаются по требованию
     data/freshness.js  — снимок актуальных редакций для проверки актуальности

   Источники:
     vendor/ruslaw/*.json          — 24 кодекса + манифест
     vendor/ruslaw/laws/*.json     — 45 федеральных законов + манифест
     vendor/ruslaw/konst.json      — Конституция Российской Федерации
     vendor/ruslaw/fkz.json        — федеральные конституционные законы
     vendor/ruslaw/meta.json       — официальные метаданные (вид акта, дата
                                     принятия, состояние) по каждому документу

   Разбор текста выполняет общий модуль tools/lib/parse.js — тот же самый,
   что используется приложением при автоматическом обновлении документов.

   Запуск:  node tools/build-data.js
   ========================================================================= */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const vm = require("vm");
const parse = require("./lib/parse.js");
const text = require("./lib/text.js");
const codeStamp = require("./lib/code-stamp.js").codeStamp;

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "vendor", "ruslaw");
const SRC_LAWS = path.join(SRC, "laws");
const OUT_DATA = path.join(ROOT, "data");
const OUT_FULL = path.join(OUT_DATA, "full");

/* Метка времени прогона — одна на всю сборку, чтобы freshness.js, meta.js,
   status.js и version.json говорили одно и то же время. */
const BUILT_AT = new Date().toISOString();

/* Отпечаток содержимого data/: sha1 по всем .js/.json (кроме самого
   version.json) с обнулённой меткой времени. Меняется только тогда, когда
   меняются сами данные, — по нему приложение понимает, что пора обновиться. */
function buildVersionStamp(articles, sources) {
  const norm = (buf) => buf.toString("utf8").replace(/"built_at":"[^"]*"/g, '"built_at":"X"');
  const files = [];
  (function walk(dir, rel) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
      const r = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else if (/\.(js|json)$/.test(e.name) && r !== "version.json") files.push(r);
    });
  })(OUT_DATA, "");
  files.sort();
  const h = crypto.createHash("sha1");
  files.forEach(function (f) {
    h.update(f); h.update("\0");
    h.update(norm(fs.readFileSync(path.join(OUT_DATA, f))));
    h.update("\0");
  });
  return {
    at: BUILT_AT,
    digest: h.digest("hex").slice(0, 16),
    articles: articles,
    sources: sources,
    files: files.length
  };
}

/* ---------------------------------------------------------------- цвет отраслей */

const BRANCH_COLOR = {
  "Уголовное право": "#e2564a",
  "Уголовный процесс": "#e08b3a",
  "Уголовно-исполнительное право": "#9c5f5f",
  "Административное право": "#c9a227",
  "Гражданское право": "#4a90d9",
  "Трудовое право": "#3aa66f",
  "Налоговое право": "#8e6bd1",
  "Судебный процесс": "#7d8794",
  "Семейное право": "#d4739c",
  "Жилищное право": "#5fb8c9",
  "Земельное право": "#8aa34a",
  "Градостроительное право": "#b07a4a",
  "Бюджетное право": "#a0722f",
  "Лесное право": "#4f8f52",
  "Водное право": "#3f8fbf",
  "Воздушное право": "#6f8fd0",
  "Торговое мореплавание": "#3d7f9c",
  "Внутренний водный транспорт": "#5a8fa0",
  "Финансовое право": "#2f9e8f",
  "Социальное право": "#c98a3a",
  "Информационное право": "#5a7fd0",
  "Транспортное право": "#8f7a3a",
  "Конституционное право": "#b0413e",
  "Судебная практика": "#6f6bb5"
};
function colorOf(branch) { return BRANCH_COLOR[branch] || "#7d8794"; }

/* ---------------------------------------------------------------- реестр кодексов */

/* short — компактное сокращение (abbr: граф ссылок, распознавание упоминаний);
   brief — расшифровка для отображаемого имени «УК РФ (Уголовный кодекс)». */
const CODES = {
  uk:   { file: "63-ФЗ_Уголовный_кодекс_Российской_Федерации.json",          short: "УК РФ",   brief: "Уголовный кодекс",                            full: "Уголовный кодекс Российской Федерации",                            branch: "Уголовное право" },
  upk:  { file: "174-ФЗ_Уголовно-процессуальный_кодекс_Российской_Федерации.json", short: "УПК РФ", brief: "Уголовно-процессуальный кодекс",         full: "Уголовно-процессуальный кодекс Российской Федерации",          branch: "Уголовный процесс" },
  koap: { file: "195-ФЗ_Кодекс_Российской_Федерации_об_административных_правонарушениях.json", short: "КоАП РФ", brief: "Кодекс об административных правонарушениях", full: "Кодекс Российской Федерации об административных правонарушениях", branch: "Административное право" },
  gk1:  { file: "51-ФЗ_Гражданский_кодекс_Российской_Федерации_Часть_первая.json",  short: "ГК РФ ч. I",   brief: "Гражданский кодекс, часть первая",   full: "Гражданский кодекс Российской Федерации. Часть первая",   branch: "Гражданское право" },
  gk2:  { file: "14-ФЗ_Гражданский_кодекс_Российской_Федерации_Часть_вторая.json",  short: "ГК РФ ч. II",  brief: "Гражданский кодекс, часть вторая",   full: "Гражданский кодекс Российской Федерации. Часть вторая",   branch: "Гражданское право" },
  gk3:  { file: "146-ФЗ_Гражданский_кодекс_Российской_Федерации_Часть_третья.json", short: "ГК РФ ч. III", brief: "Гражданский кодекс, часть третья",   full: "Гражданский кодекс Российской Федерации. Часть третья",   branch: "Гражданское право" },
  gk4:  { file: "230-ФЗ_Гражданский_кодекс_Российской_Федерации_Часть_четвертая.json", short: "ГК РФ ч. IV", brief: "Гражданский кодекс, часть четвёртая", full: "Гражданский кодекс Российской Федерации. Часть четвёртая", branch: "Гражданское право" },
  tk:   { file: "197-ФЗ_Трудовой_кодекс_Российской_Федерации.json",          short: "ТК РФ",   brief: "Трудовой кодекс",                            full: "Трудовой кодекс Российской Федерации",                            branch: "Трудовое право" },
  nk1:  { file: "146-ФЗ_Налоговый_кодекс_Российской_Федерации_Часть_первая.json",  short: "НК РФ ч. I",  brief: "Налоговый кодекс, часть первая",  full: "Налоговый кодекс Российской Федерации. Часть первая",  branch: "Налоговое право" },
  nk2:  { file: "117-ФЗ_Налоговый_кодекс_Российской_Федерации_Часть_вторая.json",  short: "НК РФ ч. II", brief: "Налоговый кодекс, часть вторая",  full: "Налоговый кодекс Российской Федерации. Часть вторая",  branch: "Налоговое право" },
  gpk:  { file: "138-ФЗ_Гражданский_процессуальный_кодекс_Российской_Федерации.json", short: "ГПК РФ", brief: "Гражданский процессуальный кодекс", full: "Гражданский процессуальный кодекс Российской Федерации", branch: "Судебный процесс" },
  kas:  { file: "21-ФЗ_Кодекс_административного_судопроизводства_Российской_Федерации.json", short: "КАС РФ", brief: "Кодекс административного судопроизводства", full: "Кодекс административного судопроизводства Российской Федерации", branch: "Судебный процесс" },
  apk:  { file: "95-ФЗ_Арбитражный_процессуальный_кодекс_Российской_Федерации.json", short: "АПК РФ", brief: "Арбитражный процессуальный кодекс", full: "Арбитражный процессуальный кодекс Российской Федерации", branch: "Судебный процесс" },
  sk:   { file: "223-ФЗ_Семейный_кодекс_Российской_Федерации.json",          short: "СК РФ",   brief: "Семейный кодекс",                            full: "Семейный кодекс Российской Федерации",                            branch: "Семейное право" },
  zhk:  { file: "188-ФЗ_Жилищный_кодекс_Российской_Федерации.json",          short: "ЖК РФ",   brief: "Жилищный кодекс",                            full: "Жилищный кодекс Российской Федерации",                            branch: "Жилищное право" },
  zk:   { file: "136-ФЗ_Земельный_кодекс_Российской_Федерации.json",         short: "ЗК РФ",   brief: "Земельный кодекс",                           full: "Земельный кодекс Российской Федерации",                           branch: "Земельное право" },
  grk:  { file: "190-ФЗ_Градостроительный_кодекс_Российской_Федерации.json", short: "ГрК РФ",  brief: "Градостроительный кодекс",                   full: "Градостроительный кодекс Российской Федерации",                   branch: "Градостроительное право" },
  bk:   { file: "145-ФЗ_Бюджетный_кодекс_Российской_Федерации.json",         short: "БК РФ",   brief: "Бюджетный кодекс",                           full: "Бюджетный кодекс Российской Федерации",                           branch: "Бюджетное право" },
  uik:  { file: "1-ФЗ_Уголовно-исполнительный_кодекс_Российской_Федерации.json", short: "УИК РФ", brief: "Уголовно-исполнительный кодекс",           full: "Уголовно-исполнительный кодекс Российской Федерации",           branch: "Уголовно-исполнительное право" },
  lk:   { file: "200-ФЗ_Лесной_кодекс_Российской_Федерации.json",            short: "ЛК РФ",   brief: "Лесной кодекс",                              full: "Лесной кодекс Российской Федерации",                              branch: "Лесное право" },
  vk:   { file: "74-ФЗ_Водный_кодекс_Российской_Федерации.json",             short: "ВК РФ",   brief: "Водный кодекс",                              full: "Водный кодекс Российской Федерации",                              branch: "Водное право" },
  vozk: { file: "60-ФЗ_Воздушный_кодекс_Российской_Федерации.json",          short: "ВзК РФ",  brief: "Воздушный кодекс",                           full: "Воздушный кодекс Российской Федерации",                           branch: "Воздушное право" },
  ktm:  { file: "81-ФЗ_Кодекс_торгового_мореплавания_Российской_Федерации.json", short: "КТМ РФ", brief: "Кодекс торгового мореплавания",            full: "Кодекс торгового мореплавания Российской Федерации",            branch: "Торговое мореплавание" },
  kvvt: { file: "24-ФЗ_Кодекс_внутреннего_водного_транспорта_Российской_Федерации.json", short: "КВВТ РФ", brief: "Кодекс внутреннего водного транспорта", full: "Кодекс внутреннего водного транспорта Российской Федерации", branch: "Внутренний водный транспорт" }
};

/* ---------------------------------------------------------------- реестр федеральных законов */

const LAWS = {
  fz102:  { file: "102-ФЗ_Об_ипотеке_залоге_недвижимости.json", short: "ФЗ об ипотеке", branch: "Жилищное право" },
  fz1032: { file: "1032-I_О_занятости_населения_в_Российской_Федерации.json", short: "ФЗ о занятости", branch: "Трудовое право" },
  fz115:  { file: "115-ФЗ_О_противодействии_легализации_отмыванию_доходов_полученных_преступным_путем_и_финансированию_терроризма.json", short: "ФЗ о легализации", branch: "Финансовое право" },
  fz125:  { file: "125-ФЗ_Об_обязательном_социальном_страховании_от_несчастных_случаев_на_производстве_и_профессиональных_заболеваний.json", short: "ФЗ о страховании от несчастных случаев", branch: "Социальное право" },
  fz126:  { file: "126-ФЗ_О_связи.json", short: "ФЗ о связи", branch: "Информационное право" },
  fz127:  { file: "127-ФЗ_О_несостоятельности_банкротстве.json", short: "ФЗ о банкротстве", branch: "Финансовое право" },
  fz149:  { file: "149-ФЗ_Об_информации_информационных_технологиях_и_о_защите_информации.json", short: "ФЗ об информации", branch: "Информационное право" },
  fz152:  { file: "152-ФЗ_О_персональных_данных.json", short: "ФЗ о персональных данных", branch: "Информационное право" },
  fz159:  { file: "159-ФЗ_О_дополнительных_гарантиях_по_социальной_поддержке_детей-сирот_и_детей_оставшихся_без_попечения_родителей.json", short: "ФЗ о детях-сиротах", branch: "Социальное право" },
  fz161:  { file: "161-ФЗ_О_национальной_платежной_системе.json", short: "ФЗ о платёжной системе", branch: "Финансовое право" },
  fz166:  { file: "166-ФЗ_О_государственном_пенсионном_обеспечении_в_Российской_Федерации.json", short: "ФЗ о государственных пенсиях", branch: "Социальное право" },
  fz167:  { file: "167-ФЗ_Об_обязательном_пенсионном_страховании_в_Российской_Федерации.json", short: "ФЗ об обязательном пенсионном страховании", branch: "Социальное право" },
  fz170:  { file: "170-ФЗ_О_техническом_осмотре_транспортных_средств_и_о_внесении_изменений_в_отдельные_законодательные_акты_Российской_Фед.json", short: "ФЗ о техосмотре", branch: "Транспортное право" },
  fz173:  { file: "173-ФЗ_О_валютном_регулировании_и_валютном_контроле.json", short: "ФЗ о валютном регулировании", branch: "Финансовое право" },
  fz177:  { file: "177-ФЗ_О_страховании_вкладов_в_банках_Российской_Федерации.json", short: "ФЗ о страховании вкладов", branch: "Финансовое право" },
  fz178:  { file: "178-ФЗ_О_государственной_социальной_помощи.json", short: "ФЗ о социальной помощи", branch: "Социальное право" },
  fz181:  { file: "181-ФЗ_О_социальной_защите_инвалидов_в_Российской_Федерации.json", short: "ФЗ об инвалидах", branch: "Социальное право" },
  fz196:  { file: "196-ФЗ_О_внесении_изменений_в_Кодекс_Российской_Федерации_об_административных_правонарушениях_и_статью_28_Федерального_з.json", short: "ФЗ о БДД", branch: "Транспортное право" },
  fz214:  { file: "214-ФЗ_Об_участии_в_долевом_строительстве_многоквартирных_домов_и_иных_объектов_недвижимости_и_о_внесении_изменений_в_не.json", short: "ФЗ о долевом строительстве", branch: "Жилищное право" },
  fz218a: { file: "218-ФЗ_О_государственной_регистрации_недвижимости.json", short: "ФЗ о госрегистрации недвижимости", branch: "Жилищное право" },
  fz218b: { file: "218-ФЗ_О_кредитных_историях.json", short: "ФЗ о кредитных историях", branch: "Финансовое право" },
  fz229:  { file: "229-ФЗ_Об_исполнительном_производстве.json", short: "ФЗ об исполнительном производстве", branch: "Судебный процесс" },
  fz230:  { file: "230-ФЗ_О_защите_прав_и_законных_интересов_физических_лиц_при_осуществлении_деятельности_по_возврату_просроченной_задолже.json", short: "ФЗ о взыскании долгов", branch: "Финансовое право" },
  fz2300: { file: "2300-I_О_защите_прав_потребителей.json", short: "ФЗ о защите прав потребителей", branch: "Гражданское право" },
  fz255:  { file: "255-ФЗ_Об_обязательном_социальном_страховании_на_случай_временной_нетрудоспособности_и_в_связи_с_материнством.json", short: "ФЗ о пособиях", branch: "Социальное право" },
  fz256:  { file: "256-ФЗ_О_дополнительных_мерах_государственной_поддержки_семей_имеющих_детей.json", short: "ФЗ о маткапитале", branch: "Социальное право" },
  fz259:  { file: "259-ФЗ_О_цифровых_финансовых_активах_цифровой_валюте_и_о_внесении_изменений_в_отдельные_законодательные_акты_Российской_.json", short: "ФЗ о ЦФА", branch: "Финансовое право" },
  fz27:   { file: "27-ФЗ_Об_индивидуальном_персонифицированном_учете_в_системах_обязательного_пенсионного_страхования_и_обязательного_социа.json", short: "ФЗ о персонифицированном учёте", branch: "Социальное право" },
  fz294:  { file: "294-ФЗ_О_защите_прав_юридических_лиц_и_индивидуальных_предпринимателей_при_осуществлении_государственного_контроля_надзо.json", short: "ФЗ о госконтроле", branch: "Административное право" },
  fz353:  { file: "353-ФЗ_О_потребительском_кредите_займе.json", short: "ФЗ о потребкредите", branch: "Финансовое право" },
  fz38:   { file: "38-ФЗ_О_рекламе.json", short: "ФЗ о рекламе", branch: "Гражданское право" },
  fz381:  { file: "381-ФЗ_Об_основах_государственного_регулирования_торговой_деятельности_в_Российской_Федерации.json", short: "ФЗ о торговой деятельности", branch: "Гражданское право" },
  fz39:   { file: "39-ФЗ_О_рынке_ценных_бумаг.json", short: "ФЗ о рынке ценных бумаг", branch: "Финансовое право" },
  fz395:  { file: "395-I_Федеральный_закон_О_банках_и_банковской_деятельности.json", short: "ФЗ о банках", branch: "Финансовое право" },
  fz40:   { file: "40-ФЗ_Об_обязательном_страховании_гражданской_ответственности_владельцев_транспортных_средств.json", short: "ФЗ об ОСАГО", branch: "Транспортное право" },
  fz400:  { file: "400-ФЗ_О_страховых_пенсиях.json", short: "ФЗ о страховых пенсиях", branch: "Социальное право" },
  fz4015: { file: "4015-I_Об_организации_страхового_дела_в_Российской_Федерации.json", short: "ФЗ о страховом деле", branch: "Финансовое право" },
  fz422:  { file: "422-ФЗ_О_проведении_эксперимента_по_установлению_специального_налогового_режима_Налог_на_профессиональный_доход.json", short: "ФЗ о самозанятых", branch: "Налоговое право" },
  fz424:  { file: "424-ФЗ_О_накопительной_пенсии.json", short: "ФЗ о накопительной пенсии", branch: "Социальное право" },
  fz426:  { file: "426-ФЗ_О_специальной_оценке_условий_труда.json", short: "ФЗ о спецоценке труда", branch: "Трудовое право" },
  fz4468: { file: "4468-I_О_пенсионном_обеспечении_лиц_проходивших_военную_службу_службу_в_органах_внутренних_дел_Государственной_противопо.json", short: "ФЗ о пенсиях военнослужащих", branch: "Социальное право" },
  fz48:   { file: "48-ФЗ_Об_опеке_и_попечительстве.json", short: "ФЗ об опеке", branch: "Семейное право" },
  fz63:   { file: "63-ФЗ_Об_электронной_подписи.json", short: "ФЗ об электронной подписи", branch: "Информационное право" },
  fz82:   { file: "82-ФЗ_О_минимальном_размере_оплаты_труда.json", short: "ФЗ о МРОТ", branch: "Трудовое право" },
  fz86:   { file: "86-ФЗ_О_Центральном_банке_Российской_Федерации_Банке_России.json", short: "ФЗ о Банке России", branch: "Финансовое право" }
};

/* ---------------------------------------------------------------- прочие источники */

const KONST = { id: "kons", file: "konst.json", short: "Конституция РФ", full: "Конституция Российской Федерации", branch: "Конституционное право" };
const FKZ_FILE = "fkz.json";

/* Документы, которые в открытом наборе данных оказались неполными или
   подменёнными. Загружаются напрямую с официального портала
   (tools/fetch-extra.js --patch) и имеют приоритет над файлом набора. */
const PATCH_DIR = path.join(SRC, "patch");

/* ---------------------------------------------------------------- метаданные */

function loadJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return null; }
}

function loadContext() {
  const meta = loadJSON(path.join(SRC, "meta.json")) || {};
  const codesManifest = loadJSON(path.join(SRC, "manifest.json")) || {};
  const lawsManifest = loadJSON(path.join(SRC_LAWS, "manifest.json")) || {};

  // slug -> hash
  const hashBySlug = {};
  Object.keys(codesManifest).forEach(function (h) { hashBySlug[codesManifest[h].slug] = h; });
  Object.keys(lawsManifest).forEach(function (h) { hashBySlug[lawsManifest[h].slug] = h; });

  return { meta: meta, codesManifest: codesManifest, lawsManifest: lawsManifest, hashBySlug: hashBySlug };
}

function esc(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "");
}

function fmtAdopted(iso) {
  // "27.07.2006" уже в нужном виде; "2006-07-27" -> "27.07.2006"
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  return m ? m[3] + "." + m[2] + "." + m[1] : (iso || "");
}

/* ------------------------------------------------------------ имена источников

   Отображаемое имя (registry.short) — «нормальное»: краткое обозначение плюс
   расшифровка/тема и номер: «УК РФ (Уголовный кодекс)», «ФЗ «О ФСБ» № 40».
   Отдельно хранится registry.abbr — компактное сокращение, нужное там, где
   имя ограничено по длине и участвует в разборе текста (граф ссылок, xref). */

function capFirst(s) {
  s = String(s == null ? "" : s);
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/* «Российской Федерации» → «РФ», «в ее составе» → «в её составе».
   Внимание: \b в JS не работает с кириллицей — только явные границы. */
function shortenRF(s) {
  return String(s == null ? "" : s)
    .replace(/Российской\s+Федерации/g, "РФ")
    .replace(/Российскую\s+Федерацию/g, "РФ")
    .replace(/(^|[\s(])ее(?=[\s,.;:)\]»]|$)/g, "$1её");
}

/* вложенные прямые кавычки в названии → „…“ (внутри внешних «…») */
function innerQuotes(s) {
  return String(s == null ? "" : s).replace(/"([^"]*)"/g, "\u201E$1\u201C");
}

/* Снять внешние кавычки, только если название целиком в них заключено
   («…» или "…"). Иначе легко срезать закрывающую кавычку вложенной ссылки:
   «…в Федеральный закон "О микрофинансовой деятельности…"». */
function stripOuterQuotes(s) {
  s = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  var m = /^([«"])\s*(.*?)\s*([»"])$/.exec(s);
  if (m && ((m[1] === "«" && m[3] === "»") || (m[1] === '"' && m[3] === '"'))) {
    return m[2].trim();
  }
  return s;
}

function codeTitle(short, brief) { return brief ? short + " (" + brief + ")" : short; }

/* «ФЗ о ФСБ» + «40-ФЗ» → «ФЗ «О ФСБ» № 40»;
   «ФЗ о банках» + «395-I» → «Закон РФ «О банках» № 395-I» */
function lawTitle(short, number) {
  var s = String(short || "");
  var m = /^(?:ФЗ|Закон\s+РФ)\s+(.+)$/i.exec(s);
  var topic = capFirst((m ? m[1] : s).trim());
  var num = String(number || "").trim();
  var type, n;
  if (/-ФЗ$/i.test(num)) { type = "ФЗ"; n = num.replace(/-ФЗ$/i, ""); }
  else if (/-I{1,2}$/.test(num)) { type = "Закон РФ"; n = num; }
  else { type = "ФЗ"; n = num; }
  return type + " «" + topic + "»" + (n ? " № " + n : "");
}

/* ФКЗ: тема — из официального названия (в сокращённых подписях она усечена),
   номер — без служебного «-ФКЗ». */
function fkzTitle(full, number) {
  var topic = stripOuterQuotes(String(full || "").replace(
    /^Федеральн[а-яё]*\s+конституционн[а-яё]*\s+закон[а-яё]*\s*/i, ""));
  topic = shortenRF(topic).trim();
  var n = String(number || "").replace(/-ФКЗ$/i, "");
  return "ФКЗ «" + topic + "»" + (n ? " № " + n : "");
}

/* Постановления Правительства: узнаваемое короткое имя + реквизит в скобках. */
function decreeTitle(short, number) {
  var n = String(number || "").trim();
  return String(short || "") +
    (n ? " (Постановление Правительства РФ № " + n + ")"
       : " (Постановление Правительства РФ)");
}

/* Постановления Пленума ВС РФ: реквизит плюс тема разъяснения — по номеру и
   дате найти нужное постановление невозможно, тема обязательна. */
function plenumTitle(short, name) {
  var topic = String(name || "").replace(/\s+/g, " ").trim();
  return String(short || "") + (topic ? " «" + topic + "»" : "");
}

/* Отображаемое имя для документа любого вида. */
function displayName(cfg, number) {
  if (cfg.name) return cfg.name;
  if (cfg.kind === "code") return codeTitle(cfg.short, cfg.brief);
  if (cfg.kind === "law") return lawTitle(cfg.short, number);
  if (cfg.kind === "fkz") return fkzTitle(cfg.full, number);
  if (cfg.kind === "decree") return decreeTitle(cfg.short, number);
  if (cfg.kind === "plenum") return plenumTitle(cfg.short, cfg.topic);
  return cfg.short;
}

/* Читает обратно уже записанный data/full/<id>.js и возвращает массив статей.
   Файлы приложения — обычные скрипты для браузера (window.RF_FULL), поэтому
   выполняем их в изолированной песочнице, а не через require. */
function readFullRows(id) {
  const src = fs.readFileSync(path.join(OUT_FULL, id + ".js"), "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(src, sandbox, { filename: id + ".js" });
  return (sandbox.window.RF_FULL || {})[id] || [];
}

/* --- граф перекрёстных ссылок (data/graph.js) ------------------------------
   Раздел «Связи источников» раньше считал граф прямо в браузере: чтобы его
   построить, приложение подгружало полные тексты ВСЕХ источников — это 118 МБ
   и десятки секунд ожидания на пустом кеше. Сам граф при этом зависит только
   от текстов, то есть от содержимого сборки, и считается за считанные секунды.
   Поэтому считаем его здесь и кладём готовым файлом на десятки килобайт.

   Единица счёта — уникальная цель внутри статьи: одна статья одного акта
   даёт максимум одну связь с каждым другим актом (иначе акт, где норма
   упомянута сто раз, перевешивал бы всё остальное). */
function buildGraph(registry, index) {
  const knownArts = {};
  index.forEach(function (r) { knownArts[r[0] + "-" + r[1]] = 1; });

  const xr = require("./lib/xref.js").create({
    docs: registry,
    has: function (id, num) { return !!knownArts[id + "-" + num]; }
  });

  const inRegistry = {};
  registry.forEach(function (c) { inRegistry[c.id] = 1; });

  const link = {}, weight = {};
  registry.forEach(function (c) {
    if (!fs.existsSync(path.join(OUT_FULL, c.id + ".js"))) return;
    readFullRows(c.id).forEach(function (row) {
      if (!row || !row[4]) return;
      const seen = {};
      xr.targets(row[4], { doc: c.id, num: row[0] }).forEach(function (t) {
        if (t.doc === c.id || !inRegistry[t.doc]) return;
        if (seen[t.doc]) return;
        seen[t.doc] = 1;
        const k = c.id + "|" + t.doc;
        link[k] = (link[k] || 0) + 1;
        weight[c.id] = (weight[c.id] || 0) + 1;
        weight[t.doc] = (weight[t.doc] || 0) + 1;
      });
    });
  });

  /* Порядок рёбер фиксируем: файл участвует в отпечатке сборки, а от него
     зависит, перезагрузится ли открытая вкладка у посетителя. */
  const edges = Object.keys(link).map(function (k) {
    const p = k.split("|");
    return [p[0], p[1], link[k]];
  }).sort(function (a, b) {
    if (b[2] !== a[2]) return b[2] - a[2];
    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
    return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
  });

  const total = edges.reduce(function (s, e) { return s + e[2]; }, 0);
  const body = "/* Правовой консультант :: граф перекрёстных ссылок между источниками.\n" +
    "   edges — направленные связи [откуда, куда, сколько статей ссылается];\n" +
    "   weight — сколько ссылок ведёт к акту и из него (по нему выбираются\n" +
    "   самые связанные акты для рисунка). Учитываются только ссылки между\n" +
    "   актами базы; связи внутри одного акта не считаются.\n" +
    "   Считается один раз при сборке — в браузере полные тексты для этого\n" +
    "   больше не подгружаются. Сформирован автоматически: tools/build-data.js */\n" +
    "window.RF_GRAPH=" + JSON.stringify({ built_at: BUILT_AT, edges: edges, weight: weight }) + ";\n";
  fs.writeFileSync(path.join(OUT_DATA, "graph.js"), body, "utf8");
  return { pairs: edges.length, nodes: Object.keys(weight).length, links: total, size: Buffer.byteLength(body) };
}

/* ---------------------------------------------------------------- сборка */

function build() {
  fs.mkdirSync(OUT_FULL, { recursive: true });
  const ctx = loadContext();

  const registry = [];
  const index = [];
  const stats = [];
  const warnings = [];
  const freshness = {};

  /* Постановления Пленума ВС РФ живут в другом источнике (sudact.ru), у них нет
     хэша официального портала, поэтому «Проверка актуальности» для них работает
     иначе: в снимок кладём дату загрузки каталога и реквизиты источника. */
  const plenumMeta = { count: 0, fetched_at: "", source: "", catalogue: "", newest: "", oldest: "", lastRedaction: "" };
  /* Обзоры судебной практики и постановления Президиума ВС РФ: тот же набор
     сведений, что у Пленума, — но другой источник (sudact.ru/vsrf/presidium/),
     поэтому и сводка отдельная. */
  const reviewMeta = { count: 0, fetched_at: "", source: "", catalogue: "", newest: "", oldest: "", lastRedaction: "" };

  /* Статусы норм: утрата силы, приостановление, признание недействующей.
     Отдельный слой (data/status.js) — по id статьи «<источник>-<номер>»,
     потому что статус есть только у части норм и в индекс его класть нельзя. */
  const statuses = {};
  const statusCount = { repealed: 0, suspended: 0, void: 0 };

  /* Инвертированный индекс: основа слова -> номера статей (позиции в index) */
  const ftMap = {};
  let ftTokens = 0;

  /* Опознавательный ключ федерального закона: «номер|название» в нижнем
     регистре без лишних пробелов. Два разных набора (открытый набор данных и
     дополнительные законы с официального портала) описывают один и тот же
     закон по-разному — id и файл у них свои, а номер и официальное название
     совпадают. По этому ключу ловим дубли: иначе один закон попадал бы в
     реестр дважды, и в поиске появлялись бы две одинаковые карточки, а статьи
     делились между ними. */
  function lawKeyOf(raw) {
    if (!raw) return "";
    return String(raw.number || "").replace(/\s+/g, "").toLowerCase() + "|" +
      String(raw.name || "").replace(/\s+/g, " ").trim().toLowerCase();
  }
  const seenLawKeys = {};

  /* --- вспомогательная сборка одного документа --- */
  function addDoc(cfg) {
    // cfg: { id, kind, raw, short, full, branch, req, file (для диагностики), slug, group }
    const raw = cfg.raw;
    if (!raw) { warnings.push("нет данных для " + cfg.id); return; }

    if (cfg.kind === "law") seenLawKeys[lawKeyOf(raw)] = cfg.id;

    const res = parse.parseDoc(raw, { mode: cfg.mode || "articles" });
    const arts = res.arts;
    const dupN = parse.dedupeNumbers(arts);
    if (dupN) warnings.push(cfg.short + ": повторяющихся номеров — " + dupN);

    const longT = arts.filter(function (a) { return a.t.length > 170; });
    if (longT.length) warnings.push(cfg.short + ": слишком длинных названий — " + longT.length + " (напр. ст. " + longT[0].n + ")");

    const chapters = {};
    arts.forEach(function (a) { if (a.g) chapters[a.g] = (chapters[a.g] || 0) + 1; });

    // официальные метаданные
    const hash = ctx.hashBySlug[cfg.slug] || raw.hash || "";
    const meta = ctx.meta[hash] || null;
    const req = cfg.req || (meta ? [meta.adopted ? "от " + fmtAdopted(meta.adopted) : "", meta.number ? "№ " + meta.number : ""].filter(Boolean).join(" ") : "");
    const num = cfg.number || (meta ? meta.number : "") || "";

    registry.push({
      id: cfg.id, kind: cfg.kind, short: displayName(cfg, num), abbr: cfg.short,
      full: cfg.full, req: req,
      branch: cfg.branch, color: colorOf(cfg.branch),
      docstate: raw.docstate || "", redaction: raw.redaction_date || "",
      adopted: cfg.adopted ? fmtAdopted(cfg.adopted) : (meta ? fmtAdopted(meta.adopted) : ""),
      number: num,
      docpassing: meta ? meta.docpassing : "",
      source_url: raw.source_url || "", dataset: raw.name || "",
      count: arts.length
    });

    arts.forEach(function (a) {
      var gi = index.length;
      /* полнотекстовый индекс: название, глава и полный текст статьи.
         Основы берём С ПОВТОРАМИ: частота слова нужна для BM25 — в статье
         о наркотиках основа «наркотическ» встречается десятки раз, а в
         норме, где они упомянуты вскользь, — один раз. Уникальные основы
         отдаёт text.stems(), он же используется при разборе запроса. */
      var st = text.stemTokens(a.t + "\n" + (a.g || "") + "\n" + a.text);
      index.push([cfg.id, a.n, a.t, a.g, st.length]);
      /* Статус нормы: утратила силу / приостановлена / недействующая.
         Только у нормативных актов. В постановлениях Пленума и обзорах
         судебной практики «утратил силу» встречается в самом тексте — как
         ссылка на утратившую силу норму, а не как судьба самого пункта, — и
         разбор порождал мусор: акт-основание вида «ии из описи». */
      if (parse.detectStatus && cfg.kind !== "plenum" && cfg.kind !== "review") {
        var stt = parse.detectStatus(a.text);
        if (stt) {
          statuses[cfg.id + "-" + a.n] = [stt.status, stt.act || "", stt.date || ""];
          statusCount[stt.status] = (statusCount[stt.status] || 0) + 1;
        }
      }
      for (var k = 0; k < st.length; k++) {
        var arr = ftMap[st[k]] || (ftMap[st[k]] = []);
        arr.push(gi);
      }
      ftTokens += st.length;
    });

    const lines = arts.map(function (a) {
      return '["' + esc(a.n) + '","' + esc(a.t) + '","' + esc(a.g) + '","' + esc(a.red) + '","' + esc(a.text) + '"]';
    });
    /* Источник текста: у актов с официального портала это actual.pravo.gov.ru,
       у постановлений Пленума ВС РФ — sudact.ru (портал Пленумов не содержит). */
    const srcHost = /^https?:\/\/([^\/]+)/.exec(raw.source_url || "");
    const head = "/* " + cfg.full + ". Редакция: " + (raw.redaction_date || "н/д") +
      ". Источник: " + (srcHost ? srcHost[1] : "actual.pravo.gov.ru") + " */\n" +
      "window.RF_FULL=window.RF_FULL||{};window.RF_FULL[\"" + cfg.id + "\"]=[\n";
    fs.writeFileSync(path.join(OUT_FULL, cfg.id + ".js"), head + lines.join(",\n") + "\n];\n", "utf8");

    freshness[cfg.id] = {
      hash: hash, redaction: raw.redaction_date || "",
      redid: raw.redid || (meta ? meta.redid : 0) || 0,
      number: meta ? meta.number : "", slug: cfg.slug || "", group: cfg.group || "",
      kind: cfg.kind, src: cfg.src || "", key: cfg.key || ""
    };

    stats.push({
      id: cfg.id, kind: cfg.kind, short: cfg.short, entries: (raw.articles || []).length,
      articles: arts.length, sub: res.sub, chapters: Object.keys(chapters).length, red: raw.redaction_date
    });
    if (res.stubs) warnings.push(cfg.short + ": записей-заглушек «Пункт N» пропущено — " + res.stubs);
  }

  /* --- 1. Кодексы --- */
  Object.keys(CODES).forEach(function (id) {
    const cfg = CODES[id];
    const raw = loadJSON(path.join(SRC, cfg.file));
    addDoc({
      id: id, kind: "code", raw: raw, short: cfg.short, brief: cfg.brief, full: cfg.full, branch: cfg.branch,
      slug: cfg.file.replace(/\.json$/, ""), group: "codes"
    });
  });

  /* --- 2. Федеральные законы --- */
  Object.keys(LAWS).forEach(function (id) {
    const cfg = LAWS[id];
    // «заплатка» с официального портала имеет приоритет над набором данных
    const patch = loadJSON(path.join(PATCH_DIR, id + ".json"));
    const raw = patch || loadJSON(path.join(SRC_LAWS, cfg.file));
    if (patch) warnings.push(cfg.short + ": использован текст с официального портала (заплатка)");
    const official = stripOuterQuotes((raw && raw.name) ? raw.name.replace(/^Федеральный закон\s*/i, "") : "");
    addDoc({
      id: id, kind: "law", raw: raw, short: cfg.short,
      full: "Федеральный закон" + (official ? " «" + innerQuotes(official) + "»" : ""),
      branch: cfg.branch, slug: cfg.file.replace(/\.json$/, ""), group: "laws",
      src: patch ? "patch/" + id + ".json" : ""
    });
  });

  /* --- 3. Дополнительные федеральные законы (загружены с официального портала) --- */
  (function () {
    const list = loadJSON(path.join(SRC, "laws-extra.json"));
    if (!list || !list.length) { warnings.push("нет дополнительных законов (vendor/ruslaw/laws-extra.json)"); return; }
    list.forEach(function (raw) {
      if (!raw.app_id) { warnings.push("у дополнительного закона нет app_id: " + raw.slug); return; }
      /* Закон уже пришёл из открытого набора данных (LAWS) — второй раз не
         берём: набор данных считается основным, дополнительный список лишь
         дополняет его. Дубль в реестре раздвоил бы карточку закона. */
      const twin = seenLawKeys[lawKeyOf(raw)];
      if (twin) {
        warnings.push("дополнительный закон " + raw.app_id + " «" + raw.short + "» пропущен — уже есть как " + twin);
        return;
      }
      addDoc({
        id: raw.app_id, kind: "law", raw: raw, short: raw.short,
        full: "Федеральный закон «" + innerQuotes(stripOuterQuotes(String(raw.name || "").replace(/^Федеральный закон\s*/i, ""))) + "»",
        branch: raw.branch, mode: "articles",
        req: raw.adopted ? "от " + raw.adopted + " № " + raw.number : "",
        number: raw.number || "", adopted: raw.adopted || "",
        slug: "", group: "extra", src: "laws-extra.json", key: raw.app_id
      });
    });
  })();

  /* --- 4. Конституция --- */
  (function () {
    const raw = loadJSON(path.join(SRC, KONST.file));
    if (!raw) { warnings.push("нет Конституции (vendor/ruslaw/konst.json)"); return; }
    addDoc({
      id: KONST.id, kind: "constitution", raw: raw, short: KONST.short, full: KONST.full,
      branch: KONST.branch, mode: "plain",
      req: raw.adopted ? "принята " + raw.adopted : "",
      adopted: raw.adopted || "",
      slug: "konst", group: "extra", src: "konst.json"
    });
  })();

  /* --- 5. Федеральные конституционные законы --- */
  (function () {
    const list = loadJSON(path.join(SRC, FKZ_FILE));
    if (!list || !list.length) { warnings.push("нет ФКЗ (vendor/ruslaw/fkz.json)"); return; }
    list.forEach(function (raw) {
      const num = String(raw.number || "").replace(/[^0-9]/g, "") || "0";
      const year = (String(raw.adopted || "").match(/(\d{4})$/) || [, "0000"])[1];
      const id = "fkz" + num + "-" + year;
      addDoc({
        id: id, kind: "fkz", raw: raw, short: raw.short || ("ФКЗ № " + raw.number),
        full: "Федеральный конституционный закон «" + innerQuotes(stripOuterQuotes(String(raw.name || "").replace(/^Федеральный конституционный закон\s*/i, ""))) + "»",
        branch: raw.branch || "Конституционное право", mode: "plain",
        req: raw.adopted ? "от " + raw.adopted + " № " + raw.number : "",
        number: raw.number || "", adopted: raw.adopted || "",
        slug: "", group: "extra", src: "fkz.json", key: raw.name
      });
    });
  })();

  /* --- 6. Постановления Правительства (пункты, а не статьи) --- */
  (function () {
    const list = loadJSON(path.join(SRC, "decrees.json"));
    if (!list || !list.length) { warnings.push("нет постановлений (vendor/ruslaw/decrees.json)"); return; }
    list.forEach(function (raw) {
      if (!raw.app_id) { warnings.push("у постановления нет app_id: " + raw.slug); return; }
      addDoc({
        id: raw.app_id, kind: "decree", raw: raw, short: raw.short,
        full: "Постановление Правительства РФ «" + innerQuotes(stripOuterQuotes(String(raw.name || "").replace(/^(Постановление|Об утверждении)\s*/i, ""))) + "»",
        branch: raw.branch, mode: "plain",
        req: raw.adopted ? "от " + raw.adopted + " № " + raw.number : "",
        number: raw.number || "", adopted: raw.adopted || "",
        slug: "", group: "extra", src: "decrees.json", key: raw.app_id
      });
    });
  })();

  /* --- 7. Постановления Пленума Верховного Суда РФ (пункты разъяснений) --- */
  (function () {
    const list = loadJSON(path.join(SRC, "plenums.json"));
    if (!list || !list.length) { warnings.push("нет постановлений Пленума ВС РФ (vendor/ruslaw/plenums.json)"); return; }
    list.forEach(function (raw) {
      if (!raw.app_id) { warnings.push("у постановления Пленума нет app_id: " + raw.slug); return; }
      plenumMeta.count++;
      if (raw.fetched_at && raw.fetched_at > plenumMeta.fetched_at) plenumMeta.fetched_at = raw.fetched_at;
      if (raw.source_url) {
        plenumMeta.source = plenumMeta.source || raw.source_url;
        plenumMeta.catalogue = plenumMeta.catalogue || raw.source_url.replace(/\/law\/[^\/]+\/?$/, "/vsrf/plenum/");
      }
      /* даты в формате ДД.ММ.ГГГГ сравнивать строками нельзя — переводим в ГГГГММДД */
      const ord = (s) => { const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s); return m ? m[3] + m[2] + m[1] : s; };
      const ad = raw.adopted || "";
      if (ad) {
        if (!plenumMeta.newest || ord(ad) > ord(plenumMeta.newest)) plenumMeta.newest = ad;
        if (!plenumMeta.oldest || ord(ad) < ord(plenumMeta.oldest)) plenumMeta.oldest = ad;
      }
      if (raw.redaction_date && (!plenumMeta.lastRedaction || ord(raw.redaction_date) > ord(plenumMeta.lastRedaction))) {
        plenumMeta.lastRedaction = raw.redaction_date;
      }
      addDoc({
        id: raw.app_id, kind: "plenum", raw: raw, short: raw.short, topic: raw.name,
        full: raw.full || ("Постановление Пленума Верховного Суда Российской Федерации № " + raw.number),
        branch: raw.branch || "Судебная практика", mode: "plain",
        req: raw.adopted ? "от " + raw.adopted + " № " + raw.number : "",
        number: raw.number || "", adopted: raw.adopted || "",
        slug: "", group: "extra", src: "plenums.json", key: raw.app_id
      });
    });
  })();

  /* --- 8. Обзоры судебной практики и постановления Президиума ВС РФ ---

     Пленум разъясняет, Президиум обобщает практику — это разные виды актов, и
     в приложении они разделены. Единица цитирования у обзора — вопрос обзора
     («Вопрос 14: …») или его пункт; у обзоров сплошного изложения (практика по
     категориям дел) единица одна — весь документ, потому что своей нумерации
     у такого текста нет, а выдумывать её нельзя (см. tools/fetch-reviews.js). */
  (function () {
    const list = loadJSON(path.join(SRC, "reviews.json"));
    if (!list || !list.length) { warnings.push("нет обзоров судебной практики ВС РФ (vendor/ruslaw/reviews.json)"); return; }
    const ord = (s) => { const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s); return m ? m[3] + m[2] + m[1] : s; };
    list.forEach(function (raw) {
      if (!raw.app_id) { warnings.push("у обзора судебной практики нет app_id: " + raw.slug); return; }
      reviewMeta.count++;
      if (raw.fetched_at && raw.fetched_at > reviewMeta.fetched_at) reviewMeta.fetched_at = raw.fetched_at;
      if (raw.source_url) {
        reviewMeta.source = reviewMeta.source || raw.source_url;
        reviewMeta.catalogue = reviewMeta.catalogue || raw.source_url.replace(/\/law\/[^\/]+\/?$/, "/vsrf/presidium/");
      }
      const ad = raw.adopted || "";
      if (ad) {
        if (!reviewMeta.newest || ord(ad) > ord(reviewMeta.newest)) reviewMeta.newest = ad;
        if (!reviewMeta.oldest || ord(ad) < ord(reviewMeta.oldest)) reviewMeta.oldest = ad;
      }
      if (raw.redaction_date && (!reviewMeta.lastRedaction || ord(raw.redaction_date) > ord(reviewMeta.lastRedaction))) {
        reviewMeta.lastRedaction = raw.redaction_date;
      }
      addDoc({
        id: raw.app_id, kind: "review", raw: raw, short: raw.short, topic: raw.name,
        full: raw.full || raw.name,
        branch: raw.branch || "Судебная практика", mode: "plain",
        req: raw.adopted ? "от " + raw.adopted + (raw.number ? " № " + raw.number : "") : "",
        number: raw.number || "", adopted: raw.adopted || "",
        slug: "", group: "extra", src: "reviews.json", key: raw.app_id
      });
    });
  })();

  /* --- запись реестра --- */
  const order = { constitution: 0, code: 1, fkz: 2, law: 3, decree: 4, plenum: 5, review: 6 };
  registry.sort(function (a, b) {
    if (order[a.kind] !== order[b.kind]) return order[a.kind] - order[b.kind];
    return 0;
  });

  fs.writeFileSync(path.join(OUT_DATA, "registry.js"),
    "/* Реестр нормативных источников: кодексы, федеральные законы, Конституция, ФКЗ.\n" +
    "   Сформирован автоматически: tools/build-data.js */\n" +
    "window.RF_CODES=" + JSON.stringify(registry, null, 1) + ";\n", "utf8");

  /* --- индекс ---
     Названия глав сильно дублируются (одна глава на десятки статей), поэтому
     главу записываем только там, где она меняется. Пустое поле означает
     «глава предыдущей записи того же источника», а спецмаркер "~" (тильда,
     в реальных названиях глав не встречается) — «у этой статьи главы
     действительно нет» (единичный случай: ст. 0.1 в ФКЗ об арбитражных судах).
     Восстанавливается в app.js (см. lastChapter в buildIndex). */
  const NO_CHAPTER = "~";
  const lastChapter = {};
  const idxLines = index.map(function (r) {
    const raw = r[3] || "";
    let g;
    if (raw === "") g = (lastChapter[r[0]] !== undefined ? NO_CHAPTER : "");
    else if (raw === lastChapter[r[0]]) g = "";
    else { g = raw; lastChapter[r[0]] = raw; }
    return '["' + esc(r[0]) + '","' + esc(r[1]) + '","' + esc(r[2]) + '","' + esc(g) + '",' + (r[4] || 0) + ']';
  });
  fs.writeFileSync(path.join(OUT_DATA, "index.js"),
    "/* Индекс всех статей: [источник, номер, название, глава, длина текста].\n" +
    "   Длина — число основ слов в названии, главе и полном тексте статьи;\n" +
    "   нужна для нормировки в BM25 (редкая статья не должна проигрывать\n" +
    "   длинной только потому, что в ней меньше слов).\n" +
    "   tools/build-data.js */\n" +
    "window.RF_IDX=[" + idxLines.join(",") + "];\n", "utf8");

  /* --- общий модуль разбора копируется в data/ для браузера --- */
  fs.copyFileSync(path.join(__dirname, "lib", "parse.js"), path.join(OUT_DATA, "parse.js"));

  /* --- общий модуль перекрёстных ссылок --- */
  fs.copyFileSync(path.join(__dirname, "lib", "xref.js"), path.join(OUT_DATA, "xref.js"));

  /* --- общий модуль текстовой обработки --- */
  fs.copyFileSync(path.join(__dirname, "lib", "text.js"), path.join(OUT_DATA, "text.js"));

  /* --- статусы норм: утрата силы, приостановление, недействующая --- */
  const statusKeys = Object.keys(statuses);
  const statusByAct = {};
  statusKeys.forEach(function (k) {
    const st = statuses[k];
    const ak = st[1] || "без указания акта";
    if (!statusByAct[ak]) statusByAct[ak] = { act: ak, date: st[2] || "", count: 0 };
    statusByAct[ak].count++;
  });
  const statusList = Object.keys(statusByAct).map(function (a) { return statusByAct[a]; })
    .sort(function (a, b) { return b.count - a.count || (a.act < b.act ? -1 : 1); });

  fs.writeFileSync(path.join(OUT_DATA, "status.js"),
    "/* Правовой консультант :: статусы норм — утрата силы, приостановление, признание\n" +
    "   недействующей. Ключ — id статьи «<источник>-<номер>», значение —\n" +
    "   [статус, реквизиты акта-основания, дата акта].\n" +
    "   Статусы распознаются из официального текста (tools/lib/parse.js,\n" +
    "   detectStatus) при сборке. Сформирован автоматически. */\n" +
    "window.RF_STATUS=" + JSON.stringify(statuses) + ";\n" +
    "/* Сводка по актам-основаниям: [{act,date,count}] — для реестра. */\n" +
    "window.RF_STATUS_ACTS=" + JSON.stringify(statusList) + ";\n" +
    "/* Итоги по видам статуса. */\n" +
    "window.RF_STATUS_META=" + JSON.stringify({
      repealed: statusCount.repealed || 0, suspended: statusCount.suspended || 0,
      void: statusCount.void || 0, total: statusKeys.length,
      built_at: BUILT_AT
    }) + ";\n", "utf8");

  /* --- полнотекстовый индекс (сегментами, загружается по требованию) --- */
  const FT_DIR = path.join(OUT_DATA, "ft");
  fs.mkdirSync(FT_DIR, { recursive: true });
  fs.readdirSync(FT_DIR).forEach(function (f) { fs.unlinkSync(path.join(FT_DIR, f)); });

  const NSHARDS = 32;
  const shards = [];
  for (let i = 0; i < NSHARDS; i++) shards.push({});
  let ftPostings = 0;
  /* Словарь основ для исправления опечаток. Редкие основы (df < 3) в него не
     попадают: их опечатанная форма всё равно ничего не найдёт, а словарь
     раздувают. Рядом с основой хранится df — по нему выбирается, какое из
     нескольких похожих написаний вероятнее. */
  const dictParts = [];
  Object.keys(ftMap).forEach(function (st) {
    const ids = ftMap[st];
    ids.sort(function (a, b) { return a - b; });
    const pairs = [];
    for (let i = 0; i < ids.length; i++) {
      const last = pairs.length ? pairs[pairs.length - 1] : null;
      if (last && last[0] === ids[i]) last[1]++;
      else pairs.push([ids[i], 1]);
    }
    const df = pairs.length;
    if (df >= 3) dictParts.push(st + ":" + df);
    const b = text.bucket(st, NSHARDS);
    shards[b][st] = text.encPairs(pairs);
    ftPostings += df;
  });
  let sizeFt = 0;
  for (let i = 0; i < NSHARDS; i++) {
    const body = "window.RF_FT=window.RF_FT||{};window.RF_FT[" + i + "]=" + JSON.stringify(shards[i]) + ";\n";
    const file = path.join(FT_DIR, i + ".js");
    fs.writeFileSync(file, body, "utf8");
    sizeFt += Buffer.byteLength(body);
  }
  const dictBody = "/* Правовой консультант :: словарь основ для исправления опечаток.\n" +
    "   Формат «основа:df» через запятую. Подгружается по требованию — только\n" +
    "   если в запросе встретилось слово, которого нет в индексе.\n" +
    "   Сформирован автоматически: tools/build-data.js */\n" +
    "window.RF_FT_DICT=" + JSON.stringify(dictParts.join(",")) + ";\n";
  fs.writeFileSync(path.join(FT_DIR, "dict.js"), dictBody, "utf8");
  fs.writeFileSync(path.join(FT_DIR, "meta.js"),
    "/* Правовой консультант :: параметры полнотекстового индекса. tools/build-data.js */\n" +
    "window.RF_FT_META=" + JSON.stringify({
      shards: NSHARDS, docs: index.length, stems: Object.keys(ftMap).length,
      postings: ftPostings, tokens: ftTokens,
      avgdl: Math.round(ftTokens / index.length * 100) / 100,
      dict: dictParts.length, built_at: BUILT_AT
    }) + ";\n", "utf8");

  /* --- снимок актуальности --- */
  fs.writeFileSync(path.join(OUT_DATA, "freshness.js"),
    "/* Правовой консультант :: снимок актуальных редакций.\n" +
    "   Хранит, на какую редакцию собран каждый документ, и копию манифестов\n" +
    "   открытого набора данных. Используется кнопкой «Проверка актуальности»:\n" +
    "   приложение сравнивает снимок с текущими манифестами и показывает,\n" +
    "   какие документы устарели. Сформирован: tools/build-data.js */\n" +
    "window.RF_FRESH=" + JSON.stringify({
      built_at: BUILT_AT,
      repo: "https://github.com/vadimpokrov396-ship-it/ruslaw-public",
      raw_base: "https://raw.githubusercontent.com/vadimpokrov396-ship-it/ruslaw-public/master/",
      api_base: "http://actual.pravo.gov.ru:8000/api/ebpi/",
      docs: freshness,
      plenums: plenumMeta,
      reviews: reviewMeta,
      manifests: { codes: ctx.codesManifest, laws: ctx.lawsManifest }
    }) + ";\n", "utf8");

  /* --- граф перекрёстных ссылок ---
     Считаем до отпечатка сборки: graph.js — часть данных, и его появление
     должно менять digest, иначе открытые вкладки не узнают об обновлении. */
  const graphStat = buildGraph(registry, index);

  /* --- отчёт --- */
  const byKind = { code: 0, law: 0, fkz: 0, constitution: 0, decree: 0, plenum: 0, review: 0 };
  let ta = 0, ts = 0;
  stats.forEach(function (s) { ta += s.articles; ts += s.sub; byKind[s.kind] = (byKind[s.kind] || 0) + 1; });

  console.log("Источник: vendor/ruslaw (actual.pravo.gov.ru, Пленумы — sudact.ru)\n");
  console.log("код        вид              записей  статей  подстатей  глав   редакция");
  console.log("-".repeat(76));
  stats.forEach(function (s) {
    console.log(s.id.padEnd(9) + " " + s.short.slice(0, 20).padEnd(22) +
      String(s.entries).padStart(6) + String(s.articles).padStart(8) +
      String(s.sub).padStart(11) + String(s.chapters).padStart(7) + "   " + s.red);
  });
  console.log("-".repeat(76));
  console.log("Всего статей: " + ta + " (из них подстатей выделено: " + ts + ")");
  console.log("Источников: " + registry.length +
    " — кодексов " + byKind.code + ", федеральных законов " + byKind.law +
    ", ФКЗ " + byKind.fkz + ", Конституция " + byKind.constitution +
    ", постановлений Правительства " + byKind.decree +
    ", постановлений Пленума ВС РФ " + byKind.plenum +
    ", обзоров судебной практики " + byKind.review);
  if (warnings.length) { console.log("\nПредупреждения:"); warnings.forEach(function (w) { console.log("  " + w); }); }

  /* --- чистка осиротевших полных текстов ---
     data/full/ перезаписывается только для источников, которые есть в
     реестре. Если документ исчез из реестра (обзор сняли с портала, акт
     переименовали), его файл остаётся лежать: он попадает в dist, в кеш
     воркера и в отпечаток сборки, а открыть его нельзя — в реестре и в
     индексе такого источника нет, и ссылка «Что изменилось» ведёт в пустоту.
     Удаляем до подсчёта отпечатка, чтобы версия отражала реальный набор. */
  const regIds = {};
  registry.forEach(function (c) { regIds[c.id] = 1; });
  let droppedFull = 0;
  fs.readdirSync(OUT_FULL).forEach(function (f) {
    if (!/\.js$/.test(f)) return;
    const id = f.replace(/\.js$/, "");
    if (regIds[id]) return;
    fs.unlinkSync(path.join(OUT_FULL, f));
    droppedFull++;
  });
  if (droppedFull) console.log("Удалено файлов полного текста без источника в реестре: " + droppedFull);

  /* --- версия сборки ------------------------------------------------------
     Отпечаток содержимого data/ — по нему приложение узнаёт, что база на
     хостинге пересобралась, и обновляет страницу у всех посетителей. Метку
     времени при подсчёте обнуляем: иначе отпечаток менялся бы на каждом
     прогоне, и все открытые вкладки перезагружались бы впустую.

     Файл крошечный и лежит отдельно от бандла, поэтому его можно
     перепроверять хоть каждую минуту — без перезагрузки данных.

     Рядом лежит отпечаток кода (поле code): правка в app.js, styles.css или
     index.html содержимое data/ не меняет, и по digest её не увидеть. Само
     значение подставляет сборка публикации (tools/build-dist.js), здесь оно
     записывается для полноты файла. */
  const version = buildVersionStamp(ta, registry.length);
  version.code = codeStamp(ROOT);
  fs.writeFileSync(path.join(OUT_DATA, "version.json"),
    JSON.stringify(version) + "\n", "utf8");
  console.log("Версия сборки: " + version.digest + " · код " + version.code +
    " · статей " + version.articles +
    " · файлов в отпечатке " + version.files);

  const sizeIdx = fs.statSync(path.join(OUT_DATA, "index.js")).size;
  let sizeFull = 0;
  fs.readdirSync(OUT_FULL).forEach(function (f) { sizeFull += fs.statSync(path.join(OUT_FULL, f)).size; });
  console.log("Размер индекса: " + (sizeIdx / 1048576).toFixed(2) + " МБ | полные тексты: " + (sizeFull / 1048576).toFixed(1) + " МБ");
  console.log("Полнотекстовый индекс: " + (sizeFt / 1048576).toFixed(2) + " МБ · основ " +
    Object.keys(ftMap).length + " · пар «слово-статья» " + ftPostings +
    " · слов " + ftTokens + " · сегментов " + NSHARDS);
  console.log("Словарь основ для опечаток: " + (Buffer.byteLength(dictBody) / 1024).toFixed(0) +
    " КБ · основ " + dictParts.length + " (df >= 3)");
  console.log("Граф ссылок: пар " + graphStat.pairs + " · узлов " + graphStat.nodes +
    " · ссылок " + graphStat.links + " · файл " + (graphStat.size / 1024).toFixed(1) + " КБ");
}

/* Экспорт для точечного пересчёта: пересобрать только граф, не трогая
   остальные данные (tools/verify-data.js сверяет по нему свежесть файла),
   и пересчитать отпечаток сборки после добавления нового файла в data/. */
module.exports = { buildGraph: buildGraph, readFullRows: readFullRows, buildVersionStamp: buildVersionStamp };

if (require.main === module) build();
