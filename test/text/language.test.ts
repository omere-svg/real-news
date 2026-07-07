import { describe, expect, it } from 'vitest';
import { looksNonEnglish } from '../../src/text/language.js';

describe('looksNonEnglish', () => {
  it('flags non-Latin scripts as not English', () => {
    expect(looksNonEnglish('В Литве запретили предвыборные программы')).toBe(true); // Cyrillic
    expect(looksNonEnglish('Цього року на саміт НАТО приїде Зеленський')).toBe(true); // Ukrainian
    expect(looksNonEnglish('בחירות חדשות בישראל')).toBe(true); // Hebrew
    expect(looksNonEnglish('中国经济增长放缓')).toBe(true); // Han
    expect(looksNonEnglish('東京で地震が発生')).toBe(true); // Japanese
    expect(looksNonEnglish('Η Ελλάδα ψηφίζει')).toBe(true); // Greek
  });

  it('flags accented Latin text (Spanish/French/… foreign languages)', () => {
    expect(looksNonEnglish('Elección presidencial en Perú definió al próximo gobierno')).toBe(true);
    expect(looksNonEnglish('Le président français annonce des réformes économiques')).toBe(true);
  });

  it('leaves plain-ASCII English headlines alone', () => {
    expect(looksNonEnglish('Sodium-ion batteries will revolutionize grid storage')).toBe(false);
    expect(looksNonEnglish("Peru's election determines who will lead the government")).toBe(false);
    expect(looksNonEnglish('')).toBe(false);
  });

  it('does not trip on non-letter symbols in an English headline', () => {
    // Curly quotes, em-dash, currency, and degree signs are not letters.
    expect(looksNonEnglish('AI — “the year ahead”: Q4 earnings up 3° and €2bn')).toBe(false);
  });

  it('escalates an English headline with an accented proper noun (a cheap, harmless call)', () => {
    // We accept this false positive: the translation prompt leaves English alone.
    expect(looksNonEnglish('Beyoncé announces a world tour starting in Zürich')).toBe(true);
  });
});
