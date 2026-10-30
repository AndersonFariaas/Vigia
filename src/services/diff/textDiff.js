const DEFAULT_SAMPLE_SIZE = 5;
// Linha muito longa vira um e-mail ilegível; o limite protege também o banco.
const MAX_LINE_LENGTH = 300;

function linesOf(text) {
  return text ? text.split('\n').filter(Boolean) : [];
}

function truncate(line) {
  return line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}…` : line;
}

/**
 * Diff por conjunto de linhas: diz quais linhas entraram e quais saíram.
 * Não é um diff de posição; um item movido de lugar não aparece como mudança.
 * Isso é intencional, porque reordenação costuma ser ruído de layout.
 */
export function diffLines(previousText, currentText, { sampleSize = DEFAULT_SAMPLE_SIZE } = {}) {
  const before = linesOf(previousText);
  const after = linesOf(currentText);
  const beforeSet = new Set(before);
  const afterSet = new Set(after);

  const added = [...new Set(after.filter((line) => !beforeSet.has(line)))];
  const removed = [...new Set(before.filter((line) => !afterSet.has(line)))];

  return {
    addedCount: added.length,
    removedCount: removed.length,
    added: added.slice(0, sampleSize).map(truncate),
    removed: removed.slice(0, sampleSize).map(truncate),
  };
}
