import { gotScraping } from 'got-scraping';
import * as cheerio from 'cheerio';

async function run() {
  // Try the redirected URL found in previous test
  const url = 'https://www.avito.ru/all/telefony/mobile-ASgBAgICAUSwwQ2I_Dc?s=104';
  console.log('Testing URL:', url);
  
  const response = await gotScraping({
    url,
    headerGeneratorOptions: {
      browsers: [{ name: 'chrome', minVersion: 110 }],
      devices: ['desktop'],
      locales: ['ru-RU', 'ru;q=0.9'],
      operatingSystems: ['windows', 'macos']
    }
  });
  
  const html = response.body;
  const $ = cheerio.load(html);
  
  console.log('Body length:', html.length);
  console.log('Items by [data-marker="item"]:', $('[data-marker="item"]').length);
  
  if ($('[data-marker="item"]').length > 0) {
      const first = $('[data-marker="item"]').first();
      console.log('First item Title:', first.find('[data-marker="item-title"]').text().trim() || first.find('h3').text().trim());
      console.log('First item Price:', first.find('[data-marker="item-price"]').text().trim());
  }
}

run();
