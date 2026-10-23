import { en, type Messages } from './en.ts';
import { ptBR } from './pt-BR.ts';

export type { Messages };
export type Locale = 'en' | 'pt-BR';

const LOCALES: Record<Locale, Messages> = { en, 'pt-BR': ptBR };

export function detectLocale(languages: readonly string[]): Locale {
  return languages.some((language) => language.toLowerCase().startsWith('pt')) ? 'pt-BR' : 'en';
}

export function messagesFor(locale: Locale): Messages {
  return LOCALES[locale];
}

/** Fills `{name}`-style placeholders. Unknown placeholders are left out. */
export function format(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? ''));
}

export const messages: Messages = messagesFor(
  detectLocale(typeof navigator === 'undefined' ? [] : navigator.languages),
);
export const locale: Locale = messages === ptBR ? 'pt-BR' : 'en';
