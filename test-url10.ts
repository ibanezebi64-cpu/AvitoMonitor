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
  
  $('script').each((i, el) => {
    const text = $(el).html() || '';
    if (text.includes('window.local') || text.includes('window.')) {
        console.log('Script includes window:, length =', text.length);
        console.log(text.substring(0, 150));
    }
  });
}

run();
