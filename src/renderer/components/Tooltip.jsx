import React from 'react';

function Tooltip({ label, children, position = 'top' }) {
  if (!label) {
    return children;
  }

  return (
    <span className={`tooltip-wrap tooltip-${position}`} data-tooltip={label}>
      {children}
    </span>
  );
}

export default Tooltip;
