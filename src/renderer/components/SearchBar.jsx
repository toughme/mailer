import React, { useState, useRef, useEffect } from 'react';

const searchItems = [
  // Campaigns & Content
  { type: 'Campaigns', name: 'Q4 Product Launch', route: '/campaigns', keywords: ['campaign', 'send', 'email'] },
  { type: 'Content', name: 'Welcome Email', route: '/content', keywords: ['content', 'editor', 'template', 'draft'] },
  
  // Audience
  { type: 'Audience', name: 'Premium Subscribers', route: '/audience', keywords: ['audience', 'recipients', 'segment', 'list'] },
  
  // Accounts
  { type: 'Account', name: 'Gmail Sender', route: '/accounts', keywords: ['account', 'smtp', 'sender', 'provider'] },
  
  // Infrastructure & Tools
  { type: 'Infrastructure', name: 'Domain Configuration', route: '/infrastructure#domain', keywords: ['domain', 'dns', 'spf', 'dkim', 'dmarc'] },
  { type: 'Infrastructure', name: 'Proxy Profiles', route: '/infrastructure#proxy', keywords: ['proxy', 'http', 'socks', 'network'] },
  { type: 'Infrastructure', name: 'IP Pools', route: '/infrastructure#pool', keywords: ['ip', 'pool', 'provider', 'ips'] },
  { type: 'Infrastructure', name: 'Webhooks', route: '/infrastructure#webhook', keywords: ['webhook', 'events', 'callback', 'delivery'] },
  { type: 'Infrastructure', name: 'Domain Inspector', route: '/infrastructure#inspect', keywords: ['inspect', 'scanner', 'dns', 'records'] },
  { type: 'Infrastructure', name: 'Reputation Monitor', route: '/infrastructure#monitor', keywords: ['reputation', 'hygiene', 'validate', 'bounces'] },
  
  // Settings & Analytics
  { type: 'Settings', name: 'Send Settings', route: '/settings#send', keywords: ['send', 'settings', 'rate', 'delay'] },
  { type: 'Analytics', name: 'Compliance Events', route: '/infrastructure#analytics', keywords: ['analytics', 'compliance', 'audit', 'events'] },
  
  // Dashboard
  { type: 'Dashboard', name: 'Main Dashboard', route: '/', keywords: ['dashboard', 'overview', 'stats'] }
];

function SearchBar() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const inputRef = useRef(null);

  function handleSearch(value) {
    setQuery(value);
    if (value.trim().length > 0) {
      const lowerQuery = value.toLowerCase();
      const filtered = searchItems.filter(
        (item) =>
          item.name.toLowerCase().includes(lowerQuery) ||
          item.type.toLowerCase().includes(lowerQuery) ||
          item.keywords.some((kw) => kw.includes(lowerQuery))
      );
      setResults(filtered);
      setShowResults(true);
    } else {
      setResults([]);
      setShowResults(false);
    }
  }

  useEffect(() => {
    function handleClickOutside(event) {
      if (inputRef.current && !inputRef.current.contains(event.target)) {
        setShowResults(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="search-bar search-bar-compact" ref={inputRef}>
      <input
        type="search"
        placeholder="Search settings, tools, campaigns..."
        value={query}
        onChange={(event) => handleSearch(event.target.value)}
        onFocus={() => query && setShowResults(true)}
        aria-label="Search"
      />
      {showResults && results.length > 0 ? (
        <div className="search-results">
          {results.map((result) => (
            <a key={`${result.type}-${result.name}`} className="search-result-item" href={result.route}>
              <span className="search-result-type">{result.type}</span>
              <span>{result.name}</span>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default SearchBar;
