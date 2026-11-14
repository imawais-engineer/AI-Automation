/**
 * The lesson's implementation.
 *
 * One language is shown at a time, chosen explicitly, because two implementations
 * side by side turn a worked reference into something a reader has to diff. The
 * expected output sits in its own block, exactly as the verified implementation
 * printed it.
 */

import { useEffect, useMemo, useState } from 'react';

import type { CodeExample } from '../../learn';

const LANGUAGE_LABEL: Record<string, string> = {
  c: 'C',
  cpp: 'C++',
  'c++': 'C++',
  python: 'Python',
  py: 'Python',
  javascript: 'JavaScript',
  js: 'JavaScript',
  typescript: 'TypeScript',
  ts: 'TypeScript',
  java: 'Java',
  go: 'Go',
  rust: 'Rust',
  pseudo: 'Pseudocode',
  text: 'Text'
};

export function languageLabel(language: string): string {
  return LANGUAGE_LABEL[String(language).toLowerCase()] || String(language).toUpperCase();
}

function Example({ example }: { example: CodeExample }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCopied(false);
  }, [example.id]);

  const copy = async () => {
    // The confirmation only appears when the clipboard actually accepted the code.
    try {
      await navigator.clipboard.writeText(example.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="p-impl">
      {example.label && <span className="p-impl-label">{example.label}</span>}
      <div className="p-code">
        <button className="copy" onClick={() => void copy()} type="button">
          {copied ? 'Copied' : 'Copy'}
        </button>
        <pre>
          <code>{example.code}</code>
        </pre>
      </div>
      {example.expectedOutput && (
        <div className="p-output">
          <span className="p-eyebrow">Expected output</span>
          <pre>
            <code>{example.expectedOutput}</code>
          </pre>
        </div>
      )}
      {example.notes && <p className="p-impl-notes">{example.notes}</p>}
    </div>
  );
}

export default function CodeExamples({ examples }: { examples: CodeExample[] }) {
  const languages = useMemo(
    () => Array.from(new Set(examples.map((example) => example.language))),
    [examples]
  );
  const [language, setLanguage] = useState(languages[0] || '');

  useEffect(() => {
    setLanguage(languages[0] || '');
  }, [languages]);

  if (examples.length === 0) {
    return (
      <p className="p-impl-missing">
        This lesson explains and traces the idea but has no runnable implementation yet, so none is shown rather
        than displaying an unverified snippet as working code.
      </p>
    );
  }

  const shown = examples.filter((example) => example.language === language);

  return (
    <div>
      {languages.length > 1 && (
        <div className="p-code-tabs" role="tablist" aria-label="Implementation language">
          {languages.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={item === language}
              className={item === language ? 'on' : ''}
              onClick={() => setLanguage(item)}
            >
              {languageLabel(item)}
            </button>
          ))}
        </div>
      )}
      {shown.map((example) => (
        <Example example={example} key={example.id} />
      ))}
    </div>
  );
}
