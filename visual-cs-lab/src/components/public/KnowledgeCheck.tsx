/**
 * Practice and knowledge check.
 *
 * Each question explains why the chosen answer is right or wrong, so a miss
 * teaches something instead of only scoring.
 */

import { useState } from 'react';

import type { QuizQuestion } from '../../learn';

export default function KnowledgeCheck({ questions }: { questions: QuizQuestion[] }) {
  const [chosen, setChosen] = useState<Record<string, number>>({});

  if (questions.length === 0) return null;

  return (
    <div className="p-quiz-list">
      {questions.map((question, questionIndex) => {
        const picked = chosen[question.id];
        const answered = picked !== undefined;
        const correct = answered && picked === question.answerIndex;
        return (
          <div className="p-quiz" key={question.id}>
            <p className="p-quiz-prompt">
              <span className="p-quiz-number">Q{questionIndex + 1}</span>
              {question.prompt}
            </p>
            <div className="options">
              {question.options.map((option, optionIndex) => {
                const state = !answered
                  ? ''
                  : optionIndex === question.answerIndex
                    ? ' right'
                    : optionIndex === picked
                      ? ' wrong'
                      : '';
                return (
                  <button
                    key={option}
                    type="button"
                    className={`option${state}`}
                    onClick={() => setChosen((current) => ({ ...current, [question.id]: optionIndex }))}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
            {answered && (
              <div className={`explain${correct ? ' right' : ''}`}>
                <strong>{correct ? 'Correct. ' : 'Not quite. '}</strong>
                {question.explanation}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
