import { useEffect } from 'react';
import { Link, NavLink, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';

import { useSession } from './session';
import Home from './pages/public/Home';
import Explore from './pages/public/Explore';
import Roadmaps from './pages/public/Roadmaps';
import RoadmapDetail from './pages/public/RoadmapDetail';
import Learn from './pages/public/Learn';
import MyLearning from './pages/public/MyLearning';
import Settings from './pages/public/Settings';
import SignIn from './pages/public/SignIn';
import SignUp from './pages/public/SignUp';

import AdminOverview from './pages/admin/AdminOverview';
import AdminContent from './pages/admin/AdminContent';
import AdminLessonContent from './pages/admin/AdminLessonContent';
import AdminReview from './pages/admin/AdminReview';
import AdminAudio from './pages/admin/AdminAudio';
import AdminUsers from './pages/admin/AdminUsers';
import AdminRoadmaps from './pages/admin/AdminRoadmaps';
import AdminThemes from './pages/admin/AdminThemes';

import Dashboard from './pages/Dashboard';
import Create from './pages/Create';
import Videos from './pages/Videos';
import Concepts from './pages/Concepts';
import ConceptDetail from './pages/ConceptDetail';
import Lessons from './pages/Lessons';
import LessonEditor from './pages/LessonEditor';
import BrandPage from './pages/Brand';
import Renders from './pages/Renders';
import Publishing from './pages/Publishing';

const PUBLIC_NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/explore', label: 'Explore' },
  { to: '/roadmaps', label: 'Roadmaps' },
  { to: '/my-learning', label: 'My Learning' }
];

const STUDIO_NAV = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/content', label: 'Content library' },
  { to: '/admin/lessons', label: 'Lessons & storyboards' },
  { to: '/admin/concepts', label: 'Concepts' },
  { to: '/admin/create', label: 'Create a short' },
  { to: '/admin/videos', label: 'Video studio' },
  { to: '/admin/renders', label: 'Render manager' }
];

const PRODUCTION_NAV = [
  { to: '/admin/review', label: 'Review & publish' },
  { to: '/admin/roadmaps', label: 'Roadmap editor' },
  { to: '/admin/themes', label: 'Theme studio' },
  { to: '/admin/audio', label: 'Audio library' },
  { to: '/admin/publishing', label: 'Publishing queue' },
  { to: '/admin/users', label: 'Users & roles' }
];

