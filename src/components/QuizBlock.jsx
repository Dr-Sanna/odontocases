import { useMemo, useState } from 'react';

function hashToUint32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function stableShuffle(arr, seedStr) {
  const seed = hashToUint32(seedStr);
  const rand = mulberry32(seed);
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function QuizBlock({
  block,
  index = 0,
  total = 1,
  seedKey = '',
  Markdown,
}) {
  const question = block?.question || 'Quiz';
  const explanation = block?.explanation || '';
  const shuffle = Boolean(block?.shuffle);

  const rawProps = Array.isArray(block?.propositions) ? block.propositions : [];

  const propositions = useMemo(() => {
    const base = rawProps.map((p, i) => ({
      _id: p?.id != null ? String(p.id) : `p-${index}-${i}`,
      label: p?.label || '',
      isCorrect: Boolean(p?.isCorrect),
      feedback: p?.feedback || '',
    }));
    return shuffle ? stableShuffle(base, String(seedKey || `${index}`)) : base;
  }, [rawProps, shuffle, seedKey, index]);

  const [selected, setSelected] = useState(() => new Set());
  const [checkedOnce, setCheckedOnce] = useState(false);
  const [result, setResult] = useState(null);

  const toggleId = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onVerify = () => {
    const correctIds = new Set(propositions.filter((p) => p.isCorrect).map((p) => p._id));
    const selectedIds = new Set(selected);

    let missing = 0;
    for (const cid of correctIds) if (!selectedIds.has(cid)) missing++;

    let extra = 0;
    for (const sid of selectedIds) if (!correctIds.has(sid)) extra++;

    const ok = missing === 0 && extra === 0;
    setCheckedOnce(true);
    setResult({ ok, missing, extra });
  };

  const onReset = () => {
    setSelected(new Set());
    setCheckedOnce(false);
    setResult(null);
  };

  const msg =
    result == null
      ? ''
      : result.ok
      ? 'Correct.'
      : result.missing > 0 && result.extra > 0
      ? `Partiel : ${result.missing} manquante(s), ${result.extra} en trop.`
      : result.missing > 0
      ? `Partiel : ${result.missing} manquante(s).`
      : `Partiel : ${result.extra} en trop.`;

  const showNumber = total > 1;

  return (
    <article className="quiz-item">
      <div className="quiz-question">
        {showNumber && <span className="quiz-num">{index + 1}.</span>}
        <span className="quiz-text">{question}</span>
      </div>

      <div className="quiz-options">
        {propositions.map((p, i) => {
          const isSelected = selected.has(p._id);
          const showState = checkedOnce && result != null;

          const optionClass = [
            'quiz-option',
            isSelected ? 'is-selected' : '',
            showState && p.isCorrect ? 'is-correct' : '',
            showState && isSelected && !p.isCorrect ? 'is-wrong' : '',
          ]
            .filter(Boolean)
            .join(' ');

          const inputId = `q-${index}-${p._id}-${i}`;

          return (
            <div
              key={p._id}
              className={optionClass}
              role="checkbox"
              aria-checked={isSelected}
              tabIndex={0}
              onClick={() => {
                if (checkedOnce) return;
                toggleId(p._id);
              }}
              onKeyDown={(e) => {
                if (checkedOnce) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleId(p._id);
                }
              }}
            >
              {/* Ligne checkbox + texte */}
              <div className="quiz-row">
                <input
                  id={inputId}
                  className="quiz-check"
                  type="checkbox"
                  checked={isSelected}
                  disabled={checkedOnce}
                  onClick={(e) => e.stopPropagation()} // évite double toggle
                  onChange={() => toggleId(p._id)}
                />

                <label
                  className="quiz-label-text"
                  htmlFor={inputId}
                  onClick={(e) => e.stopPropagation()} // le label clique déjà via htmlFor
                >
                  {p.label}
                </label>
              </div>

              {/* Feedback */}
              {showState && p.feedback && (
                <div className="quiz-feedback" onClick={(e) => e.stopPropagation()}>
                  <Markdown>{p.feedback}</Markdown>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="quiz-actions">
        {!checkedOnce ? (
          <button
            type="button"
            className="quiz-verify"
            onClick={onVerify}
            disabled={propositions.length === 0}
          >
            Vérifier
          </button>
        ) : (
          <button type="button" className="quiz-reset" onClick={onReset}>
            Réinitialiser
          </button>
        )}

        {result != null && (
          <div className={['quiz-result', result.ok ? 'is-ok' : 'is-ko'].join(' ')}>
            {msg}
          </div>
        )}
      </div>

      {checkedOnce && explanation && (
        <div className="quiz-explanation">
          <Markdown>{explanation}</Markdown>
        </div>
      )}
    </article>
  );
}
