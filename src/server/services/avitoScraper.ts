import * as cheerio from 'cheerio';
import UserAgent from 'user-agents';
import dotenv from 'dotenv';
dotenv.config();

let currentProxyIndex = 0;

export function getProxyList(): string[] {
  const proxiesStr = process.env.PROXIES || '';
  if (!proxiesStr) {
    if (process.env.PROXY_URL) return process.env.PROXY_URL.split(',').map(p => p.trim()).filter(p => p.length > 0);
    return [];
  }
  return proxiesStr.split(',').map(p => p.trim()).filter(p => p.length > 0);
}

export function getCurrentProxy(): string | undefined {
  const proxies = getProxyList();
  if (proxies.length === 0) return undefined;
  
  if (currentProxyIndex >= proxies.length) {
    currentProxyIndex = 0;
  }
  return proxies[currentProxyIndex];
}

export function advanceProxy() {
  const proxies = getProxyList();
  if (proxies.length > 0) {
    currentProxyIndex = (currentProxyIndex + 1) % proxies.length;
  }
}

export let currentProxyStatus = 'Ожидание первого запроса...';

export function getStatusDescription(statusCode?: number, errorMsg?: string): string {
  if (statusCode === 200) return '✅ Отлично (200)';
  if (statusCode === 403) return '❌ Блок по IP (403)';
  if (statusCode === 429) return '⚠️ Капча / Лимит запросов (429)';
  if (statusCode === 407) return '❌ Ошибка авторизации прокси (407)';
  if (statusCode) return `❌ Ошибка (${statusCode})`;
  return `❌ Сбой (${errorMsg || 'Неизвестно'})`;
}

export async function testAllProxies(): Promise<string> {
  const proxies = getProxyList();
  if (proxies.length === 0) return 'Прокси не настроены в .env (PROXIES или PROXY_URL пуст).';
  
  let msg = `Найдено прокси: ${proxies.length}\n\n`;
  const { gotScraping } = await import('got-scraping');

  for (let i = 0; i < proxies.length; i++) {
    const proxy = proxies[i];
    msg += `${i + 1}. ${proxy}\n`;
    try {
      const response = await gotScraping({
        url: 'https://m.avito.ru/rossiya',
        proxyUrl: proxy,
        headerGeneratorOptions: {
          browsers: [{ name: 'chrome', minVersion: 110 }, { name: 'safari', minVersion: 15 }],
          devices: ['desktop'],
          locales: ['ru-RU', 'ru;q=0.9'],
          operatingSystems: ['windows', 'macos']
        },
        headers: {
          'referer': 'https://www.avito.ru/'
        },
        timeout: { request: 40000 },
        throwHttpErrors: false
      });
      msg += `Статус: ${getStatusDescription(response.statusCode)}\n`;
    } catch (error: any) {
      if (error.response) {
         msg += `Статус: ${getStatusDescription(error.response.statusCode)}\n`;
      } else {
         msg += `Статус: ${getStatusDescription(undefined, error.code || error.message)}\n`;
      }
    }
    msg += '\n';
  }

  return msg;
}

export interface ScrapedAd {
  avito_id: string;
  title: string;
  price: string;
  url: string;
  images: string[];
}

