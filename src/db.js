import { Sequelize } from 'sequelize'
import { mkdirSync } from 'node:fs'

// База хранится вне public, чтобы её нельзя было скачать через сайт.
export const dataDir = 'data'
mkdirSync(dataDir, { recursive: true, mode: 0o700 })

// Подключение к одному файлу SQLite; отдельный сервер БД не нужен.
export const db = new Sequelize({
  dialect: 'sqlite',
  storage: `${dataDir}/cleaning.sqlite`,
  logging: false,
  define: { timestamps: false },
})
