import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const pathMap = {
  '/': 'Dashboard',
  '/send': 'Send',
  '/accounts': 'Accounts',
  '/campaigns': 'Campaigns',
  '/audience': 'Audience',
  '/content': 'Content',
  '/deliverability': 'Deliverability',
  '/infrastructure': 'Infrastructure'
};

function Breadcrumb() {
  const location = useLocation();
  const navigate = useNavigate();
  const segments = location.pathname.split('/').filter(Boolean);

  const crumbs = [{ path: '/', label: 'Dashboard' }];
  if (segments.length > 0) {
    const currentPath = `/${segments[0]}`;
    crumbs.push({ path: currentPath, label: pathMap[currentPath] || segments[0] });
  }

  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      {crumbs.map((crumb, index) => (
        <React.Fragment key={crumb.path}>
          {index > 0 ? <span className="breadcrumb-separator">/</span> : null}
          <button
            type="button"
            className={index === crumbs.length - 1 ? 'breadcrumb-current' : 'breadcrumb-link'}
            onClick={() => navigate(crumb.path)}
          >
            {crumb.label}
          </button>
        </React.Fragment>
      ))}
    </nav>
  );
}

export default Breadcrumb;
