import { VK, Keyboard } from 'vk-io';
import { SessionManager } from '@vk-io/session';
import dotenv from 'dotenv';
import { getOrCreateUser, toggleUserTracking, updateUserState } from './services/userService';
import { getUserCategories, removeAllCategories } from './services/categoryService';

dotenv.config();

const vkToken = process.env.VK_TOKEN;
if (!vkToken) {
  console.warn('VK_TOKEN is not set. Bot will not start.');
}

const vk = new VK({
  token: vkToken || 'DUMMY_TOKEN',
  uploadTimeout: 60000 // 60 seconds for uploads
});

const sessionManager = new SessionManager();
vk.updates.on('message_new', sessionManager.middleware);

// Static Menus
const MAIN_MENU_DEFAULT_KEYBOARD = Keyboard.builder()
  .textButton({ label: 'Главное меню', payload: { command: 'main' }, color: Keyboard.PRIMARY_COLOR })
  .inline(false);

function getInlineMainMenu(isActive: boolean, senderId?: number) {
  const adminIdStr = process.env.ADMIN_VK_ID;
  const isAdmin = adminIdStr && senderId === parseInt(adminIdStr, 10);

  const kb = Keyboard.builder()
    .textButton({ label: 'Мои категории', payload: { command: 'my_categories' }, color: Keyboard.SECONDARY_COLOR })
    .row()
    .textButton({ label: 'Добавить категории', payload: { command: 'add_categories' }, color: Keyboard.POSITIVE_COLOR })
    .row()
    .textButton({ label: isActive ? 'Остановить отслеживание' : 'Запустить отслеживание', payload: { command: 'toggle_tracking' }, color: isActive ? Keyboard.NEGATIVE_COLOR : Keyboard.PRIMARY_COLOR })
    .row()
    .textButton({ label: 'Помощь', payload: { command: 'help' }, color: Keyboard.SECONDARY_COLOR });
    
  if (isAdmin) {
    kb.row().textButton({ label: '👑 Админ', payload: { command: 'admin_panel' }, color: Keyboard.PRIMARY_COLOR });
  }

  return kb.inline(true);
}

// Bot middleware for user init
vk.updates.on('message_new', async (context, next) => {
  if (!context.isOutbox && context.senderId) {
    context.state.dbUser = getOrCreateUser(context.senderId);
  }
  await next();
});

// Help handler
vk.updates.on('message_new', async (context, next) => {
  const text = (context.text || '').toLowerCase();
  const payload = context.messagePayload;

  if (text === 'помощь' || payload?.command === 'help') {
    await context.send({
      message: `Инструкция по использованию бота:\n1. В разделе "Добавить категории" отправьте ссылку с Авито с нужными фильтрами.\n2. Бот будет автоматически проверять эту ссылку и присылать новые объявления.\n3. Нажмите "Запустить отслеживание", чтобы бот начал работу.\n\nЧтобы вызвать меню, нажмите "Главное меню".`,
      keyboard: MAIN_MENU_DEFAULT_KEYBOARD
    });
    return;
  }
  await next();
});

// Start & Main menu
vk.updates.on('message_new', async (context, next) => {
  const text = (context.text || '').toLowerCase();
  const payload = context.messagePayload;
  const user = context.state.dbUser;

  if (['старт', 'начать', '/start'].includes(text) || payload?.command === 'main' || text === 'главное меню') {
    updateUserState(user.vk_id, 'main_menu');
    
    const statusText = user.is_active ? '✅ Отслеживание запущено' : '⏸ Отслеживание остановлено';
    
    await context.send({
      message: `Привет! Я бот для мониторинга новых объявлений на Авито. Выбери нужные категории и я буду присылать новые объявления!\\n\\nТекущий статус: ${statusText}`,
      keyboard: MAIN_MENU_DEFAULT_KEYBOARD
    });
    
    await context.send({
      message: 'Главное меню:',
      keyboard: getInlineMainMenu(user.is_active, context.senderId)
    });
    return;
  }
  await next();
});

// Toggle Tracking
vk.updates.on('message_new', async (context, next) => {
  const payload = context.messagePayload;
  const user = context.state.dbUser;

  if (payload?.command === 'toggle_tracking') {
    const categories = getUserCategories(user.vk_id);
    if (categories.length === 0 && !user.is_active) {
      await context.send({
        message: '⚠ У вас нет выбранных категорий. Сначала добавьте категории для отслеживания.'
      });
      return;
    }

    const isActive = toggleUserTracking(user.vk_id);
    const statusText = isActive ? '✅ Отслеживание успешно запущено!' : '⏸ Отслеживание остановлено.';
    
    await context.send({
      message: statusText,
      keyboard: getInlineMainMenu(isActive, context.senderId)
    });
    return;
  }
  await next();
});

import { addCategory, getCategoryFilters, removeCategory } from './services/categoryService';

