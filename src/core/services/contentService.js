const { analyzeSpamContent } = require('./spamScoringService');

function normalizeText(value) {
  return String(value || '').trim();
}

function analyzeContent(input = {}) {
  const spam = analyzeSpamContent(input);
  const subject = normalizeText(input.subject);
  const previewText = normalizeText(input.previewText);
  const content = String(input.contentHtml || input.editorHtml || '');

  const structureChecks = [
    {
      label: 'Personalization',
      ok: /\{\{[a-z0-9_]+\}\}/i.test(content) || /\{\{[a-z0-9_]+\}\}/i.test(subject),
      note: 'Optional merge tags'
    },
    {
      label: 'Alt text',
      ok: !/<img\b/i.test(content) || /alt=["'][^"']+["']/i.test(content),
      note: 'Images need alt attributes'
    }
  ];

  const checks = [
    ...spam.checklist.map((item) => ({
      label: item.label,
      ok: item.ok,
      note: item.hint
    })),
    ...structureChecks
  ];

  const structureScore = structureChecks.filter((item) => item.ok).length / structureChecks.length;
  const blendedScore = Math.round(spam.score * 0.85 + structureScore * 100 * 0.15);

  return {
    score: blendedScore,
    spam,
    checks
  };
}

function normalizeRow(row) {
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    previewText: row.preview_text,
    contentHtml: row.content_html,
    editorHtml: row.editor_html,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function createContentService({ db }) {
  return {
    async listDocuments() {
      const rows = await db.all('SELECT * FROM content_documents ORDER BY updated_at DESC, id DESC');
      return rows.map(normalizeRow);
    },

    async saveDocument(payload) {
      const name = normalizeText(payload.name || 'Untitled content');
      const subject = normalizeText(payload.subject);
      const previewText = normalizeText(payload.previewText);
      const contentHtml = String(payload.contentHtml || '');
      const editorHtml = String(payload.editorHtml || '');

      if (!contentHtml.trim()) {
        throw new Error('Content cannot be empty.');
      }

      if (payload.id) {
        await db.run(
          `UPDATE content_documents
           SET name = ?, subject = ?, preview_text = ?, content_html = ?, editor_html = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [name, subject, previewText, contentHtml, editorHtml, payload.id]
        );
      } else {
        await db.run(
          `INSERT INTO content_documents
           (name, subject, preview_text, content_html, editor_html, updated_at)
           VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [name, subject, previewText, contentHtml, editorHtml]
        );
      }

      return this.listDocuments();
    },

    async deleteDocument(id) {
      await db.run('DELETE FROM content_documents WHERE id = ?', [id]);
      return this.listDocuments();
    },

    analyze(payload) {
      return analyzeContent(payload || {});
    }
  };
}

module.exports = { createContentService };
