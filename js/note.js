import { prepareAudio, playNote, midiToHz } from './audio.js';
import { mountResult, pickRank } from './result.js';
import { pickRandom, wait } from './util.js';

const QUESTION_COUNT = 10;
// 真ん中のド（C4）から始まる1オクターブ
const C4_MIDI = 60;
const NOTE_NAMES = ['ド', 'ド♯', 'レ', 'レ♯', 'ミ', 'ファ', 'ファ♯', 'ソ', 'ソ♯', 'ラ', 'ラ♯', 'シ'];
const BLACK_KEY_INDEXES = [1, 3, 6, 8, 10];
const NOTE_SEC = 1.2;
const KEY_FLASH_MS = 200;
const NEXT_QUESTION_DELAY_MS = 1200;

// 白鍵だけなら当てずっぽうでも 10問中 1〜2問は当たるので、それより上を段階づける
const RANKS = [
  { max: 2, label: 'ここから伸びる' },
  { max: 4, label: 'いい勘してる' },
  { max: 7, label: 'いい耳' },
  { max: 9, label: 'ほぼ絶対音感' },
  { max: 10, label: '絶対音感' },
];

const isBlackKey = (noteIndex) => BLACK_KEY_INDEXES.includes(noteIndex);

function buildKeyboard(container) {
  let whiteKeyCount = 0;
  return NOTE_NAMES.map((name, noteIndex) => {
    const key = document.createElement('button');
    key.type = 'button';
    key.textContent = name;
    if (isBlackKey(noteIndex)) {
      key.className = 'key key-black';
      // 黒鍵は直前の白鍵と次の白鍵の境目に置く
      key.style.setProperty('--boundary', String(whiteKeyCount));
    } else {
      key.className = 'key key-white';
      whiteKeyCount += 1;
    }
    container.append(key);
    return key;
  });
}

export function initNoteGame(panel) {
  const startButton = panel.querySelector('[data-note-start]');
  const replayButton = panel.querySelector('[data-note-replay]');
  const modeInputs = panel.querySelectorAll('input[name="note-mode"]');
  const countOutput = panel.querySelector('[data-note-count]');
  const scoreOutput = panel.querySelector('[data-note-score]');
  const feedback = panel.querySelector('[data-feedback]');
  const errorMessage = panel.querySelector('[data-error]');
  const keys = buildKeyboard(panel.querySelector('[data-note-keyboard]'));
  const result = mountResult(panel.querySelector('[data-result-slot]'), {
    gameId: 'note',
    gameTitle: 'ドレミあて',
    onRetry: () => start(),
  });

  let ctx = null;
  let questionNumber = 0;
  let score = 0;
  let answerNoteIndex = null;
  let isAwaitingAnswer = false;
  let isRunning = false;
  let sessionId = 0;

  const isWhiteOnly = () => panel.querySelector('input[name="note-mode"]:checked').value === 'white';
  const playableNoteIndexes = () => NOTE_NAMES.map((_, index) => index).filter((index) => !isWhiteOnly() || !isBlackKey(index));

  function renderKeyAvailability() {
    keys.forEach((key, noteIndex) => (key.disabled = isWhiteOnly() && isBlackKey(noteIndex)));
  }

  function renderStatus() {
    countOutput.value = String(questionNumber);
    scoreOutput.value = String(score);
  }

  function flashKey(noteIndex, className) {
    keys[noteIndex].classList.add(className);
    setTimeout(() => keys[noteIndex].classList.remove(className), className === 'is-pressed' ? KEY_FLASH_MS : NEXT_QUESTION_DELAY_MS);
  }

  function playAnswerNote() {
    playNote(ctx, midiToHz(C4_MIDI + answerNoteIndex), { durationSec: NOTE_SEC });
  }

  function nextQuestion() {
    questionNumber += 1;
    answerNoteIndex = pickRandom(playableNoteIndexes());
    renderStatus();
    feedback.textContent = `第${questionNumber}問。この音は？`;
    isAwaitingAnswer = true;
    replayButton.disabled = false;
    playAnswerNote();
  }

  function finish() {
    isRunning = false;
    replayButton.disabled = true;
    modeInputs.forEach((input) => (input.disabled = false));
    feedback.textContent = '';
    result.show({
      big: `${score} / ${QUESTION_COUNT}`,
      rank: pickRank(score, RANKS),
      details: [`モード: ${isWhiteOnly() ? '白鍵だけ（7音）' : '12音ぜんぶ'}`, '基準は ラ ＝ 440 Hz'],
    });
  }

  async function answer(noteIndex) {
    const currentSession = sessionId;
    isAwaitingAnswer = false;
    replayButton.disabled = true;
    const isCorrect = noteIndex === answerNoteIndex;
    if (isCorrect) score += 1;
    renderStatus();
    flashKey(answerNoteIndex, 'is-correct');
    const correctName = NOTE_NAMES[answerNoteIndex];
    feedback.textContent = isCorrect ? `正解！ ${correctName}でした。` : `ざんねん、正解は ${correctName} でした。`;
    await wait(NEXT_QUESTION_DELAY_MS);
    if (currentSession !== sessionId) return;
    if (questionNumber === QUESTION_COUNT) {
      finish();
      return;
    }
    nextQuestion();
  }

  // クイズ中でなければ、鍵盤は自由に弾ける
  function pressKey(noteIndex) {
    if (!ctx || keys[noteIndex].disabled) return;
    playNote(ctx, midiToHz(C4_MIDI + noteIndex), { durationSec: 0.8 });
    flashKey(noteIndex, 'is-pressed');
    if (isAwaitingAnswer) answer(noteIndex);
  }

  async function start() {
    ctx = await prepareAudio(errorMessage);
    if (!ctx) return;
    sessionId += 1;
    isRunning = true;
    questionNumber = 0;
    score = 0;
    startButton.hidden = true;
    modeInputs.forEach((input) => (input.disabled = true));
    result.hide();
    nextQuestion();
    // 押したスタートボタンが消えてフォーカスを見失わないよう、次に押す場所へ移す
    keys[0].focus();
  }

  keys.forEach((key, noteIndex) =>
    key.addEventListener('click', async () => {
      ctx ??= await prepareAudio(errorMessage);
      pressKey(noteIndex);
    }),
  );
  startButton.addEventListener('click', start);
  replayButton.addEventListener('click', playAnswerNote);
  modeInputs.forEach((input) => input.addEventListener('change', renderKeyAvailability));

  renderKeyAvailability();
  renderStatus();
  replayButton.disabled = true;

  return {
    stop() {
      sessionId += 1;
      if (!isRunning) return;
      isRunning = false;
      isAwaitingAnswer = false;
      replayButton.disabled = true;
      startButton.hidden = false;
      modeInputs.forEach((input) => (input.disabled = false));
      feedback.textContent = '';
    },
  };
}
