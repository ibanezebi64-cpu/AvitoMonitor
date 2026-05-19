import { VK, Keyboard } from 'vk-io';
import axios from 'axios';
import { getAllActiveUsers } from './services/userService';
import { getUserCategories, getCategoryFilters, Category } from './services/categoryService';
import { fetchCategoryAds, ScrapedAd, advanceProxy, getCurrentProxy } from './services/avitoScraper';
import { db } from './database';
import dotenv from 'dotenv';
dotenv.config();

const vk = new VK({ token: process.env.VK_TOKEN || 'DUMMY' });
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
async function notifyUser(vkId: number, ad: ScrapedAd) {
  try {
    let message = `🆕 Новое объявление!\\n\\n📌 ${ad.title}\\n💰 Цена: ${ad.price}`;
    
    const attachments: string[] = [];
    
    // Download and upload up to 3 images
    for (const imgUrl of ad.images) {
      if (attachments.length >= 3) break;
      try {
        const response = await axios.get(imgUrl, { responseType: 'arraybuffer' });
        const photo = await vk.upload.messagePhoto({
          source: { value: response.data, filename: 'image.jpg' }
        });
        attachments.push(photo.toString());
      } catch (e) {
        console.error('Error uploading photo to VK:', e);
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

export async function runSchedulerLoop() {
  console.log('Scheduler loop started.');
  let consecutiveBlocks = 0;
  let wasBlocked = false;

  while (true) {
    let blockCaughtInThisCycle = false;

    try {
      const users = getAllActiveUsers();
      if (users.length > 0) {
        console.log(`Checking ads for ${users.length} active users.`);

        // Gather all categories to avoid duplicate hits on Avito
        const allTasks: { user_id: number, cat: Category }[] = [];
        for (const u of users) {
          const cats = getUserCategories(u.vk_id);
          cats.forEach(c => allTasks.push({ user_id: u.vk_id, cat: c }));
        }

        for (const task of allTasks) {
          try {
            const filters = getCategoryFilters(task.cat.id);
            let page = 1;
            let initializationMode = !task.cat.is_initialized;

            while (true) {
              let ads: ScrapedAd[] = [];
              try {
                ads = await fetchCategoryAds(task.cat.category_code, filters?.search_query, filters?.url, page);
                
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

              console.log(`Fetched ${ads.length} ads from page ${page} (initializationMode: ${initializationMode})`);

              if (ads.length === 0) {
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
                 
                 // Filter ads logically
                 const filteredAds = ads.filter(ad => {
                    const parsedPrice = parseInt(ad.price.replace(/\D/g, ''), 10);
                    if (!isNaN(parsedPrice) && filters && !filters.url) {
                      if (filters.min_price && parsedPrice < filters.min_price) return false;
                      if (filters.max_price && parsedPrice > filters.max_price) return false;
                    }
                    return true;
                 });

                 for (const ad of ads) {
                   if (hasSeenAd(task.user_id, task.cat.id, ad.avito_id)) {
                     foundSeenAd = true;
                   } else {
                     // Add to DB
                     markAdAsSeen(task.user_id, task.cat.id, ad.avito_id);
                     
                     // Send to user only if it matches filters
                     if (filteredAds.some(fAd => fAd.avito_id === ad.avito_id)) {
                       await notifyUser(task.user_id, ad);
                     }
                   }
                 }

                 if (foundSeenAd) {
                   break; // We reached ads that are already in DB
                 }

                 page++;
                 if (page > 10) break; // Hard limit for regular updates to avoid huge hits if something goes wrong
                 await delay(getRandomInt(4000, 7000)); // Delay between pages
              }
            } // end while(true)
            
            if (initializationMode) {
               db.prepare('UPDATE categories SET is_initialized = 1 WHERE id = ?').run(task.cat.id);
               task.cat.is_initialized = 1;
               vk.api.messages.send({
                 user_id: task.user_id,
                 random_id: Math.floor(Math.random() * 1000000000),
                 message: `✅ Категория "${task.cat.title}" к работе готова! Исходная база объявлений собрана.`
               }).catch(e => console.error(e));
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

    // Wait from 12 to 18 minutes (720000 to 1080000 ms) before next global run
    const waitMs = getRandomInt(720000, 1080000);
    console.log(`Waiting ${Math.floor(waitMs / 60000)} minutes until next check...`);
    await delay(waitMs);
  }
}

export function startScheduler() {
  console.log('Initializing background scheduler...');
  runSchedulerLoop();
}
