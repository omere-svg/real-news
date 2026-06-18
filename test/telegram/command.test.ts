import { describe, expect, it } from 'vitest';
import { parseCommand } from '../../src/telegram/command.js';

describe('parseCommand', () => {
  it('parses bare commands', () => {
    expect(parseCommand('/start')).toEqual({ kind: 'start' });
    expect(parseCommand('/help')).toEqual({ kind: 'help' });
    expect(parseCommand('/brief')).toEqual({ kind: 'brief' });
    expect(parseCommand('/podcast')).toEqual({ kind: 'podcast' });
  });

  it('parses a minutes argument for brief and podcast', () => {
    expect(parseCommand('/brief 10')).toEqual({ kind: 'brief', minutes: 10 });
    expect(parseCommand('/podcast 20')).toEqual({ kind: 'podcast', minutes: 20 });
  });

  it('ignores a non-numeric minutes argument', () => {
    expect(parseCommand('/brief soon')).toEqual({ kind: 'brief' });
  });

  it('strips a @botname suffix (group chats)', () => {
    expect(parseCommand('/brief@HorizonBot 5')).toEqual({ kind: 'brief', minutes: 5 });
  });

  it('parses outline with a topic and optional minutes', () => {
    expect(parseCommand('/outline AI')).toEqual({ kind: 'outline', topic: 'AI' });
    expect(parseCommand('/outline Geopolitics 12')).toEqual({
      kind: 'outline',
      topic: 'Geopolitics',
      minutes: 12,
    });
    expect(parseCommand('/outline')).toEqual({ kind: 'outline' });
  });

  it('parses preference commands', () => {
    expect(parseCommand('/prefs')).toEqual({ kind: 'prefsShow' });
    expect(parseCommand('/prefs clear')).toEqual({ kind: 'prefsClear' });
    expect(parseCommand('/prefs topics AI,Geopolitics')).toEqual({
      kind: 'prefsSet',
      field: 'topics',
      value: 'AI,Geopolitics',
    });
    expect(parseCommand('/prefs minutes 15')).toEqual({
      kind: 'prefsSet',
      field: 'minutes',
      value: '15',
    });
    expect(parseCommand('/prefs regions Israel')).toEqual({
      kind: 'prefsSet',
      field: 'regions',
      value: 'Israel',
    });
  });

  it('treats an unknown or empty input as unknown', () => {
    expect(parseCommand('hello there')).toEqual({ kind: 'unknown', text: 'hello there' });
    expect(parseCommand('/wat')).toEqual({ kind: 'unknown', text: '/wat' });
    expect(parseCommand('   ')).toEqual({ kind: 'unknown', text: '   ' });
  });

  it('parses /feedback with free text, and /feedback undo as its own command', () => {
    expect(parseCommand('/feedback more AI, less sports, shorter')).toEqual({
      kind: 'feedback',
      text: 'more AI, less sports, shorter',
    });
    expect(parseCommand('/feedback undo')).toEqual({ kind: 'feedbackUndo' });
    expect(parseCommand('/feedback UNDO')).toEqual({ kind: 'feedbackUndo' });
    // "undo" inside a longer sentence is feedback text, not the undo command.
    expect(parseCommand('/feedback undo the sports thing please')).toEqual({
      kind: 'feedback',
      text: 'undo the sports thing please',
    });
    expect(parseCommand('/feedback')).toEqual({ kind: 'feedback', text: '' });
  });
});