/** The public shell: minimal navigation, no production controls. */
function PublicLayout() {
  const { user, signOut, canStudio } = useSession();
  const location = useLocation();

  useEffect(() => {
    document.body.dataset.shell = 'public';
  }, []);

  return (
    <div className="p-shell">
      <header className="p-nav">
        <div className="p-nav-inner">
          <Link to="/" className="p-logo">
            <span className="mark">VL</span>
            <span>
              Visual CS Lab
              <small>Computer science, one concept at a time</small>
            </span>
          </Link>

          <nav className="p-nav-links">
            {PUBLIC_NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? 'active' : '')}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="p-nav-account">
            {user ? (
              <>
                {canStudio && (
                  <Link className="p-btn p-btn-sm" to="/admin">
                    Studio
                  </Link>
                )}
                <Link className="p-btn p-btn-sm" to="/settings" title={user.email}>
                  {user.name || user.email}
                </Link>
                <button className="p-btn p-btn-sm" onClick={() => void signOut()}>
                  Sign out
                </button>
              </>
            ) : (
              <>
                <Link className="p-btn p-btn-sm" to="/sign-in">
                  Sign in
                </Link>
                <Link className="p-btn p-btn-sm p-btn-primary" to="/sign-up">
                  Create account
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="p-main" key={location.pathname}>
        <Outlet />
      </main>

      <footer className="p-footer">
        <div className="p-container">
          <span>Visual CS Lab · learn the idea, then the code.</span>
          <span className="p-row">
            <Link to="/explore">Explore</Link>
            <Link to="/roadmaps">Roadmaps</Link>
            <Link to="/settings">Preferences</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

/** Protected studio shell. The API enforces the same roles on every call. */
function AdminLayout() {
  const { user, loading, canStudio, signOut } = useSession();

  useEffect(() => {
    document.body.dataset.shell = 'admin';
  }, []);

  if (loading) {
    return (
      <div className="empty" style={{ padding: 60 }}>
        <strong>Checking your session…</strong>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="empty" style={{ padding: 60 }}>
        <strong>The studio needs an editor account</strong>
        <span>Sign in to continue. The learning platform itself is public.</span>
        <Link className="btn primary" to="/sign-in" style={{ marginTop: 14 }}>
          Sign in
        </Link>
      </div>
    );
  }

  if (!canStudio) {
    return (
      <div className="empty" style={{ padding: 60 }}>
        <strong>Your account cannot open the studio</strong>
        <span>
          You are signed in as a learner. Ask an administrator to give you an editor or reviewer role.
        </span>
        <Link className="btn" to="/" style={{ marginTop: 14 }}>
          Back to learning
        </Link>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brandmark">
          <span className="dot">VL</span>
          <div>
            <div>Admin Studio</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500 }}>private production system</div>
          </div>
        </div>

        <nav className="nav">
          {STUDIO_NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="nav" style={{ marginTop: 16 }}>
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', padding: '0 12px 6px' }}>
            PRODUCTION
          </div>
          {PRODUCTION_NAV.map((item) => (
            <NavLink key={item.to} to={item.to}>
              {item.label}
            </NavLink>
          ))}
        </div>

        <div className="foot">
          <span className="mono">{user.email}</span>
          <span>role: {user.role}</span>
          <div className="row" style={{ marginTop: 8, gap: 6 }}>
            <Link className="btn ghost" to="/" style={{ padding: '5px 10px', fontSize: 11.5 }}>
              View site
            </Link>
            <button className="btn ghost" style={{ padding: '5px 10px', fontSize: 11.5 }} onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/explore" element={<Explore />} />
        <Route path="/concepts" element={<Navigate to="/explore" replace />} />
        <Route path="/roadmaps" element={<Roadmaps />} />
        <Route path="/roadmaps/:slug" element={<RoadmapDetail />} />
        <Route path="/learn/:slug" element={<Learn />} />
        <Route path="/my-learning" element={<MyLearning />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/sign-up" element={<SignUp />} />
      </Route>

      <Route element={<AdminLayout />}>
        <Route path="/admin" element={<AdminOverview />} />
        <Route path="/admin/content" element={<AdminContent />} />
        <Route path="/admin/content/:id" element={<AdminLessonContent />} />
        <Route path="/admin/review" element={<AdminReview />} />
        <Route path="/admin/audio" element={<AdminAudio />} />
        <Route path="/admin/users" element={<AdminUsers />} />
        <Route path="/admin/roadmaps" element={<AdminRoadmaps />} />
        <Route path="/admin/themes" element={<AdminThemes />} />
        <Route path="/admin/create" element={<Create />} />
        <Route path="/admin/videos" element={<Videos />} />
        <Route path="/admin/concepts" element={<Concepts />} />
        <Route path="/admin/concepts/:id" element={<ConceptDetail />} />
        <Route path="/admin/lessons" element={<Lessons />} />
        <Route path="/admin/lessons/:id" element={<LessonEditor />} />
        <Route path="/admin/renders" element={<Renders />} />
        <Route path="/admin/publishing" element={<Publishing />} />
        <Route path="/admin/brand" element={<BrandPage />} />
      </Route>

      {/* The production screens moved into the studio; old URLs keep working. */}
      <Route path="/videos" element={<Navigate to="/admin/videos" replace />} />
      <Route path="/create" element={<Navigate to="/admin/create" replace />} />
      <Route path="/lessons" element={<Navigate to="/admin/lessons" replace />} />
      <Route path="/lessons/:id" element={<Navigate to="/admin/content" replace />} />
      <Route path="/renders" element={<Navigate to="/admin/renders" replace />} />
      <Route path="/publishing" element={<Navigate to="/admin/publishing" replace />} />
      <Route path="/style" element={<Navigate to="/admin/themes" replace />} />
      <Route path="/overview" element={<Navigate to="/admin" replace />} />

      <Route
        path="*"
        element={
          <div className="p-shell" style={{ padding: 60 }}>
            <div className="p-container">
              <span className="p-eyebrow">404</span>
              <h1 className="p-h1">That page is not here</h1>
              <p className="p-lede">It may have moved, or the lesson may not be published yet.</p>
              <div className="p-row" style={{ marginTop: 18 }}>
                <Link className="p-btn p-btn-primary" to="/">
                  Home
                </Link>
                <Link className="p-btn" to="/explore">
                  Explore concepts
                </Link>
              </div>
            </div>
          </div>
        }
      />
    </Routes>
  );
}
