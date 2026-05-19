import { gotScraping } from 'got-scraping';

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
  console.log('Status', response.statusCode);
  console.log('URL', response.url);
  // print first 500 chars of body
  console.log(response.body.slice(0, 500));
}

run();
