import idLocale from './locales/id.json' with { type: 'json' };
import enLocale from './locales/en.json' with { type: 'json' };

export type Locale = 'id' | 'en';
export type LocaleSchema = typeof idLocale;

export const locales: Record<Locale, LocaleSchema> = {
  id: idLocale,
  en: enLocale,
};

let currentLocale: Locale = 'en';

export function setLocale(locale: Locale) {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

export function t(): LocaleSchema {
  return locales[currentLocale];
}

export { idLocale, enLocale };
