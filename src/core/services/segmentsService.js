function normalizeFilters(input) {
  if (!input || typeof input !== 'object') {
    return {};
  }

  const filters = {};
  if (input.tagIncludes) {
    filters.tagIncludes = String(input.tagIncludes).trim();
  }
  if (input.status) {
    filters.status = String(input.status).trim();
  }
  return filters;
}

function createSegmentsService({ db }) {
  async function list() {
    const rows = await db.all('SELECT * FROM segments ORDER BY created_at DESC');
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      filters: row.filters ? JSON.parse(row.filters) : {},
      createdAt: row.created_at
    }));
  }

  async function preview(filtersInput) {
    const filters = normalizeFilters(filtersInput);
    const recipients = await db.all('SELECT * FROM recipients ORDER BY created_at DESC');

    return recipients
      .map((row) => ({
        id: row.id,
        email: row.email,
        name: row.name,
        tags: row.tags ? JSON.parse(row.tags) : [],
        status: row.status
      }))
      .filter((recipient) => {
        if (filters.status && recipient.status !== filters.status) {
          return false;
        }

        if (filters.tagIncludes && !recipient.tags.includes(filters.tagIncludes)) {
          return false;
        }

        return true;
      });
  }

  return {
    list,

    async create(payload) {
      const name = String(payload.name || '').trim();
      const description = String(payload.description || '').trim();
      const filters = normalizeFilters(payload.filters);

      if (!name) {
        throw new Error('Segment name is required.');
      }

      await db.run(
        `INSERT INTO segments
         (name, description, filters, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        [name, description, JSON.stringify(filters)]
      );

      return list();
    },

    async deleteSegment(id) {
      await db.run('DELETE FROM segments WHERE id = ?', [id]);
      return list();
    },

    async deleteSegments(ids) {
      if (!Array.isArray(ids) || ids.length === 0) {
        throw new Error('No segments to delete.');
      }
      const placeholders = ids.map(() => '?').join(',');
      await db.run(`DELETE FROM segments WHERE id IN (${placeholders})`, ids);
      return list();
    },

    preview
  };
}

module.exports = { createSegmentsService };
