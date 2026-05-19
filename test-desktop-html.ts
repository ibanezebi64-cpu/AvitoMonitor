import { gotScraping } from 'got-scraping';

async function run() {
  const url = 'https://www.avito.ru/rossiya/telefony?s=104&q=iphone';
  const response = await gotScraping({
    url,
    headerGeneratorOptions: {
      browsers: [{ name: 'chrome', minVersion: 110 }],
      devices: ['desktop'],
      locales: ['ru-RU', 'ru;q=0.9'],
      operatingSystems: ['windows', 'macos']
    }
  });
  
  console.log('--- START 2000 ---');
  console.log(response.body.substring(0, 2000));
  console.log('--- END 2000 ---');
  console.log(response.body.substring(response.body.length - 2000));
}

run();
