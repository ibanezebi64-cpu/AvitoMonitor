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
  
  const itemContainer = $('[data-marker="item"]').first().parent().parent();
  console.log('Item container text:', itemContainer.text());
  console.log('Item container HTML:', itemContainer.html());
}

run();
