import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../../api';
import { useSession } from '../../session';

const LANGUAGES = [
  { value: 'python', label: 'Python' },
  { value: 'cpp', label: 'C++' },
  { value: 'c', label: 'C' },
  { value: 'javascript', label: 'JavaScript' }
];

const AUDIO = [
  { value: 'silent', label: 'Silent (default)' },
  { value: 'music', label: 'Background music, where available' },
  { value: 'voiceover', label: 'Voice-over, where available' }
];

export default function Settings() {
  const { user, refresh, loading } = useSession();
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('python');
  const [audio, setAudio] = useState('silent');
  const [captions, setCaptions] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    setName(user.name);
    setLanguage(user.default_language || 'python');
    setAudio(user.audio_mode || 'silent');
    setCaptions(Boolean(user.captions));
    setReducedMotion(Boolean(user.reduced_motion));
  }, [user]);

  const save = async () => {
    setError('');
    setSaved('');
    try {
      await api('/api/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({
          name,
          default_language: language,
          audio_mode: audio,
          captions,
          reduced_motion: reducedMotion
        })
      });
      await refresh();
      setSaved('Preferences saved.');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (!loading && !user) {
    return (
      <div className="p-container">
        <div className="p-auth" style={{ marginTop: 80 }}>
          <div className="p-card">
            <h1 className="p-h2">Account & preferences</h1>
            <p className="p-lede" style={{ fontSize: 14, marginTop: 10 }}>
              Sign in to change your profile and learning preferences.
            </p>
            <div className="p-row" style={{ marginTop: 18 }}>
              <Link className="p-btn p-btn-primary" to="/sign-in">
                Sign in
              </Link>
              <Link className="p-btn" to="/sign-up">
                Create account
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-container">
      <div style={{ maxWidth: 680, paddingTop: 40 }}>
        <span className="p-eyebrow">Account</span>
        <h1 className="p-h1" style={{ fontSize: 'clamp(26px, 3.2vw, 36px)' }}>
          Preferences
        </h1>
        <p className="p-lede" style={{ marginTop: 10 }}>
          These choices shape the lesson pages: which code tab opens first, which audio version plays, and how much motion
          the site uses.
        </p>

        <div className="p-card" style={{ marginTop: 26 }}>
          <div className="p-form-grid">
            <div>
              <label className="p-label" htmlFor="name">
                Display name
              </label>
              <input id="name" className="p-input" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div>
              <label className="p-label" htmlFor="email">
                Email
              </label>
              <input id="email" className="p-input" value={user?.email || ''} readOnly disabled />
              <p className="p-muted" style={{ fontSize: 11.5, marginTop: 6 }}>
                Sign-in email. An administrator manages accounts and roles.
              </p>
            </div>
            <div>
              <label className="p-label" htmlFor="language">
                Default code language
              </label>
              <select
                id="language"
                className="p-select"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
              >
                {LANGUAGES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="p-label" htmlFor="audio">
                Preferred video audio
              </label>
              <select id="audio" className="p-select" value={audio} onChange={(event) => setAudio(event.target.value)}>
                {AUDIO.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <p className="p-muted" style={{ fontSize: 11.5, marginTop: 6 }}>
                A lesson plays your preference when that version exists, and the silent cut otherwise.
              </p>
            </div>
          </div>

          <div style={{ marginTop: 8 }}>
            <div className="p-switch-row">
              <div>
                <strong style={{ fontSize: 13.5 }}>Show captions and on-screen text</strong>
                <p className="p-muted" style={{ fontSize: 11.5, margin: '4px 0 0' }}>
                  Mirrors the lesson's captions next to the video.
                </p>
              </div>
              <button
                className={`p-switch${captions ? ' on' : ''}`}
                aria-pressed={captions}
                aria-label="Toggle captions"
                onClick={() => setCaptions((value) => !value)}
              />
            </div>
            <div className="p-switch-row">
              <div>
                <strong style={{ fontSize: 13.5 }}>Reduce motion</strong>
                <p className="p-muted" style={{ fontSize: 11.5, margin: '4px 0 0' }}>
                  Turns off interface transitions. Lesson videos are unaffected.
                </p>
              </div>
              <button
                className={`p-switch${reducedMotion ? ' on' : ''}`}
                aria-pressed={reducedMotion}
                aria-label="Toggle reduced motion"
                onClick={() => setReducedMotion((value) => !value)}
              />
            </div>
          </div>

          {error && <div className="p-error" style={{ marginTop: 14 }}>{error}</div>}
          {saved && (
            <div className="p-note" style={{ marginTop: 14 }}>
              {saved}
            </div>
          )}

          <div className="p-row" style={{ marginTop: 18 }}>
            <button className="p-btn p-btn-primary" onClick={() => void save()}>
              Save preferences
            </button>
            <Link className="p-btn" to="/my-learning">
              My learning
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
