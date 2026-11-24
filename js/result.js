import { renderCardBlob, saveCardImage, shareCardImage, canShareImages } from './share-card.js';

const BUTTON_FEEDBACK_MS = 2000;

/** 符号つきの数値。0 に丸まる値は符号を付けず、マイナスはハイフンより読みやすいマイナス記号（U+2212）にする */
export function formatSigned(value, digits) {
  const rounded = value.toFixed(digits);
  if (Number(rounded) === 0) return (0).toFixed(digits);
  return value > 0 ? `+${rounded}` : rounded.replace('-', '−');
}

/** @param {{ max: number, label: string }[]} ranks max の昇順 */
export function pickRank(value, ranks) {
  return ranks.find((rank) => value <= rank.max).label;
}

/**
 * 中心線から上下に伸びるバーで、各回のずれを並べる。
 * @param {HTMLElement} barsElement
 * @param {(number|null)[]} ratios -1〜1。正なら上、負なら下に伸びる。null は「入力なし」
 */
export function renderDeviationBars(barsElement, ratios) {
  barsElement.replaceChildren(
    ...ratios.map((ratio) => {
      const bar = document.createElement('div');
      bar.className = 'dev-bar';
      if (ratio === null) {
        bar.classList.add('is-missed');
        return bar;
      }
      bar.classList.add(ratio >= 0 ? 'is-up' : 'is-down');
      bar.style.setProperty('--size', String(Math.min(Math.abs(ratio), 1)));
      bar.append(document.createElement('span'));
      return bar;
    }),
  );
}

/**
 * 結果表示（画像保存・共有・もう一回）を slot に組み立てる。
 * @param {HTMLElement} slot
 * @param {{ gameId: string, gameTitle: string, onRetry: () => void }} options
 */
export function mountResult(slot, { gameId, gameTitle, onRetry }) {
  const fragment = document.getElementById('result-template').content.cloneNode(true);
  const section = fragment.querySelector('[data-result]');
  const rankElement = fragment.querySelector('[data-result-rank]');
  const bigElement = fragment.querySelector('[data-result-big]');
  const detailsElement = fragment.querySelector('[data-result-details]');
  const saveButton = fragment.querySelector('[data-result-save]');
  const shareButton = fragment.querySelector('[data-result-share]');
  const retryButton = fragment.querySelector('[data-result-retry]');
  const statusElement = fragment.querySelector('[data-result-status]');
  slot.append(fragment);

  shareButton.hidden = !canShareImages();

  let currentCard = null;
  let cardBlobPromise = null;

  function setStatus(message, { isError = false } = {}) {
    statusElement.textContent = message;
    statusElement.classList.toggle('is-error', isError);
  }

  async function runWithCardImage(button, action, successMessage) {
    button.disabled = true;
    try {
      const blob = await cardBlobPromise;
      await action(currentCard, blob);
      if (successMessage) setStatus(successMessage);
    } catch (error) {
      // 共有シートを閉じただけのときはエラー扱いしない
      if (error.name !== 'AbortError') {
        setStatus('画像を作れませんでした。もう一度押してみてください。', { isError: true });
      }
    } finally {
      setTimeout(() => {
        button.disabled = false;
      }, successMessage ? BUTTON_FEEDBACK_MS : 0);
    }
  }

  saveButton.addEventListener('click', () => runWithCardImage(saveButton, saveCardImage, '画像を保存しました。'));
  shareButton.addEventListener('click', () => runWithCardImage(shareButton, shareCardImage));
  retryButton.addEventListener('click', onRetry);

  return {
    /** @param {{ big: string, rank: string, details: string[] }} result */
    show(result) {
      currentCard = { gameId, gameTitle, ...result };
      // 共有はユーザー操作の直後に呼ばないと拒否されるブラウザがあるため、画像は先に作っておく
      cardBlobPromise = renderCardBlob(currentCard);
      rankElement.textContent = result.rank;
      bigElement.textContent = result.big;
      detailsElement.replaceChildren(
        ...result.details.map((line) => Object.assign(document.createElement('li'), { textContent: line })),
      );
      setStatus('');
      section.hidden = false;
      section.focus({ preventScroll: true });
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      section.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'nearest' });
    },
    hide() {
      section.hidden = true;
      currentCard = null;
      cardBlobPromise = null;
    },
  };
}
