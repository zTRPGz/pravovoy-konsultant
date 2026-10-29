# Прокси к GigaChat для «Правового консультанта»

Необязательный сервер, который даёт сайту короткое объяснение простыми словами.
Сайт работает и без него: разбор ситуации, нормы и даты редакций считаются
локально, в браузере. Этот прокси нужен ровно для одного — чтобы **ключ
GigaChat не оказался в браузере**.

```
браузер (github.io)  ──POST /ask──▶  прокси (ваш хостинг)  ──OAuth──▶  GigaChat
   описание + нормы                   client_secret                 объяснение
                                      хранится здесь
```

## Почему отдельный хостинг

Сайт статический: HTML, JS и данные лежат на GitHub Pages. Всё, что попадает в
браузер, видит любой желающий — поэтому `client_secret` там хранить нельзя,
и «сходить в GigaChat напрямую» из страницы невозможно в принципе. Нужен
маленький сервер, который держит секрет у себя.

## Что даёт прокси и чего не даёт

**Даёт:** разбор ситуации человеческим языком — 8–12 предложений, по каждой
норме из тех, что уже подобрал сайт, со ссылками только на этот перечень.

**Не даёт и не должен:** свободных юридических выводов. Модель получает
**закрытый перечень** норм (id, кодекс, номер, название и короткую выдержку)
и обязана ссылаться только на них. Каждый id, который она вернула, сверяется
с базой сайта (`RF_IDX`): выдуманные выбрасываются, а если ссылок не осталось —
блок честно пишет, что это пересказ, а не вывод. Ответ всегда помечен
«Сгенерировано
GigaChat» и не заменяет разбор.

## 1. Ключи GigaChat

1. Кабинет — <https://developers.sber.ru/studio>. Создайте проект, в нём
   «Авторизационные данные»: там будет строка вида `client_id:client_secret`
   в base64.
2. Разберите её на две части — прокси нужны они по отдельности:

   ```bash
   echo 'BASE64СТРОКА' | base64 -d      # → id:secret
   ```

3. Права доступа (`scope`): для физлиц — `GIGACHAT_API_PERS`, для юрлиц —
   `GIGACHAT_API_CORP`.
4. Бесплатный тариф для физлиц — 365 млн токенов на 12 месяцев, но генерация
   **в один поток**: одновременные запросы встают в очередь. Для публичного
   сайта этого мало, для личного использования — с запасом.

## 2. Сертификаты НУЦ Минцифры (обязательно)

GigaChat использует сертификат, выданный российским УЦ. Без корневого
сертификата Node не установит TLS-соединение
(`SELF_SIGNED_CERT_IN_CHAIN` / `UNABLE_TO_VERIFY_LEAF_SIGNATURE`).

```bash
curl -o russian_trusted_root_ca.pem \
  https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt
```

Сертификат прокси загружает сам: сначала читает `proxy/russian_trusted_root_ca.pem`,
а если файла рядом нет — берёт встроенную копию из `proxy/lib/russian-root-ca.js`.
Поэтому `NODE_EXTRA_CA_CERTS` не обязателен: на serverless-площадках путь внутри
сборки другой, и переменная молча игнорируется. Отключать проверку сертификата
(`NODE_TLS_REJECT_UNAUTHORIZED=0`) нельзя: это открывает перехват трафика вместе
с токеном доступа.

## 3. Локальная проверка (без ключей)

```bash
GIGACHAT_MOCK=1 node proxy/server.js        # http://localhost:8080
curl localhost:8080/health
```

В mock-режиме прокси не ходит в сеть и отвечает заглушкой той же формы — этого
достаточно, чтобы проверить всю цепочку в браузере.

```bash
node proxy/test/smoke.js     # 15 проверок: CORS, лимиты, фильтр выдуманных id
```

С настоящими ключами:

```bash
cp proxy/.env.example proxy/.env      # заполнить и НЕ коммитить
set -a && . proxy/.env && set +a
node proxy/server.js
```

## 4. Куда деплоить, чтобы работало в России без VPN

Требования жёсткие с двух сторон: **браузер в РФ должен доставать прокси**, и
**прокси должен доставать GigaChat**. Поэтому российская площадка — самый
предсказуемый вариант.

