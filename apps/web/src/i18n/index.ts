import { en } from "./messages/en";

/**
 * Single locale registry (Req 4.3). English is the only enabled locale (Req 4.1);
 * enabling another locale = add its catalog here and to `locales`. Nothing outside this
 * module may hard-code a locale code.
 */
export const defaultLocale = "en" as const;
export const locales = [defaultLocale] as const;
export type Locale = (typeof locales)[number];
type StringCatalog<T> = { [K in keyof T]: T[K] extends string ? string : StringCatalog<T[K]> };
export type Messages = StringCatalog<typeof en>;

const catalogs: Record<Locale, Messages> = { en };

/** Locale prefixes that are routed under `app/[locale]/...` (the default locale stays unprefixed). */
export const prefixedLocales: readonly Locale[] = locales.filter((locale) => locale !== defaultLocale);

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

export function isPrefixedLocale(value: string): value is Locale {
  return (prefixedLocales as readonly string[]).includes(value);
}

export function getMessages(locale: Locale): Messages {
  return catalogs[locale];
}

export function localePath(locale: Locale, path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (!isPrefixedLocale(locale)) return normalized;
  return `/${locale}${normalized === "/" ? "" : normalized}`;
}

/** Resolves the locale for an incoming pathname; unknown or default-locale prefixes stay on the default. */
export function localeFromPathname(pathname: string): Locale {
  const segment = pathname.split("/")[1] ?? "";
  return isPrefixedLocale(segment) ? segment : defaultLocale;
}
