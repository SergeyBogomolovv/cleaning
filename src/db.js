import { Sequelize } from 'sequelize'
import { mkdirSync } from 'node:fs'

// В этой папке хранится секрет сессий, недоступный через сайт.
export const dataDir = 'data'
mkdirSync(dataDir, { recursive: true, mode: 0o700 })

// Настройки совпадают с PostgreSQL в compose.yaml.
export const db = new Sequelize({
  dialect: 'postgres',
  host: '127.0.0.1',
  port: 5432,
  database: 'cleaning',
  username: 'cleaning',
  password: 'cleaning',
  logging: false,
  define: { timestamps: false },
})
