// Word Ladder: change exactly one letter. Tee and pin are the same length (3-5 letters).
import { writeCourse } from './lib.mjs';
import { commonWords, isPoolWord, loadPoolFilter } from './words.mjs';

await loadPoolFilter();

const words = (await commonWords()).filter((w) => w.length >= 3 && w.length <= 6);
const pool = words.map((w, i) => (isPoolWord(i, w) && w.length <= 5 ? i : -1)).filter((i) => i >= 0);
writeCourse({ id: 'ladder', kind: 'ladder', nodes: words, pool, meta: { source: 'OpenSubtitles frequency list ∩ ENABLE dictionary' } });
