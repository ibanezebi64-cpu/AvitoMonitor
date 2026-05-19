import { HttpsProxyAgent } from 'https-proxy-agent';
import { VK, Keyboard } from 'vk-io';
import axios from 'axios';
import { getUser, getAllActiveUsers } from './services/userService';
import { getUserCategories, getCategoryFilters, Category } from './services/categoryService';
import { fetchCategoryAds, ScrapedAd, advanceProxy, getCurrentProxy, fetchAdDetails, getProxyCount } from './services/avitoScraper';
import { db } from './database';
import dotenv from 'dotenv';
import { CookieJar } from 'tough-cookie';
dotenv.config();

const vk = new VK({ 
  token: process.env.VK_TOKEN || 'DUMMY',
  uploadTimeout: 60000 
});
const ADMIN_VK_ID = process.env.ADMIN_VK_ID ? parseInt(process.env.ADMIN_VK_ID, 10) : 0;

let lastProxyRotationTime = Date.now();
let plannedRotationInterval = getRandomInt(120, 180) * 60 * 1000; // 2-3 hours

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
    const VK_MAX_LENGTH = 3800; // Safe limit for one VK message
    
    let header = `🆕 Новое объявление!\n\n📌 ${ad.title}\n💰 Цена: ${ad.price}`;
    if (ad.date) {
      header += `\n📅 ${ad.date}`;
    }
    
    const description = ad.description || "";
    const urlMessage = `\n\n🔗 Объявление: ${ad.url}`;
    
    const attachments: string[] = [];
    
    let httpsAgent;
    if (proxyString) {
      httpsAgent = new HttpsProxyAgent(proxyString);
    }
    
    // Download and upload only the first image
    if (ad.images && ad.images.length > 0) {
      const imgUrl = ad.images[0];
      console.log(`[Скрейпер:VK] Загружаю главное изображение для ${ad.avito_id}`);
      
      let success = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
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
          
          if (response && response.data && response.data.length > 500) {
            const photo = await vk.upload.messagePhoto({
              source: { value: response.data, filename: 'image.jpg' }
            });
            attachments.push(photo.toString());
            console.log(`[Скрейпер:VK] ✅ Главное изображение загружено с попытки ${attempt}`);
            success = true;
            break; 
          }
        } catch (e: any) {
          console.warn(`[Скрейпер:VK] ⚠️ Попытка ${attempt}/3 для ${imgUrl} не удалась: ${e.message}`);
          if (attempt < 3) await delay(1500 * attempt);
        }
      }
    }

    const kb = Keyboard.builder()
      .urlButton({ label: 'Открыть объявление', url: ad.url })
      .inline(true);

    const fullMessage = `${header}\n\n📝 Описание:\n${description}`;

    if (fullMessage.length <= VK_MAX_LENGTH) {
      await vk.api.messages.send({
        user_id: vkId,
        random_id: Math.floor(Math.random() * 1000000000),
        message: fullMessage,
        attachment: attachments.length > 0 ? attachments.join(',') : undefined,
        keyboard: kb
      });
    } else {
      // Split description across messages
      const firstPartLimit = VK_MAX_LENGTH - 100;
      const firstPart = fullMessage.substring(0, firstPartLimit);
      
      await vk.api.messages.send({
        user_id: vkId,
        random_id: Math.floor(Math.random() * 1000000000),
        message: firstPart + '...',
        attachment: attachments.length > 0 ? attachments.join(',') : undefined
      });
      
      await delay(500);
      
      let remaining = fullMessage.substring(firstPartLimit);
      while (remaining.length > 0) {
        const chunk = remaining.substring(0, VK_MAX_LENGTH - 200);
        const isLastChunk = chunk.length === remaining.length;
        
        await vk.api.messages.send({
          user_id: vkId,
          random_id: Math.floor(Math.random() * 1000000000),
          message: (isLastChunk ? '... ' + chunk : '... ' + chunk + ' ...'),
          keyboard: isLastChunk ? kb : undefined
        });
        
        remaining = remaining.substring(chunk.length);
        if (remaining.length > 0) await delay(500);
      }
    }
  } catch (error: any) {
    console.error(`Failed to send message to ${vkId}:`, error.message);
    throw error;
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
  let cycleCount = 0;
  let isHalted = false;

  while (!isHalted) {
    cycleCount++;
    if (cycleCount % 10 === 0) {
      cleanupDatabase();
    }

    // Planned proxy rotation every 2-3 hours
    if (Date.now() - lastProxyRotationTime > plannedRotationInterval) {
      advanceProxy();
      lastProxyRotationTime = Date.now();
      plannedRotationInterval = getRandomInt(120, 180) * 60 * 1000;
      console.log(`[Скрейпер] Плановая смена прокси. Новый: ${getCurrentProxy() || 'Локальный'}`);
    }

    try {
      const users = getAllActiveUsers();
      if (users.length > 0) {
        console.log(`[Скрейпер] Найдено: ${users.length} активных пользователей для проверки.`);

        const allTasks: { user_id: number, cat: Category }[] = [];
        for (const u of users) {
          const cats = getUserCategories(u.vk_id);
          cats.forEach(c => allTasks.push({ user_id: u.vk_id, cat: c }));
        }
        
        console.log(`[Скрейпер] Всего задач (категорий) в очереди: ${allTasks.length}`);

        for (const task of allTasks) {
          if (isHalted) break;
          try {
            const currentUser = getUser(task.user_id);
            if (!currentUser || !currentUser.is_active) continue;

            const currentCat = db.prepare('SELECT * FROM categories WHERE id = ?').get(task.cat.id);
            if (!currentCat) continue;

            console.log(`[Скрейпер] Запуск парсинга. Пользователь: ${task.user_id}, Категория: "${task.cat.title}"`);
            const filters = getCategoryFilters(task.cat.id);
            let page = 1;
            let initializationMode = !task.cat.is_initialized;
            const cookieJar = new CookieJar();
            const sessionToken = {}; 
            let referer = 'https://www.avito.ru/';

            while (true) {
              if (isHalted) break;
              const currentUserLoop = getUser(task.user_id);
              if (!currentUserLoop || !currentUserLoop.is_active) break;
              
              const currentCatLoop = db.prepare('SELECT id FROM categories WHERE id = ?').get(task.cat.id);
              if (!currentCatLoop) break;

              console.log(`[Скрейпер] -> Читаю страницу ${page} для категории: ${task.cat.title}...`);
              let ads: ScrapedAd[] = [];
              let fetchSuccess = false;
              let retries = 0;
              const maxRetriesPerRequest = Math.max(1, getProxyCount());

              while (retries < maxRetriesPerRequest && !fetchSuccess) {
                try {
                  ads = await fetchCategoryAds(task.cat.category_code, filters?.search_query, filters?.url, page, cookieJar, sessionToken, referer);
                  fetchSuccess = true;
                  consecutiveBlocks = 0; // Reset global counter on success
                } catch (fetchError: any) {
                  if (fetchError.message === 'BLOCKED') {
                    consecutiveBlocks++;
                    retries++;
                    advanceProxy();
                    const nextProxy = getCurrentProxy();
                    console.warn(`[Скрейпер] Блок на странице ${page}. Попытка ${retries}/${maxRetriesPerRequest}. След. прокси: ${nextProxy || 'Локальный'}`);
                    
                    // User requested: stop after 2 full rounds of blocks
                    const proxyCount = getProxyCount() || 1; 
                    if (consecutiveBlocks >= proxyCount * 2) {
                       const fatalMsg = `🛑 КРИТИЧЕСКАЯ ОШИБКА: Все прокси (${consecutiveBlocks} попыток) заблокированы. Работа парсера остановлена. Пожалуйста, обновите список прокси!`;
                       console.error(fatalMsg);
                       await notifyAdmin(fatalMsg);
                       isHalted = true;
                       break;
                    }
                    await delay(getRandomInt(5000, 10000));
                  } else {
                    throw fetchError;
                  }
                }
              }

              if (isHalted || !fetchSuccess) break;

              referer = typeof filters?.url === 'string' && filters.url 
                        ? filters.url + (page > 1 ? `&p=${page}` : '') 
                        : `https://www.avito.ru/rossiya/${task.cat.category_code}?p=${page}`;

              if (ads.length === 0) break;

              if (initializationMode) {
                 for (const ad of ads) {
                   if (!hasSeenAd(task.user_id, task.cat.id, ad.avito_id)) {
                     markAdAsSeen(task.user_id, task.cat.id, ad.avito_id);
                   }
                 }
                 page++;
                 if (page > 30) break;
                 await delay(getRandomInt(3000, 7000));
              } else {
                 let foundSeenAd = false;
                 for (const ad of ads) {
                    if (hasSeenAd(task.user_id, task.cat.id, ad.avito_id)) {
                      foundSeenAd = true;
                    } else {
                      markAdAsSeen(task.user_id, task.cat.id, ad.avito_id);
                      const checkUser = getUser(task.user_id);
                      if (checkUser && checkUser.is_active) {
                         // Enrich details with retry logic for detail page too
                         let details: any = {};
                         let detailSuccess = false;
                         let detailRetries = 0;
                         while (detailRetries < 2 && !detailSuccess) {
                           try {
                              details = await fetchAdDetails(ad.url, getCurrentProxy());
                              detailSuccess = true;
                           } catch (e: any) {
                              if (e.message === 'BLOCKED') {
                                consecutiveBlocks++;
                                advanceProxy();
                                detailRetries++;
                                await delay(3000);
                              } else break;
                           }
                         }

                         if (details.title) ad.title = details.title;
                         if (details.price) ad.price = details.price;
                         if (details.images && details.images.length > 0) ad.images = details.images;
                         ad.description = details.description;
                         ad.date = details.date;

                         console.log(`[Скрейпер] Отправляем объявление ${ad.avito_id} (${ad.title})`);
                         
                         let notifySuccess = false;
                         let notifyAttempts = 0;
                         while (notifyAttempts < 3 && !notifySuccess) {
                           try {
                             await notifyUser(task.user_id, ad, getCurrentProxy());
                             notifySuccess = true;
                           } catch (err: any) {
                             notifyAttempts++;
                             console.warn(`[Скрейпер] Ошибка отправки в VK (попытка ${notifyAttempts}/3) для ${ad.avito_id}: ${err.message}`);
                             if (notifyAttempts < 3) await delay(2000 * notifyAttempts);
                           }
                         }
                      }
                    }
                 }
                 if (foundSeenAd) break;
                 page++;
                 if (page > 10) break;
                 await delay(getRandomInt(4000, 7000));
              }
            } 
            
            if (!isHalted && initializationMode) {
               const checkActiveAtEnd = getUser(task.user_id);
               if (checkActiveAtEnd && checkActiveAtEnd.is_active) {
                 db.prepare('UPDATE categories SET is_initialized = 1 WHERE id = ?').run(task.cat.id);
                 vk.api.messages.send({
                   user_id: task.user_id,
                   random_id: Math.floor(Math.random() * 1000000000),
                   message: `✅ Категория "${task.cat.title}" готова! База собрана.`
                 }).catch(() => {});
               }
            }

            await delay(getRandomInt(15000, 30000));
          } catch (error) {
            console.error(`Task error:`, error);
          }
        }
      }
    } catch (e) {
      console.error('Scheduler error:', e);
    }

    if (isHalted) {
      console.warn('[Скрейпер] Парсер остановлен до вмешательства администратора.');
      break; 
    }

    const waitMs = getRandomInt(60000, 180000);
    await delay(waitMs);
  }
}

export function startScheduler() {
  console.log('Initializing background scheduler...');
  runSchedulerLoop();
}
