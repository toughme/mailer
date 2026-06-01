import React, { useContext } from 'react';
import { AppContext } from '../contexts/AppContext';

function HamburgerButton() {
  const { sidebarCollapsed, toggleSidebarCollapse } = useContext(AppContext);

  return (
    <button className="hamburger-button" onClick={toggleSidebarCollapse} title="Toggle sidebar">
      <span></span>
    </button>
  );
}

export default HamburgerButton;
