import { normalize, validate, registrationFields, requestFields, services, today } from './validation.js';

let csrfToken;
// Общая отправка запросов: JSON, cookie сессии и CSRF-токен для POST.
async function api(path, data) {
  const response = await fetch(path, {
    method: data === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: data === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken || '' },
    body: data === undefined ? undefined : JSON.stringify(data)
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.message), { errors: result.errors, status: response.status });
  if (result.csrfToken) csrfToken = result.csrfToken;
  return result;
}

// textContent выводит пользовательские строки как текст, не как HTML.
function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}
function errorMessage(error) {
  return error instanceof TypeError ? 'Не удалось связаться с сервером. Проверьте соединение и повторите.' : error.message;
}
function showErrors(form, errors = {}) {
  for (const input of form.querySelectorAll('[name]')) {
    const message = errors[input.name];
    form.querySelector(`[data-error="${input.name}"]`).textContent = message || '';
    input.setAttribute('aria-invalid', String(Boolean(message)));
  }
  form.querySelector('[aria-invalid="true"]')?.focus();
}

// Общий обработчик форм: проверяет поля, ждёт сессию и показывает ошибки.
function bindForm(id, fields, submit) {
  const form = document.getElementById(id);
  if (!form) return;
  for (const input of form.querySelectorAll('[name]')) {
    const error = element('span', '', 'field-error');
    error.id = `${input.name}-error`;
    error.dataset.error = input.name;
    input.closest('.field').append(error);
    const hint = input.closest('.field').querySelector('small');
    if (hint) hint.id = `${input.name}-hint`;
    input.setAttribute('aria-describedby', [hint?.id, error.id].filter(Boolean).join(' '));
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    if (button.disabled) return;
    const message = form.querySelector('.form-message');
    message.textContent = '';
    message.classList.remove('success');
    const data = normalize(Object.fromEntries(new FormData(form)));
    if (fields.includes('consent')) data.consent = form.elements.consent.checked;
    const errors = validate(data, fields);
    showErrors(form, errors);
    if (Object.keys(errors).length) return;
    // Не даём повторно отправить форму, пока не пришёл ответ.
    button.disabled = true;
    try {
      await ready;
      await submit(data, form, message);
    } catch (error) {
      showErrors(form, error.errors);
      message.textContent = errorMessage(error);
      if (error.status === 401 && id === 'request-form') location.assign('/login.html');
    } finally { button.disabled = false; }
  });
}

bindForm('register-form', registrationFields, async data => {
  await api('/api/register', data);
  location.assign('/login.html?registered=1');
});
bindForm('login-form', ['login', 'password'], async data => {
  await api('/api/login', data);
  location.assign('/cabinet.html');
});
bindForm('request-form', requestFields, async (data, form, message) => {
  await api('/api/requests', data);
  form.reset();
  message.classList.add('success');
  message.textContent = 'Заявка сохранена. Она появилась в списке справа или ниже.';
  await loadRequests();
});
bindForm('search-form', ['q'], async data => {
  const result = await api(`/api/search?q=${encodeURIComponent(data.q)}`);
  const container = document.getElementById('search-results');
  container.replaceChildren();
  container.append(element('p', result.services.length ? `Найдено услуг: ${result.services.length}` : 'Ничего не найдено. Попробуйте «уборка» или «кухня».'));
  for (const service of result.services) {
    const card = element('article', '', 'search-result');
    const link = element('a', 'Оставить заявку ↗');
    link.href = '/cabinet.html';
    card.append(element('h3', service.name), element('p', service.description), link);
    container.append(card);
  }
});

async function loadRequests() {
  const container = document.getElementById('requests');
  try {
    const { requests } = await api('/api/requests');
    container.replaceChildren();
    if (!requests.length) {
      const empty = element('div', '', 'empty');
      empty.append(element('strong', 'Заявок пока нет'), element('span', 'Выберите услугу и удобную дату в форме.'));
      container.append(empty);
    }
    for (const request of requests) {
      const card = element('article', '', 'request-card');
      const date = request.date.split('-').reverse().join('.');
      card.append(element('span', `Заявка № ${request.id} · Сохранена`, 'badge'),
        element('h3', services.find(service => service.id === request.service)?.name || 'Уборка'),
        element('p', request.address), element('p', `Дата: ${date}`, 'quiet'));
      container.append(card);
    }
  } catch (error) {
    container.replaceChildren(element('p', errorMessage(error), 'form-message'));
    if (error.status === 401) location.assign('/login.html');
  }
}

const select = document.getElementById('service');
if (select) {
  for (const service of services) {
    const option = element('option', service.name);
    option.value = service.id;
    select.append(option);
  }
  document.getElementById('date').min = today();
}
if (document.getElementById('registered-message')) {
  document.getElementById('registered-message').hidden = !new URLSearchParams(location.search).has('registered');
}

// Состояние сессии определяет меню, доступ к кабинету и показ cookie-уведомления.
const ready = api('/api/session').catch(() => {
  throw new Error('Не удалось загрузить сессию с сервера. Проверьте соединение и обновите страницу.');
}).then(async state => {
  for (const link of document.querySelectorAll('[data-guest]')) link.hidden = Boolean(state.user);
  for (const link of document.querySelectorAll('[data-member]')) link.hidden = !state.user;
  const notice = document.getElementById('cookie-notice');
  if (notice) notice.hidden = state.cookieNoticeSeen;
  if (select) {
    if (!state.user) return location.replace('/login.html');
    document.getElementById('greeting').textContent = `Здравствуйте, ${state.user.firstName}!`;
    await loadRequests();
  }
});
ready.catch(error => {
  const target = document.querySelector('.form-message, #page-message');
  if (target) target.textContent = errorMessage(error);
});

document.getElementById('accept-cookies')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await ready;
    await api('/api/cookie-notice', {});
    document.getElementById('cookie-notice').hidden = true;
  } catch (error) { document.getElementById('cookie-error').textContent = errorMessage(error); }
  finally { button.disabled = false; }
});
document.getElementById('logout')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await ready;
    await api('/api/logout', {});
    location.assign('/login.html');
  } catch (error) {
    document.getElementById('page-message').textContent = errorMessage(error);
    button.disabled = false;
  }
});
