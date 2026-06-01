import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error.message || String(error) };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="crash-shell">
          <h1>Renderer Error</h1>
          <p>{this.state.message}</p>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
