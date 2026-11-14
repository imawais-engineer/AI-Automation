import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../../api';
import type { RoadmapSummary } from '../../learn';

export default function Roadmaps() {
  const [roadmaps, setRoadmaps] = useState<RoadmapSummary[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ roadmaps: RoadmapSummary[] }>('/api/learn/roadmaps')
      .then((data) => setRoadmaps(data.roadmaps))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-container">
      <header style={{ paddingTop: 40 }}>
        <span className="p-eyebrow">Learning roadmaps</span>
        <h1 className="p-h1" style={{ fontSize: 'clamp(28px, 3.6vw, 40px)' }}>
          Follow a path, in the right order
        </h1>
        <p className="p-lede" style={{ marginTop: 12 }}>
          Each roadmap is an ordered set of modules. Finish a lesson to unlock the next one.
        </p>
      </header>

      {error && <div className="p-error" style={{ marginTop: 22 }}>{error}</div>}

      <div className="p-lesson-grid" style={{ marginTop: 28 }}>
        {roadmaps.map((roadmap) => (
          <Link className="p-lesson-card" key={roadmap.slug} to={`/roadmaps/${roadmap.slug}`}>
            <span className="p-badge accent">{roadmap.lessonCount} lessons</span>
            <h3>{roadmap.title}</h3>
            <p>{roadmap.description}</p>
            {roadmap.prerequisites && (
              <div className="p-mono p-muted">Prerequisites: {roadmap.prerequisites}</div>
            )}
            <div className="p-card-foot">
              <span>Open roadmap</span>
              <span>→</span>
            </div>
          </Link>
        ))}
      </div>

      {!loading && !error && roadmaps.length === 0 && (
        <div className="p-empty" style={{ marginTop: 24 }}>
          <strong>No published roadmaps yet</strong>
          <span>An editor curates and publishes a roadmap in the studio.</span>
        </div>
      )}
    </div>
  );
}
