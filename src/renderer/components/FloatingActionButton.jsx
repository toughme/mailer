import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

function FloatingActionButton() {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();

  const menuItems = [
    { icon: '📧', label: 'New Email', action: () => navigate('/campaigns') },
    { icon: '👥', label: 'Recipients', action: () => navigate('/audience') },
    { icon: '📝', label: 'New Content', action: () => navigate('/content') },
    { icon: '🔌', label: 'Add Account', action: () => navigate('/accounts') },
  ];

  return (
    <>
      {isOpen && (
        <div
          className="fab-menu"
          onMouseLeave={() => setIsOpen(false)}
        >
          {menuItems.map((item) => (
            <button
              key={item.label}
              className="fab-menu-item"
              onClick={() => {
                item.action();
                setIsOpen(false);
              }}
            >
              <span style={{ fontSize: '16px' }}>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      )}
      <button
        className="floating-action-button"
        onClick={() => setIsOpen(!isOpen)}
        title="Create new item"
      >
        +
      </button>
    </>
  );
}

export default FloatingActionButton;
