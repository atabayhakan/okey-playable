import { describe, expect, it } from 'vitest';
import { LANGUAGES, pickStrings, type Strings } from '../src/i18n';

const en = LANGUAGES.en;

/** Every string a language has, with its path: plain strings, lists, groups, and what the functions say for sample arguments. */
function everyText(strings: Strings): [string, string][] {
  const out: [string, string][] = [];
  // Only hintShown takes null (nothing to say about how far from winning); the others are given what they are.
  const argSets: unknown[][] = [[3, 2, 1, 4], ['Ali', 'Ali'], [true, true], [false, false], [0], [1]];
  const walk = (value: unknown, path: string): void => {
    if (typeof value === 'string') out.push([path, value]);
    else if (typeof value === 'function') {
      // Only argument lists that give the function everything it takes.
      for (const args of argSets.filter((a) => a.length >= (value as () => unknown).length)) {
        try {
          const said = (value as (...a: unknown[]) => unknown)(...args);
          if (typeof said === 'string') out.push([`${path}(${args.join(',')})`, said]);
        } catch {
          /* these arguments are not for this function */
        }
      }
    } else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`));
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
  };
  walk(strings, '');
  return out;
}

describe('the languages', () => {
  const languages = Object.entries(LANGUAGES);

  it('are English, Turkish, German, Dutch and Azerbaijani, each tagged with its own code', () => {
    expect(Object.keys(LANGUAGES).sort()).toEqual(['az', 'de', 'en', 'nl', 'tr']);
    for (const [code, strings] of languages) expect(strings.langTag).toBe(code);
  });

  for (const [code, strings] of languages) {
    describe(code, () => {
      const texts = everyText(strings);

      it('has no empty text, no broken placeholder and no mangled characters', () => {
        for (const [path, text] of texts) {
          expect(text.trim(), path).not.toBe('');
          expect(text, path).not.toMatch(/undefined|NaN|\[object|\bnull\b/);
          // What a file read in the wrong encoding looks like.
          expect(text, path).not.toMatch(/Ã|Â|â€|�/);
        }
      });

      it('puts a name, a count or a tile into the texts that are given one', () => {
        expect(strings.waiting('Ali')).toContain('Ali');
        expect(strings.someoneWon('Ali')).toContain('Ali');
        expect(strings.indicatorShownBy('Ali')).toContain('Ali');
        expect(strings.takeDiscard('Red 7')).toContain('Red 7');
        expect(strings.matchOverOther('Ali and Can')).toContain('Ali and Can');
        expect(strings.matchRule(20)).toContain('20');
        expect(strings.tiles(14)).toContain('14');
        expect(strings.statTurns(7)).toContain('7');
        expect(strings.hintShown(3)).toContain('3');
        expect(strings.lifetime(5, 9, 1, 2)).toMatch(/5.*9.*1.*2/);
      });

      it('tells a win with pairs from one with sets, and an okey finish from a plain one', () => {
        const said = new Set([strings.finishedWith(true, false), strings.finishedWith(false, false), strings.finishedWith(true, true), strings.finishedWith(false, true)]);
        expect(said.size).toBe(4);
        expect(new Set([strings.hintShown(null), strings.hintShown(0), strings.hintShown(1)]).size).toBe(3);
        expect(strings.hintShown(null)).not.toMatch(/undefined|NaN|\[object|\bnull\b/);
      });

      // The first-hand guide has about 70 px of status bar on a 320 px phone: two lines of about eleven
      // characters, and a third line is cut. The layout check looks at the first step on a real page; this
      // wraps all four the way a browser would, word by word, so a step cannot be written too long.
      it('keeps the first-hand guide short enough for the status bar: two lines of eleven characters', () => {
        const lines = (text: string, width: number): number => {
          let count = 1;
          let used = 0;
          for (const word of text.split(' ')) {
            if (word.length > width) return Infinity;
            if (used && used + 1 + word.length > width) {
              count++;
              used = word.length;
            } else used += (used ? 1 : 0) + word.length;
          }
          return count;
        };
        for (const step of [strings.tourPick, strings.tourDrop, strings.tourDraw, strings.tourGoal]) expect(lines(step, 11), step).toBeLessThanOrEqual(2);
      });

      it('names four colours, three levels and the table seats', () => {
        expect(new Set(Object.values(strings.colors)).size).toBe(4);
        expect(new Set(Object.values(strings.difficulty)).size).toBe(3);
        expect(new Set(Object.values(strings.matchLength)).size).toBe(3);
        expect(strings.botNames).toHaveLength(3);
        expect(strings.scoreHeader).toHaveLength(3);
      });
    });
  }

  it('are translated, not copied from English', () => {
    // The game's title and a few words that really are the same in another language ("Match" in German,
    // "Menu", "Indicator" and "Hand" in Dutch) are the same; the rest is not.
    const shared = ['langTag', 'gameTitle', 'matchLengthLabel', 'menu', 'indicator', 'handValue'];
    for (const [code, strings] of languages) {
      if (code === 'en') continue;
      const same = Object.keys(en).filter((key) => {
        const a = (en as Record<string, unknown>)[key];
        const b = (strings as Record<string, unknown>)[key];
        return typeof a === 'string' && a === b;
      });
      expect(same.filter((k) => !shared.includes(k)), `${code} has English left`).toEqual([]);
    }
  });

  it('say 1 and 2 differently where the language does (tiles, turns)', () => {
    for (const code of ['en', 'de', 'nl']) {
      const s = LANGUAGES[code];
      expect(s.tiles(1), code).not.toBe(s.tiles(2).replace('2', '1'));
      expect(s.statTurns(1), code).not.toBe(s.statTurns(2).replace('2', '1'));
    }
  });
});

describe('picking a language', () => {
  it('goes by the first part of the tag, however the platform spells it', () => {
    for (const [tag, code] of [
      ['tr', 'tr'], ['tr-TR', 'tr'], ['TR', 'tr'],
      ['de', 'de'], ['de-AT', 'de'], ['de_CH', 'de'],
      ['nl', 'nl'], ['nl-BE', 'nl'],
      ['az', 'az'], ['az-Latn-AZ', 'az'],
      ['en', 'en'], ['en-GB', 'en'],
    ] as const) {
      expect(pickStrings(tag).langTag, tag).toBe(code);
    }
  });

  it('falls back to English for a language the game does not have, and for nothing', () => {
    for (const tag of ['fr', 'ja-JP', 'zh-Hans', '', 'x', 'deutsch']) expect(pickStrings(tag).langTag, tag).toBe('en');
  });
});
