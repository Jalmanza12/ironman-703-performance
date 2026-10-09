// One passage per plan day, in date order (Oct 5, 2026 → Mar 14, 2027).
// Summaries are paraphrases — read the full passage in a translation of your choice
// (e.g., ESV, NIV, CSB). No translation is quoted, so none is cited.

import { BIBLE_A } from './bible-a.js';
import { BIBLE_B } from './bible-b.js';
import { BIBLE_C } from './bible-c.js';

const OT_BOOKS = ['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra', 'Nehemiah', 'Esther', 'Job', 'Psalm', 'Proverbs', 'Ecclesiastes', 'Song of Songs', 'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah', 'Malachi'];

export function testamentOf(ref) {
  const book = ref.replace(/\s+\d+[:\d–\-, ]*$/, '').trim();
  return OT_BOOKS.includes(book) ? 'OT' : 'NT';
}

export const BIBLE = [...BIBLE_A, ...BIBLE_B, ...BIBLE_C].map(([ref, theme, summary, reflection, question]) => ({
  ref, theme, summary, reflection, question, testament: testamentOf(ref),
}));
