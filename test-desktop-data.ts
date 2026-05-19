import { gotScraping } from 'got-scraping';
import * as cheerio from 'cheerio';

async function run() {
  const url = 'https://www.avito.ru/rossiya/telefony?s=104&q=iphone';
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
  
  // check for window.__initialData__
  const scriptWithData = $('script').filter((i, el) => {
    return ($(el).html() || '').includes('window.__initialData__');
  });
  
  if (scriptWithData.length > 0) {
      console.log('Found window.__initialData__ !');
      const text = scriptWithData.html() || '';
      console.log('Script length:', text.length);
      // Try to extract it
      const match = text.match(/window\.__initialData__\s*=\s*"(.*?)";/);
      if (match) {
          console.log('Data is encoded as string');
      } else {
          console.log('Data might be plain object');
          const matchObj = text.match(/window\.__initialData__\s*=\s*(\{.*?\});/);
          if (matchObj) {
              console.log('Data is plain object');
          }
      }
  } else {
      console.log('window.__initialData__ NOT found');
  }

  // Look for any div that might contain an item
  const allDivs = $('div');
  console.log('Total divs:', allDivs.length);
  
  // Search for occurrence of "iPhone" in body
  const bodyText = $('body').text().toLowerCase();
  const count = (bodyText.match(/iphone/g) || []).length;
  console.log('Occurrences of "iphone" in body text:', count);
}

run();
