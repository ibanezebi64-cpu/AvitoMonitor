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
  token: vkToken || 'DUMMY_TOKEN', // prevents crashing if not set, but won't work
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
      message: `Инструкция по использованию бота:\\n1. В разделе "Добавить категории" выберите нужные товары для отслеживания.\\n2. В разделе "Мои категории" вы можете задать фильтры (цена, состояние).\\n3. Нажмите "Запустить отслеживание", чтобы бот начал мониторить Авито и присылать новые объявления.\\n\\nЧтобы вызвать меню, нажмите "Главное меню".`,
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

import { AVITO_CATEGORIES, getCategoryById } from './constants/categories';
import { addCategory, getCategoryFilters, removeCategory, updateFilter, resetFilters } from './services/categoryService';

// Add Categories Selection
vk.updates.on('message_new', async (context, next) => {
  const payload = context.messagePayload;
  const user = context.state.dbUser;

  if (payload?.command === 'add_categories') {
    const kb = Keyboard.builder();
    
    kb.textButton({ label: '🔗 Добавить по ссылке (Рекомендуется!)', payload: { command: 'add_by_url' }, color: Keyboard.POSITIVE_COLOR }).row();

    for (let i = 0; i < AVITO_CATEGORIES.length; i += 2) {
      kb.textButton({ label: AVITO_CATEGORIES[i].title.substring(0, 40), payload: { command: 'select_cat', id: AVITO_CATEGORIES[i].id }, color: Keyboard.SECONDARY_COLOR });
      if (i + 1 < AVITO_CATEGORIES.length) {
        kb.textButton({ label: AVITO_CATEGORIES[i + 1].title.substring(0, 40), payload: { command: 'select_cat', id: AVITO_CATEGORIES[i + 1].id }, color: Keyboard.SECONDARY_COLOR });
      }
      kb.row();
    }
    kb.textButton({ label: '« Назад в меню', payload: { command: 'main' }, color: Keyboard.PRIMARY_COLOR }).inline(false);

    await context.send({
      message: 'Вы можете добавить категорию по ссылке (максимально точные настройки с сайта Авито) или выбрать из базовых:',
      keyboard: kb
    });
    return;
  }

  if (payload?.command === 'add_by_url') {
    updateUserState(user.vk_id, 'await_avito_url');
    const kb = Keyboard.builder().textButton({ label: 'Отмена', payload: { command: 'main' }, color: Keyboard.NEGATIVE_COLOR }).inline(true);

    await context.send({
      message: '🔗 Инструкция:\\n1. Зайдите на сайт Авито (avito.ru) или в приложение.\\n2. Введите нужный поисковой запрос, выберите любую категорию, любые точечные фильтры (размер, пробег, диагональ, марку).\\n3. Скопируйте ссылку из адресной строки и отправьте её сюда.',
      keyboard: kb
    });
    return;
  }

  if (payload?.command === 'select_cat') {
    const catData = getCategoryById(payload.id);
    if (!catData) return;

    const kb = Keyboard.builder();
    const labelText = `✅ Категория целиком: ${catData.category.title}`;
    kb.textButton({ label: labelText.substring(0, 40), payload: { command: 'confirm_cat', id: catData.category.id }, color: Keyboard.POSITIVE_COLOR }).row();
    
    if (catData.category.subcategories && catData.category.subcategories.length > 0) {
      const subs = catData.category.subcategories;
      for (let i = 0; i < subs.length; i += 2) {
        kb.textButton({ label: subs[i].title.substring(0, 40), payload: { command: 'confirm_cat', id: subs[i].id }, color: Keyboard.SECONDARY_COLOR });
        if (i + 1 < subs.length) {
          kb.textButton({ label: subs[i + 1].title.substring(0, 40), payload: { command: 'confirm_cat', id: subs[i + 1].id }, color: Keyboard.SECONDARY_COLOR });
        }
        kb.row();
      }
    }

    kb.textButton({ label: '« Назад к категориям', payload: { command: 'add_categories' }, color: Keyboard.PRIMARY_COLOR }).inline(false);

    await context.send({
      message: `Категория: ${catData.category.title}\\nВыберите подкатегорию или отслеживайте всю категорию целиком:`,
      keyboard: kb
    });
    return;
  }

  if (payload?.command === 'confirm_cat') {
    const catData = getCategoryById(payload.id);
    if (!catData) return;

    // Add to DB
    const categories = getUserCategories(user.vk_id);
    if (categories.some(c => c.category_code === payload.id)) {
      await context.send({ message: '⚠ Эта категория уже добавлена.' });
    } else {
      addCategory(user.vk_id, payload.id, catData.category.title);
      await context.send({ message: `✅ Категория "${catData.category.title}" успешно добавлена!` });
    }

    await context.send({
      message: 'Главное меню:',
      keyboard: getInlineMainMenu(user.is_active, context.senderId)
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

  const priceText = filters.min_price || filters.max_price 
    ? `[${filters.min_price || 0} - ${filters.max_price || '∞'} ₽]` 
    : '[Любая]';
  
  const condTextMap: Record<string, string> = { 'all': 'Все', 'new': 'Новые', 'used': 'Б/У' };
  const condText = condTextMap[filters.condition] || 'Все';

  const kb = Keyboard.builder();
  
  if (filters.url) {
    kb.textButton({ label: '❌ Удалить категорию (По ссылке)', payload: { command: 'remove_cat', id: catId }, color: Keyboard.NEGATIVE_COLOR }).row();
  } else {
    kb.textButton({ label: `Цена ${priceText}`, payload: { command: 'set_price_filter', id: catId }, color: Keyboard.SECONDARY_COLOR }).row()
      .textButton({ label: `Состояние: ${condText}`, payload: { command: 'toggle_cond_filter', id: catId }, color: Keyboard.SECONDARY_COLOR }).row()
      .textButton({ label: 'Сбросить фильтры', payload: { command: 'reset_filters', id: catId }, color: Keyboard.PRIMARY_COLOR }).row()
      .textButton({ label: '❌ Удалить категорию', payload: { command: 'remove_cat', id: catId }, color: Keyboard.NEGATIVE_COLOR }).row();
  }

  kb.textButton({ label: '« К списку категорий', payload: { command: 'my_categories' }, color: Keyboard.PRIMARY_COLOR }).inline(true);

  updateUserState(user.vk_id, 'main_menu'); // assure clean state

  await context.send({
    message: filters.url 
      ? `Настройки для: ${catInfo.title}\\n\\n🔗 Ваша ссылка (все фильтры применены внутри ссылки):\\n${filters.url}` 
      : `Настройки для: ${catInfo.title}`,
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

  // Filters setup
  if (payload?.command === 'toggle_cond_filter') {
    const filters = getCategoryFilters(payload.id);
    if (!filters) return;
    const cycleMap: Record<string, string> = { 'all': 'new', 'new': 'used', 'used': 'all' };
    updateFilter(payload.id, { condition: cycleMap[filters.condition] });
    
    await sendCategorySettings(context, user, payload.id);
    return;
  }

  if (payload?.command === 'reset_filters') {
    resetFilters(payload.id);
    await sendCategorySettings(context, user, payload.id);
    return;
  }

  if (payload?.command === 'set_price_filter') {
    updateUserState(user.vk_id, `await_price_${payload.id}`);
    
    const kb = Keyboard.builder().textButton({ label: 'Отмена', payload: { command: 'view_my_cat', id: payload.id }, color: Keyboard.NEGATIVE_COLOR }).inline(true);

    await context.send({
      message: 'Введите минимальную и максимальную цену через пробел или дефис (например: "1000 5000").\\nВведите "0 5000" (до 5000) или "1000 0" (от 1000).',
      keyboard: kb
    });
    return;
  }

  await next();
});

// Handle text input for states
vk.updates.on('message_new', async (context, next) => {
  const text = (context.text || '').trim();
  const user = context.state.dbUser;

  if (user.state.startsWith('await_avito_url')) {
    if (text.includes('avito.ru/')) {
      // Find a domain and path roughly
      const urlRegex = new RegExp('https?://[^\\\\s]+');
      const urlMatch = text.match(urlRegex);
      if (urlMatch) {
         addCategory(user.vk_id, 'custom_url', 'Пользовательский поиск (Ссылка)', urlMatch[0]);
         updateUserState(user.vk_id, 'main_menu');
         await context.send({
           message: '✅ Поиск по ссылке успешно добавлен! Бот будет учитывать все выбранные в ней фильтры на Авито.',
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

  if (user.state.startsWith('await_price_')) {
    const catId = parseInt(user.state.replace('await_price_', ''), 10);
    
    // Attempt parse prices
    const numbers = text.match(/\\d+/g);
    if (numbers && numbers.length >= 1) {
      const min = parseInt(numbers[0], 10);
      const max = numbers.length > 1 ? parseInt(numbers[1], 10) : 0;
      
      updateFilter(catId, { 
        min_price: min > 0 ? min : null, 
        max_price: max > 0 ? max : null 
      });
      
      await context.send({ message: '✅ Ценовой фильтр установлен.' });
    } else {
      await context.send({ message: '❌ Неверный формат цены. Фильтр сброшен.' });
    }

    updateUserState(user.vk_id, 'main_menu');
    await sendCategorySettings(context, user, catId);
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
