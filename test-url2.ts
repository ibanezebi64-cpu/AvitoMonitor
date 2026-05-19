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
  
  console.log('Items found with data-marker="item":', $('[data-marker="item"]').length);
  
  // check for initialData payload
  let hasInitialData = false;
  $('script').each((i, el) => {
    const text = $(el).html() || '';
    if (text.includes('window.__initialData__')) {
      hasInitialData = true;
      console.log('Found window.__initialData__ ! length =', text.length);
    }
  });

  // check other ways items might be presented
  console.log('div class item:', $('div[class*="item"]').length);
}

run();
