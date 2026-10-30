/* Общая логика ответа для всех адаптеров: standalone-сервера, Vercel и Netlify.
 *
 * Проверки CORS, лимитов и токена остаются в адаптерах — им нужен разный
 * объект запроса. Здесь только то, что повторялось дословно: ответ /health,
 * проверка перечня норм и вызов модели с понятной ошибкой.
 */
"use strict";

const { ask, errorText, mock } = require("./gigachat");
const g = require("./guard");

function health() {
  return {
    ok: true,
    service: "rf-laws-gigachat-proxy",
    mock: mock(),
    limits: { perMinute: g.PER_IP, perDay: g.PER_DAY }
  };
}

async function askBody(body) {
  const text = String((body && body.text) || "").trim();
  if (text.length < 5) return { status: 400, json: { error: "слишком короткое описание" } };
  if (!Array.isArray(body.norms) || !body.norms.length) {
    return { status: 400, json: { error: "нужен перечень норм: без него модель начнёт выдумывать статьи" } };
  }
  try {
    const out = await ask(body);
    return { status: 200, json: { ok: true, plain: out.plain, cite: out.cite } };
  } catch (e) {
    const code = e && e.status ? e.status : 502;
    console.error("[ask]", errorText(e), e && e.cause ? e.cause : "");
    return { status: code, json: { error: "GigaChat недоступен: " + errorText(e) } };
  }
}

module.exports = { health: health, askBody: askBody };
