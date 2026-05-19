import { gotScraping } from 'got-scraping';
import * as cheerio from 'cheerio';
import fs from 'fs';

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
  
  let initialDataStr = '';
  $('script').each((i, el) => {
    const text = $(el).html() || '';
    if (text.includes('window.__initialData__')) {
        const match = text.match(/window\.__initialData__\s*=\s*"(.*?)";/);
        if (match) {
            initialDataStr = match[1];
        }
    }
  });

  if (initialDataStr) {
      initialDataStr = decodeURIComponent(initialDataStr);
      fs.writeFileSync('initialData.json', initialDataStr);
      console.log('length', initialDataStr.length);
  } else {
      console.log('No window.__initialData__ match found.');
  }
}

run();
