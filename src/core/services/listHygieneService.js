const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com',
  '10minutemail.com',
  'guerrillamail.com',
  'tempmail.com',
  'yopmail.com'
]);

function domainOf(email) {
  return String(email || '').toLowerCase().split('@')[1] || '';
}

function localValidate(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalized)) {
    return { email: normalized, status: 'invalid', reason: 'Invalid email syntax', provider: 'local' };
  }

  if (DISPOSABLE_DOMAINS.has(domainOf(normalized))) {
    return { email: normalized, status: 'risky', reason: 'Disposable email domain', provider: 'local' };
  }

  return { email: normalized, status: 'valid', reason: '', provider: 'local' };
}

function createListHygieneService({ db }) {
  return {
    async validateEmail(email) {
      const result = localValidate(email);
      await db.run(
        `INSERT INTO email_validation_cache (email, status, reason, provider, checked_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(email) DO UPDATE SET
           status = excluded.status,
           reason = excluded.reason,
           provider = excluded.provider,
           checked_at = CURRENT_TIMESTAMP`,
        [result.email, result.status, result.reason, result.provider]
      );
      return result;
    },

    async validateRecipients(limit = 5000) {
      const recipients = await db.all('SELECT email FROM recipients LIMIT ?', [Number(limit) || 5000]);
      const results = [];
      for (const recipient of recipients) {
        const result = await this.validateEmail(recipient.email);
        results.push(result);
        if (result.status === 'invalid') {
          await db.run(
            `INSERT INTO suppression_entries (email, reason, source)
             VALUES (?, ?, ?)
             ON CONFLICT(email) DO UPDATE SET reason = excluded.reason, source = excluded.source`,
            [result.email, result.reason, 'list-hygiene']
          );
        }
      }
      return {
        checked: results.length,
        valid: results.filter((item) => item.status === 'valid').length,
        risky: results.filter((item) => item.status === 'risky').length,
        invalid: results.filter((item) => item.status === 'invalid').length,
        results
      };
    },

    async getSuppressionList() {
      return db.all('SELECT * FROM suppression_entries ORDER BY created_at DESC');
    }
  };
}

module.exports = { createListHygieneService, localValidate };
