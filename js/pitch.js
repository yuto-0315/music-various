import { prepareAudio, createSineVoice } from './audio.js';
import { mountResult, formatSigned, pickRank } from './result.js';

const REFERENCE_HZ = 440;
const CENTS_PER_OCTAVE = 1200;
// HTML のスライダー min/max と揃える。中心がずれても目標に届くよう、全音1.5個分の幅を持たせている
const SLIDER_HALF_RANGE_CENTS = 300;
// スライダーの位置で答えを覚えられないよう、毎回の中心を最大で半音1.5個分ずらす
const MAX_CENTER_SHIFT_CENTS = 150;
const FINE_STEP_CENTS = 1;
const ANSWER_PREVIEW_MS = 1500;

// 440Hz と 442Hz の差は約 7.9cent。その半分以内なら「どちらか聞き分けられている」とみなす
const RANKS = [
  { max: 1, label: 'チューナー並み' },
  { max: 4, label: '440と442を聞き分ける耳' },
  { max: 10, label: 'かなりいい線' },
  { max: 25, label: 'おしい' },
  { max: 60, label: 'だいたいこのへん' },
  { max: Infinity, label: 'のびしろあり' },
];

const centsToHz = (cents) => REFERENCE_HZ * 2 ** (cents / CENTS_PER_OCTAVE);
const hzToCents = (hz) => CENTS_PER_OCTAVE * Math.log2(hz / REFERENCE_HZ);

export function initPitchGame(panel) {
  const slider = panel.querySelector('[data-pitch-slider]');
  const toggleButton = panel.querySelector('[data-pitch-toggle]');
  const lowerButton = panel.querySelector('[data-pitch-lower]');
  const higherButton = panel.querySelector('[data-pitch-higher]');
  const submitButton = panel.querySelector('[data-pitch-submit]');
  const listenButton = panel.querySelector('[data-pitch-listen]');
  const answerMarker = panel.querySelector('[data-pitch-marker]');
  const targetInputs = panel.querySelectorAll('input[name="pitch-target"]');
  const errorMessage = panel.querySelector('[data-error]');
  const result = mountResult(panel.querySelector('[data-result-slot]'), {
    gameId: 'pitch',
    gameTitle: '周波数あて',
    onRetry: () => {
      startRound();
      toggleButton.focus();
    },
  });

  let voice = null;
  let isPlaying = false;
  let isAnswered = false;
  let centerShiftCents = 0;
  let previewTimerId = null;

  const getTargetHz = () => Number(panel.querySelector('input[name="pitch-target"]:checked').value);
  const getSliderHz = () => centsToHz(Number(slider.value) + centerShiftCents);

  async function prepareVoice() {
    const ctx = await prepareAudio(errorMessage);
    if (!ctx) return false;
    voice ??= createSineVoice(ctx);
    return true;
  }

  function setPlaying(playing) {
    isPlaying = playing;
    panel.classList.toggle('is-playing', playing);
    toggleButton.textContent = playing ? '音を止める' : '音を出す';
    toggleButton.setAttribute('aria-pressed', String(playing));
  }

  async function play() {
    if (!(await prepareVoice())) return;
    clearTimeout(previewTimerId);
    voice.setFrequency(getSliderHz(), { immediate: true });
    voice.fadeIn();
    setPlaying(true);
  }

  function stop() {
    clearTimeout(previewTimerId);
    voice?.fadeOut();
    setPlaying(false);
  }

  // 動かしたら音が出るのが自然なので、止まっているときにスライダーを触ったら自動で鳴らす
  function handlePitchChange() {
    if (!isPlaying) {
      play();
      return;
    }
    voice.setFrequency(getSliderHz());
  }

  function nudge(deltaCents) {
    slider.value = String(Number(slider.value) + deltaCents);
    handlePitchChange();
  }

  function setControlsEnabled(enabled) {
    for (const control of [slider, toggleButton, lowerButton, higherButton, submitButton]) {
      control.disabled = !enabled;
    }
  }

  function submit() {
    if (isAnswered) return;
    stop();
    isAnswered = true;
    setControlsEnabled(false);

    const targetHz = getTargetHz();
    const answerHz = getSliderHz();
    const errorCents = CENTS_PER_OCTAVE * Math.log2(answerHz / targetHz);
    const targetSliderValue = hzToCents(targetHz) - centerShiftCents;
    const markerPosition = (targetSliderValue + SLIDER_HALF_RANGE_CENTS) / (SLIDER_HALF_RANGE_CENTS * 2);
    answerMarker.style.setProperty('--position', String(markerPosition));
    answerMarker.hidden = false;
    listenButton.hidden = false;

    result.show({
      big: `${answerHz.toFixed(1)} Hz`,
      rank: pickRank(Math.abs(errorCents), RANKS),
      details: [
        `ねらい ${targetHz} Hz`,
        `ずれ ${formatSigned(answerHz - targetHz, 1)} Hz（${formatSigned(errorCents, 1)} cent）`,
        '100 cent ＝ 半音ひとつ分',
      ],
    });
  }

  async function previewAnswer() {
    if (!(await prepareVoice())) return;
    clearTimeout(previewTimerId);
    voice.setFrequency(getTargetHz(), { immediate: true });
    voice.fadeIn();
    previewTimerId = setTimeout(() => voice.fadeOut(), ANSWER_PREVIEW_MS);
  }

  function startRound() {
    stop();
    isAnswered = false;
    centerShiftCents = (Math.random() * 2 - 1) * MAX_CENTER_SHIFT_CENTS;
    slider.value = '0';
    setControlsEnabled(true);
    answerMarker.hidden = true;
    listenButton.hidden = true;
    result.hide();
  }

  slider.addEventListener('input', handlePitchChange);
  toggleButton.addEventListener('click', () => (isPlaying ? stop() : play()));
  lowerButton.addEventListener('click', () => nudge(-FINE_STEP_CENTS));
  higherButton.addEventListener('click', () => nudge(FINE_STEP_CENTS));
  submitButton.addEventListener('click', submit);
  listenButton.addEventListener('click', previewAnswer);
  // 答え合わせ後に狙う音を変えたら、表示中の結果と食い違わないよう新しいラウンドにする
  targetInputs.forEach((input) => input.addEventListener('change', () => isAnswered && startRound()));

  startRound();
  return { stop };
}
