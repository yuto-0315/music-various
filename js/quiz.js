import { prepareAudio } from './audio.js';
import { mountResult, pickRank } from './result.js';
import { average, wait } from './util.js';

const QUESTION_COUNT = 10;
const NEXT_QUESTION_DELAY_MS = 1000;

/**
 * 「音を聞いて、選択肢から答える」10問クイズの共通部分。
 * パネルには data-quiz-start / data-quiz-replay / data-quiz-count / data-quiz-score /
 * data-choices（中に data-choice="値" のボタン）/ data-feedback / data-error / data-result-slot を置く。
 *
 * @param {HTMLElement} panel
 * @param {object} options
 * @param {string} options.gameId
 * @param {string} options.gameTitle
 * @param {{ max: number, label: string }[]} options.ranks 正解数で判定
 * @param {() => { answer: string }} options.createQuestion
 * @param {(ctx: AudioContext, question: object) => void} options.playQuestion
 * @param {(answer: string) => string} options.describeAnswer フィードバックに出す正解の名前
 * @param {(ctx: AudioContext, choice: string) => void} [options.playSample] クイズ外で選択肢を押したときのお試し音
 * @param {() => string[]} [options.extraDetails] 結果に足す行
 * @param {(isRunning: boolean) => void} [options.onRunningChange]
 */
export function initQuiz(panel, options) {
  const { gameId, gameTitle, ranks, createQuestion, playQuestion, describeAnswer, playSample, extraDetails, onRunningChange } = options;
  const startButton = panel.querySelector('[data-quiz-start]');
  const replayButton = panel.querySelector('[data-quiz-replay]');
  const countOutput = panel.querySelector('[data-quiz-count]');
  const scoreOutput = panel.querySelector('[data-quiz-score]');
  const choiceContainer = panel.querySelector('[data-choices]');
  const feedback = panel.querySelector('[data-feedback]');
  const errorMessage = panel.querySelector('[data-error]');
  const result = mountResult(panel.querySelector('[data-result-slot]'), { gameId, gameTitle, onRetry: () => start() });
  const getChoiceButtons = () => [...choiceContainer.querySelectorAll('[data-choice]')];

  let ctx = null;
  let questionNumber = 0;
  let score = 0;
  let question = null;
  let questionStartedMs = 0;
  let answerTimesMs = [];
  let isAwaitingAnswer = false;
  let isRunning = false;
  // 画面を離れたり再スタートしたりしたときに、古い問題の続きが動かないようにするための番号
  let sessionId = 0;

  function renderStatus() {
    countOutput.value = String(questionNumber);
    scoreOutput.value = String(score);
  }

  // お試し音がないゲームでは、クイズ外の選択肢は押しても何も起きないので無効にしておく
  function refreshChoices() {
    const isUsable = isRunning || Boolean(playSample);
    getChoiceButtons().forEach((button) => (button.disabled = !isUsable));
  }

  function setRunning(running) {
    isRunning = running;
    onRunningChange?.(running);
    refreshChoices();
  }

  function setAwaiting(awaiting) {
    isAwaitingAnswer = awaiting;
    replayButton.disabled = !awaiting;
  }

  const playCurrent = () => playQuestion(ctx, question);

  function nextQuestion() {
    questionNumber += 1;
    question = createQuestion();
    renderStatus();
    feedback.textContent = `第${questionNumber}問`;
    setAwaiting(true);
    questionStartedMs = performance.now();
    playCurrent();
  }

  function finish() {
    setRunning(false);
    setAwaiting(false);
    feedback.textContent = '';
    // 再挑戦は結果の「もう一回」から。スタートボタンは出さず、同じ役割のボタンを2つ並べない
    result.show({
      big: `${score} / ${QUESTION_COUNT}`,
      rank: pickRank(score, ranks),
      details: [...(extraDetails?.() ?? []), `平均回答時間 ${(average(answerTimesMs) / 1000).toFixed(1)} 秒`],
    });
  }

  async function answer(choice) {
    if (!isAwaitingAnswer) return;
    const currentSession = sessionId;
    answerTimesMs.push(performance.now() - questionStartedMs);
    setAwaiting(false);
    const isCorrect = choice === question.answer;
    if (isCorrect) score += 1;
    renderStatus();
    const correctButton = getChoiceButtons().find((button) => button.dataset.choice === question.answer);
    correctButton?.classList.add('is-correct');
    const correctName = describeAnswer(question.answer);
    feedback.textContent = isCorrect ? `正解！ ${correctName}でした。` : `ざんねん、正解は ${correctName} でした。`;
    await wait(NEXT_QUESTION_DELAY_MS);
    correctButton?.classList.remove('is-correct');
    if (currentSession !== sessionId) return;
    if (questionNumber === QUESTION_COUNT) {
      finish();
      return;
    }
    nextQuestion();
  }

  async function handleChoice(choice) {
    if (isRunning) {
      answer(choice);
      return;
    }
    if (!playSample) return;
    ctx ??= await prepareAudio(errorMessage);
    if (ctx) playSample(ctx, choice);
  }

  async function start() {
    ctx = await prepareAudio(errorMessage);
    if (!ctx) return;
    sessionId += 1;
    questionNumber = 0;
    score = 0;
    answerTimesMs = [];
    startButton.hidden = true;
    result.hide();
    setRunning(true);
    nextQuestion();
    // 押したスタートボタンが消えてフォーカスを見失わないよう、次に押す場所へ移す
    getChoiceButtons()[0]?.focus();
  }

  function stop() {
    sessionId += 1;
    if (!isRunning) return;
    setRunning(false);
    setAwaiting(false);
    startButton.hidden = false;
    feedback.textContent = '';
  }

  choiceContainer.addEventListener('click', (event) => {
    const button = event.target.closest('[data-choice]');
    if (button && !button.disabled) handleChoice(button.dataset.choice);
  });
  startButton.addEventListener('click', start);
  replayButton.addEventListener('click', playCurrent);

  setAwaiting(false);
  refreshChoices();
  renderStatus();

  return {
    stop,
    /** 選択肢を作り直したあとに呼ぶ */
    refreshChoices,
    handleKey(event) {
      const button = getChoiceButtons()[Number(event.key) - 1];
      if (button && !button.disabled) handleChoice(button.dataset.choice);
    },
  };
}
