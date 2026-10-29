import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../../api';
import { difficultyLabel, type HomePayload } from '../../learn';
import { useSession } from '../../session';

export default function Home() {
  const { user } = useSession();
  const [data, setData] = useState<HomePayload | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<HomePayload>('/api/learn/home')
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <div className="p-container">
      <section className="p-hero">
        <span className="p-eyebrow" style={{ color: '#a9a4c4' }}>
          Computer science, taught like a tutorial
        </span>
        <h1 className="p-h1">
          {user ? `Welcome back${user.name ? `, ${user.name.split(' ')[0]}` : ''}.` : 'Understand the idea, not just the definition.'}
        </h1>
        <p className="p-lede" style={{ marginTop: 16 }}>
          Every lesson reads like a tutorial: the idea in plain language, a worked example you can follow, the
          implementation with its real output, then practice. A short animation closes it for anyone who wants to see
          the trace move.
        </p>
        <div className="p-hero-actions">
          <Link className="p-btn p-btn-primary" to="/explore">
            Explore concepts
          </Link>
          {data?.featured && (
            <Link className="p-btn" to={`/roadmaps/${data.featured.slug}`}>
              Start the {data.featured.title} roadmap
            </Link>
          )}
        </div>
        <div className="p-hero-stats">
          <div>
            <span>{data?.stats.lessons ?? '—'}</span>
            <small>lessons</small>
          </div>
          <div>
            <span>{data?.stats.roadmaps ?? '—'}</span>
            <small>roadmaps</small>
          </div>
          <div>
            <span>{data?.stats.withVideo ?? '—'}</span>
            <small>with a demonstration</small>
          </div>
        </div>
      </section>

      {error && (
        <div className="p-error" style={{ marginTop: 24 }}>
          {error}
        </div>
      )}

      {data && data.continueLearning.length > 0 && (
        <section className="p-section">
          <div className="p-section-head">
            <h2 className="p-h2">Continue learning</h2>
            <Link className="p-btn p-btn-sm" to="/my-learning">
              My learning
            </Link>
          </div>
          <div className="p-lesson-grid">
            {data.continueLearning.map((item) => (
              <Link className="p-lesson-card" key={item.slug} to={`/learn/${item.slug}`}>
                <span className="p-badge accent">{item.state === 'completed' ? 'Completed' : 'In progress'}</span>
                <h3>{item.title}</h3>
                <div className="p-card-foot">
                  <span>Pick up where you left off</span>
                  <span>→</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="p-section">
        <div className="p-section-head">
          <h2 className="p-h2">Browse by topic</h2>
        </div>
        <div className="p-topic-grid">
          {(data?.topics || []).map((topic) => (
            <Link className="p-topic" key={topic} to={`/explore?topic=${encodeURIComponent(topic)}`}>
              <strong>{topic}</strong>
              <span className="p-muted" style={{ fontSize: 12.5 }}>
                {topic === 'Data Structures'
                  ? 'How values sit in memory, and what that costs.'
                  : topic === 'Algorithms'
                    ? 'Procedures that turn a structure into an answer.'
                    : 'Comparing one approach with another.'}
              </span>
              <span className="count">
                {(data?.recent || []).filter((lesson) => lesson.category === topic).length} in this topic
              </span>
            </Link>
          ))}
        </div>
      </section>

      {data?.featured && (
        <section className="p-section">
          <div className="p-section-head">
            <h2 className="p-h2">Featured roadmap</h2>
            <Link className="p-btn p-btn-sm" to="/roadmaps">
              All roadmaps
            </Link>
          </div>
          <div className="p-card" style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ flex: '1 1 320px' }}>
              <span className="p-eyebrow">Curated path</span>
              <h3 className="p-h2" style={{ marginTop: 8, fontSize: 24 }}>
                {data.featured.title}
              </h3>
              <p className="p-lede" style={{ marginTop: 10, fontSize: 14.5 }}>
                {data.featured.description}
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span className="p-badge">{data.featured.lessonCount} lessons</span>
              <Link className="p-btn p-btn-primary" to={`/roadmaps/${data.featured.slug}`}>
                Open roadmap
              </Link>
            </div>
          </div>
        </section>
      )}

      <section className="p-section">
        <div className="p-section-head">
          <h2 className="p-h2">Recently added</h2>
          <Link className="p-btn p-btn-sm" to="/explore">
            Everything
          </Link>
        </div>
        <div className="p-lesson-grid">
          {(data?.recent || []).map((lesson) => (
            <Link className="p-lesson-card" key={lesson.slug} to={`/learn/${lesson.slug}`}>
              <span className="p-badge">{lesson.category}</span>
              <h3>{lesson.title}</h3>
              <p>{lesson.summary}</p>
              <div className="p-card-foot">
                <span>{difficultyLabel(lesson.difficulty)}</span>
                {lesson.complexity && <span className="p-mono">{lesson.complexity}</span>}
                {lesson.hasVideo && <span className="p-demo-mark">Visual demonstration</span>}
              </div>
            </Link>
          ))}
          {data && data.recent.length === 0 && (
            <div className="p-empty" style={{ gridColumn: '1 / -1' }}>
              <strong>No published lessons yet</strong>
              <span>Lessons appear here once an editor publishes them in the studio.</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