| Площадка | Доступность из РФ | Сложность | Замечания |
|---|---|---|---|
| **Timeweb Cloud** (приложения) | стабильно | низкая | РФ, оплата картой РФ, HTTPS из коробки |
| **Yandex Cloud** (Functions / ВМ) | стабильно | средняя | нужен платёжный аккаунт; Functions — по секундам |
| **VPS в РФ** (reg.ru, Beget, Timeweb) | стабильно | средняя | нужен свой TLS (Caddy сделает сам) |
| **Vercel** | обычно да | очень низкая | `*.vercel.app` иногда капризничает в РФ; лучше свой домен |
| **Netlify** | обычно да | низкая | нужен свой адаптер функции (см. ниже) |
| **Cloudflare Workers** | **нет** | — | `*.workers.dev` в РФ throttling/блокировки, не советуем |
| **Render / Railway** | нестабильно | низкая | бесплатные инстансы засыпают |

Отдельное замечание: если прокси стоит **за пределами РФ**, GigaChat может
отклонить запрос по региону. Российская площадка снимает оба вопроса сразу.

### Vercel (быстрее всего, бесплатный Hobby)

**Через сайт (рекомендую).** Импортируйте репозиторий в Vercel и в поле
**Root Directory** укажите `proxy` — иначе Vercel возьмёт корневой
`vercel.json` и начнёт собирать статический сайт вместо прокси. Framework
Preset — **Other**, Build Command и Output Directory оставьте пустыми.

**Через CLI:**

```bash
cd proxy
npx vercel            # каталог proxy уже корень проекта
npx vercel --prod
```

Переменные задаются в настройках **самого проекта**: выберите его в
**All Projects → Settings → Environment Variables**. Страница
**Team → Environment Variables** — это общие переменные команды, для одного
прокси они не нужны. После добавления нажмите **Redeploy** у последнего
деплоя: уже собранная функция новые переменные не увидит.

| Переменная | Значение |
|---|---|
| `GIGACHAT_CLIENT_ID` | id из кабинета developers.sber.ru |
| `GIGACHAT_CLIENT_SECRET` | секрет — только здесь, не в git |
| `GIGACHAT_SCOPE` | `GIGACHAT_API_PERS` для физлиц, `GIGACHAT_API_CORP` для юрлиц |
| `GIGACHAT_MODEL` | `GigaChat` |
| `ALLOWED_ORIGINS` | `https://ztrpgz.github.io` — точный Origin, строчными |

`NODE_EXTRA_CA_CERTS` на Vercel больше не нужен: сертификат НУЦ встроен в
`proxy/lib/russian-root-ca.js` (и дополнительно читается из `.pem`, если файл
оказался в сборке). На serverless путь внутри бандла другой, поэтому переменная
раньше молча не срабатывала и запрос падал на `SELF_SIGNED_CERT_IN_CHAIN`.

`proxy/vercel.json` даёт функции 60 секунд на ответ модели.

Маршрут зависит от того, что Vercel собрал из проекта. Проверьте после деплоя:

```bash
curl https://<проект>.vercel.app/health
```

Если вернулся JSON `{"ok":true,...}` — работает `server.js`. Адрес для сайта:
`https://<проект>.vercel.app` (в поле «Адрес прокси»), клиент сам дописывает
`/ask`. Если `/health` отдаёт 404, а `/api/ask` отвечает на POST — работает
serverless-адаптер, и адрес для сайта: `https://<проект>.vercel.app/api`.

Файл `proxy/.vercelignore` не даёт загрузить локальный `.env` с ключами в
сборку. Проверьте, что он есть, прежде чем запускать `vercel` из CLI.

Проверка после деплоя:

```bash
curl -i -X OPTIONS https://<проект>.vercel.app/ask \
  -H "Origin: https://ztrpgz.github.io" \
  -H "Access-Control-Request-Method: POST"
```

В ответе должны быть `204` и `Access-Control-Allow-Origin:
https://ztrpgz.github.io`. Если GigaChat отклоняет запрос по региону,
бесплатный Vercel не подойдёт — нужна российская площадка (см. ниже).

### Обычный VPS (самый предсказуемый)

```bash
# на сервере
apt install -y nodejs caddy
git clone <репозиторий> /opt/rf-laws && cd /opt/rf-laws
cp proxy/.env.example proxy/.env && nano proxy/.env     # ключи, ALLOWED_ORIGINS
```

`/etc/systemd/system/rf-laws-proxy.service`:

```ini
[Unit]
Description=rf-laws GigaChat proxy
After=network.target

[Service]
WorkingDirectory=/opt/rf-laws
EnvironmentFile=/opt/rf-laws/proxy/.env
ExecStart=/usr/bin/node proxy/server.js
Restart=always
RestartSec=3
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable --now rf-laws-proxy
```

`/etc/caddy/Caddyfile` — HTTPS Caddy получит сам:

```
proxy.example.ru {
    reverse_proxy 127.0.0.1:8080
}
```

Адрес для сайта: `https://proxy.example.ru` (без `/ask` — его допишет клиент).

### Netlify

