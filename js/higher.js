import { prepareAudio, playNote } from './audio.js';
import { mountResult, pickRank } from './result.js';
import { randomInt, wait } from './util.js';

// 最初は半音（100cent）差。ほぼ全員が正解できるところから始めて、自信をつけてもらう
const START_DIFF_CENTS = 100;
const MIN_DIFF_CENTS = 0.5;
const MAX_DIFF_CENTS = 200;
// 正解で差を縮め、不正解で広げる（階段法）。縮める幅を小さくして、限界付近で何度も試せるようにする
const SHRINK_ON_CORRECT = 0.7;
const GROW_ON_WRONG = 1.5;
const LIVES = 3;
// 毎問の基準音を変えて、前の問題の音を覚えて答えることを防ぐ
const MIN_BASE_HZ = 330;
const MAX_BASE_HZ = 660;
const TONE_SEC = 0.45;
const GAP_SEC = 0.25;
const NEXT_QUESTION_DELAY_MS = 900;

const RANKS = [
  { max: 2, label: '測定器レベル' },
  { max: 5, label: '調律師の耳' },
  { max: 10, label: '鋭い耳' },
  { max: 25, label: 'いい耳' },
  { max: 50, label: 'ふつうの耳' },
  { max: Infinity, label: 'のびしろあり' },
];

export function initHigherGame(panel) {
  const startButton = panel.querySelector('[data-higher-start]');
  const replayButton = panel.querySelector('[data-higher-replay]');
  const choiceButtons = [...panel.querySelectorAll('[data-higher-choice]')];
  const diffOutput = panel.querySelector('[data-higher-diff]');
  const lifeList = panel.querySelector('[data-higher-lives]');
  const lifeText = panel.querySelector('[data-higher-lives-text]');
  const feedback = panel.querySelector('[data-feedback]');
  const errorMessage = panel.querySelector('[data-error]');
  const result = mountResult(panel.querySelector('[data-result-slot]'), {
    gameId: 'higher',
    gameTitle: '高いのはどっち？',
    onRetry: () => startGame(),
  });

  const lifeDots = Array.from({ length: LIVES }, () => document.createElement('li'));
  lifeList.append(...lifeDots);

  let ctx = null;
  let diffCents = START_DIFF_CENTS;
  let bestCents = null;
  let lives = LIVES;
  let correctCount = 0;
  let questionCount = 0;
  let question = null;
  let isRunning = false;
  let isAwaitingAnswer = false;
  // 画面を離れたり再スタートしたりしたときに、古い問題の続きが動かないようにするための番号
  let sessionId = 0;

  function renderStatus() {
    diffOutput.value = diffCents.toFixed(1);
    lifeDots.forEach((dot, index) => dot.classList.toggle('is-filled', index < lives));
    lifeText.textContent = `のこり ${lives} 回`;
  }

  function setChoicesEnabled(enabled) {
    isAwaitingAnswer = enabled;
    choiceButtons.forEach((button) => (button.disabled = !enabled));
    replayButton.disabled = !enabled;
  }

  async function playQuestion() {
    const currentSession = sessionId;
    const startSec = ctx.currentTime + 0.05;
    question.toneHz.forEach((hz, index) => {
      playNote(ctx, hz, { startSec: startSec + index * (TONE_SEC + GAP_SEC), durationSec: TONE_SEC, type: 'sine', gain: 0.22, decay: false });
    });
    // いま鳴っている音に対応するボタンを光らせ、「1つ目」「2つ目」の対応を分かりやすくする
    for (const button of choiceButtons) {
      if (currentSession !== sessionId) return;
      button.classList.add('is-sounding');
      await wait(TONE_SEC * 1000);
      button.classList.remove('is-sounding');
      await wait(GAP_SEC * 1000);
    }
  }

  function nextQuestion() {
    const baseHz = randomInt(MIN_BASE_HZ, MAX_BASE_HZ);
    const higherIndex = randomInt(0, 1);
    const shiftedHz = baseHz * 2 ** (diffCents / 1200);
    question = { higherIndex, toneHz: higherIndex === 0 ? [shiftedHz, baseHz] : [baseHz, shiftedHz] };
    questionCount += 1;
    renderStatus();
    feedback.textContent = 'よく聞いて…';
    setChoicesEnabled(true);
    playQuestion();
  }

  function finish() {
    isRunning = false;
    setChoicesEnabled(false);
    // 再挑戦は結果の「もう一回」から。スタートボタンは出さず、同じ役割のボタンを2つ並べない
    const hasCorrect = bestCents !== null;
    result.show({
      big: hasCorrect ? `${bestCents.toFixed(1)} cent` : '— cent',
      rank: hasCorrect ? pickRank(bestCents, RANKS) : 'のびしろあり',
      details: [
        hasCorrect ? `半音を約 ${Math.round(100 / bestCents)} 等分した差まで聞き分け` : '半音の差から練習してみよう',
        `正解 ${correctCount} / ${questionCount} 問`,
      ],
    });
  }

  async function answer(choiceIndex) {
    if (!isAwaitingAnswer) return;
    const currentSession = sessionId;
    setChoicesEnabled(false);
    const isCorrect = choiceIndex === question.higherIndex;
    const correctLabel = question.higherIndex === 0 ? '1つ目' : '2つ目';
    if (isCorrect) {
      correctCount += 1;
      bestCents = Math.min(bestCents ?? Infinity, diffCents);
      diffCents = Math.max(MIN_DIFF_CENTS, diffCents * SHRINK_ON_CORRECT);
      feedback.textContent = `正解！ ${correctLabel}が高い音でした。`;
    } else {
      lives -= 1;
      diffCents = Math.min(MAX_DIFF_CENTS, diffCents * GROW_ON_WRONG);
      feedback.textContent = `ざんねん、${correctLabel}が高い音でした。`;
    }
    renderStatus();
    if (lives === 0) {
      finish();
      return;
    }
    await wait(NEXT_QUESTION_DELAY_MS);
    if (currentSession === sessionId) nextQuestion();
  }

  async function startGame() {
    ctx = await prepareAudio(errorMessage);
    if (!ctx) return;
    sessionId += 1;
    isRunning = true;
    diffCents = START_DIFF_CENTS;
    bestCents = null;
    lives = LIVES;
    correctCount = 0;
    questionCount = 0;
    startButton.hidden = true;
    result.hide();
    nextQuestion();
    // 押したスタートボタンが消えてフォーカスを見失わないよう、次に押す場所へ移す
    choiceButtons[0].focus();
  }

  function stop() {
    sessionId += 1;
    if (!isRunning) return;
    // 出題中に画面を離れたら、戻ってきたときに最初から始められる状態に戻す
    isRunning = false;
    setChoicesEnabled(false);
    startButton.hidden = false;
    feedback.textContent = '';
  }

  startButton.addEventListener('click', startGame);
  replayButton.addEventListener('click', playQuestion);
  choiceButtons.forEach((button, index) => button.addEventListener('click', () => answer(index)));

  setChoicesEnabled(false);
  renderStatus();
  return {
    stop,
    handleKey(event) {
      const choiceIndex = ['1', '2'].indexOf(event.key);
      if (choiceIndex === -1) return;
      answer(choiceIndex);
    },
  };
}
