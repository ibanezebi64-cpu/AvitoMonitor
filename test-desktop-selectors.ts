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
  
  console.log('Total data-marker="item":', $('[data-marker="item"]').length);
  
  $('[data-marker="item"]').each((i, el) => {
    if (i > 5) return; // check first 5
    
    const id = $(el).attr('data-item-id') || 'MISSING ID';
    const title = $(el).find('[data-marker="item-title"]').text().trim() || $(el).find('h3').text().trim() || 'MISSING TITLE';
    const price = $(el).find('[data-marker="item-price"]').text().trim() || 'MISSING PRICE';
    const link = $(el).find('a[data-marker="item-title"]').attr('href') || $(el).find('a').attr('href') || 'MISSING LINK';
    
    console.log(`Item ${i}: ID=${id}, Title="${title}", Price="${price}", Link=${link}`);
    
    // Check images
    const images: string[] = [];
    $(el).find('img').each((idx, imgEl) => {
        images.push($(imgEl).attr('src') || '');
    });
    console.log(`   Images found: ${images.length}`);
  });
}

run();
