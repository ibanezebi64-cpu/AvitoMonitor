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
          browsers: [{ name: 'chrome', minVersion: 110 }],
          devices: ['desktop', 'mobile'],
          locales: ['ru-RU'],
          operatingSystems: ['windows', 'linux', 'android']
        },
        timeout: { request: 15000 },
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

const BASE_URL = 'https://m.avito.ru';

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function fetchCategoryAds(categoryCode: string, searchQuery?: string | null, customUrl?: string | null, page: number = 1): Promise<ScrapedAd[]> {
  // Add a random human-like delay before requesting
  await delay(getRandomInt(3000, 7000));

  let url = `${BASE_URL}/rossiya/${categoryCode}`;
  
  if (customUrl) {
    url = customUrl.replace('www.avito.ru', 'm.avito.ru').replace('://avito.ru', '://m.avito.ru');
  } else if (searchQuery) {
    url = `${BASE_URL}/rossiya?q=${encodeURIComponent(searchQuery)}`;
  }

  // Force sort by date (s=104) so that we always get newest items instead of old VIP items
  try {
    const parsedUrl = new URL(url);
    parsedUrl.searchParams.set('s', '104');
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
      headerGeneratorOptions: {
        browsers: [{ name: 'chrome', minVersion: 110 }],
        devices: ['desktop', 'mobile'],
        locales: ['ru-RU'],
        operatingSystems: ['windows', 'linux', 'android']
      },
      timeout: { request: 20000 }
    });

    const html = response.body;
    currentProxyStatus = '✅ Отлично (200)';
    const $ = cheerio.load(html);

    const ads: ScrapedAd[] = [];

    // NOTE: Selectors are extremely volatile on Avito. 
    // This is a generalized approximation for demonstration.
    $('[data-marker="item"]').each((i, el) => {
      const avito_id = $(el).attr('data-item-id');
      const titleElem = $(el).find('[data-marker="item-title"]');
      const title = titleElem.text().trim();
      
      // Attempt to get relative url
      let itemUrl = $(el).find('a[itemprop="url"]').attr('href') || titleElem.attr('href') || '';
      if (itemUrl && !itemUrl.startsWith('http')) {
        itemUrl = BASE_URL + itemUrl;
      }

      const price = $(el).find('[data-marker="item-price"]').text().trim();
      
      // Images
      const images: string[] = [];
      $(el).find('img').each((idx, imgEl) => {
        const src = $(imgEl).attr('src');
        const className = $(imgEl).attr('class') || '';
        // Skip user avatars and dummy icons
        if (src && src.startsWith('http') && 
            !src.includes('avatar') && 
            !className.includes('avatar') && 
            !className.includes('seller') && 
            !className.includes('icon')) {
          images.push(src);
        }
      });

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
