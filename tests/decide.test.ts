import { describe, expect, it } from 'vitest';
import { buildSortCommand, cleanAddress, verdictForScore } from '../src/decide';

describe('verdictForScore', () => {
  it('calls a score at or above the threshold healthy', () => {
    expect(verdictForScore(6, 6)).toBe('healthy');
    expect(verdictForScore(10, 6)).toBe('healthy');
    expect(verdictForScore(7, 7)).toBe('healthy');
  });

  it('calls a score below the threshold junk', () => {
    expect(verdictForScore(5, 6)).toBe('junk');
    expect(verdictForScore(0, 6)).toBe('junk');
    expect(verdictForScore(9, 10)).toBe('junk');
  });

  it('works when the threshold is changed in Settings', () => {
    expect(verdictForScore(4, 4)).toBe('healthy');
    expect(verdictForScore(4, 8)).toBe('junk');
  });
});

describe('buildSortCommand', () => {
  it('builds the exact request for the board', () => {
    expect(buildSortCommand('192.168.43.50', 'healthy', 7)).toEqual({
      method: 'POST',
      url: 'http://192.168.43.50/sort',
      body: { side: 'healthy', score: 7 },
    });
  });

  it('builds the junk command with a hostname', () => {
    const command = buildSortCommand('food-sorter.local', 'junk', 2);
    expect(command.url).toBe('http://food-sorter.local/sort');
    expect(command.body).toEqual({ side: 'junk', score: 2 });
  });

  it('cleans the address before building the URL', () => {
    const command = buildSortCommand('http://192.168.43.50/', 'healthy', 9);
    expect(command.url).toBe('http://192.168.43.50/sort');
  });
});

describe('cleanAddress', () => {
  it('keeps a plain IP or hostname', () => {
    expect(cleanAddress('192.168.43.50')).toBe('192.168.43.50');
    expect(cleanAddress('food-sorter.local')).toBe('food-sorter.local');
  });

  it('strips http:// and https://', () => {
    expect(cleanAddress('http://192.168.43.50')).toBe('192.168.43.50');
    expect(cleanAddress('https://food-sorter.local')).toBe('food-sorter.local');
  });

  it('strips trailing slashes and spaces', () => {
    expect(cleanAddress('192.168.43.50/')).toBe('192.168.43.50');
    expect(cleanAddress('http://food-sorter.local///')).toBe('food-sorter.local');
    expect(cleanAddress('  192.168.43.50  ')).toBe('192.168.43.50');
  });
});
