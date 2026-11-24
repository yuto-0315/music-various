const A4_MIDI = 69;
const A4_HZ = 440;

export const NOTE_NAMES_JA = ['ド', 'ド♯', 'レ', 'レ♯', 'ミ', 'ファ', 'ファ♯', 'ソ', 'ソ♯', 'ラ', 'ラ♯', 'シ'];
const NOTE_NAMES_EN = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export const midiToHz = (midi) => A4_HZ * 2 ** ((midi - A4_MIDI) / 12);

/** 小数を含む MIDI ノート番号（60 = 真ん中のド） */
export const hzToMidi = (hz) => A4_MIDI + 12 * Math.log2(hz / A4_HZ);

const pitchClassOf = (midi) => ((Math.round(midi) % 12) + 12) % 12;

/** 例: 60 → "C4"。オクターブ番号は真ん中のドを 4 とする国際式 */
export function formatNoteEn(midi) {
  const octave = Math.floor(Math.round(midi) / 12) - 1;
  return `${NOTE_NAMES_EN[pitchClassOf(midi)]}${octave}`;
}

/** 例: 60 → "C4（ド）" */
export const formatNote = (midi) => `${formatNoteEn(midi)}（${NOTE_NAMES_JA[pitchClassOf(midi)]}）`;
