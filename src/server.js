import express from 'express'
import session from 'express-session'
import { rateLimit } from 'express-rate-limit'
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { db, dataDir } from './db.js'
import { User, CleaningRequest } from './models.js'
import { sessionLifetime, DatabaseStore, stopSessionCleanup } from './session-store.js'
import {
  normalize,
  validate,
  registrationFields,
  requestFields,
  services,
} from '../public/validation.js'

const app = express()
const port = 3107
const host = '127.0.0.1'
// Локальный сайт работает по HTTP, поэтому Secure здесь отключён.
const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: false, path: '/' }
// Секрет подписывает cookie; сохраняем его, чтобы сессии переживали перезапуск.
const secretFile = `${dataDir}/session-secret`
if (!existsSync(secretFile)) {
  writeFileSync(secretFile, randomBytes(48).toString('hex'), { mode: 0o600, flag: 'wx' })
}
const secret = readFileSync(secretFile, 'utf8')
if (secret.length < 32) throw new Error('Повреждён файл секрета сессий.')

app.disable('x-powered-by')
// Заголовки применяются ко всем ответам, включая ошибки.
app.use((req, res, next) => {
  res.set({
    // CSP разрешает ресурсы своего сайта и запрещает встроенные скрипты.
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    // Не позволяем браузеру угадывать тип файла.
    'X-Content-Type-Options': 'nosniff',
    // Запрещаем встраивать сайт в чужой iframe.
    'X-Frame-Options': 'DENY',
    // Не передаём адрес текущей страницы при переходе по ссылкам.
    'Referrer-Policy': 'no-referrer',
    // Сайту не нужны камера, микрофон и геолокация.
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  })
  // Браузер не должен сохранять ответы с личными данными и токенами в кэше.
  if (req.path.startsWith('/api/') || /\/(login|register|cabinet)\.html$/.test(req.path))
    res.set('Cache-Control', 'no-store')
  next()
})
app.use(express.json({ limit: '16kb' }))
// HttpOnly скрывает cookie от JS; SameSite ограничивает отправку с чужих сайтов.
app.use(
  session({
    name: 'cleaning.sid',
    secret,
    store: new DatabaseStore(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { ...cookieOptions, maxAge: sessionLifetime },
  }),
)

// При открытии страницы клиент получает состояние входа и токен для форм.
app.get('/api/session', async (req, res) => {
  req.session.csrfToken ||= randomBytes(32).toString('hex')
  const user = req.session.userId
    ? await User.findByPk(req.session.userId, { attributes: ['id', 'firstName', 'login'] })
    : null
  res.json({
    csrfToken: req.session.csrfToken,
    user: user || null,
    cookieNoticeSeen: /(?:^|;\s*)cookie_notice=1(?:;|$)/.test(req.headers.cookie || ''),
  })
})

// CSRF-токен защищает от отправки запросов с чужого сайта от имени пользователя.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  const actual = Buffer.from(req.get('X-CSRF-Token') || '')
  const expected = Buffer.from(req.session.csrfToken || '')
  if (!expected.length || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return res
      .status(403)
      .json({ message: 'Сессия формы истекла. Обновите страницу и повторите действие.' })
  }
  next()
})

// Ограничиваем частые попытки входа и регистрации с одного IP.
const authLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Слишком много попыток. Повторите через 15 минут.' },
})
const deriveKey = promisify(scrypt)
// Новый пароль получает случайную соль; при проверке используем соль из БД.
async function hashPassword(password, stored) {
  const salt = stored ? stored.split('$')[4] : randomBytes(16).toString('hex')
  const key = await deriveKey(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 3,
    maxmem: 64 * 1024 * 1024,
  })
  return `scrypt$32768$8$3$${salt}$${key.toString('hex')}`
}
// Выполняем хеширование даже для неизвестного логина, уменьшая разницу во времени.
const dummyHash = await hashPassword(randomBytes(32).toString('hex'))

// Клиентскую проверку можно обойти, поэтому сервер повторно проверяет поля.
function checked(req, res, fields) {
  const data = normalize(req.body)
  const errors = validate(data, fields)
  if (Object.keys(errors).length) {
    res.status(400).json({ message: 'Проверьте заполнение полей.', errors })
    return null
  }
  return data
}
function authenticated(req, res, next) {
  if (!req.session.userId)
    return res.status(401).json({ message: 'Войдите, чтобы работать с заявками.' })
  next()
}

