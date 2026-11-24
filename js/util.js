/** min 以上 max 以下の整数 */
export const randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

export const pickRandom = (items) => items[Math.floor(Math.random() * items.length)];

export const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

export const standardDeviation = (values) => {
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
};

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
