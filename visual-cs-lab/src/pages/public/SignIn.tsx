import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useSession } from '../../session';

export default function SignIn() {
  const { signIn, bootstrapAdmin, needsAdmin, user } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signIn(email, password);
      navigate('/my-learning');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const createAdmin = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await bootstrapAdmin(email, name, password);
      navigate('/admin');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-container">
      <div className="p-auth">
        <div className="p-card">
          <span className="p-eyebrow">{needsAdmin ? 'First run' : 'Welcome back'}</span>
          <h1 className="p-h2" style={{ marginTop: 8 }}>
            {needsAdmin ? 'Create the first administrator' : 'Sign in'}
          </h1>

          {needsAdmin ? (
            <>
              <p className="p-lede" style={{ fontSize: 13.5, marginTop: 10 }}>
                No administrator exists yet. This account owns the Admin Studio: content, review, publishing and roles.
                The public learning site stays open to everyone.
              </p>
              <form onSubmit={createAdmin} style={{ marginTop: 18 }}>
                <div>
                  <label className="p-label" htmlFor="admin-name">
                    Name
                  </label>
                  <input
                    id="admin-name"
                    className="p-input"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Muhammad Awais"
                    autoComplete="name"
                  />
                </div>
                <div>
                  <label className="p-label" htmlFor="admin-email">
                    Email
                  </label>
                  <input
                    id="admin-email"
                    className="p-input"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    required
                  />
                </div>
                <div>
                  <label className="p-label" htmlFor="admin-password">
                    Password
                  </label>
                  <input
                    id="admin-password"
                    className="p-input"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="new-password"
                    required
                  />
                  <p className="p-muted" style={{ fontSize: 11.5, marginTop: 6 }}>
                    At least 8 characters, with a letter and a number.
                  </p>
                </div>
                {error && <div className="p-error">{error}</div>}
                <button className="p-btn p-btn-primary" type="submit" disabled={busy}>
                  {busy ? 'Creating…' : 'Create administrator and open the studio'}
                </button>
              </form>
            </>
          ) : (
            <>
              <p className="p-lede" style={{ fontSize: 13.5, marginTop: 10 }}>
                Sign in to save progress. Editors and reviewers use the same form, then open the Studio.
              </p>
              {user && <div className="p-note" style={{ marginTop: 12 }}>Already signed in as {user.email}.</div>}
              <form onSubmit={submit} style={{ marginTop: 18 }}>
                <div>
                  <label className="p-label" htmlFor="email">
                    Email
                  </label>
                  {/* type="text", not "email": the browser's built-in check rejects
                      addresses such as admin@visual_cs_lab and would block sign-in
                      before the request is sent. The server still validates the
                      format when an account is created. */}
                  <input
                    id="email"
                    className="p-input"
                    type="text"
                    inputMode="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    required
                  />
                </div>
                <div>
                  <label className="p-label" htmlFor="password">
                    Password
                  </label>
                  <input
                    id="password"
                    className="p-input"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                    required
                  />
                </div>
                {error && <div className="p-error">{error}</div>}
                <button className="p-btn p-btn-primary" type="submit" disabled={busy}>
                  {busy ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
              <p className="p-muted" style={{ fontSize: 12, marginTop: 14 }}>
                No account? <Link to="/sign-up">Create one</Link>. You can read every published lesson without one.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