const BASE_URL = 'https://www.avito.ru';

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function fetchCategoryAds(categoryCode: string, searchQuery?: string | null, customUrl?: string | null, page: number = 1, cookieJar?: any, sessionToken?: any, referer?: string): Promise<ScrapedAd[]> {
  // Add a random human-like delay before requesting
  await delay(getRandomInt(3000, 7000));

  let url = `${BASE_URL}/rossiya/${categoryCode}`;
  
  if (customUrl) {
    url = customUrl.replace('m.avito.ru', 'www.avito.ru').replace('://avito.ru', '://www.avito.ru');
  } else if (searchQuery) {
    url = `${BASE_URL}/rossiya?q=${encodeURIComponent(searchQuery)}`;
  }

  // Force sort by date (s=104) so that we always get newest items instead of old VIP items
  // BUT only if it's not already set to something else that looks like a sort
  try {
    const parsedUrl = new URL(url);
    if (!parsedUrl.searchParams.has('s')) {
      parsedUrl.searchParams.set('s', '104');
    }
    if (page > 1) {
      parsedUrl.searchParams.set('p', page.toString());
    }
    url = parsedUrl.toString();
  } catch(e) {
    console.error('Failed to parse URL for sorting', e);
  }

  try {
    const { gotScraping } = await import('got-scraping');
    const proxyToUse = getCurrentProxy();
    const response = await gotScraping({
      url,
      proxyUrl: proxyToUse,
      cookieJar,
      sessionToken,
      headerGeneratorOptions: {
        browsers: [{ name: 'chrome', minVersion: 110 }, { name: 'safari', minVersion: 15 }],
        devices: ['desktop'],
        locales: ['ru-RU', 'ru;q=0.9'],
        operatingSystems: ['windows', 'macos']
      },
      headers: {
        'referer': referer || 'https://www.avito.ru/'
      },
      timeout: { request: 40000 }
    });

    let html: any = response.body;
    
    // Если Авито вместо объявлений отдает страницу логина (перенаправляет)
    if (response.url && (response.url.includes('/login') || response.url.includes('auth'))) {
      currentProxyStatus = '🛑 Редирект на страницу авторизации';
      throw new Error('BLOCKED');
    }

    // Обработка серверного редиректа в JSON (Suspense Redirect), часто бывает на десктопе
    if (html.includes('"redirect":') && html.includes('"isSuspenseRedirect":true')) {
       const match = html.match(/"redirect":"(.*?)"/);
       if (match && match[1]) {
          const redirectPath = match[1].replace(/\\u0026/g, '&');
          const redirectUrl = redirectPath.startsWith('http') ? redirectPath : `${BASE_URL}${redirectPath}`;
          console.log(`[Скрейпер:Avito] Обнаружен серверный редирект: ${redirectUrl}. Перехожу...`);
          return fetchCategoryAds(categoryCode, searchQuery, redirectUrl, page, cookieJar, sessionToken, url);
       }
    }

    // Иногда отдает 200, но вместо контента страница блокировки (капча)
    if (html.includes('auth-form') || html.includes('Доступ временно заблокирован') || html.includes('firewall')) {
      currentProxyStatus = '⚠️ Страница блокировки/капчи (200 OK)';
      throw new Error('BLOCKED');
    }

    currentProxyStatus = '✅ Отлично (200)';
    let $ = cheerio.load(html);

    const ads: ScrapedAd[] = [];

    // NOTE: Selectors are extremely volatile on Avito. 
    // This is a generalized approximation for demonstration.
    $('[data-marker="item"]').each((i, el) => {
      // Check if it's a real item and not some similar/recommended block outside catalog
      const parentHierarchy = $(el).parents('[data-marker]').map((idx, p) => $(p).attr('data-marker')).get();
      const inCatalog = parentHierarchy.includes('catalog-serp');
      
      // If it's NOT in the main catalog, it might be recommendations which user doesn't want
      if (!inCatalog) return;

      const avito_id = $(el).attr('data-item-id') || $(el).find('a[data-marker-id]').attr('data-marker-id');
      const titleElem = $(el).find('[data-marker="item-title"]');
      let title = titleElem.text().trim();
      if (!title) {
          title = $(el).find('h3').text().trim();
      }
      
      // Attempt to get relative url
      let itemUrl = $(el).find('a[itemprop="url"]').attr('href') || titleElem.attr('href') || $(el).find('a[data-marker="item-title"]').attr('href') || '';
      if (itemUrl && !itemUrl.startsWith('http')) {
        itemUrl = BASE_URL + itemUrl;
      }

      const price = $(el).find('[data-marker="item-price"]').text().trim();
      
      // Images - on Avito search result, sometimes multiple images are available in a source set or hidden tags
      const images: string[] = [];

      // Try searching for more images in data-props or other attributes
      const dataProps = $(el).attr('data-props');
      if (dataProps) {
        try {
          const props = JSON.parse(dataProps);
          if (props.images && Array.isArray(props.images)) {
            props.images.forEach((img: any) => {
              const url = img.url || img['636x476'] || img['432x324'];
              if (url && url.startsWith('http') && !images.includes(url)) {
                images.push(url);
              }
            });
          }
        } catch (e) {
          // ignore parse errors
        }
      }

      if (images.length < 3) {
        $(el).find('img').each((idx, imgEl) => {
          const src = $(imgEl).attr('src');
          const dataSrc = $(imgEl).attr('data-src');
          const srcset = $(imgEl).attr('srcset');
          
          let foundUrl = src || dataSrc;
          
          // If srcset is present, try to get a better quality image
          if (srcset) {
             const sets = srcset.split(',').map(s => s.trim().split(' ')[0]);
             if (sets.length > 0) foundUrl = sets[sets.length - 1]; // highest quality usually
          }

          const className = $(imgEl).attr('class') || '';
          // Skip user avatars and dummy icons
          if (foundUrl && foundUrl.startsWith('http') && 
              !foundUrl.includes('avatar') && 
              !className.includes('avatar') && 
              !className.includes('seller') && 
              !className.includes('icon')) {
            if (!images.includes(foundUrl)) {
               images.push(foundUrl);
            }
          }
        });
      }

      if (avito_id && title && itemUrl) {
         ads.push({
           avito_id,
           title,
           price,
           url: itemUrl,
           images: images.slice(0, 3) // max 3 images
         });
      }
    });

    const titleText = $('title').text().trim();
    if (ads.length === 0) {
      console.log(`[Скрейпер:Avito] Внимание: Найдено 0 объявлений. Проверка структуры HTML: title=${titleText}`);
      // Check if it's an end-of-catalog or empty message
      if (html.includes('По вашему запросу ничего не найдено') || html.includes('ничего не найдено')) {
         console.log(`[Скрейпер:Avito] Обнаружен конец выдачи (объявления закончились на этой странице).`);
      } else if (html.length < 50000) {
         console.log(`[Скрейпер:Avito] Подозрительно маленький размер страницы (${html.length} байт). Возможно лимит выдачи без JS.`);
      }
    }

    // Help garbage collector
    html = '';
    (response as any).body = null;
    $ = null as any;

    return ads;
  } catch (error: any) {
    if (error.response && [403, 429, 407, 502, 503].includes(error.response.statusCode)) {
      currentProxyStatus = getStatusDescription(error.response.statusCode);
      console.error(`Avito/Proxy Blocked us (${error.response.statusCode}) on ${url}`);
      throw new Error('BLOCKED');
    }
    
    if (error.message && (error.message.includes('407 Proxy Authentication Required') || error.message.includes('Proxy responded with') || error.message.includes('tunneling socket could not be established'))) {
      currentProxyStatus = getStatusDescription(407);
      console.error(`Proxy error on ${url}: ${error.message}`);
      throw new Error('BLOCKED');
    }

    // Also treat generic network / proxy connection errors as a reason to switch proxy
    if (error.code && ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'ECONNREFUSED'].includes(error.code)) {
      currentProxyStatus = getStatusDescription(undefined, error.code);
      console.error(`Network error (${error.code}) on ${url}, treating as block.`);
      throw new Error('BLOCKED');
    }

    currentProxyStatus = getStatusDescription(undefined, error.message);
    console.error(`Error fetching Avito for category ${categoryCode}:`, error.message);
    return [];
  }
}
