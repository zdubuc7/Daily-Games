// Common-English word list shared by the word courses:
// OpenSubtitles frequency list (hermitdave/FrequencyWords) ∩ ENABLE dictionary, minus a blocklist.
import { fetchText, readSource } from './lib.mjs';

export const ANSWER_LIMIT = 20000; // words accepted as answers ("common words only")
export const POOL_LIMIT = 3000;    // words eligible to be tee or pin

export async function commonWords() {
  const enable = new Set((await fetchText('https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt', 'enable1.txt')).split(/\s+/));
  const freq = await fetchText('https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt', 'en_50k.txt');
  const block = new Set(readSource('word-blocklist.txt').split('\n').filter((l) => !l.startsWith('#')).join(' ').split(/\s+/).filter(Boolean));
  const out = [];
  for (const line of freq.split('\n')) {
    const w = line.split(' ')[0];
    if (!w || !/^[a-z]+$/.test(w) || !enable.has(w) || block.has(w)) continue;
    if (w.length < 2) continue;
    out.push(w);
    if (out.length >= ANSWER_LIMIT) break;
  }
  return out; // most frequent first
}

// Tee/pin words must also be in Google's 10k most common (no swears) list, which weeds out names and slang.
let google;
export async function loadPoolFilter() {
  google = new Set((await fetchText('https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-usa-no-swears.txt', 'google-10k.txt')).split(/\s+/));
}

// Rank 0 = most frequent. Skips the ~150 most common function words for tee/pin use.
export function isPoolWord(rank, w) {
  if (!google) throw new Error('call loadPoolFilter() first');
  return rank >= 150 && rank < POOL_LIMIT && w.length >= 3 && google.has(w);
}
