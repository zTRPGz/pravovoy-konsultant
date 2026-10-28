/* Проверка прокси без ключей GigaChat: `node proxy/test/smoke.js`.
 *
 * Поднимает сервер в режиме GIGACHAT_MOCK=1 и проверяет то, что реально
 * ломается: CORS по белому списку, отказ без перечня норм, лимиты, форму
 * ответа и — главное — фильтр выдуманных моделью id.
 */
"use strict";

const { spawn } = require("child_process");
const path = require("path");
const assert = require("assert");

const PORT = 8137 + Math.floor(Math.random() * 200);
const ORIGIN = "https://ztrpgz.github.io";
const ROOT = path.resolve(__dirname, "..");

let ok = 0, bad = 0;
function check(name, fn) {
  try { fn(); ok++; console.log("  OK   " + name); }
  catch (e) { bad++; console.log("  ПРОВАЛ " + name + " — " + e.message); }
}

/* --- чистая логика: разбор ответа модели -------------------------------- */
const { parseAnswer } = require(path.join(ROOT, "lib/gigachat"));

check("JSON в обёртке ```json … ``` разбирается", function () {
  const r = parseAnswer('```json\n{"plain":"Текст","cite":["uk-111"]}\n```', { norms: [{ id: "uk-111" }] });
  assert.strictEqual(r.plain, "Текст");
  assert.deepStrictEqual(r.cite, ["uk-111"]);
});

check("выдуманные моделью id выбрасываются", function () {
  const r = parseAnswer('{"plain":"Текст","cite":["uk-111","uk-999","fz-777"]}', { norms: [{ id: "uk-111" }] });
  assert.deepStrictEqual(r.cite, ["uk-111"]);
});

check("повторы в cite убираются, максимум четыре", function () {
  const norms = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];
  const r = parseAnswer('{"plain":"x","cite":["a","a","b","c","d","e"]}', { norms: norms });
  assert.deepStrictEqual(r.cite, ["a", "b", "c", "d"]);
});

check("текст без JSON остаётся объяснением без ссылок", function () {
  const r = parseAnswer("Просто текст без разметки.", { norms: [{ id: "uk-111" }] });
  assert.strictEqual(r.plain, "Просто текст без разметки.");
  assert.deepStrictEqual(r.cite, []);
});

check("пустой cite допустим", function () {
  const r = parseAnswer('{"plain":"Нужны документы","cite":[]}', { norms: [] });
  assert.deepStrictEqual(r.cite, []);
});

check("текст с последней строкой CITE сохраняет абзацы", function () {
  const r = parseAnswer("Первый абзац.\n\nВторой абзац.\nCITE: uk-111, uk-222", { norms: [{ id: "uk-111" }, { id: "uk-222" }] });
  assert.strictEqual(r.plain, "Первый абзац.\n\nВторой абзац.");
  assert.deepStrictEqual(r.cite, ["uk-111", "uk-222"]);
});

check("CITE, приписанный к последнему предложению, тоже разбирается", function () {
  const r = parseAnswer("Объяснение. CITE: uk-111", { norms: [{ id: "uk-111" }] });
  assert.strictEqual(r.plain, "Объяснение.");
  assert.deepStrictEqual(r.cite, ["uk-111"]);
});

/* --- живой сервер в mock-режиме ----------------------------------------- */
const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
  env: Object.assign({}, process.env, {
    PORT: String(PORT),
    HOST: "127.0.0.1",
    GIGACHAT_MOCK: "1",
    ALLOWED_ORIGINS: ORIGIN,
    RATE_LIMIT_PER_MIN: "50",
    RATE_LIMIT_PER_DAY: "500"
  }),
  stdio: ["ignore", "pipe", "pipe"]
});
let ready = false;
child.stdout.on("data", function (d) { if (String(d).indexOf("слушает") !== -1) ready = true; });
child.stderr.on("data", function (d) { process.stderr.write(d); });

const base = "http://127.0.0.1:" + PORT;

async function post(body, headers) {
  const r = await fetch(base + "/ask", {
    method: "POST",
    headers: Object.assign({ "Content-Type": "application/json" }, headers || {}),
    body: JSON.stringify(body)
  });
  let j = null;
  try { j = await r.json(); } catch (e) {}
  return { status: r.status, json: j, headers: r.headers };
}

(async function () {
  for (let i = 0; i < 100 && !ready; i++) await new Promise((r) => setTimeout(r, 100));
  if (!ready) { console.log("ПРОВАЛ сервер не поднялся"); child.kill(); process.exit(1); }

  const h = await fetch(base + "/health");
  const hj = await h.json();
  check("/health отвечает и сообщает mock-режим", function () {
    assert.strictEqual(h.status, 200);
    assert.strictEqual(hj.ok, true);
    assert.strictEqual(hj.mock, true);
  });

  const good = { text: "ударил ножом в живот, тяжкий вред здоровью", qual: "ст. 111 УК РФ",
    norms: [{ id: "uk-111", code: "УК РФ", num: "111", title: "Умышленное причинение тяжкого вреда здоровью" },
            { id: "uk-112", code: "УК РФ", num: "112", title: "Средней тяжести" }] };

  const a = await post(good, { Origin: ORIGIN });
  check("разрешённый источник получает объяснение", function () {
    assert.strictEqual(a.status, 200);
    assert.strictEqual(a.json.ok, true);
    assert.ok(a.json.plain.length > 20);
  });
  check("cite не выходит за перечень норм", function () {
    a.json.cite.forEach(function (id) {
      assert.ok(good.norms.some(function (n) { return n.id === id; }), "лишний id " + id);
    });
  });
  check("CORS отвечает тем же источником", function () {
    assert.strictEqual(a.headers.get("access-control-allow-origin"), ORIGIN);
  });

  const evil = await post(good, { Origin: "https://evil.example" });
  check("чужой источник получает 403", function () { assert.strictEqual(evil.status, 403); });

  const pre = await fetch(base + "/ask", { method: "OPTIONS", headers: { Origin: ORIGIN } });
  check("preflight отвечает 204", function () { assert.strictEqual(pre.status, 204); });

  const noNorms = await post({ text: "ударил ножом в живот" }, { Origin: ORIGIN });
  check("без перечня норм — 400 (иначе модель выдумает статьи)", function () { assert.strictEqual(noNorms.status, 400); });

  const short = await post({ text: "иск", norms: good.norms }, { Origin: ORIGIN });
  check("слишком короткое описание — 400", function () { assert.strictEqual(short.status, 400); });

  const big = await post({ text: "а".repeat(20000), norms: good.norms }, { Origin: ORIGIN });
  check("слишком большое тело — 413", function () { assert.strictEqual(big.status, 413); });

  const notFound = await fetch(base + "/nope");
  check("неизвестный путь — 404", function () { assert.strictEqual(notFound.status, 404); });

  child.kill();
  console.log("\n" + (bad ? "ПРОВАЛОВ: " + bad : "Все проверки пройдены") + " (" + ok + " ok)");
  process.exit(bad ? 1 : 0);
})();
