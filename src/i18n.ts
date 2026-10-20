// English is required by Playables certification; Turkish is picked from ytgame.system.getLanguage().
// Never read navigator.language: certification forbids it.

const en = {
  langTag: 'en',
  botNames: ['Ali', 'Ayşe', 'Can'],
  tiles: (n: number) => `${n} tiles`,
  pile: 'Pile',
  indicator: 'Indicator',
  finish: 'Finish',
  drawPrompt: 'Your turn: draw from the pile or take the tile on your left',
  discardPrompt: 'Discard a tile on the right, or drop it on Finish to win',
  waiting: (name: string) => `${name} is thinking…`,
  invalidFinish: 'That hand is not complete yet',
  sortRuns: 'Sort runs',
  sortPairs: 'Sort pairs',
  stats: (won: number, played: number) => `Won ${won} of ${played}`,
  youWon: 'You won!',
  someoneWon: (name: string) => `${name} won`,
  drawnRound: 'No tiles left. Nobody wins.',
  bySets: 'Finished with runs and sets',
  byPairs: 'Finished with pairs',
  nextHand: 'Next hand',
  colors: { red: 'Red', yellow: 'Yellow', blue: 'Blue', black: 'Black' },
  fakeOkey: 'Fake okey',
  okey: 'okey, wild',
  emptyDiscard: 'Empty',
  takeDiscard: (tile: string) => `Take ${tile}`,
  discardHere: 'Discard here',
};

export type Strings = typeof en;

const tr: Strings = {
  langTag: 'tr',
  botNames: ['Ali', 'Ayşe', 'Can'],
  tiles: (n) => `${n} taş`,
  pile: 'Orta',
  indicator: 'Gösterge',
  finish: 'Bitir',
  drawPrompt: 'Sıra sende: ortadan taş çek ya da soldaki taşı al',
  discardPrompt: 'Sağa bir taş at ya da bitirmek için Bitir’e bırak',
  waiting: (name) => `${name} düşünüyor…`,
  invalidFinish: 'Bu el henüz bitmiyor',
  sortRuns: 'Seri diz',
  sortPairs: 'Çift diz',
  stats: (won, played) => `Kazanılan: ${won}/${played}`,
  youWon: 'Kazandın!',
  someoneWon: (name) => `${name} kazandı`,
  drawnRound: 'Taşlar bitti, kazanan yok',
  bySets: 'Perlerle bitirildi',
  byPairs: 'Çiftten bitirildi',
  nextHand: 'Sonraki el',
  colors: { red: 'Kırmızı', yellow: 'Sarı', blue: 'Mavi', black: 'Siyah' },
  fakeOkey: 'Sahte okey',
  okey: 'okey',
  emptyDiscard: 'Boş',
  takeDiscard: (tile) => `${tile} al`,
  discardHere: 'Buraya at',
};

export function pickStrings(language: string): Strings {
  return language.toLowerCase().startsWith('tr') ? tr : en;
}
