import React, { useContext } from 'react';
import { AppContext } from '../contexts/AppContext';

function TabBar() {
  const { openTabs, activeTab, setActiveTab, closeTab } = useContext(AppContext);

  if (openTabs.length === 0) {
    return null;
  }

  return (
    <div className="tab-bar">
      {openTabs.map((tab) => (
        <button
          key={tab.path}
          className={`tab ${activeTab === tab.path ? 'active' : ''}`}
          onClick={() => setActiveTab(tab.path)}
        >
          {tab.label}
          <button
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation();
              closeTab(tab.path);
            }}
          >
            ✕
          </button>
        </button>
      ))}
    </div>
  );
}

export default TabBar;
