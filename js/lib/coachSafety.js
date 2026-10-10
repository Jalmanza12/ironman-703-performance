// Red-flag symptom detection for the AI Coach. These messages always get an immediate app
// safety notice (stop exercising, seek urgent care) in addition to the AI's reply.

const RED_FLAGS = [
  [/chest (pain|tightness|pressure)/i, 'chest pain or pressure'],
  [/\b(faint(ed|ing)?|passed out|blacked out|collapse[d]?)\b/i, 'fainting or collapse'],
  [/(severe|can'?t catch my|cannot catch my|struggling to) breath|short(ness)? of breath at rest|can'?t breathe/i, 'severe shortness of breath'],
  [/\b(palpitations|heart (is |was |keeps )?(racing|pounding|skipping|fluttering)|irregular heart ?beat)\b/i, 'heart rhythm symptoms'],
  [/\b(dizz(y|iness)|lightheaded|light-headed)\b/i, 'dizziness'],
  [/\bconfus(ed|ion)\b|\bslurred\b/i, 'confusion'],
];

export function detectRedFlags(text = '') {
  return RED_FLAGS.filter(([re]) => re.test(text)).map(([, label]) => label);
}