// Add Categories Selection
vk.updates.on('message_new', async (context, next) => {
  const payload = context.messagePayload;
  const user = context.state.dbUser;

  if (payload?.command === 'add_categories') {
    const kb = Keyboard.builder()
      .textButton({ label: '🔗 Добавить по ссылке (Рекомендуется!)', payload: { command: 'add_by_url' }, color: Keyboard.POSITIVE_COLOR })
      .row()
      .textButton({ label: '« Назад в меню', payload: { command: 'main' }, color: Keyboard.PRIMARY_COLOR })
      .inline(false);

    await context.send({
      message: 'Для отслеживания новых объявлений просто отправьте мне ссылку с сайта Авито с уже настроенными вами фильтрами.',
      keyboard: kb
    });
    return;
  }

  if (payload?.command === 'add_by_url') {
    updateUserState(user.vk_id, 'await_custom_title');
    const kb = Keyboard.builder().textButton({ label: 'Отмена', payload: { command: 'main' }, color: Keyboard.NEGATIVE_COLOR }).inline(true);

    await context.send({
      message: '📝 Введите название для этого поиска (например: "iPhone 15 Pro" или "Кофемашина"):',
      keyboard: kb
    });
    return;
  }

  await next();
});

// My Categories
async function sendCategorySettings(context: any, user: any, catId: number) {
  const categories = getUserCategories(user.vk_id);
  const catInfo = categories.find(c => c.id === catId);
  if (!catInfo) return;

  const filters = getCategoryFilters(catId);
  if (!filters) return;

  const kb = Keyboard.builder();
  
  kb.textButton({ label: '❌ Удалить категорию', payload: { command: 'remove_cat', id: catId }, color: Keyboard.NEGATIVE_COLOR }).row();
  kb.textButton({ label: '« К списку категорий', payload: { command: 'my_categories' }, color: Keyboard.PRIMARY_COLOR }).inline(true);

  updateUserState(user.vk_id, 'main_menu'); // assure clean state

  await context.send({
    message: `Настройки для: ${catInfo.title}\n\n🔗 Ваша ссылка (все фильтры применены внутри ссылки):\n${filters.url || 'Не указана'}`,
    keyboard: kb
  });
}

vk.updates.on('message_new', async (context, next) => {
  const payload = context.messagePayload;
  const user = context.state.dbUser;

  if (payload?.command === 'my_categories') {
    const categories = getUserCategories(user.vk_id);
    if (categories.length === 0) {
      await context.send({
        message: 'У вас пока нет добавленных категорий.',
        keyboard: getInlineMainMenu(user.is_active, context.senderId)
      });
      return;
    }

    const kb = Keyboard.builder();
    for (let i = 0; i < categories.length; i += 2) {
      kb.textButton({ label: categories[i].title.substring(0, 40), payload: { command: 'view_my_cat', id: categories[i].id }, color: Keyboard.SECONDARY_COLOR });
      if (i + 1 < categories.length) {
        kb.textButton({ label: categories[i + 1].title.substring(0, 40), payload: { command: 'view_my_cat', id: categories[i + 1].id }, color: Keyboard.SECONDARY_COLOR });
      }
      kb.row();
    }
    kb.textButton({ label: '❌ Удалить все категории', payload: { command: 'remove_all_cat' }, color: Keyboard.NEGATIVE_COLOR }).row();
    kb.textButton({ label: '« Назад в меню', payload: { command: 'main' }, color: Keyboard.PRIMARY_COLOR }).inline(false);

    await context.send({
      message: 'Ваши отслеживаемые категории. Выберите категорию для настройки фильтров или удаления:',
      keyboard: kb
    });
    return;
  }

  if (payload?.command === 'remove_all_cat') {
    removeAllCategories(user.vk_id);
    if (user.is_active) toggleUserTracking(user.vk_id); // Stop tracking if no categories
    await context.send({
      message: '✅ Все категории удалены. Отслеживание остановлено.',
      keyboard: getInlineMainMenu(false, context.senderId)
    });
    return;
  }

  if (payload?.command === 'view_my_cat' || payload?.command === 'back_to_my_cat') {
    await sendCategorySettings(context, user, payload.id);
    return;
  }

  if (payload?.command === 'remove_cat') {
    removeCategory(payload.id, user.vk_id);
    await context.send({ message: '✅ Категория удалена.' });
    
    const categories = getUserCategories(user.vk_id);
    if (categories.length === 0 && user.is_active) toggleUserTracking(user.vk_id);

    // Call my_categories logic manually (trigger next event visually)
    await context.send({
      message: 'Главное меню:',
      keyboard: getInlineMainMenu(user.is_active && categories.length > 0, context.senderId)
    });
    return;
  }

  await next();
});

