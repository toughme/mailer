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
  const words = plain.split(/\s+/).filter(Boolean);

  let score = 100;
  const signals = [];
  const checklist = [];

  function addSignal(id, label, impact, ok, hint) {
    const roundedImpact = Math.round(impact);
    signals.push({ id, label, impact: roundedImpact, ok });
    checklist.push({ id, label, ok, hint: hint || label });
    if (!ok) {
      score -= roundedImpact;
    }
  }

  const subjectLen = subject.length;
  addSignal(
    'subject_present',
    'Subject present',
    subject ? 0 : 18,
    Boolean(subject),
    subject ? 'Subject included' : 'Add a subject line'
  );

  addSignal(
    'subject_length',
    'Subject length',
    subjectLen && subjectLen < 12 ? 10 : subjectLen > 70 ? 10 : 0,
    subjectLen >= 12 && subjectLen <= 70,
    `${subjectLen || 0} chars · aim 12–70`
  );

  const capsRatio = subject.replace(/[^A-Z]/g, '').length / Math.max(subject.length, 1);
  addSignal(
    'subject_caps',
    'Subject capitalization',
    capsRatio > 0.4 ? 10 : 0,
    capsRatio <= 0.4,
    capsRatio > 0.4 ? 'Reduce ALL CAPS' : 'Good'
  );

  const subjectExclamations = (subject.match(/!/g) || []).length;
  addSignal(
    'subject_exclamation',
    'Subject punctuation',
    subjectExclamations > 1 ? 8 : 0,
    subjectExclamations <= 1,
    `${subjectExclamations} exclamation${subjectExclamations === 1 ? '' : 's'}`
  );

  addSignal(
    'preview_text',
    'Preview text',
    previewText ? (previewText.length < 20 || previewText.length > 120 ? 8 : 0) : 5,
    previewText.length >= 20 && previewText.length <= 120,
    previewText ? `${previewText.length} chars` : 'No preview text'
  );

  const textLen = plain.length;
  addSignal(
    'body_length',
    'Body length',
    textLen < 60 ? 14 : textLen < 120 ? 8 : 0,
    textLen >= 120,
    `${textLen} chars`
  );

  const linkCount = (html.match(/<a\b/gi) || []).length;
  const linkDensity = linkCount / Math.max(words.length, 1);
  addSignal(
    'link_density',
    'Link density',
    linkCount > 10 || linkDensity > 0.12 ? 10 : 0,
    linkCount <= 10 && linkDensity <= 0.12,
    `${linkCount} links`
  );

  const imgCount = (html.match(/<img\b/gi) || []).length;
  addSignal(
    'image_text_ratio',
    'Image to text ratio',
    imgCount > 0 && textLen < 140 ? 12 : 0,
    !(imgCount > 0 && textLen < 140),
    imgCount ? `${imgCount} images · ${textLen} chars text` : 'Balanced'
  );

  let triggerPenalty = 0;
  const triggersHit = [];
  SPAM_TRIGGERS.forEach((trigger) => {
    if (trigger.pattern.test(combined)) {
      triggerPenalty += trigger.weight;
      triggersHit.push(trigger.label);
    }
  });
  triggerPenalty = Math.min(30, triggerPenalty);
  addSignal(
    'spam_phrases',
    'Spam phrases',
    triggerPenalty,
    triggerPenalty === 0,
    triggersHit.length ? triggersHit.slice(0, 3).join(', ') : 'None detected'
  );

  const hiddenContent = /<div[^>]+style=["'][^"']*(display\s*:\s*none|font-size\s*:\s*0)[^"']*["']/i.test(html)
    || /font-size\s*:\s*0/i.test(html);
  if (hiddenContent) {
    addSignal('hidden_content', 'Hidden content', 18, false, 'Remove hidden CSS tricks');
  }

  if (/<a\b[^>]+href=["']?javascript:/i.test(html)) {
    addSignal('javascript_link', 'Suspicious link', 12, false, 'Avoid javascript: links');
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
