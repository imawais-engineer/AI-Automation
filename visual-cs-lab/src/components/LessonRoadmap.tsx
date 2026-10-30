import { useMemo } from 'react';
import { Link } from 'react-router-dom';

export type RoadmapRow = {
  id: string;
  slug: string;
  title: string;
  content_status: string;
  theme_id: string;
  updated_at: string;
  concept: string;
  category: string;
  derived: {
    deck: { present: boolean; stale: boolean; slides: number };
    videos: { present: boolean; stale: boolean; ready: number };
    narration: { present: boolean; stale: boolean };
  };
  roadmap: {
    roadmap_title: string;
    roadmap_position: number;
    module_title: string;
    module_summary: string;
    module_position: number;
    position: number;
  } | null;
};

type Group = {
  key: string;
  title: string;
  summary: string;
  start: number;
  rows: RoadmapRow[];
};

const UNPLACED = 'Not on the roadmap yet';

/** Lessons in their roadmap order: one group per module, then anything unplaced. */
function groupRows(rows: RoadmapRow[]): Group[] {
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const key = row.roadmap ? `${row.roadmap.roadmap_title}|${row.roadmap.module_title}` : UNPLACED;
    const group = groups.get(key) || {
      key,
      title: row.roadmap ? row.roadmap.module_title : UNPLACED,
      summary: row.roadmap ? row.roadmap.module_summary : 'Lessons that do not sit on a published sequence yet.',
      start: 0,
      rows: []
    };
    group.rows.push(row);
    groups.set(key, group);
  }
  const ordered = Array.from(groups.values()).sort((a, b) => {
    const left = a.rows[0].roadmap;
    const right = b.rows[0].roadmap;
    if (!left) return 1;
    if (!right) return -1;
    return left.roadmap_position - right.roadmap_position || left.module_position - right.module_position;
  });
  for (const group of ordered) {
    group.rows.sort((a, b) => (a.roadmap?.position ?? 0) - (b.roadmap?.position ?? 0));
  }
  // The step numbers run through the whole roadmap, not per module.
  let next = 1;
  for (const group of ordered.filter((item) => item.title !== UNPLACED)) {
    group.start = next;
    next += group.rows.length;
  }
  return ordered;
}

function assetText(present: boolean, count: number, stale: boolean, noun: string): string {
  if (!present && count === 0) return `no ${noun}`;
  if (count === 0) return noun;
  return `${count} ${noun}${stale ? ' · stale' : ''}`;
}

/**
 * The content plan as a learning path: modules in roadmap order, each lesson a
 * numbered step carrying the same status and derived-asset badges as before.
 */
export default function LessonRoadmap({ rows }: { rows: RoadmapRow[] }) {
  const groups = useMemo(() => groupRows(rows), [rows]);

  return (
    <div className="roadmap">
      {groups.map((group) => {
        const published = group.rows.filter((row) => row.content_status === 'published').length;
        const pct = Math.round((published / Math.max(1, group.rows.length)) * 100);
        return (
          <section className="roadmap-module" key={group.key}>
            <header className="roadmap-head">
              <div>
                <h2>{group.title}</h2>
                <p className="sub">{group.summary}</p>
              </div>
              <div className="roadmap-count">
                <span className="mono">
                  {published} of {group.rows.length} published
                </span>
                <div className="progress" style={{ width: 150 }}>
                  <span style={{ width: `${pct}%` }} />
                </div>
              </div>
            </header>

            <ol className="roadmap-steps">
              {group.rows.map((row, index) => (
                <li className="roadmap-step" key={row.id}>
                  <span className="roadmap-node mono">{group.start ? group.start + index : '·'}</span>
                  <div className="roadmap-body">
                    <div className="roadmap-title">
                      <Link to={`/admin/content/${row.id}`}>{row.title}</Link>
                      <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                        /{row.slug} · {row.concept} · {row.theme_id}
                      </span>
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      <span className={`badge ${row.content_status === 'published' ? 'ok' : ''}`}>
                        {row.content_status.replace('_', ' ')}
                      </span>
                      <span
                        className="mono"
                        style={{
                          fontSize: 11,
                          color: row.derived.deck.stale || row.derived.videos.stale ? 'var(--warn)' : 'var(--muted)'
                        }}
                      >
                        {assetText(row.derived.deck.present, row.derived.deck.slides, row.derived.deck.stale, 'slides')} ·{' '}
                        {assetText(row.derived.videos.present || row.derived.videos.ready > 0, row.derived.videos.ready, row.derived.videos.stale, 'videos')} ·{' '}
                        {row.derived.narration.present ? (row.derived.narration.stale ? 'narration · stale' : 'narrated') : 'no narration'}
                      </span>
                      <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                        updated {new Date(row.updated_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <Link className="btn ghost" to={`/admin/content/${row.id}`} style={{ padding: '4px 9px', fontSize: 11 }}>
                      Edit
                    </Link>
                    <Link className="btn ghost" to={`/admin/lessons/${row.id}`} style={{ padding: '4px 9px', fontSize: 11 }}>
                      Storyboard
                    </Link>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
