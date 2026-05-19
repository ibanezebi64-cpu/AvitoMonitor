import { HttpsProxyAgent } from 'https-proxy-agent';
import { VK, Keyboard } from 'vk-io';
import axios from 'axios';
import { getUser, getAllActiveUsers } from './services/userService';
import { getUserCategories, getCategoryFilters, Category } from './services/categoryService';
import { fetchCategoryAds, ScrapedAd, advanceProxy, getCurrentProxy } from './services/avitoScraper';
import { db } from './database';
import dotenv from 'dotenv';
import { CookieJar } from 'tough-cookie';
dotenv.config();

const vk = new VK({ 
  token: process.env.VK_TOKEN || 'DUMMY',
  uploadTimeout: 60000 
});
const ADMIN_VK_ID = process.env.ADMIN_VK_ID ? parseInt(process.env.ADMIN_VK_ID, 10) : 0;

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function hasSeenAd(vkId: number, categoryId: number, avitoId: string): boolean {
  const stmt = db.prepare('SELECT id FROM seen_ads WHERE user_id = ? AND category_id = ? AND avito_id = ?');
  return !!stmt.get(vkId, categoryId, avitoId);
}

function markAdAsSeen(vkId: number, categoryId: number, avitoId: string) {
  const stmt = db.prepare('INSERT INTO seen_ads (user_id, category_id, avito_id) VALUES (?, ?, ?)');
  stmt.run(vkId, categoryId, avitoId);
}

async function notifyAdmin(message: string) {
  if (!ADMIN_VK_ID) return;
  try {
    await vk.api.messages.send({
      user_id: ADMIN_VK_ID,
      random_id: Math.floor(Math.random() * 1000000000),
      message: `[ADMIN ALERT] ⚠️\\n${message}`
    });
  } catch (e) {
    console.error('Failed to notify admin:', e);
  }
}

// Function to send ad via VK with images and inline link button
async function notifyUser(vkId: number, ad: ScrapedAd, proxyString?: string) {
  try {
    let message = `🆕 Новое объявление!\n\n📌 ${ad.title}\n💰 Цена: ${ad.price}`;
    
    const attachments: string[] = [];
    
    let httpsAgent;
    if (proxyString) {
      httpsAgent = new HttpsProxyAgent(proxyString);
    }
    
    // Download and upload up to 3 images
    for (const imgUrl of ad.images) {
      if (attachments.length >= 3) break;
      try {
        // Try without proxy first for images, as CDNs often hate proxies
        let response;
        try {
          response = await axios.get(imgUrl, { 
            responseType: 'arraybuffer', 
            timeout: 10000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36'
            }
          });
        } catch (err) {
          // If direct fails, try with proxy
          if (httpsAgent) {
             response = await axios.get(imgUrl, { 
                responseType: 'arraybuffer', 
                timeout: 15000,
                httpsAgent: httpsAgent,
                proxy: false,
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36'
                }
             });
          } else {
             throw err;
          }
        }
        
        if (response && response.data && response.data.length > 0) {
           const photo = await vk.upload.messagePhoto({
             source: { value: response.data, filename: 'image.jpg' }
           });
           attachments.push(photo.toString());
           await delay(1000); // 1s delay between photo uploads
        }
        
        // Help garbage collector
        if (response) (response as any).data = null;
      } catch (e) {
        console.error(`Error uploading photo ${imgUrl} to VK:`, e);
      }
    }

    const kb = Keyboard.builder()
      .urlButton({ label: 'Открыть объявление', url: ad.url })
      .inline(true);

    await vk.api.messages.send({
      user_id: vkId,
      random_id: Math.floor(Math.random() * 1000000000),
      message: message,
      attachment: attachments.length > 0 ? attachments.join(',') : undefined,
      keyboard: kb
    });
  } catch (error) {
    console.error(`Failed to send message to ${vkId}:`, error);
  }
}

function cleanupDatabase() {
  console.log('[Скрейпер] Очистка старых данных...');
  try {
    // Delete seen ads older than 7 days
    db.prepare("DELETE FROM seen_ads WHERE created_at < datetime('now', '-7 days')").run();
    console.log('[Скрейпер] Очистка завершена.');
  } catch (e) {
    console.error('Error in cleanupDatabase:', e);
  }
}

