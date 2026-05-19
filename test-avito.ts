import { fetchCategoryAds } from './src/server/services/avitoScraper';

async function run() {
  const ads = await fetchCategoryAds('telefony', 'iphone', null, 1, undefined, undefined, 'https://m.avito.ru/');
  console.log('Ads found:', ads.length);
  if (ads.length > 0) {
    console.log(ads[0]);
  }
}

run();
