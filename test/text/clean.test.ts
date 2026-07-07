import { describe, expect, it } from 'vitest';
import { collapseWhitespace } from '../../src/text/clean.js';

describe('collapseWhitespace — punctuation-spacing cleanup', () => {
  it('collapses a space before a comma (tokenizer artifact)', () => {
    expect(collapseWhitespace('Europe , leading the world')).toBe('Europe, leading the world');
  });

  it('collapses a space before a colon', () => {
    expect(collapseWhitespace('Results : strong growth')).toBe('Results: strong growth');
  });

  it('collapses a space before other punctuation (period, semicolon, exclamation, question mark)', () => {
    expect(collapseWhitespace('Wait . Stop ; Really ! Sure ?')).toBe('Wait. Stop; Really! Sure?');
  });

  it('collapses doubled/runs of whitespace as before', () => {
    expect(collapseWhitespace('Boğazı  nda   köprüsü')).toBe('Boğazı nda köprüsü');
  });

  it('still trims leading/trailing whitespace', () => {
    expect(collapseWhitespace('  hello  ')).toBe('hello');
  });
});
