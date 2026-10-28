import { NavLink, Route, Routes } from 'react-router-dom';

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

const NAV = [
  { to: '/', label: 'Create', end: true },
  { to: '/videos', label: 'Videos' },
  { to: '/style', label: 'Style' }
];

const LIBRARY = [
  { to: '/overview', label: 'Overview' },
  { to: '/lessons', label: 'Lessons' },
  { to: '/concepts', label: 'Concept library' },
  { to: '/renders', label: 'Render manager' },
  { to: '/publishing', label: 'Publishing queue' }
];

export default function App() {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brandmark">
          <span className="dot">VL</span>
          <div>
            <div>Visual CS Lab</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500 }}>
              code-driven CS shorts
            </div>
          </div>
        </div>

        <nav className="nav">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="nav" style={{ marginTop: 18 }}>
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', padding: '0 12px 6px' }}>
            LIBRARY
          </div>
          {LIBRARY.map((item) => (
            <NavLink key={item.to} to={item.to}>
              {item.label}
            </NavLink>
          ))}
        </div>

        <div className="foot">
          <span className="mono">renderer</span>
          <span>canvas → H.264 MP4 (local worker)</span>
          <span className="mono" style={{ marginTop: 6 }}>
            v0.1 · DSA
          </span>
        </div>
      </aside>

      <main className="main">
        <Routes>
          <Route path="/" element={<Create />} />
          <Route path="/videos" element={<Videos />} />
          <Route path="/style" element={<BrandPage />} />
          <Route path="/overview" element={<Dashboard />} />
          <Route path="/concepts" element={<Concepts />} />
          <Route path="/concepts/:id" element={<ConceptDetail />} />
          <Route path="/lessons" element={<Lessons />} />
          <Route path="/lessons/:id" element={<LessonEditor />} />
          <Route path="/renders" element={<Renders />} />
          <Route path="/publishing" element={<Publishing />} />
          <Route path="/brand" element={<BrandPage />} />
          <Route
            path="*"
            element={
              <div className="empty">
                <strong>Page not found</strong>
                <span>That route is not part of Visual CS Lab.</span>
              </div>
            }
          />
        </Routes>
      </main>
    </div>
  );
}
