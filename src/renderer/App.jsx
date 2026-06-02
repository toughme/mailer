import React, { useEffect, useState, useContext } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { desktopInvoke } from './api';
import { AppContext } from './contexts/AppContext';
import DashboardPage from './pages/DashboardPage';
import AccountsPage from './pages/AccountsPage';
import CampaignsPage from './pages/CampaignsPage';
import SendPage from './pages/SendPage';
import AudiencePage from './pages/AudiencePage';
import ContentPage from './pages/ContentPage';
import DeliverabilityPage from './pages/DeliverabilityPage';
import InfrastructurePage from './pages/InfrastructurePage';
import Breadcrumb from './components/Breadcrumb';
import HamburgerButton from './components/HamburgerButton';
import SearchBar from './components/SearchBar';
import KeyboardShortcuts from './components/KeyboardShortcuts';
import SidebarResizeHandle from './components/SidebarResizeHandle';

function App() {
  const [bootstrap, setBootstrap] = useState(null);
  const [error, setError] = useState('');
  const { darkMode, sidebarCollapsed, sidebarWidth, toggleDarkMode } = useContext(AppContext);

  useEffect(() => {
    desktopInvoke('app:bootstrap')
      .then(setBootstrap)
      .catch((appError) => setError(appError.message));
  }, []);

  return (
    <div
      className={`shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}
      style={{ gridTemplateColumns: sidebarCollapsed ? '56px 1fr' : `${sidebarWidth}px 1fr` }}
    >
      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''} show-hamburger`}>
        <SidebarResizeHandle />
        <HamburgerButton />
        <div className="brand-block">
          <span className="brand-mark">Phantom</span>
        </div>
        <nav className="nav-links">
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/send">Send</NavLink>
          <NavLink to="/accounts">Accounts</NavLink>
          <NavLink to="/campaigns">Emails</NavLink>
          <NavLink to="/audience">Recipients</NavLink>
          <NavLink to="/content">Content</NavLink>
          <NavLink to="/deliverability">Deliverability</NavLink>
          <NavLink to="/infrastructure">Infrastructure</NavLink>
        </nav>
        <div className="sidebar-footer">
          {bootstrap ? (
            <>
              <span>v{bootstrap.version}</span>
              <button type="button" className="theme-toggle" onClick={toggleDarkMode}>
                {darkMode ? 'Light' : 'Dark'}
              </button>
            </>
          ) : null}
        </div>
      </aside>

      <main className="workspace">
        <div className="workspace-topbar">
          <Breadcrumb />
          <SearchBar />
        </div>
        {error ? <div className="error-banner">{error}</div> : null}
        <div className="workspace-content">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/send" element={<SendPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/campaigns" element={<CampaignsPage />} />
            <Route path="/audience" element={<AudiencePage />} />
            <Route path="/content" element={<ContentPage />} />
            <Route path="/deliverability" element={<DeliverabilityPage />} />
            <Route path="/infrastructure" element={<InfrastructurePage />} />
          </Routes>
        </div>
      </main>
      <KeyboardShortcuts />
    </div>
  );
}

export default App;