// Handle text input for states
vk.updates.on('message_new', async (context, next) => {
  const text = (context.text || '').trim();
  const user = context.state.dbUser;

  if (user.state === 'await_custom_title') {
    if (text.length < 2 || text.length > 100) {
      await context.send({ message: '❌ Название должно быть от 2 до 100 символов.' });
      return;
    }
    
    updateUserState(user.vk_id, `await_avito_url:${text}`);
    const kb = Keyboard.builder().textButton({ label: 'Отмена', payload: { command: 'main' }, color: Keyboard.NEGATIVE_COLOR }).inline(true);

    await context.send({
      message: `✅ Название "${text}" принято.\n\n🔗 Теперь отправьте ссылку с Авито:\n1. Зайдите на сайт Авито (avito.ru) или в приложение.\n2. Введите запрос и выберите фильтры.\n3. ОБЯЗАТЕЛЬНО установите сортировку "По дате".\n4. Скопируйте ссылку из адресной строки и вставьте её сюда.`,
      keyboard: kb
    });
    return;
  }

  if (user.state.startsWith('await_avito_url')) {
    if (text.includes('avito.ru/')) {
      const urlRegex = /https?:\/\/\S+/;
      const urlMatch = text.match(urlRegex);
      if (urlMatch) {
         let title = 'Пользовательский поиск';
         if (user.state.includes(':')) {
           title = user.state.split(':')[1];
         }
         
         addCategory(user.vk_id, 'custom_url', title, urlMatch[0]);
         updateUserState(user.vk_id, 'main_menu');
         await context.send({
           message: `✅ Поиск "${title}" успешно добавлен! Бот будет отслеживать новые объявления по этой ссылке.`,
           keyboard: getInlineMainMenu(user.is_active, context.senderId)
         });
         return;
      }
    }
    
    await context.send({
      message: '❌ Ссылка не распознана. Убедитесь, что она начинается с https://m.avito.ru или https://www.avito.ru',
      keyboard: Keyboard.builder().textButton({ label: 'Отмена', payload: { command: 'main' }, color: Keyboard.NEGATIVE_COLOR }).inline(true)
    });
    return;
  }

  await next();
});

// Admin Command
vk.updates.on('message_new', async (context, next) => {
  const text = (context.text || '').toLowerCase();
  const payload = context.messagePayload;
  const adminIdStr = process.env.ADMIN_VK_ID;
  const isAdmin = adminIdStr && parseInt(adminIdStr, 10) === context.senderId;

  if (!isAdmin) {
    return next();
  }

  if (text === '/admin' || text === 'админ' || payload?.command === 'admin_panel') {
    const kb = Keyboard.builder()
      .textButton({ label: '📊 Статистика', payload: { command: 'admin_stats' }, color: Keyboard.PRIMARY_COLOR }).row()
      .textButton({ label: '🌐 Проверить прокси', payload: { command: 'admin_test_proxy' }, color: Keyboard.PRIMARY_COLOR }).row()
      .textButton({ label: '« К боту', payload: { command: 'main' }, color: Keyboard.SECONDARY_COLOR }).inline(true);

    const { getCurrentProxy, currentProxyStatus } = require('./services/avitoScraper');
    const proxy = getCurrentProxy();
    let msg = `👑 Панель администратора:\n\n`;
    msg += `Текущий прокси: ${proxy ? proxy : 'Локальный IP'}\n`;
    msg += `Статус: ${currentProxyStatus}`;

    await context.send({
      message: msg,
      keyboard: kb
    });
    return;
  }

  if (payload?.command === 'admin_test_proxy') {
    const kb = Keyboard.builder()
      .textButton({ label: '« Назад', payload: { command: 'admin_panel' }, color: Keyboard.SECONDARY_COLOR }).inline(true);

    try {
      await context.send({
        message: '⏳ Начинаю проверку всех прокси на доступность Авито. Это может занять некоторое время...',
      });
      
      const { testAllProxies } = require('./services/avitoScraper');
      const msg = await testAllProxies();

      await context.send({
        message: msg,
        keyboard: kb
      });
    } catch (e: any) {
      await context.send({
        message: `❌ Ошибка скрипта: ${e.message}`,
        keyboard: kb
      });
    }
    return;
  }

  if (payload?.command === 'admin_stats') {
    const { db } = require('./database');
    const usersCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    const activeCount = db.prepare('SELECT COUNT(*) as c FROM users WHERE is_active = 1').get().c;
    const catsCount = db.prepare('SELECT COUNT(*) as c FROM categories').get().c;
    const adsCount = db.prepare('SELECT COUNT(*) as c FROM seen_ads').get().c;

    const kb = Keyboard.builder()
      .textButton({ label: '« Назад', payload: { command: 'admin_panel' }, color: Keyboard.SECONDARY_COLOR }).inline(true);

    await context.send({
      message: `📊 Статистика:\\nПользователей: ${usersCount} (Активных: ${activeCount})\\nКатегорий: ${catsCount}\\nОтправлено уведомлений: ${adsCount}`,
      keyboard: kb
    });
    return;
  }
  
  await next();
});

export function startBot() {
  if (vkToken) {
    vk.updates.start().then(() => {
      console.log('VK Bot started successfully.');
    }).catch(console.error);
  }
}
