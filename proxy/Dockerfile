# Прокси к GigaChat для VPS и Docker-площадок.
# Сборка: docker build -t rf-laws-proxy ./proxy
# Запуск:  docker run -p 8080:8080 --env-file proxy/.env rf-laws-proxy
#
# Зависимостей нет: только стандартная библиотека Node, поэтому образ
# собирается за секунды и не требует npm install.

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY package.json ./
COPY server.js ./
COPY lib ./lib

# Процессу не нужна запись в каталог приложения.
USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
