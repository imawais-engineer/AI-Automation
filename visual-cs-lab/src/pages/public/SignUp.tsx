import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useSession } from '../../session';

export default function SignUp() {
  const { register, signIn } = useSession();
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
      await register(email, name, password);
      navigate('/my-learning');
    } catch (err) {
      const message = (err as Error).message;
      // A learner account is the norm; if registration is closed, let them sign in.
      if (/already exists/i.test(message)) {
        try {
          await signIn(email, password);
          navigate('/my-learning');
          return;
        } catch {
          /* fall through to the original message */
        }
      }
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-container">
      <div className="p-auth">
        <div className="p-card">
          <span className="p-eyebrow">Create account</span>
          <h1 className="p-h2" style={{ marginTop: 8 }}>
            Keep your place
          </h1>
          <p className="p-lede" style={{ fontSize: 13.5, marginTop: 10 }}>
            A learner account saves your progress, bookmarks and roadmap position. Reading lessons never needs an account.
          </p>
          <form onSubmit={submit} style={{ marginTop: 18 }}>
            <div>
              <label className="p-label" htmlFor="name">
                Name
              </label>
              <input
                id="name"
                className="p-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
              />
            </div>
            <div>
              <label className="p-label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                className="p-input"
                type="email"
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
                autoComplete="new-password"
                required
              />
              <p className="p-muted" style={{ fontSize: 11.5, marginTop: 6 }}>
                At least 8 characters, with a letter and a number.
              </p>
            </div>
            {error && <div className="p-error">{error}</div>}
            <button className="p-btn p-btn-primary" type="submit" disabled={busy}>
              {busy ? 'Creating…' : 'Create account'}
            </button>
          </form>
          <p className="p-muted" style={{ fontSize: 12, marginTop: 14 }}>
            Already have one? <Link to="/sign-in">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
