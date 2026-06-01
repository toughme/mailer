const SPAM_TRIGGERS = [
  { pattern: /\bfree\b/i, weight: 8, label: 'Promo: "free"' },
  { pattern: /\bact now\b/i, weight: 10, label: 'Urgency: "act now"' },
  { pattern: /\blimited time\b/i, weight: 9, label: 'Urgency: "limited time"' },
  { pattern: /\b100%\s*free\b/i, weight: 12, label: 'High-risk phrase' },
  { pattern: /\bno risk\b/i, weight: 9, label: 'Risk claim' },
  { pattern: /\bguarantee\b/i, weight: 7, label: 'Guarantee claim' },
  { pattern: /\bclick here\b/i, weight: 8, label: 'Generic CTA' },
  { pattern: /\bwinner\b/i, weight: 10, label: 'Lottery language' },
  { pattern: /\bcongratulations\b/i, weight: 9, label: 'Lottery language' },
  { pattern: /\bviagra\b|\bcialis\b/i, weight: 15, label: 'Pharma spam' },
  { pattern: /\$\$\$|!!!|URGENT|WINNER/i, weight: 8, label: 'Shouting / symbols' }
];

function stripHtml(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function gradeFromScore(score) {
  if (score >= 85) {
    return { grade: 'A', label: 'Inbox-ready', tone: 'good' };
  }
  if (score >= 70) {
    return { grade: 'B', label: 'Low risk', tone: 'good' };
  }
  if (score >= 55) {
    return { grade: 'C', label: 'Review', tone: 'warn' };
  }
  if (score >= 40) {
    return { grade: 'D', label: 'High risk', tone: 'bad' };
  }
  return { grade: 'F', label: 'Likely spam', tone: 'bad' };
}

function analyzeSpamContent(input = {}) {
  const subject = String(input.subject || '').trim();
  const previewText = String(input.previewText || '').trim();
  const html = String(input.contentHtml || input.editorHtml || '');
  const plain = stripHtml(html);
  const combined = `${subject} ${previewText} ${plain}`.toLowerCase();

  let score = 100;
  const signals = [];
  const checklist = [];

  function addSignal(id, label, impact, ok, hint) {
    signals.push({ id, label, impact: Math.round(impact), ok });
    checklist.push({ id, label, ok, hint: hint || label });
    if (!ok) {
      score -= impact;
    }
  }

  const subjectLen = subject.length;
  addSignal(
    'subject_len',
    'Subject length',
    subjectLen >= 24 && subjectLen <= 60 ? 0 : 12,
    subjectLen >= 24 && subjectLen <= 60,
    `${subjectLen || 0} chars · aim 24–60`
  );

  const capsRatio = subject.replace(/[^A-Z]/g, '').length / Math.max(subject.length, 1);
  addSignal(
    'subject_caps',
    'Subject caps',
    capsRatio > 0.35 ? 14 : 0,
    capsRatio <= 0.35,
    capsRatio > 0.35 ? 'Reduce ALL CAPS' : 'OK'
  );

  const exclamations = (subject.match(/!/g) || []).length + (plain.match(/!/g) || []).length;
  addSignal(
    'punctuation',
    'Exclamation use',
    exclamations > 2 ? 10 : 0,
    exclamations <= 2,
    `${exclamations} found`
  );

  addSignal(
    'preview',
    'Preview text',
    previewText.length >= 35 && previewText.length <= 140 ? 0 : 10,
    previewText.length >= 35 && previewText.length <= 140,
    `${previewText.length || 0} chars`
  );

  const linkCount = (html.match(/<a\b/gi) || []).length;
  const linkDensity = linkCount / Math.max(plain.split(/\s+/).length, 1);
  addSignal(
    'links',
    'Link density',
    linkCount > 8 || linkDensity > 0.08 ? 12 : 0,
    linkCount <= 8 && linkDensity <= 0.08,
    `${linkCount} links`
  );

  const imgCount = (html.match(/<img\b/gi) || []).length;
  const textLen = plain.length;
  addSignal(
    'image_text',
    'Text vs images',
    imgCount > 0 && textLen < 120 ? 14 : 0,
    !(imgCount > 0 && textLen < 120),
    imgCount ? `${imgCount} images · ${textLen} chars text` : 'Balanced'
  );

  addSignal(
    'unsubscribe',
    'Unsubscribe',
    /\{\{\s*unsubscribe_url\s*\}\}/i.test(html) || /<a[^>]+unsubscribe/i.test(html) ? 0 : 18,
    /\{\{\s*unsubscribe_url\s*\}\}/i.test(html) || /<a[^>]+unsubscribe/i.test(html),
    'Add {{unsubscribe_url}}'
  );

  addSignal(
    'cta',
    'Primary CTA',
    /<a\b[^>]*href=/i.test(html) ? 0 : 8,
    /<a\b[^>]*href=/i.test(html),
    'Include one clear link'
  );

  let triggerPenalty = 0;
  const triggersHit = [];
  SPAM_TRIGGERS.forEach((trigger) => {
    if (trigger.pattern.test(combined)) {
      triggerPenalty += trigger.weight;
      triggersHit.push(trigger.label);
    }
  });
  triggerPenalty = Math.min(35, triggerPenalty);
  addSignal(
    'triggers',
    'Spam phrases',
    triggerPenalty || 0,
    triggerPenalty === 0,
    triggersHit.length ? triggersHit.slice(0, 3).join(', ') : 'None detected'
  );

  if (/<div[^>]+display\s*:\s*none/i.test(html) || /font-size\s*:\s*0/i.test(html)) {
    score -= 20;
    signals.push({ id: 'hidden', label: 'Hidden content', impact: 20, ok: false });
    checklist.push({ id: 'hidden', label: 'Hidden content', ok: false, hint: 'Remove hidden CSS tricks' });
  }

  score = clamp(Math.round(score), 0, 100);
  const grade = gradeFromScore(score);

  return {
    score,
    grade: grade.grade,
    gradeLabel: grade.label,
    gradeTone: grade.tone,
    signals: signals.sort((a, b) => Number(a.ok) - Number(b.ok)),
    checklist,
    triggers: triggersHit,
    metrics: {
      subjectLength: subjectLen,
      previewLength: previewText.length,
      linkCount,
      imageCount: imgCount,
      textLength: textLen,
      triggerCount: triggersHit.length
    }
  };
}

module.exports = { analyzeSpamContent };
