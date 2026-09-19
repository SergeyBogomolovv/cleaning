import session from 'express-session'
import { Op } from 'sequelize'
import { Session } from './models.js'

export const sessionLifetime = 30 * 60 * 1000

// express-session использует callbacks, а Sequelize возвращает Promise.
export class SQLiteStore extends session.Store {
  // Истёкшую сессию считаем отсутствующей, даже если запись ещё в БД.
  async get(sid, callback) {
    try {
      const row = await Session.findOne({ where: { sid, expires: { [Op.gt]: Date.now() } } })
      callback(null, row ? JSON.parse(row.data) : null)
    } catch (error) {
      callback(error)
    }
  }
  async set(sid, value, callback) {
    try {
      // upsert создаёт сессию или обновляет запись с тем же sid.
      await Session.upsert({
        sid,
        data: JSON.stringify(value),
        expires: Date.now() + sessionLifetime,
      })
      callback?.()
    } catch (error) {
      callback?.(error)
    }
  }
  // Активность пользователя продлевает срок сессии без перезаписи её данных.
  async touch(sid, value, callback) {
    try {
      await Session.update({ expires: Date.now() + sessionLifetime }, { where: { sid } })
      callback?.()
    } catch (error) {
      callback?.(error)
    }
  }
  async destroy(sid, callback) {
    try {
      await Session.destroy({ where: { sid } })
      callback?.()
    } catch (error) {
      callback?.(error)
    }
  }
}

// Периодически удаляем истёкшие записи, чтобы таблица не росла бесконечно.
const cleanup = () => Session.destroy({ where: { expires: { [Op.lte]: Date.now() } } })
await cleanup()
const timer = setInterval(
  () =>
    cleanup().catch((error) => console.error('Не удалось удалить истёкшие сессии:', error.name)),
  10 * 60 * 1000,
)
timer.unref()
export const stopSessionCleanup = () => clearInterval(timer)
