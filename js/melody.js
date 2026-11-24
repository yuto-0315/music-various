import { prepareAudio, playNote } from './audio.js';
import { midiToHz } from './music.js';
import { mountResult, pickRank } from './result.js';
import { randomInt, wait } from './util.js';

// ド・レ・ミ・ソ・ラ（ヨナ抜き音階）。どんな順に並んでも濁らず、メロディらしく聞こえる
const PAD_MIDIS = [72, 74, 76, 79, 81];
const NOTE_SEC = 0.5;
const PAD_LIGHT_MS = 300;
// 長くなるほど少しずつテンポを上げて、後半の緊張感を出す。速すぎると聞き取れないので下限を設ける
const START_STEP_MS = 560;
const MIN_STEP_MS = 320;
const STEP_SPEEDUP_MS = 16;
const ROUND_CLEAR_DELAY_MS = 800;

const RANKS = [
  { max: 3, label: 'ウォームアップ中' },
  { max: 6, label: 'いい記憶力' },
  { max: 9, label: '作曲家の頭' },
  { max: 14, label: '記憶の鬼' },
  { max: Infinity, label: '人間レコーダー' },
];

export function initMelodyGame(panel) {
  const startButton = panel.querySelector('[data-melody-start]');
  const pads = [...panel.querySelectorAll('[data-melody-pad]')];
  const lengthOutput = panel.querySelector('[data-melody-length]');
  const feedback = panel.querySelector('[data-feedback]');
  const errorMessage = panel.querySelector('[data-error]');
  const result = mountResult(panel.querySelector('[data-result-slot]'), {
    gameId: 'melody',
    gameTitle: 'メロディ記憶',
    onRetry: () => start(),
  });

  let ctx = null;
  let melody = [];
  let inputPosition = 0;
  let isListening = false;
  let isRunning = false;
  let sessionId = 0;

  function sound(padIndex) {
    playNote(ctx, midiToHz(PAD_MIDIS[padIndex]), { durationSec: NOTE_SEC });
    pads[padIndex].classList.add('is-lit');
    setTimeout(() => pads[padIndex].classList.remove('is-lit'), PAD_LIGHT_MS);
  }

  function setYourTurn(isYourTurn) {
    isListening = isYourTurn;
    panel.classList.toggle('is-demo', isRunning && !isYourTurn);
  }

  async function playMelody() {
    const currentSession = sessionId;
    setYourTurn(false);
    feedback.textContent = 'よく聞いて…';
    const stepMs = Math.max(MIN_STEP_MS, START_STEP_MS - melody.length * STEP_SPEEDUP_MS);
    await wait(400);
    for (const padIndex of melody) {
      if (currentSession !== sessionId) return;
      sound(padIndex);
      await wait(stepMs);
    }
    if (currentSession !== sessionId) return;
    inputPosition = 0;
    feedback.textContent = 'あなたの番です。';
    setYourTurn(true);
  }

  function addNoteAndPlay() {
    melody.push(randomInt(0, PAD_MIDIS.length - 1));
    lengthOutput.value = String(melody.length);
    playMelody();
  }

  function finish() {
    isRunning = false;
    setYourTurn(false);
    const clearedLength = melody.length - 1;
    feedback.textContent = '';
    result.show({
      big: `${clearedLength} 音`,
      rank: pickRank(clearedLength, RANKS),
      details: [`${clearedLength} 音のメロディまで覚えられた`],
    });
  }

  async function pressPad(padIndex) {
    ctx ??= await prepareAudio(errorMessage);
    if (!ctx) return;
    sound(padIndex);
    // ゲーム中でなければ、パッドは自由に鳴らせる
    if (!isListening) return;
    if (padIndex !== melody[inputPosition]) {
      finish();
      return;
    }
    inputPosition += 1;
    if (inputPosition < melody.length) return;
    const currentSession = sessionId;
    setYourTurn(false);
    feedback.textContent = 'いいね！ 1音ふえます。';
    await wait(ROUND_CLEAR_DELAY_MS);
    if (currentSession === sessionId) addNoteAndPlay();
  }

  async function start() {
    ctx = await prepareAudio(errorMessage);
    if (!ctx) return;
    sessionId += 1;
    isRunning = true;
    melody = [];
    startButton.hidden = true;
    result.hide();
    addNoteAndPlay();
    // 押したスタートボタンが消えてフォーカスを見失わないよう、次に押す場所へ移す
    pads[0].focus();
  }

  pads.forEach((pad, padIndex) => pad.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    pressPad(padIndex);
  }));
  // キーボード操作（Enter / Space）でも押せるように。pointerdown と二重にならないよう detail で判定する
  pads.forEach((pad, padIndex) => pad.addEventListener('click', (event) => event.detail === 0 && pressPad(padIndex)));
  startButton.addEventListener('click', start);

  return {
    stop() {
      sessionId += 1;
      if (!isRunning) return;
      isRunning = false;
      setYourTurn(false);
      startButton.hidden = false;
      feedback.textContent = '';
    },
    handleKey(event) {
      const padIndex = Number(event.key) - 1;
      if (Number.isInteger(padIndex) && padIndex >= 0 && padIndex < pads.length) pressPad(padIndex);
    },
  };
}