app.post('/api/register', authLimit, async (req, res) => {
  const data = checked(req, res, registrationFields)
  if (!data) return
  const passwordHash = await hashPassword(data.password)
  try {
    await User.create({
      lastName: data.lastName,
      firstName: data.firstName,
      patronymic: data.patronymic,
      login: data.login,
      passwordHash,
      phone: data.phone,
      email: data.email,
      consentAt: new Date().toISOString(),
      consentVersion: '2026-09-19',
    })
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError')
      return res
        .status(409)
        .json({ message: 'Этот логин уже занят.', errors: { login: 'Выберите другой логин.' } })
    throw error
  }
  res.status(201).json({ message: 'Регистрация завершена. Теперь можно войти.' })
})

app.post('/api/login', authLimit, async (req, res) => {
  const data = checked(req, res, ['login', 'password'])
  if (!data) return
  const user = await User.findOne({
    where: { login: data.login.toLowerCase() },
    attributes: ['id', 'passwordHash'],
  })
  const stored = user?.passwordHash || dummyHash
  const candidate = await hashPassword(data.password, stored)
  if (!timingSafeEqual(Buffer.from(candidate), Buffer.from(stored)) || !user)
    return res.status(401).json({ message: 'Неверный логин или пароль.' })
  // После входа меняем ID сессии: прежний ID не должен давать доступ к аккаунту.
  await promisify(req.session.regenerate).call(req.session)
  req.session.userId = user.id
  req.session.csrfToken = randomBytes(32).toString('hex')
  await promisify(req.session.save).call(req.session)
  res.json({ message: 'Вы вошли.', csrfToken: req.session.csrfToken })
})

app.post('/api/logout', (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error)
    res.clearCookie('cleaning.sid', cookieOptions).json({ message: 'Вы вышли.' })
  })
})
app.post('/api/cookie-notice', (req, res) => {
  res.cookie('cookie_notice', '1', { ...cookieOptions, maxAge: 180 * 24 * 60 * 60 * 1000 })
  res.json({ message: 'Настройка сохранена.' })
})

// Владельца берём из сессии: клиент не может запросить чужие заявки.
app.get('/api/requests', authenticated, async (req, res) => {
  const requests = await CleaningRequest.findAll({
    where: { userId: req.session.userId },
    attributes: ['id', 'service', 'address', 'date', ['created_at', 'created_at']],
    order: [['id', 'DESC']],
  })
  res.json({ requests })
})
app.post('/api/requests', authenticated, async (req, res) => {
  const data = checked(req, res, requestFields)
  if (!data) return
  const request = await CleaningRequest.create({
    userId: req.session.userId,
    service: data.service,
    address: data.address,
    date: data.date,
  })
  res.status(201).json({ id: request.id, message: 'Заявка сохранена.' })
})
app.get('/api/search', (req, res) => {
  const data = normalize(req.query)
  const errors = validate(data, ['q'])
  if (Object.keys(errors).length)
    return res.status(400).json({ message: 'Проверьте поисковый запрос.', errors })
  const query = data.q.toLocaleLowerCase('ru')
  // includes ищет обычный текст, а не выполняет введённое регулярное выражение.
  res.json({
    services: services.filter((service) =>
      `${service.name} ${service.description}`.toLocaleLowerCase('ru').includes(query),
    ),
  })
})

app.get('/cabinet.html', (req, res, next) => {
  if (!req.session.userId) return res.redirect('/login.html')
  next()
})
// По HTTP доступны только файлы интерфейса из public.
app.use(express.static('public', { dotfiles: 'deny', etag: false }))
app.use((req, res) => res.status(404).json({ message: 'Страница не найдена.' }))
// Возвращаем понятную ошибку без SQL, путей к файлам и стека вызовов.
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error)
  const status = error.status === 413 ? 413 : error.type === 'entity.parse.failed' ? 400 : 500
  if (status === 500) console.error('Ошибка сервера:', error.code || error.name)
  res.status(status).json({
    message:
      status === 413
        ? 'Слишком большой запрос.'
        : status === 400
          ? 'Неверный формат запроса.'
          : 'Не удалось выполнить действие. Попробуйте позже.',
  })
})

const server = app.listen(port, host, () => console.log(`Чистый дом: http://${host}:${port}`))
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () =>
    server.close(async () => {
      stopSessionCleanup()
      await db.close()
      process.exit(0)
    }),
  )
