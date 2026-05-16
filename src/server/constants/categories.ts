export interface CategoryItem {
  id: string; // Internal ID for Avito (or slug)
  title: string;
  subcategories?: CategoryItem[];
}

export const AVITO_CATEGORIES: CategoryItem[] = [
  {
    id: 'transport',
    title: 'Транспорт',
    subcategories: [
      { id: 'automobiles', title: 'Автомобили' },
      { id: 'motorcycles', title: 'Мотоциклы и мототехника' },
      { id: 'trucks', title: 'Грузовики и спецтехника' },
    ]
  },
  {
    id: 'real_estate',
    title: 'Недвижимость',
    subcategories: [
      { id: 'apartments', title: 'Квартиры' },
      { id: 'houses', title: 'Дома, дачи, коттеджи' },
      { id: 'commercial', title: 'Коммерческая недвижимость' },
    ]
  },
  {
    id: 'electronics',
    title: 'Бытовая электроника',
    subcategories: [
      { id: 'phones', title: 'Телефоны' },
      { id: 'audio_video', title: 'Аудио и видео' },
      { id: 'computers', title: 'Товары для компьютера' },
      { id: 'laptops', title: 'Ноутбуки' },
    ]
  },
  {
    id: 'personal_items',
    title: 'Личные вещи',
    subcategories: [
      { id: 'clothes', title: 'Одежда, обувь, аксессуары' },
      { id: 'children_clothes', title: 'Детская одежда и обувь' },
      { id: 'watches', title: 'Часы и украшения' },
    ]
  },
  {
    id: 'home_and_garden',
    title: 'Для дома и дачи',
    subcategories: [
      { id: 'appliances', title: 'Бытовая техника' },
      { id: 'furniture', title: 'Мебель и интерьер' },
      { id: 'repair', title: 'Ремонт и строительство' },
    ]
  }
];

export function getCategoryById(id: string): { category: CategoryItem, parent?: CategoryItem } | null {
  for (const parent of AVITO_CATEGORIES) {
    if (parent.id === id) return { category: parent };
    if (parent.subcategories) {
      for (const child of parent.subcategories) {
        if (child.id === id) return { category: child, parent };
      }
    }
  }
  return null;
}
