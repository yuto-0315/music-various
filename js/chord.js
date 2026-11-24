import { prepareAudio, playNote, midiToHz } from './audio.js';
import { mountResult, pickRank } from './result.js';
import { randomInt, average, wait } from './util.js';

const QUESTION_COUNT = 10;
// E3〜E4 あたりの根音。低すぎると濁り、高すぎると明暗が分かりにくい
const MIN_ROOT_MIDI = 52;
const MAX_ROOT_MIDI = 64;
const CHORD_TYPES = {
  major: { label: '明るい（メジャー）', intervals: [0, 4, 7] },
  minor: { label: '暗い（マイナー）', intervals: [0, 3, 7] },
};
// 下から順に少しずらして鳴らすと、ギターのストロークのように自然に聞こえる
const STRUM_SEC = 0.04;
const CHORD_SEC = 1.6;
const NEXT_QUESTION_DELAY_MS = 900;

const RANKS = [
  { max: 4, label: 'ここから伸びる' },
  { max: 6, label: 'なんとなく分かる' },
  { max: 8, label: 'いい耳' },
  { max: 9, label: '和音マスター' },
  { max: 10, label: '全問正解' },
];

export function initChordGame(panel) {
  const startButton = panel.querySelector('[data-chord-start]');
  const replayButton = panel.querySelector('[data-chord-replay]');
  const choiceButtons = [...panel.querySelectorAll('[data-chord-choice]')];
  const countOutput = panel.querySelector('[data-chord-count]');
  const scoreOutput = panel.querySelector('[data-chord-score]');
  const feedback = panel.querySelector('[data-feedback]');
  const errorMessage = panel.querySelector('[data-error]');
  const result = mountResult(panel.querySelector('[data-result-slot]'), {
    gameId: 'chord',
    gameTitle: '明るい？暗い？',
    onRetry: () => start(),
  });

  let ctx = null;
  let questionNumber = 0;
  let score = 0;
  let question = null;
  let questionStartedMs = 0;
  let answerTimesMs = [];
  let isAwaitingAnswer = false;
  let isRunning = false;
  let sessionId = 0;

  function renderStatus() {
    countOutput.value = String(questionNumber);
    scoreOutput.value = String(score);
  }

  function setChoicesEnabled(enabled) {
    isAwaitingAnswer = enabled;
    choiceButtons.forEach((button) => (button.disabled = !enabled));
    replayButton.disabled = !enabled;
  }

  function playChord() {
    const startSec = ctx.currentTime + 0.02;
    CHORD_TYPES[question.type].intervals.forEach((interval, index) => {
      playNote(ctx, midiToHz(question.rootMidi + interval), {
        startSec: startSec + index * STRUM_SEC,
        durationSec: CHORD_SEC,
        gain: 0.16,
      });
    });
  }

  function nextQuestion() {
    questionNumber += 1;
    question = { type: Math.random() < 0.5 ? 'major' : 'minor', rootMidi: randomInt(MIN_ROOT_MIDI, MAX_ROOT_MIDI) };
    renderStatus();
    feedback.textContent = `第${questionNumber}問`;
    setChoicesEnabled(true);
    questionStartedMs = performance.now();
    playChord();
  }

  function finish() {
    isRunning = false;
    setChoicesEnabled(false);
    feedback.textContent = '';
    result.show({
      big: `${score} / ${QUESTION_COUNT}`,
      rank: pickRank(score, RANKS),
      details: [`平均回答時間 ${(average(answerTimesMs) / 1000).toFixed(1)} 秒`],
    });
  }

  async function answer(type) {
    if (!isAwaitingAnswer) return;
    const currentSession = sessionId;
    answerTimesMs.push(performance.now() - questionStartedMs);
    setChoicesEnabled(false);
    const isCorrect = type === question.type;
    if (isCorrect) score += 1;
    renderStatus();
    const correctLabel = CHORD_TYPES[question.type].label;
    feedback.textContent = isCorrect ? `正解！ ${correctLabel}でした。` : `ざんねん、${correctLabel}でした。`;
    await wait(NEXT_QUESTION_DELAY_MS);
    if (currentSession !== sessionId) return;
    if (questionNumber === QUESTION_COUNT) {
      finish();
      return;
    }
    nextQuestion();
  }

  async function start() {
    ctx = await prepareAudio(errorMessage);
    if (!ctx) return;
    sessionId += 1;
    isRunning = true;
    questionNumber = 0;
    score = 0;
    answerTimesMs = [];
    startButton.hidden = true;
    result.hide();
    nextQuestion();
    // 押したスタートボタンが消えてフォーカスを見失わないよう、次に押す場所へ移す
    choiceButtons[0].focus();
  }

  startButton.addEventListener('click', start);
  replayButton.addEventListener('click', playChord);
  choiceButtons.forEach((button) => button.addEventListener('click', () => answer(button.dataset.chordChoice)));

  setChoicesEnabled(false);
  renderStatus();

  return {
    stop() {
      sessionId += 1;
      if (!isRunning) return;
      isRunning = false;
      setChoicesEnabled(false);
      startButton.hidden = false;
      feedback.textContent = '';
    },
    handleKey(event) {
      const type = { 1: 'major', 2: 'minor' }[event.key];
      if (type) answer(type);
    },
  };
}
