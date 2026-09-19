// Общие правила для браузера и сервера. Сервер повторяет проверку каждой формы.
export const services = [
  {
    id: 'regular',
    name: 'Поддерживающая уборка',
    description: 'Порядок на каждый день: полы, пыль, кухня и ванная.',
  },
  {
    id: 'general',
    name: 'Генеральная уборка',
    description: 'Тщательная уборка квартиры, включая труднодоступные места.',
  },
  {
    id: 'renovation',
    name: 'Уборка после ремонта',
    description: 'Уберём строительную пыль и подготовим дом к жизни.',
  },
]

export const registrationFields = [
  'lastName',
  'firstName',
  'patronymic',
  'login',
  'password',
  'phone',
  'email',
  'consent',
]
export const requestFields = ['service', 'address', 'date']
export const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date())

// Убираем случайные пробелы по краям полей; пароль оставляем без изменений.
export function normalize(data) {
  return Object.fromEntries(
    Object.entries(data ?? {}).map(([key, value]) => [
      key,
      typeof value === 'string' && key !== 'password' ? value.trim() : value,
    ]),
  )
}

// У каждого поля — допустимый формат и сообщение при ошибке.
const rules = {
  lastName: [/^[А-ЯЁ][а-яё]*$/u, 'Русские буквы, первая — заглавная.'],
  firstName: [/^[А-ЯЁ][а-яё]*(?:-[А-ЯЁ][а-яё]*)?$/u, 'Например: Анна или Анна-Мария.'],
  patronymic: [
    /^[А-ЯЁ][а-яё]*(?:[ -](?:оглы|кызы|уулу|гызы))?$/u,
    'Например: Иванович или Рашид оглы.',
  ],
  login: [/^[A-Za-z]+$/, 'Только латинские буквы, без цифр и пробелов.'],
  password: [
    /^(?=[\s\S]*[a-z])(?=[\s\S]*[A-Z])(?=[\s\S]*\d)(?=[\s\S]*[$#@!])[\s\S]{8,}$/u,
    'От 8 символов: A–Z, a–z, цифра и символ $#@!.',
  ],
  phone: [/^8\(\d{3}\)\d{3}-\d{2}-\d{2}$/, 'Формат: 8(999)123-45-67.'],
  email: [
    /^(?!\.)(?![^@]*\.\.)(?![^@]*\.@)[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/,
    'Укажите email, например a@mail.ru.',
  ],
  q: [/^[А-ЯЁа-яёA-Za-z0-9 -]+$/u, 'Только буквы, цифры, пробелы и дефисы.'],
}

// Возвращаем ошибки по именам полей; пустой объект означает успешную проверку.
export function validate(data, fields) {
  const errors = {}
  for (const field of fields) {
    const value = data[field]
    if (field === 'consent') {
      if (value !== true) errors[field] = 'Для регистрации нужно согласие на обработку данных.'
      continue
    }
    const limit = field === 'address' ? 100 : 20
    if (typeof value !== 'string' || !value.trim()) errors[field] = 'Заполните поле.'
    else if (field !== 'password' && [...value].length > limit)
      errors[field] = `Не более ${limit} символов.`
    else if (rules[field] && !rules[field][0].test(value)) errors[field] = rules[field][1]
    else if (field === 'service' && !services.some((service) => service.id === value))
      errors[field] = 'Выберите услугу из списка.'
    else if (field === 'date') {
      const parsed = new Date(`${value}T12:00:00Z`)
      // JavaScript исправляет дату вроде 30 февраля — сравнение выявляет это.
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== value ||
        value < today()
      ) {
        errors[field] = 'Выберите существующую дату, не раньше сегодняшней.'
      }
    }
  }
  return errors
}