export async function runSchedulerLoop() {
  console.log('[Скрейпер] Главный цикл запущен.');
  let consecutiveBlocks = 0;
  let wasBlocked = false;
  let cycleCount = 0;

  while (true) {
    let blockCaughtInThisCycle = false;
    cycleCount++;
    if (cycleCount % 10 === 0) {
      cleanupDatabase();
    }

    try {
      const users = getAllActiveUsers();
      if (users.length > 0) {
        console.log(`[Скрейпер] Найдено: ${users.length} активных пользователей для проверки.`);

        // Gather all categories to avoid duplicate hits on Avito
        const allTasks: { user_id: number, cat: Category }[] = [];
        for (const u of users) {
          const cats = getUserCategories(u.vk_id);
          cats.forEach(c => allTasks.push({ user_id: u.vk_id, cat: c }));
        }
        
        console.log(`[Скрейпер] Всего задач (категорий) в очереди: ${allTasks.length}`);

        for (const task of allTasks) {
          try {
            // Check if user is still active and category still exists before running task
            const currentUser = getUser(task.user_id);
            if (!currentUser || !currentUser.is_active) {
                console.log(`[Скрейпер] Пользователь ${task.user_id} теперь неактивен. Пропускаю задачу.`);
                continue;
            }

            const currentCat = db.prepare('SELECT * FROM categories WHERE id = ?').get(task.cat.id);
            if (!currentCat) {
                console.log(`[Скрейпер] Категория ${task.cat.id} была удалена. Пропускаю задачу.`);
                continue;
            }

            console.log(`[Скрейпер] Запуск парсинга. Пользователь: ${task.user_id}, Категория: "${task.cat.title}"`);
            const filters = getCategoryFilters(task.cat.id);
            let page = 1;
            let initializationMode = !task.cat.is_initialized;
            const cookieJar = new CookieJar();
            const sessionToken = {}; 
            let referer = 'https://www.avito.ru/';

            while (true) {
              // Check if user is still active and category still exists inside the loop to allow stopping
              const currentUserLoop = getUser(task.user_id);
              if (!currentUserLoop || !currentUserLoop.is_active) {
                  console.log(`[Скрейпер] Пользователь ${task.user_id} стал неактивен во время парсинга. Останавливаю.`);
                  break;
              }
              const currentCatLoop = db.prepare('SELECT id FROM categories WHERE id = ?').get(task.cat.id);
              if (!currentCatLoop) {
                  console.log(`[Скрейпер] Категория ${task.cat.id} была удалена во время парсинга. Останавливаю.`);
                  break;
              }

              console.log(`[Скрейпер] -> Читаю страницу ${page} для категории: ${task.cat.title}... (initializationMode: ${initializationMode})`);
              let ads: ScrapedAd[] = [];
              try {
                ads = await fetchCategoryAds(task.cat.category_code, filters?.search_query, filters?.url, page, cookieJar, sessionToken, referer);
                // Update referer to current page URL for next request
                referer = typeof filters?.url === 'string' && filters.url 
                          ? filters.url + (page > 1 ? `&p=${page}` : '') 
                          : `https://www.avito.ru/rossiya/${task.cat.category_code}?p=${page}`;
                
                // If fetch executes successfully without throw, reset block counter
                if (wasBlocked && consecutiveBlocks > 0) {
                    notifyAdmin(`✅ Парсер вышел из блока и успешно продолжил работу! (Прокси: ${getCurrentProxy() || 'Локальный'})`);
                }
                consecutiveBlocks = 0;
                wasBlocked = false;
              } catch (fetchError: any) {
                if (fetchError.message === 'BLOCKED') {
                  advanceProxy();
                  const nextProxy = getCurrentProxy();
                  notifyAdmin(`⚠️ Столкнулся с капчей/блоком, переключаюсь на другой прокси: ${nextProxy || 'Локальный'} (Категория: ${task.cat.title}, Страница: ${page})`);
                  consecutiveBlocks++;
                  if (consecutiveBlocks >= 20) {
                     // Too many blocks even with proxies, exit for cooldown
                     blockCaughtInThisCycle = true;
                     wasBlocked = true;
                     break; 
                  }
                  await delay(getRandomInt(5000, 10000));
                  continue; // Retry the same page with a new proxy
                } else {
                  throw fetchError;
                }
              }

              console.log(`[Скрейпер] Успешно получено: ${ads.length} объявлений. Категория: ${task.cat.title}, Страница: ${page}`);

              if (ads.length === 0) {
                 console.log(`[Скрейпер] На странице ${page} нет объявлений. Прекращаю обход категории ${task.cat.title}.`);
                 break;
              }

              if (initializationMode) {
                 // First run: just save all ads to as seen, so they don't trigger notifications later.
                 for (const ad of ads) {
                   if (!hasSeenAd(task.user_id, task.cat.id, ad.avito_id)) {
                     markAdAsSeen(task.user_id, task.cat.id, ad.avito_id);
                   }
                 }
                 page++;
                 if (page > 30) break; // Limit initialization to max 30 pages to prevent infinite loops / rate limits
                 await delay(getRandomInt(3000, 7000));
              } else {
                 let foundSeenAd = false;
                 
                 for (const ad of ads) {
                   // Re-check if category still exists before marking seen (avoid FK error)
                   const checkCat = db.prepare('SELECT id FROM categories WHERE id = ?').get(task.cat.id);
                   if (!checkCat) {
                     console.log(`[Скрейпер] Категория ${task.cat.id} была удалена в процессе. Отмена.`);
                     break;
                   }

                   if (hasSeenAd(task.user_id, task.cat.id, ad.avito_id)) {
                     foundSeenAd = true;
                   } else {
                     console.log(`[Скрейпер] Объявление ${ad.avito_id} новое!`);
                     // Add to DB
                     markAdAsSeen(task.user_id, task.cat.id, ad.avito_id);
                     
                     // Final check before notify: is user still active?
                     const checkUser = getUser(task.user_id);
                     if (checkUser && checkUser.is_active) {
                        console.log(`[Скрейпер] Отправляем объявление ${ad.avito_id} (${ad.title}) в VK. Изображений: ${ad.images.length}`);
                        await notifyUser(task.user_id, ad, getCurrentProxy());
                     }
                   }
                 }

                 if (foundSeenAd) {
                   console.log(`[Скрейпер] Дошли до ранее виденных объявлений на странице ${page}. Останавливаем обход категории ${task.cat.title}.`);
                   break; // We reached ads that are already in DB
                 }

                 page++;
                 // Ограничения: при инициализации можно листать до глубоких страниц (до 50),
                 // при обычной работе - только первые 10 страниц, чтобы не делать лишних запросов
                 const pageLimit = initializationMode ? 50 : 10;
                 if (page > pageLimit) {
                    console.log(`[Скрейпер] Достигнут жесткий лимит в ${pageLimit} страниц. Переход к следующей задаче.`);
                    break;
                 }
                 const interPageWait = getRandomInt(4000, 7000);
                 console.log(`[Скрейпер] Жду ${interPageWait} мс перед следующей страницей...`);
                 await delay(interPageWait); // Delay between pages
              }
            } // end while(true)
            
            if (initializationMode) {
               // Only complete initialization if user is still active
               const checkActiveAtEnd = getUser(task.user_id);
               if (checkActiveAtEnd && checkActiveAtEnd.is_active) {
                 console.log(`[Скрейпер] Инициализация категории "${task.cat.title}" пользователя ${task.user_id} завершена. База наполнена.`);
                 db.prepare('UPDATE categories SET is_initialized = 1 WHERE id = ?').run(task.cat.id);
                 task.cat.is_initialized = 1;
                 vk.api.messages.send({
                   user_id: task.user_id,
                   random_id: Math.floor(Math.random() * 1000000000),
                   message: `✅ Категория "${task.cat.title}" к работе готова! Исходная база объявлений собрана.`
                 }).catch(e => console.error(e));
               } else {
                 console.log(`[Скрейпер] Инициализация категории "${task.cat.title}" прервана (пользователь неактивен).`);
               }
            }

            // Random delay between tasks
            await delay(getRandomInt(15000, 30000));
            if (blockCaughtInThisCycle) {
               break; // Pass the break to the outer loop to start cooldown
            }
          } catch (fetchError: any) {
            console.error(`Error in task ${task.cat.title}:`, fetchError);
          }
        }
      }

    } catch (e) {
      console.error('Error in scheduler loop:', e);
    }

    if (blockCaughtInThisCycle) {
      consecutiveBlocks++;
      let penaltyMinutes = 60;
      if (consecutiveBlocks === 1) penaltyMinutes = 60;
      else if (consecutiveBlocks === 2) penaltyMinutes = 4 * 60;
      else penaltyMinutes = 24.5 * 60;

      const blockMsg = `Парсер словил блок Avito (403/429)!\\nКоличество блоков подряд: ${consecutiveBlocks}.\\nОхлаждение: ${penaltyMinutes} минут.`;
      console.warn(blockMsg);
      await notifyAdmin(blockMsg);
      
      await delay(penaltyMinutes * 60 * 1000);
      continue; // Skip the normal random delay, go straight to next cycle after cooldown
    }

    // Wait from 1 to 3 minutes (60000 to 180000 ms) before next global run
    const waitMs = getRandomInt(60000, 180000);
    console.log(`[Скрейпер] Ожидание ${Math.floor(waitMs / 1000)} секунд перед следующим циклом проверки...`);
    await delay(waitMs);
  }
}

export function startScheduler() {
  console.log('Initializing background scheduler...');
  runSchedulerLoop();
}
