import { DataTypes } from 'sequelize'
import { db } from './db.js'

// Обязательное текстовое поле; field — имя столбца в существующей БД.
const text = (field) => ({ type: DataTypes.TEXT, allowNull: false, field })
const createdAt = { ...text('created_at'), defaultValue: () => new Date().toISOString() }

export const User = db.define(
  'User',
  {
    lastName: text('last_name'),
    firstName: text('first_name'),
    patronymic: text('patronymic'),
    // NOCASE сохраняет сравнение логинов без учёта регистра на уровне SQLite.
    login: { type: 'TEXT COLLATE NOCASE', allowNull: false, unique: true },
    passwordHash: text('password_hash'),
    phone: text('phone'),
    email: text('email'),
    consentAt: text('consent_at'),
    consentVersion: text('consent_version'),
    createdAt,
  },
  { tableName: 'users' },
)

export const CleaningRequest = db.define(
  'CleaningRequest',
  {
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    service: text('service'),
    address: text('address'),
    date: text('date'),
    createdAt,
  },
  { tableName: 'requests', indexes: [{ name: 'requests_user', fields: ['user_id'] }] },
)

// В cookie хранится только sid; данные сессии и срок её жизни остаются в БД.
export const Session = db.define(
  'Session',
  {
    sid: { type: DataTypes.TEXT, primaryKey: true },
    data: text('data'),
    expires: { type: DataTypes.BIGINT, allowNull: false },
  },
  { tableName: 'sessions', indexes: [{ name: 'sessions_expiry', fields: ['expires'] }] },
)

// Один пользователь — много заявок; каждая заявка принадлежит одному пользователю.
User.hasMany(CleaningRequest, { as: 'requests', foreignKey: 'userId', onDelete: 'RESTRICT' })
CleaningRequest.belongsTo(User, { as: 'user', foreignKey: 'userId', onDelete: 'RESTRICT' })

// Создаёт недостающие таблицы. Существующие таблицы и данные не пересоздаются.
await db.sync()
