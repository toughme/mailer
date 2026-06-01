import React, { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppContext } from '../contexts/AppContext';

function RecentItems() {
  const [isOpen, setIsOpen] = useState(true);
  const { recentItems } = useContext(AppContext);
  const navigate = useNavigate();

  if (!recentItems || recentItems.length === 0) {
    return null;
  }

  return (
    <div className="recent-items">
      <button className="recent-items-toggle" onClick={() => setIsOpen(!isOpen)}>
        <span>Recent</span>
        <span>{isOpen ? '▼' : '▶'}</span>
      </button>
      {isOpen && (
        <>
          {recentItems.map((item) => (
            <a
              key={`${item.type}-${item.name}`}
              className="recent-item"
              onClick={() => navigate(item.route)}
            >
              <span className="recent-item-type">{item.type}</span>
              <span>{item.name}</span>
            </a>
          ))}
        </>
      )}
    </div>
  );
}

export default RecentItems;
