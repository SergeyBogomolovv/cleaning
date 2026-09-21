# Клининг

Запустить Docker Desktop, затем в папке проекта:

```sh
npm ci
docker compose up -d --wait
npm start
```

Открыть http://127.0.0.1:3107

Остановить сайт: Ctrl+C. Остановить базу: `docker compose down`.
