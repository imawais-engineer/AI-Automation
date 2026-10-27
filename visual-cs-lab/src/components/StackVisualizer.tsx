import { useCallback, useEffect, useRef, useState } from 'react';

import { api, type StackEvent } from '../api';

type Op = { op: 'push'; value: number } | { op: 'pop' } | { op: 'top' };

type TraceResponse = {
  events: StackEvent[];
  errors: string[];
  validation: { ok: boolean; failures: string[] };
};

type Props = {
  conceptId: string;
  initialOps: Op[];
};

const SPEEDS = [0.5, 1, 2, 4];

export default function StackVisualizer({ conceptId, initialOps }: Props) {
  const [ops, setOps] = useState<Op[]>(initialOps.length ? initialOps : [{ op: 'push', value: 10 }]);
  const [trace, setTrace] = useState<TraceResponse | null>(null);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [pushValue, setPushValue] = useState('40');
  const [error, setError] = useState('');
  const timer = useRef<number | null>(null);

  const run = useCallback(
    async (nextOps: Op[], jumpToEnd = true) => {
      try {
        const data = await api<TraceResponse>(`/api/concepts/${conceptId}/trace`, {
          method: 'POST',
          body: JSON.stringify({ ops: nextOps })
        });
        setTrace(data);
        setError(data.errors.length ? data.errors.join(' ') : '');
        setCursor(jumpToEnd ? Math.max(0, data.events.length - 1) : 0);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [conceptId]
  );

  useEffect(() => {
    void run(ops, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conceptId]);

  useEffect(() => {
    if (!playing) {
      if (timer.current) window.clearInterval(timer.current);
      return;
    }
    const events = trace?.events.length ?? 0;
    timer.current = window.setInterval(() => {
      setCursor((current) => {
        if (current >= events - 1) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 1100 / speed);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [playing, speed, trace?.events.length]);

  function addOp(next: Op) {
    const updated = [...ops, next];
    setOps(updated);
    setPlaying(false);
    void run(updated, true);
  }

  function resetDemo() {
    setOps(initialOps);
    setPlaying(false);
    void run(initialOps, false);
    setCursor(0);
  }

  const events = trace?.events ?? [];
  const current = events[cursor];
  const items = current ? current.items : [];
  const top = current ? current.top : null;
  const stepLabel = current
    ? current.op === 'push'
      ? `PUSH(${current.value})`
      : current.op === 'pop'
        ? current.returned === null
          ? 'POP → EMPTY'
          : `POP → ${current.returned}`
        : `TOP → ${current.top ?? 'EMPTY'}`
    : 'INITIAL';

  return (
    <div className="viz">
      <div>
        <div className="stack-area">
          <div className="op-badge">{stepLabel}</div>
          <div className="stack-cells">
            {items.map((value, index) => {
              const isTop = index === items.length - 1;
              return (
                <div className={`stack-cell ${isTop ? 'top' : ''}`} key={`${index}-${value}`}>
                  <span className="idx">#{index}</span>
                  {value}
                  {isTop && <span className="top-flag">◀ TOP</span>}
                </div>
              );
            })}
            {items.length === 0 && (
              <div className="stack-cell" style={{ borderStyle: 'dashed', color: 'var(--muted)' }}>
                empty
              </div>
            )}
          </div>
          <div className="mono" style={{ marginTop: 14, fontSize: 11, color: 'var(--muted)' }}>
            size {items.length} · LIFO
          </div>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => setPlaying((value) => !value)}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <button className="btn" onClick={() => setCursor((value) => Math.max(0, value - 1))}>
            Previous step
          </button>
          <button
            className="btn"
            onClick={() => setCursor((value) => Math.min(events.length - 1, value + 1))}
          >
            Next step
          </button>
          <button className="btn ghost" onClick={resetDemo}>
            Reset
          </button>
          <div className="chips">
            {SPEEDS.map((value) => (
              <button
                key={value}
                className={`chip ${speed === value ? 'on' : ''}`}
                onClick={() => setSpeed(value)}
              >
                {value}×
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        <div className="card tight">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3>
              Step {current ? current.n : 0} of {events.length}
            </h3>
            {trace && (
              <span className={`badge ${trace.validation.ok ? 'good' : 'bad'}`}>
                {trace.validation.ok ? 'expected results verified' : 'not verified'}
              </span>
            )}
          </div>
          <p style={{ color: current ? 'var(--ink)' : 'var(--muted)' }}>
            {current ? current.message : 'Stack is empty — every operation starts from here.'}
          </p>
          {trace && !trace.validation.ok && trace.validation.failures.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--bad)', fontSize: 12.5 }}>
              {trace.validation.failures.map((failure) => (
                <li key={failure}>{failure}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="card tight">
          <h3>Run operations</h3>
          <div className="row">
            <input
              className="input"
              style={{ width: 92 }}
              value={pushValue}
              onChange={(event) => setPushValue(event.target.value)}
              aria-label="Value to push"
              inputMode="numeric"
            />
            <button
              className="btn"
              onClick={() => {
                const value = Number(pushValue);
                if (!Number.isFinite(value)) return;
                addOp({ op: 'push', value });
              }}
            >
              Push
            </button>
            <button className="btn" onClick={() => addOp({ op: 'pop' })}>
              Pop
            </button>
            <button className="btn" onClick={() => addOp({ op: 'top' })}>
              Top
            </button>
          </div>
          <p className="mono" style={{ fontSize: 12, color: 'var(--muted)', wordBreak: 'break-word' }}>
            {ops
              .map((item) => (item.op === 'push' ? `PUSH(${item.value})` : item.op.toUpperCase()))
              .join(' → ')}
          </p>
          {error && <div className="notice bad">{error}</div>}
        </div>

        <div className="card tight">
          <h3>Operation history</h3>
          <div className="history">
            {events.map((event, index) => (
              <button
                key={event.n}
                className={index === cursor ? 'on' : ''}
                onClick={() => {
                  setPlaying(false);
                  setCursor(index);
                }}
              >
                {event.n}.{' '}
                {event.op === 'push'
                  ? `PUSH(${event.value})`
                  : event.op === 'pop'
                    ? `POP → ${event.returned ?? 'EMPTY'}`
                    : `TOP → ${event.top ?? 'EMPTY'}`}{' '}
                · [{event.items.join(', ')}]
              </button>
            ))}
            {events.length === 0 && <span style={{ color: 'var(--muted)' }}>No operations yet.</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