Netlify не понимает сигнатуру Vercel. Создайте `proxy/netlify/functions/ask.js`:

```js
const { ask } = require("../../lib/gigachat");
const g = require("../../lib/guard");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: g.corsHeaders({ headers: event.headers }) };
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "нужен POST" }) };
  const body = JSON.parse(event.body || "{}");
  const out = await ask(body);
  return {
    statusCode: 200,
    headers: Object.assign({ "Content-Type": "application/json" }, g.corsHeaders({ headers: event.headers })),
    body: JSON.stringify({ ok: true, plain: out.plain, cite: out.cite })
  };
};
```

Плюс `proxy/netlify.toml` с `[functions] directory = "netlify/functions"`.
Адрес для сайта: `https://<сайт>.netlify.app/.netlify/functions`.

## 5. Как включить на сайте

1. Откройте раздел **Помощник** → блок «Объяснение простыми словами
   (GigaChat, необязательно)».
2. Поставьте галочку и впишите адрес прокси (`https://proxy.example.ru`).
   Полный адрес эндпоинта тоже подойдёт: хвост `/ask` клиент уберёт сам.
3. Нажмите «Проверить связь» — кнопка шлёт OPTIONS на `/ask` и не тратит
   квоту GigaChat. Если адрес не разрешён в `ALLOWED_ORIGINS`, проверка
   покажет ошибку CORS.
4. Разберите ситуацию — под ответом появится карточка «Объяснить».

Настройка хранится в браузере (`localStorage → rflaws.ai`) и по умолчанию
выключена. Пока галочка не стоит, из браузера не уходит ни один байт.

Требования к адресу: **https**, иначе браузер заблокирует запрос как mixed
content (сайт на GitHub Pages работает по https). На локальном файле (`file://`)
объяснение отключается — прокси всё равно недоступен.

## 6. Безопасность и лимиты

| Что | Как |
|---|---|
| Секрет | только в переменных окружения площадки, в git не попадает (`proxy/.env` в `.gitignore`) |
| CORS | `ALLOWED_ORIGINS=https://ztrpgz.github.io` — чужие сайты получают 403 |
| Квота | `RATE_LIMIT_PER_MIN=12`, `RATE_LIMIT_PER_DAY=400` на процесс |
| Размер | тело ≤ 16 КБ, описание ≤ 2000 знаков, нормы ≤ 8, выдержка нормы ≤ 280 знаков |
| Общий токен | `SHARED_TOKEN` → клиент присылает `X-Proxy-Token` (для своей сборки) |
| Данные | описание уходит только по нажатию кнопки; в логах прокси текста нет |

Прокси не пишет описания ситуаций в логи — только коды ошибок. Учтите, что
сам GigaChat обрабатывает запрос на своей стороне: если в описании есть
персональные данные, лучше их не указывать.

## 7. Что проверить после деплоя

```bash
curl https://proxy.example.ru/health
# {"ok":true,"service":"rf-laws-gigachat-proxy","mock":false,"limits":{...}}

curl -X POST https://proxy.example.ru/ask \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://ztrpgz.github.io' \
  -d '{"text":"ударил ножом в живот, тяжкий вред здоровью",
       "qual":"ст. 111 УК РФ",
       "norms":[{"id":"uk-111","code":"УК РФ","num":"111","title":"Умышленное причинение тяжкого вреда здоровью"}]}'
```

Ожидаемый ответ — `{"ok":true,"plain":"…","cite":["uk-111"]}`. Если приходит
`GigaChat 401` — неверные ключи или `scope`; `GigaChat 402` — кончилась квота;
`SELF_SIGNED_CERT_IN_CHAIN` — сертификат НУЦ не попал в сборку: проверьте, что
рядом лежит `lib/russian-root-ca.js` (прокси берёт его, если `.pem` недоступен).

## 8. Файлы

```
proxy/
  server.js          автономный сервер (VPS, Timeweb, Yandex Cloud)
  api/ask.js         serverless-адаптер для Vercel
  lib/gigachat.js    OAuth, запрос, разбор и фильтрация ответа
  lib/russian-root-ca.js  корневой сертификат НУЦ Минцифры (встроенная копия)
  lib/guard.js       CORS, лимиты, чтение тела
  test/smoke.js      15 проверок без ключей
  .env.example       все переменные с пояснениями
```

Сквозная проверка вместе с сайтом выполняется в браузере: поднимите прокси в
mock-режиме (`GIGACHAT_MOCK=1 node proxy/server.js`), включите опцию в
Помощнике, укажите `http://localhost:8080` и нажмите «Объяснить». В ответе
должны быть только id норм из перечня — выдуманные отбрасывает и прокси, и
клиент.
