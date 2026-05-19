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
  
  const titleElem = $('[data-marker="item-title"]').first();
  console.log('Title elem HTML:', titleElem.parent().parent().html());
  console.log('Class of parent with data-marker=item?', titleElem.closest('[data-marker="item"]').length);
  
  // What is the structure from body?
  console.log('Item count:', $('div[data-marker="item"]').length);
  
  const __initialDataText = $('script').filter((i, el) => ($(el).html() || '').includes('window.__initialData__')).html();
  if (__initialDataText) {
      console.log('Initial data exists, length:', __initialDataText.length);
  }
}

run();
