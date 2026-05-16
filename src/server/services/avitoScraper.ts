import * as cheerio from 'cheerio';
import UserAgent from 'user-agents';
import dotenv from 'dotenv';
dotenv.config();

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

export async function fetchCategoryAds(categoryCode: string, searchQuery?: string | null, customUrl?: string | null): Promise<ScrapedAd[]> {
  // Add a random human-like delay before requesting
  await delay(getRandomInt(2000, 7000));

  let url = `${BASE_URL}/rossiya/${categoryCode}`;
  
  if (customUrl) {
    url = customUrl;
  } else if (searchQuery) {
    url = `${BASE_URL}/rossiya?q=${encodeURIComponent(searchQuery)}`;
  }

  try {
    const { gotScraping } = await import('got-scraping');
    const response = await gotScraping({
      url,
      proxyUrl: process.env.PROXY_URL || undefined,
      headerGeneratorOptions: {
        browsers: [{ name: 'chrome', minVersion: 110 }],
        devices: ['desktop', 'mobile'],
        locales: ['ru-RU'],
        operatingSystems: ['windows', 'linux', 'android']
      },
      timeout: { request: 20000 }
    });

    const html = response.body;
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
        if (src && src.startsWith('http')) {
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
    if (error.response && [403, 429].includes(error.response.statusCode)) {
      console.error(`Avito Blocked us (${error.response.statusCode}) on ${url}`);
      throw new Error('BLOCKED');
    }
    console.error(`Error fetching Avito for category ${categoryCode}:`, error.message);
    return [];
  }
}
