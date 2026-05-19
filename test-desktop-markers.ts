import { gotScraping } from 'got-scraping';
import * as cheerio from 'cheerio';

async function run() {
  const url = 'https://www.avito.ru/rossiya/telefony?s=104';
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
  console.log('Final URL:', response.url);
  console.log('Page Title:', $('title').text());
  
  const markers = new Set<string>();
  $('[data-marker]').each((i, el) => {
    markers.add($(el).attr('data-marker') || '');
  });
  
  console.log('Unique markers found:', Array.from(markers).slice(0, 50));
  
  // Try to find items by class
  const itemsByClass = $('div[class*="item-root"], div[class*="iva-item"], div[class*="styles-module-root"]');
  console.log('Found by class (potential items):', itemsByClass.length);
  if (itemsByClass.length > 0) {
      console.log('First item classes:', itemsByClass.first().attr('class'));
  }
}

run();
