function safeJsonParse(value, fallback) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values.map((item) => item.trim());
}

function escapeCsv(value) {
  const text = String(value ?? '');
  if (text.includes('"') || text.includes(',') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function createRecipientsService({ db }) {
  return {
    async list() {
      const rows = await db.all('SELECT * FROM recipients ORDER BY name ASC, email ASC');
      return rows.map((row) => ({
        id: row.id,
        email: row.email,
        name: row.name,
        category: row.category || '',
        tags: safeJsonParse(row.tags, []),
        metadata: safeJsonParse(row.metadata, {}),
        status: row.status,
        createdAt: row.created_at
      }));
    },

    async listByCategory() {
      const rows = await db.all('SELECT * FROM recipients ORDER BY category ASC, name ASC, email ASC');
      const grouped = {};
      rows.forEach((row) => {
        const cat = row.category || 'Uncategorized';
        if (!grouped[cat]) {
          grouped[cat] = [];
        }
        grouped[cat].push({
          id: row.id,
          email: row.email,
          name: row.name,
          category: row.category || '',
          tags: safeJsonParse(row.tags, []),
          metadata: safeJsonParse(row.metadata, {}),
          status: row.status,
          createdAt: row.created_at
        });
      });
      return grouped;
    },

    async create(payload) {
      const email = String(payload.email || '').trim().toLowerCase();
      const name = String(payload.name || '').trim();
      const category = String(payload.category || '').trim();
      const tags = Array.isArray(payload.tags)
        ? payload.tags.map((item) => String(item).trim()).filter(Boolean)
        : String(payload.tags || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
      const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
      const status = String(payload.status || 'active').trim();

      if (!email) {
        throw new Error('Recipient email is required.');
      }

      await db.run(
        `INSERT INTO recipients
         (email, name, category, tags, metadata, status, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [email, name, category, JSON.stringify(tags), JSON.stringify(metadata), status]
      );

      return this.list();
    },

    async importCsv(csvText) {
      const lines = String(csvText || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      if (lines.length < 1) {
        throw new Error('CSV must include at least one row.');
      }

      const firstLine = lines[0];
      const headerLine = parseCsvLine(firstLine);
      
      let emailIndex = -1;
      let nameIndex = -1;
      let tagsIndex = -1;
      let statusIndex = -1;
      let headers = [];
      let dataStartIndex = 1;

      // Check if first line is a header by looking for email-related column names
      const headerLower = headerLine.map((h) => h.toLowerCase());
      const hasEmailHeader = headerLower.some((h) => h === 'email' || h === 'e-mail' || h === 'email address');
      const hasOtherHeaders = headerLower.some((h) => h === 'name' || h === 'tags' || h === 'status');

      if (hasEmailHeader || hasOtherHeaders) {
        // First line is a header
        headers = headerLower;
        emailIndex = headers.findIndex((h) => h === 'email' || h === 'e-mail' || h === 'email address');
        nameIndex = headers.findIndex((h) => h === 'name');
        tagsIndex = headers.findIndex((h) => h === 'tags');
        statusIndex = headers.findIndex((h) => h === 'status');
        dataStartIndex = 1;
      } else if (headerLine.length > 0 && headerLine[0].includes('@')) {
        // First line looks like data (contains email), treat it as data with no header
        emailIndex = 0;
        dataStartIndex = 0;
      } else {
        // Ambiguous - treat as header, first column is email
        headers = headerLower;
        emailIndex = 0;
        nameIndex = headers.length > 1 ? 1 : -1;
        tagsIndex = headers.length > 2 ? 2 : -1;
        statusIndex = headers.length > 3 ? 3 : -1;
        dataStartIndex = 1;
      }

      if (emailIndex === -1) {
        throw new Error('Could not find email column. Please use "email", "e-mail", or put email addresses first.');
      }

      for (const line of lines.slice(dataStartIndex)) {
        const values = parseCsvLine(line);
        const email = String(values[emailIndex] || '').trim().toLowerCase();
        if (!email || !email.includes('@')) {
          continue;
        }

        const name = nameIndex >= 0 ? String(values[nameIndex] || '').trim() : '';
        const tags = tagsIndex >= 0
          ? String(values[tagsIndex] || '')
              .split('|')
              .map((item) => item.trim())
              .filter(Boolean)
          : [];
        const status = statusIndex >= 0 ? String(values[statusIndex] || 'active').trim() : 'active';

        await db.run(
          `INSERT INTO recipients (email, name, tags, metadata, status, updated_at)
           VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(email) DO UPDATE SET
             name = excluded.name,
             tags = excluded.tags,
             status = excluded.status,
             updated_at = CURRENT_TIMESTAMP`,
          [email, name, JSON.stringify(tags), JSON.stringify({}), status]
        );
      }

      return this.list();
    },

    async exportCsv() {
      const recipients = await this.list();
      const header = 'email,name,tags,status';
      const rows = recipients.map((recipient) => [
        escapeCsv(recipient.email),
        escapeCsv(recipient.name),
        escapeCsv((recipient.tags || []).join('|')),
        escapeCsv(recipient.status)
      ].join(','));

      return [header, ...rows].join('\n');
    },

    async deleteRecipient(id) {
      await db.run('DELETE FROM recipients WHERE id = ?', [id]);
      return this.list();
    },

    async deleteRecipients(ids) {
      if (!Array.isArray(ids) || ids.length === 0) {
        throw new Error('No recipients to delete.');
      }
      const placeholders = ids.map(() => '?').join(',');
      await db.run(`DELETE FROM recipients WHERE id IN (${placeholders})`, ids);
      return this.list();
    }
  };
}

module.exports = { createRecipientsService };
