import { playNote } from './audio.js';
import { midiToHz } from './music.js';
import { initQuiz } from './quiz.js';
import { randomInt } from './util.js';

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

const RANKS = [
  { max: 4, label: 'ここから伸びる' },
  { max: 6, label: 'なんとなく分かる' },
  { max: 8, label: 'いい耳' },
  { max: 9, label: '和音マスター' },
  { max: 10, label: '全問正解' },
];

// スタート前のお試しは、聞き比べやすいよう毎回同じ根音（ド）で鳴らす
const SAMPLE_ROOT_MIDI = 60;

function playChord(ctx, type, rootMidi) {
  const startSec = ctx.currentTime + 0.02;
  CHORD_TYPES[type].intervals.forEach((interval, index) => {
    playNote(ctx, midiToHz(rootMidi + interval), {
      startSec: startSec + index * STRUM_SEC,
      durationSec: CHORD_SEC,
      gain: 0.16,
    });
  });
}

export function initChordGame(panel) {
  return initQuiz(panel, {
    gameId: 'chord',
    gameTitle: '明るい？暗い？',
    ranks: RANKS,
    createQuestion: () => ({
      answer: Math.random() < 0.5 ? 'major' : 'minor',
      rootMidi: randomInt(MIN_ROOT_MIDI, MAX_ROOT_MIDI),
    }),
    playQuestion: (ctx, question) => playChord(ctx, question.answer, question.rootMidi),
    playSample: (ctx, type) => playChord(ctx, type, SAMPLE_ROOT_MIDI),
    describeAnswer: (answer) => CHORD_TYPES[answer].label,
  });
}
