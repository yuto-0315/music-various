import { initPitchGame } from './pitch.js';
import { initHigherGame } from './higher.js';
import { initMosquitoGame } from './mosquito.js';
import { initNoteGame } from './note.js';
import { initChordGame } from './chord.js';
import { initBpmGame } from './bpm.js';
import { initTapGame } from './tap.js';
import { initTimingGame } from './timing.js';
import { initMelodyGame } from './melody.js';

const GAME_INITIALIZERS = {
  pitch: initPitchGame,
  higher: initHigherGame,
  mosquito: initMosquitoGame,
  note: initNoteGame,
  chord: initChordGame,
  bpm: initBpmGame,
  tap: initTapGame,
  timing: initTimingGame,
  melody: initMelodyGame,
};

const home = document.getElementById('home');
const backNav = document.getElementById('back-nav');
const panels = Object.fromEntries(
  Object.keys(GAME_INITIALIZERS).map((gameId) => [gameId, document.getElementById(`game-${gameId}`)]),
);
const games = Object.fromEntries(
  Object.entries(GAME_INITIALIZERS).map(([gameId, init]) => [gameId, init(panels[gameId])]),
);

let activeGameId = null;

function stopAllGames() {
  Object.values(games).forEach((game) => game.stop());
}

// URL のハッシュ（#pitch など）で画面を切り替える。ブラウザの「戻る」でも一覧に戻れる
function render() {
  const requestedId = location.hash.slice(1);
  const previousGameId = activeGameId;
  activeGameId = requestedId in games ? requestedId : null;
  stopAllGames();

  home.hidden = activeGameId !== null;
  backNav.hidden = activeGameId === null;
  for (const [gameId, panel] of Object.entries(panels)) panel.hidden = gameId !== activeGameId;

  const title = activeGameId ? panels[activeGameId].querySelector('h2').textContent : null;
  document.title = title ? `${title} | おとあて` : 'おとあて';

  window.scrollTo(0, 0);
  if (activeGameId) {
    panels[activeGameId].querySelector('h2').focus();
    return;
  }
  // 一覧に戻ったら、直前に遊んでいたゲームのカードにフォーカスを戻す
  if (previousGameId) home.querySelector(`a[href="#${previousGameId}"]`)?.focus();
}

window.addEventListener('hashchange', render);

document.addEventListener('keydown', (event) => {
  if (!activeGameId || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  games[activeGameId].handleKey?.(event);
});

// 別タブに切り替えたりスマホをロックしたりしたときに、音が鳴り続けないようにする
document.addEventListener('visibilitychange', () => document.hidden && stopAllGames());

render();
