import { playNote } from './audio.js';
import { midiToHz } from './music.js';
import { initQuiz } from './quiz.js';
import { pickRandom, randomInt } from './util.js';

// 例は「ドから数えるとどこまでか」。度数の名前だけでは響きを思い出しにくいため
const INTERVALS = {
  1: { label: '短2度', example: 'ド→ド♯' },
  2: { label: '長2度', example: 'ド→レ' },
  3: { label: '短3度', example: 'ド→ミ♭' },
  4: { label: '長3度', example: 'ド→ミ' },
  5: { label: '完全4度', example: 'ド→ファ' },
  6: { label: '増4度', example: 'ド→ファ♯' },
  7: { label: '完全5度', example: 'ド→ソ' },
  8: { label: '短6度', example: 'ド→ラ♭' },
  9: { label: '長6度', example: 'ド→ラ' },
  10: { label: '短7度', example: 'ド→シ♭' },
  11: { label: '長7度', example: 'ド→シ' },
  12: { label: 'オクターブ', example: 'ド→ド' },
};
// 選択肢が多いほど迷う時間が増えるので、まずは響きの違いが大きい3つから
const MODES = {
  easy: { label: 'かんたん（3択）', semitones: [4, 7, 12] },
  normal: { label: 'ふつう（7択）', semitones: [2, 3, 4, 5, 7, 9, 12] },
  hard: { label: 'むずかしい（12択）', semitones: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
};
// G3〜G4 の根音。上の音がオクターブ上でも高くなりすぎない範囲
const MIN_ROOT_MIDI = 55;
const MAX_ROOT_MIDI = 67;
const SAMPLE_ROOT_MIDI = 60;
const NOTE_SEC = 0.6;

const RANKS = [
  { max: 3, label: 'ここから伸びる' },
  { max: 5, label: 'なんとなく分かる' },
  { max: 7, label: 'いい耳' },
  { max: 9, label: '音程マスター' },
  { max: 10, label: '全問正解' },
];

/** 1音ずつ鳴らしてから、2音いっしょに鳴らす */
function playInterval(ctx, rootMidi, semitones) {
  const startSec = ctx.currentTime + 0.02;
  const [lowHz, highHz] = [midiToHz(rootMidi), midiToHz(rootMidi + semitones)];
  playNote(ctx, lowHz, { startSec, durationSec: NOTE_SEC });
  playNote(ctx, highHz, { startSec: startSec + NOTE_SEC, durationSec: NOTE_SEC });
  for (const hz of [lowHz, highHz]) {
    playNote(ctx, hz, { startSec: startSec + NOTE_SEC * 2, durationSec: NOTE_SEC * 2, gain: 0.18 });
  }
}

export function initIntervalGame(panel) {
  const choiceContainer = panel.querySelector('[data-choices]');
  const modeInputs = panel.querySelectorAll('input[name="interval-mode"]');
  const getMode = () => MODES[panel.querySelector('input[name="interval-mode"]:checked').value];

  function renderChoices() {
    choiceContainer.replaceChildren(
      ...getMode().semitones.map((semitones) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn choice';
        button.dataset.choice = String(semitones);
        button.append(INTERVALS[semitones].label, Object.assign(document.createElement('small'), { textContent: INTERVALS[semitones].example }));
        return button;
      }),
    );
  }

  renderChoices();
  const quiz = initQuiz(panel, {
    gameId: 'interval',
    gameTitle: '音程あて',
    ranks: RANKS,
    createQuestion: () => ({ answer: String(pickRandom(getMode().semitones)), rootMidi: randomInt(MIN_ROOT_MIDI, MAX_ROOT_MIDI) }),
    playQuestion: (ctx, question) => playInterval(ctx, question.rootMidi, Number(question.answer)),
    playSample: (ctx, semitones) => playInterval(ctx, SAMPLE_ROOT_MIDI, Number(semitones)),
    describeAnswer: (answer) => INTERVALS[answer].label,
    extraDetails: () => [`モード: ${getMode().label}`],
    onRunningChange: (isRunning) => modeInputs.forEach((input) => (input.disabled = isRunning)),
  });
  modeInputs.forEach((input) =>
    input.addEventListener('change', () => {
      renderChoices();
      quiz.refreshChoices();
    }),
  );
  return quiz;
}
