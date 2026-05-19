import { gotScraping } from 'got-scraping';
import * as cheerio from 'cheerio';

async function run() {
  const url = 'https://m.avito.ru/all/telefony/mobile-ASgBAgICAUSwwQ2I_Dc';
  const response = await gotScraping({
    url,
    headerGeneratorOptions: {
      browsers: [{ name: 'chrome', minVersion: 110 }, { name: 'safari', minVersion: 15 }],
      devices: ['mobile'],
      locales: ['ru-RU', 'ru;q=0.9'],
      operatingSystems: ['android', 'ios']
    }
  });
  
  const html = response.body;
  const $ = cheerio.load(html);
  
  let validCount = 0;
  $('[data-marker="item"]').each((i, el) => {
    const avito_id = $(el).attr('data-item-id');
    const titleElem = $(el).find('[data-marker="item-title"]');
    const title = titleElem.text().trim();
    let itemUrl = $(el).find('a[itemprop="url"]').attr('href') || titleElem.attr('href') || '';
    
    if (!avito_id || !title || !itemUrl) {
      console.log(`Failed at index ${i}: id=${avito_id}, title=${title}, url=${itemUrl}`);
    } else {
      validCount++;
    }
  });

  console.log('Valid ads:', validCount);
}

run();
