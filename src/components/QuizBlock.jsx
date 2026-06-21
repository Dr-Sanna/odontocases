import { useMemo, useState } from 'react';

import './QuizBlock.css';

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

  const [selectedId, setSelectedId] = useState(null);
  const [checkedOnce, setCheckedOnce] = useState(false);
  const [result, setResult] = useState(null);

  const correctProposition = useMemo(() => {
    return propositions.find((p) => p.isCorrect) || null;
  }, [propositions]);

  const selectedProposition = useMemo(() => {
    return propositions.find((p) => p._id === selectedId) || null;
  }, [propositions, selectedId]);

  const onSelect = (id) => {
    if (checkedOnce) return;
    setSelectedId(id);
  };

  const onVerify = () => {
    if (!selectedId) return;

    const ok = Boolean(selectedProposition?.isCorrect);
    setCheckedOnce(true);
    setResult({ ok });
  };

  const onReset = () => {
    setSelectedId(null);
    setCheckedOnce(false);
    setResult(null);
  };

  const answerTitle =
    result == null
      ? ''
      : result.ok
        ? 'Bonne réponse'
        : correctProposition?.label
          ? `Mauvaise réponse, la bonne réponse était : ${correctProposition.label}`
          : 'Mauvaise réponse';

  const showNumber = total > 1;

  return (
    <article className="quiz-item">
      <div className="quiz-question">
        {showNumber && <span className="quiz-num">{index + 1}.</span>}
        <span className="quiz-text">{question}</span>
      </div>

      <div className="quiz-options" role="radiogroup" aria-label={question}>
        {propositions.map((p, i) => {
          const isSelected = selectedId === p._id;
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
              role="radio"
              aria-checked={isSelected}
              tabIndex={checkedOnce ? -1 : 0}
              onClick={() => onSelect(p._id)}
              onKeyDown={(e) => {
                if (checkedOnce) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(p._id);
                }
              }}
            >
              <div className="quiz-row">
                <input
                  id={inputId}
                  className="quiz-check"
                  type="radio"
                  name={`quiz-${index}-${seedKey || 'default'}`}
                  checked={isSelected}
                  disabled={checkedOnce}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => onSelect(p._id)}
                />

                <label
                  className="quiz-label-text"
                  htmlFor={inputId}
                  onClick={(e) => e.stopPropagation()}
                >
                  {p.label}
                </label>
              </div>

              {showState && isSelected && p.feedback && (
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
            disabled={propositions.length === 0 || !selectedId}
          >
            Vérifier
          </button>
        ) : (
          <button type="button" className="quiz-reset" onClick={onReset}>
            Réinitialiser
          </button>
        )}
      </div>

      {checkedOnce && (
        <div className="quiz-answer">
          <h4 className={['quiz-answer-title', result?.ok ? 'is-ok' : 'is-ko'].join(' ')}>
            {answerTitle}
          </h4>

          {explanation && (
            <div className="quiz-explanation">
              <Markdown>{explanation}</Markdown>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
