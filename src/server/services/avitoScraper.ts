import axios from 'axios';
import * as cheerio from 'cheerio';
import UserAgent from 'user-agents';
import { HttpsProxyAgent } from 'https-proxy-agent';
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

  // Use a modern desktop or mobile user agent
  const userAgent = new UserAgent({ deviceCategory: Math.random() > 0.5 ? 'mobile' : 'desktop' });
  const isMobile = userAgent.data.deviceCategory === 'mobile';

  const headers: Record<string, string> = {
    'User-Agent': userAgent.toString(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
    'Sec-Ch-Ua-Mobile': isMobile ? '?1' : '?0',
    'Sec-Ch-Ua-Platform': `"${userAgent.data.platform || (isMobile ? 'Android' : 'Windows')}"`
  };

  const axiosConfig: any = {
    headers,
    timeout: 15000
  };

  if (process.env.PROXY_URL) {
    axiosConfig.httpsAgent = new HttpsProxyAgent(process.env.PROXY_URL);
    axiosConfig.proxy = false; // Disable axios default proxy handling
  }

  try {
    const response = await axios.get(url, axiosConfig);

    const html = response.data;
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
    if (error.response && [403, 429].includes(error.response.status)) {
      console.error(`Avito Blocked us (${error.response.status}) on ${url}`);
      throw new Error('BLOCKED');
    }
    console.error(`Error fetching Avito for category ${categoryCode}:`, error.message);
    return [];
  }
}
