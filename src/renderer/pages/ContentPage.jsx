import React, { useEffect, useMemo, useRef, useState } from 'react';
import { desktopInvoke } from '../api';
import { analyzeSpamContent } from '../../core/services/spamScoringService';
import RichTextEditor from '../components/RichTextEditor';

const BUILDER_PREFIX = '<!-- phantom-email-builder:';
const BUILDER_SUFFIX = ' -->';

const blockCatalog = [
  { type: 'heading', label: 'Heading', icon: 'H' },
  { type: 'text', label: 'Text', icon: 'T' },
  { type: 'image', label: 'Image', icon: 'Img' },
  { type: 'button', label: 'Button', icon: 'CTA' },
  { type: 'divider', label: 'Divider', icon: '-' },
  { type: 'spacer', label: 'Spacer', icon: '+' },
  { type: 'social', label: 'Social links', icon: '@' },
  { type: 'logo', label: 'Logo/Header', icon: 'Logo' },
  { type: 'footer', label: 'Footer', icon: 'Foot' },
  { type: 'columns2', label: '2 Columns', icon: '2' },
  { type: 'columns3', label: '3 Columns', icon: '3' }
];

const fontOptions = [
  'Inter, Arial, Helvetica, sans-serif',
  'Arial, Helvetica, sans-serif',
  'Georgia, serif',
  'Tahoma, Arial, sans-serif'
];

const starterBlocks = [
  {
    id: makeId(),
    type: 'logo',
    content: 'PhantomMailer',
    styles: baseStyles({ fontSize: 20, fontWeight: 700, textColor: '#111827', paddingTop: 28, paddingBottom: 16, align: 'center' })
  },
  {
    id: makeId(),
    type: 'heading',
    content: 'Write a clear campaign headline',
    styles: baseStyles({ fontSize: 32, lineHeight: 1.2, fontWeight: 700, textColor: '#111827', paddingTop: 24, paddingBottom: 12, align: 'center' })
  },
  {
    id: makeId(),
    type: 'text',
    content: 'Hi {{first_name}}, use this canvas to design a focused email that looks good in Gmail, Outlook, and Apple Mail.',
    styles: baseStyles({ fontSize: 16, lineHeight: 1.65, textColor: '#374151', paddingTop: 8, paddingBottom: 20, align: 'left' })
  },
  {
    id: makeId(),
    type: 'button',
    content: 'Get started',
    url: 'https://',
    styles: baseStyles({ fontSize: 15, fontWeight: 700, textColor: '#ffffff', backgroundColor: '#111827', paddingTop: 14, paddingBottom: 14, paddingLeft: 24, paddingRight: 24, align: 'center', borderRadius: 8 })
  },
  {
    id: makeId(),
    type: 'footer',
    content: 'You are receiving this because you subscribed to updates. Unsubscribe: {{unsubscribe_url}}',
    styles: baseStyles({ fontSize: 12, lineHeight: 1.55, textColor: '#6b7280', backgroundColor: '#f9fafb', paddingTop: 22, paddingBottom: 22, paddingLeft: 28, paddingRight: 28, align: 'center' })
  }
];

const starterComposeBody = [
  '<p>Hi {{first_name}},</p>',
  '<p>Use this composer to draft your message, then switch into design mode when you want more layout control.</p>',
  '<p>Keep the tone clear, specific, and easy to scan.</p>',
  '<p>Best,<br>{{first_name}}</p>'
].join('');

const builtinTemplates = [
  {
    name: 'Minimal Newsletter',
    subject: 'Your weekly update from {{company}}',
    previewText: 'Highlights, ideas, and useful links',
    blocks: starterBlocks
  },
  {
    name: 'Product Announcement',
    subject: 'Introducing something new',
    previewText: 'A faster way to get more done',
    blocks: [
      makeBlock('logo'),
      makeBlock('heading', 'A simpler way to launch your next campaign'),
      makeBlock('text', 'Hi {{first_name}}, we built a cleaner workflow for teams that need polished outreach without wrestling with old email builders.'),
      makeBlock('image'),
      makeBlock('button', 'Explore the update'),
      makeBlock('divider'),
      makeBlock('footer')
    ]
  }
];

const composeTemplates = [
  {
    name: 'Warm intro',
    mode: 'compose',
    subject: 'A quick note from {{company}}',
    previewText: 'A short, human message',
    bodyHtml: '<p>Hi {{first_name}},</p><p>I wanted to send a quick note and share a few updates that may be useful.</p><p>Best,<br>{{first_name}}</p>'
  },
  {
    name: 'Follow-up',
    mode: 'compose',
    subject: 'Following up on my previous message',
    previewText: 'A polite follow-up email',
    bodyHtml: '<p>Hi {{first_name}},</p><p>Just following up on my previous note to see if you had any questions.</p><p>Best,<br>{{first_name}}</p>'
  },
  {
    name: 'Announcement',
    mode: 'compose',
    subject: 'Something new is here',
    previewText: 'Short announcement body',
    bodyHtml: '<p>Hi {{first_name}},</p><p>We are excited to share something new with you today.</p><p>Best,<br>{{first_name}}</p>'
  }
];

function makeId() {
  return `block_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function baseStyles(overrides = {}) {
  return {
    fontFamily: 'Inter, Arial, Helvetica, sans-serif',
    fontSize: 16,
    lineHeight: 1.55,
    fontWeight: 400,
    textColor: '#111827',
    backgroundColor: '#ffffff',
    paddingTop: 12,
    paddingRight: 28,
    paddingBottom: 12,
    paddingLeft: 28,
    marginTop: 0,
    marginBottom: 0,
    align: 'left',
    borderRadius: 0,
    width: 600,
    ...overrides
  };
}

function makeBlock(type, content) {
  const defaults = {
    heading: { content: content || 'New section heading', styles: baseStyles({ fontSize: 28, lineHeight: 1.25, fontWeight: 700, paddingTop: 24, paddingBottom: 10 }) },
    text: { content: content || 'Click to edit this paragraph. Keep it direct, human, and useful.', styles: baseStyles() },
    image: { content: content || 'Image description', src: '', styles: baseStyles({ paddingTop: 18, paddingBottom: 18, align: 'center', borderRadius: 8 }) },
    button: { content: content || 'Call to action', url: 'https://', styles: baseStyles({ align: 'center', fontWeight: 700, textColor: '#ffffff', backgroundColor: '#111827', borderRadius: 8, paddingTop: 14, paddingBottom: 14, paddingLeft: 24, paddingRight: 24 }) },
    divider: { content: '', styles: baseStyles({ paddingTop: 18, paddingBottom: 18, backgroundColor: '#e5e7eb' }) },
    spacer: { content: '', height: 28, styles: baseStyles({ paddingTop: 0, paddingBottom: 0 }) },
    social: { content: 'LinkedIn | X | Website', styles: baseStyles({ align: 'center', fontSize: 13, textColor: '#4b5563' }) },
    logo: { content: content || 'Your Brand', styles: baseStyles({ align: 'center', fontSize: 20, fontWeight: 700, paddingTop: 28, paddingBottom: 18 }) },
    footer: { content: content || 'Company Inc. 123 Main St. Unsubscribe: {{unsubscribe_url}}', styles: baseStyles({ align: 'center', fontSize: 12, lineHeight: 1.55, textColor: '#6b7280', backgroundColor: '#f9fafb', paddingTop: 22, paddingBottom: 22 }) },
    columns2: { content: '', columns: ['Left column content', 'Right column content'], styles: baseStyles({ paddingTop: 18, paddingBottom: 18 }) },
    columns3: { content: '', columns: ['First column', 'Second column', 'Third column'], styles: baseStyles({ paddingTop: 18, paddingBottom: 18 }) }
  };

  return { id: makeId(), type, ...defaults[type] };
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripTags(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function textToHtml(value) {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

function normalizeUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (/^(https?:|mailto:|tel:)/i.test(url)) return url;
  return `https://${url}`;
}

function sanitizeInlineHtml(value) {
  if (typeof document === 'undefined') {
    return textToHtml(value);
  }

  const template = document.createElement('template');
  template.innerHTML = String(value || '');
  const allowedTags = new Set(['A', 'B', 'BR', 'EM', 'I', 'STRONG', 'U']);

  function clean(node) {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        return;
      }

      if (child.nodeType !== Node.ELEMENT_NODE || !allowedTags.has(child.tagName)) {
        child.replaceWith(document.createTextNode(child.textContent || ''));
        return;
      }

      [...child.attributes].forEach((attribute) => child.removeAttribute(attribute.name));
      if (child.tagName === 'A') {
        const href = normalizeUrl(child.getAttribute('href') || '');
        if (href) {
          child.setAttribute('href', href);
          child.setAttribute('style', 'color:#2563eb;text-decoration:underline;');
          child.setAttribute('target', '_blank');
        } else {
          child.replaceWith(document.createTextNode(child.textContent || ''));
          return;
        }
      }
      clean(child);
    });
  }

  clean(template.content);
  return template.innerHTML.replace(/<div>/gi, '<br>').replace(/<\/div>/gi, '');
}

function getBlockInlineHtml(block) {
  return sanitizeInlineHtml(block.contentHtml || textToHtml(block.content || ''));
}

function px(value) {
  return `${Number(value) || 0}px`;
}

function blockPadding(styles) {
  return `${px(styles.paddingTop)} ${px(styles.paddingRight)} ${px(styles.paddingBottom)} ${px(styles.paddingLeft)}`;
}

function blockTextStyle(styles) {
  return `font-family:${styles.fontFamily};font-size:${px(styles.fontSize)};line-height:${styles.lineHeight};font-weight:${styles.fontWeight};color:${styles.textColor};text-align:${styles.align};margin:0;`;
}

function renderBlockHtml(block) {
  const styles = block.styles || baseStyles();
  const cellStyle = `padding:${blockPadding(styles)};background:${styles.backgroundColor};border-radius:${px(styles.borderRadius)};`;
  const textStyle = blockTextStyle(styles);

  if (block.type === 'heading' || block.type === 'logo') {
    return `<tr><td style="${cellStyle}"><h1 style="${textStyle}">${getBlockInlineHtml(block)}</h1></td></tr>`;
  }

  if (block.type === 'text' || block.type === 'footer' || block.type === 'social') {
    return `<tr><td style="${cellStyle}"><p style="${textStyle}">${getBlockInlineHtml(block)}</p></td></tr>`;
  }

  if (block.type === 'image') {
    const src = block.src || 'https://via.placeholder.com/560x260/f3f4f6/6b7280?text=Image';
    return `<tr><td align="${styles.align}" style="${cellStyle}"><img src="${escapeHtml(src)}" alt="${escapeHtml(block.content || 'Email image')}" width="544" style="display:block;width:100%;max-width:544px;height:auto;border:0;border-radius:${px(styles.borderRadius)};" /></td></tr>`;
  }

  if (block.type === 'button') {
    return `<tr><td align="${styles.align}" style="padding:${blockPadding(styles)};background:#ffffff;"><a href="${escapeHtml(normalizeUrl(block.url) || 'https://')}" style="display:inline-block;background:${styles.backgroundColor};color:${styles.textColor};font-family:${styles.fontFamily};font-size:${px(styles.fontSize)};font-weight:${styles.fontWeight};text-decoration:none;padding:12px 22px;border-radius:${px(styles.borderRadius)};">${textToHtml(block.content)}</a></td></tr>`;
  }

  if (block.type === 'divider') {
    return `<tr><td style="padding:${blockPadding(styles)};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr><td style="border-top:1px solid ${styles.backgroundColor};font-size:1px;line-height:1px;">&nbsp;</td></tr></table></td></tr>`;
  }

  if (block.type === 'spacer') {
    return `<tr><td style="height:${px(block.height || 28)};line-height:${px(block.height || 28)};font-size:1px;">&nbsp;</td></tr>`;
  }

  if (block.type === 'columns2' || block.type === 'columns3') {
    const columns = block.columns || [];
    const width = block.type === 'columns2' ? '50%' : '33.333%';
    return `<tr><td style="${cellStyle}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>${columns.map((column) => `<td width="${width}" valign="top" style="padding:8px;font-family:${styles.fontFamily};font-size:${px(styles.fontSize)};line-height:${styles.lineHeight};color:${styles.textColor};">${sanitizeInlineHtml(column)}</td>`).join('')}</tr></table></td></tr>`;
  }

  return '';
}

function buildEmailHtml({ subject, previewText, blocks, canvas }) {
  const bodyRows = blocks.map(renderBlockHtml).join('\n');
  const width = Number(canvas.width) || 600;
  const bg = canvas.backgroundColor || '#f3f4f6';
  const radius = Number(canvas.borderRadius) || 0;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(subject || 'Email draft')}</title>
  </head>
  <body style="margin:0;padding:0;background:${bg};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(previewText || '')}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:${bg};">
      <tr>
        <td align="center" style="padding:28px 12px;">
          <table role="presentation" width="${width}" cellpadding="0" cellspacing="0" style="width:100%;max-width:${width}px;border-collapse:collapse;background:${canvas.contentBackgroundColor || '#ffffff'};border-radius:${radius}px;overflow:hidden;">
            ${bodyRows}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildComposeEmailHtml({ subject, previewText, bodyHtml, canvas }) {
  const width = Number(canvas.width) || 600;
  const bg = canvas.backgroundColor || '#f3f4f6';
  const radius = Number(canvas.borderRadius) || 0;
  const body = String(bodyHtml || '<p></p>');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(subject || 'Email draft')}</title>
  </head>
  <body style="margin:0;padding:0;background:${bg};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(previewText || '')}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:${bg};">
      <tr>
        <td align="center" style="padding:28px 12px;">
          <table role="presentation" width="${width}" cellpadding="0" cellspacing="0" style="width:100%;max-width:${width}px;border-collapse:collapse;background:${canvas.contentBackgroundColor || '#ffffff'};border-radius:${radius}px;overflow:hidden;">
            <tr>
              <td style="padding:30px 34px;font-family:Inter, Arial, Helvetica, sans-serif;color:#111827;">
                ${body}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildRecipientSummary(recipients = {}) {
  return {
    to: String(recipients.to || '').trim(),
    cc: String(recipients.cc || '').trim(),
    bcc: String(recipients.bcc || '').trim()
  };
}

function buildComposePreviewHtml(bodyHtml, recipients) {
  const summary = buildRecipientSummary(recipients);
  const lines = [];
  if (summary.to) lines.push(`<div><strong>To:</strong> ${escapeHtml(summary.to)}</div>`);
  if (summary.cc) lines.push(`<div><strong>Cc:</strong> ${escapeHtml(summary.cc)}</div>`);
  if (summary.bcc) lines.push(`<div><strong>Bcc:</strong> ${escapeHtml(summary.bcc)}</div>`);

  return `${lines.join('') ? `<div style="margin-bottom:18px;color:#64748b;font-size:13px;line-height:1.6;">${lines.join('')}</div>` : ''}
${bodyHtml || '<p></p>'}`;
}

function serializeBuilder(state) {
  return `${BUILDER_PREFIX}${encodeURIComponent(JSON.stringify(state))}${BUILDER_SUFFIX}`;
}

function parseBuilder(value) {
  const text = String(value || '');
  if (!text.startsWith(BUILDER_PREFIX)) {
    return null;
  }
  const encoded = text.slice(BUILDER_PREFIX.length, text.indexOf(BUILDER_SUFFIX));
  try {
    return JSON.parse(decodeURIComponent(encoded));
  } catch {
    return null;
  }
}

function fallbackComposeBody(value) {
  const text = stripTags(value || '');
  return text ? textToHtml(text) : '<p></p>';
}

function ContentPage() {
  const toolMenuRef = useRef(null);
  const saveDocumentRef = useRef(null);
  const [documents, setDocuments] = useState([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState('');
  const [name, setName] = useState('Untitled content');
  const [subject, setSubject] = useState('');
  const [previewText, setPreviewText] = useState('');
  const [recipients, setRecipients] = useState({ to: '', cc: '', bcc: '' });
  const [blocks, setBlocks] = useState(starterBlocks);
  const [selectedBlockId, setSelectedBlockId] = useState(starterBlocks[1].id);
  const [bodyHtml, setBodyHtml] = useState(starterComposeBody);
  const [contentMode, setContentMode] = useState('compose');
  const [showHtmlView, setShowHtmlView] = useState(false);
  const [canvas, setCanvas] = useState({ width: 600, backgroundColor: '#f3f4f6', contentBackgroundColor: '#ffffff', borderRadius: 10 });
  const [device, setDevice] = useState('desktop');
  const [draggedBlockId, setDraggedBlockId] = useState(null);
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);
  const [savedMessage, setSavedMessage] = useState('');
  const [error, setError] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [templates, setTemplates] = useState(() => JSON.parse(localStorage.getItem('pm.content.templates') || '[]'));
  const [savedBlocks, setSavedBlocks] = useState(() => JSON.parse(localStorage.getItem('pm.content.blocks') || '[]'));
  const [showTemplates, setShowTemplates] = useState(false);
  const [showSavedBlocks, setShowSavedBlocks] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(true);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(true);
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);

  const selectedBlock = blocks.find((block) => block.id === selectedBlockId) || blocks[0];
  const builderHtml = useMemo(() => buildEmailHtml({ subject, previewText, blocks, canvas }), [subject, previewText, blocks, canvas]);
  const composeHtml = useMemo(() => buildComposeEmailHtml({ subject, previewText, bodyHtml, canvas }), [subject, previewText, bodyHtml, canvas]);
  const activeHtml = contentMode === 'compose' ? composeHtml : builderHtml;
  const spamAnalytics = useMemo(
    () => analyzeSpamContent({ subject, previewText, contentHtml: activeHtml, editorHtml: activeHtml }),
    [subject, previewText, activeHtml]
  );

  useEffect(() => {
    desktopInvoke('content:list-documents')
      .then((rows) => {
        setDocuments(rows);
        if (rows[0]) {
          loadDocument(rows[0]);
        }
      })
      .catch((loadError) => setError(loadError.message));
  }, []);

  useEffect(() => {
    const handler = (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        saveDocumentRef.current?.();
      }
      if (key === 'z') {
        event.preventDefault();
        undo();
      }
      if (key === 'y') {
        event.preventDefault();
        redo();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!toolMenuOpen) {
        return;
      }

      if (toolMenuRef.current && !toolMenuRef.current.contains(event.target)) {
        setToolMenuOpen(false);
      }
    };

    window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, [toolMenuOpen]);

  function snapshot() {
    return { blocks, canvas };
  }

  function commit(nextBlocks, nextCanvas = canvas) {
    setHistory((items) => [...items.slice(-40), snapshot()]);
    setFuture([]);
    setBlocks(nextBlocks);
    setCanvas(nextCanvas);
  }

  function undo() {
    const previous = history[history.length - 1];
    if (!previous) return;
    setFuture((items) => [snapshot(), ...items]);
    setHistory((items) => items.slice(0, -1));
    setBlocks(previous.blocks);
    setCanvas(previous.canvas);
  }

  function redo() {
    const next = future[0];
    if (!next) return;
    setHistory((items) => [...items, snapshot()]);
    setFuture((items) => items.slice(1));
    setBlocks(next.blocks);
    setCanvas(next.canvas);
  }

  function loadDocument(documentRow) {
    const parsed = parseBuilder(documentRow.editorHtml);
    setSelectedDocumentId(String(documentRow.id || ''));
    setName(documentRow.name || 'Untitled content');
    setSubject(documentRow.subject || '');
    setPreviewText(documentRow.previewText || '');
    setRecipients(buildRecipientSummary(parsed?.recipients || {}));
    const initialMode = parsed?.mode === 'html' ? 'compose' : parsed?.mode || (parsed?.blocks?.length ? 'design' : 'compose');
    setContentMode(initialMode);
    setShowHtmlView(false);
    if (parsed?.blocks?.length) {
      setBlocks(parsed.blocks);
      setCanvas(parsed.canvas || canvas);
      setSelectedBlockId(parsed.blocks[0].id);
      setBodyHtml(parsed.bodyHtml || fallbackComposeBody(documentRow.contentHtml || ''));
    } else {
      const legacyBlock = makeBlock('text', stripTags(documentRow.editorHtml || documentRow.contentHtml || 'Start writing your email...'));
      setBlocks([legacyBlock]);
      setSelectedBlockId(legacyBlock.id);
      setBodyHtml(fallbackComposeBody(documentRow.contentHtml || documentRow.editorHtml || ''));
    }
    setHistory([]);
    setFuture([]);
    setError('');
    setSavedMessage('');
  }

  function createNewDocument() {
    const freshBlocks = starterBlocks.map((block) => ({ ...block, id: makeId(), styles: { ...block.styles } }));
    setSelectedDocumentId('');
    setName('Untitled content');
    setSubject('');
    setPreviewText('');
    setRecipients({ to: '', cc: '', bcc: '' });
    setBlocks(freshBlocks);
    setSelectedBlockId(freshBlocks[1].id);
    setBodyHtml(starterComposeBody);
    setContentMode('compose');
    setShowHtmlView(false);
    setHistory([]);
    setFuture([]);
  }

  function addBlock(type, index = blocks.length) {
    const block = makeBlock(type);
    const next = [...blocks.slice(0, index), block, ...blocks.slice(index)];
    commit(next);
    setSelectedBlockId(block.id);
  }

  function addBlockAfterSelected(type) {
    const selectedIndex = blocks.findIndex((block) => block.id === selectedBlockId);
    addBlock(type, selectedIndex >= 0 ? selectedIndex + 1 : blocks.length);
  }

  function updateBlock(id, patch) {
    commit(blocks.map((block) => (block.id === id ? { ...block, ...patch } : block)));
  }

  function updateBlockStyles(id, patch) {
    commit(blocks.map((block) => (block.id === id ? { ...block, styles: { ...block.styles, ...patch } } : block)));
  }

  function duplicateBlock(id) {
    const index = blocks.findIndex((block) => block.id === id);
    if (index < 0) return;
    const clone = { ...blocks[index], id: makeId(), styles: { ...blocks[index].styles }, columns: blocks[index].columns ? [...blocks[index].columns] : undefined };
    commit([...blocks.slice(0, index + 1), clone, ...blocks.slice(index + 1)]);
    setSelectedBlockId(clone.id);
  }

  function deleteBlock(id) {
    if (blocks.length <= 1) return;
    const next = blocks.filter((block) => block.id !== id);
    commit(next);
    setSelectedBlockId(next[0]?.id || '');
  }

  function moveBlock(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return;
    const fromIndex = blocks.findIndex((block) => block.id === fromId);
    const toIndex = blocks.findIndex((block) => block.id === toId);
    if (fromIndex < 0 || toIndex < 0) return;
    const next = [...blocks];
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    commit(next);
  }

  function persistEditableContent(blockId) {
    const element = document.querySelector(`[data-editable-block-id="${blockId}"]`);
    if (!element) return;
    const contentHtml = sanitizeInlineHtml(element.innerHTML);
    updateBlock(blockId, {
      contentHtml,
      content: stripTags(contentHtml)
    });
  }

  function runInlineCommand(event, command, blockId) {
    event.preventDefault();
    event.stopPropagation();
    document.execCommand(command, false, null);
    persistEditableContent(blockId);
  }

  function applyInlineLink(event, blockId) {
    event.preventDefault();
    event.stopPropagation();
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      setError('Select text inside the block before adding a link.');
      return;
    }
    const href = normalizeUrl(window.prompt('Link URL', 'https://') || '');
    if (!href) return;
    document.execCommand('createLink', false, href);
    persistEditableContent(blockId);
    setError('');
  }

  function removeInlineLink(event, blockId) {
    event.preventDefault();
    event.stopPropagation();
    document.execCommand('unlink', false, null);
    persistEditableContent(blockId);
  }

  async function pickImage(blockId) {
    try {
      const result = await desktopInvoke('content:pick-image');
      if (result?.src) {
        updateBlock(blockId, { src: result.src, content: result.name || 'Email image' });
      }
    } catch (imageError) {
      setError(imageError.message);
    }
  }

  async function runAi(mode, targetBlock = selectedBlock) {
    setAiBusy(true);
    setError('');
    try {
      const targetHtml = contentMode === 'compose'
        ? bodyHtml
        : (targetBlock ? renderBlockHtml(targetBlock) : builderHtml);
      const result = await desktopInvoke('ai:process-email', {
        mode,
        html: targetHtml,
        subject,
        previewText
      });
      if (contentMode === 'compose') {
        setBodyHtml(result.improvedHtml || result.improved || bodyHtml);
      } else if (targetBlock && ['text', 'heading', 'footer', 'social', 'logo', 'button'].includes(targetBlock.type)) {
        updateBlock(targetBlock.id, { content: stripTags(result.improvedHtml || result.improved) });
      } else {
        const block = makeBlock('text', stripTags(result.improvedHtml || result.improved));
        commit([block]);
        setSelectedBlockId(block.id);
      }
      if (result.subject) setSubject(result.subject);
      if (result.previewText) setPreviewText(result.previewText);
    } catch (aiError) {
      setError(aiError.message);
    } finally {
      setAiBusy(false);
    }
  }

  async function saveDocument() {
    if (!subject.trim()) {
      setError('Subject is required before saving.');
      return;
    }
    if (!activeHtml.trim()) {
      setError('Content body is empty. Write something before saving.');
      return;
    }

    try {
      const nextEditorState = {
        blocks,
        canvas,
        bodyHtml,
        mode: contentMode,
        recipients
      };
      const rows = await desktopInvoke('content:save-document', {
        id: selectedDocumentId ? Number(selectedDocumentId) : null,
        name,
        subject,
        previewText,
        editorHtml: serializeBuilder(nextEditorState),
        contentHtml: activeHtml
      });
      if (!Array.isArray(rows)) {
        throw new Error('Unexpected response from save endpoint.');
      }
      setDocuments(rows);
      const saved = rows.find((row) => row.name === name) || rows[0];
      if (saved) loadDocument(saved);
      setSavedMessage('Saved. This content is now available inside Campaigns.');
      setError('');
      setTimeout(() => setSavedMessage(''), 3000);
    } catch (saveError) {
      setError(saveError.message || 'Failed to save document.');
    }
  }

  saveDocumentRef.current = saveDocument;

  async function deleteDocument() {
    if (!selectedDocumentId) {
      createNewDocument();
      return;
    }
    try {
      const rows = await desktopInvoke('content:delete-document', { id: Number(selectedDocumentId) });
      if (!Array.isArray(rows)) {
        throw new Error('Unexpected response from delete endpoint.');
      }
      setDocuments(rows);
      rows[0] ? loadDocument(rows[0]) : createNewDocument();
      setError('');
    } catch (deleteError) {
      setError(deleteError.message || 'Failed to delete document.');
    }
  }

  function exportHtml() {
    const blob = new Blob([activeHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name || 'email'}.html`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function saveTemplate() {
    const templateName = window.prompt('Template name', name || 'Reusable template');
    if (!templateName) return;
    const template = contentMode === 'compose'
      ? { name: templateName, mode: 'compose', subject, previewText, bodyHtml, canvas, recipients }
      : { name: templateName, mode: 'design', subject, previewText, blocks, canvas };
    const next = [template, ...templates].slice(0, 24);
    setTemplates(next);
    localStorage.setItem('pm.content.templates', JSON.stringify(next));
  }

  function saveSelectedBlock() {
    if (!selectedBlock) return;
    const blockName = window.prompt('Component name', selectedBlock.type);
    if (!blockName) return;
    const next = [{ name: blockName, block: selectedBlock }, ...savedBlocks].slice(0, 40);
    setSavedBlocks(next);
    localStorage.setItem('pm.content.blocks', JSON.stringify(next));
  }

  function applyTemplate(template) {
    setName(template.name);
    setSubject(template.subject || '');
    setPreviewText(template.previewText || '');
    setRecipients(buildRecipientSummary(template.recipients || {}));
    setCanvas(template.canvas || canvas);
    if (template.mode === 'compose') {
      setContentMode('compose');
      setShowHtmlView(false);
      setBodyHtml(template.bodyHtml || starterComposeBody);
    } else {
      const cloned = (template.blocks || []).map((block) => ({ ...block, id: makeId(), styles: { ...block.styles }, columns: block.columns ? [...block.columns] : undefined }));
      setContentMode('design');
      setShowHtmlView(false);
      commit(cloned, template.canvas || canvas);
      setSelectedBlockId(cloned[0]?.id || '');
    }
    setShowTemplates(false);
  }

  function renderCanvasBlock(block) {
    const selected = block.id === selectedBlockId;
    const styles = block.styles || baseStyles();
    const commonStyle = {
      fontFamily: styles.fontFamily,
      color: styles.textColor,
      background: block.type === 'button' ? 'transparent' : styles.backgroundColor,
      padding: blockPadding(styles),
      textAlign: styles.align,
      borderRadius: styles.borderRadius,
      lineHeight: styles.lineHeight,
      fontSize: styles.fontSize
    };

    return (
      <div
        key={block.id}
        className={`builder-block ${selected ? 'selected' : ''}`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={() => moveBlock(draggedBlockId, block.id)}
        onClick={() => setSelectedBlockId(block.id)}
      >
        <div className="block-mini-toolbar">
          <button
            type="button"
            className="drag-handle"
            draggable
            onDragStart={(event) => {
              event.stopPropagation();
              setDraggedBlockId(block.id);
            }}
          >
            Move
          </button>
          {['text', 'heading', 'footer', 'social', 'logo'].includes(block.type) && (
            <>
              <button type="button" onMouseDown={(event) => runInlineCommand(event, 'bold', block.id)}>B</button>
              <button type="button" onMouseDown={(event) => runInlineCommand(event, 'italic', block.id)}>I</button>
              <button type="button" onMouseDown={(event) => runInlineCommand(event, 'underline', block.id)}>U</button>
              <button type="button" onMouseDown={(event) => applyInlineLink(event, block.id)}>Link</button>
              <button type="button" onMouseDown={(event) => removeInlineLink(event, block.id)}>Unlink</button>
            </>
          )}
          <button type="button" onClick={(event) => { event.stopPropagation(); duplicateBlock(block.id); }}>Duplicate</button>
          <button type="button" onClick={(event) => { event.stopPropagation(); deleteBlock(block.id); }}>Delete</button>
          {['text', 'heading', 'footer', 'social', 'logo'].includes(block.type) && (
            <button type="button" onClick={(event) => { event.stopPropagation(); runAi('improve', block); }}>AI</button>
          )}
        </div>

        {block.type === 'heading' || block.type === 'logo' ? (
          <h2
            contentEditable
            suppressContentEditableWarning
            data-editable-block-id={block.id}
            style={{ ...commonStyle, margin: 0, fontWeight: styles.fontWeight }}
            onBlur={(event) => updateBlock(block.id, { contentHtml: sanitizeInlineHtml(event.currentTarget.innerHTML), content: event.currentTarget.innerText })}
            dangerouslySetInnerHTML={{ __html: getBlockInlineHtml(block) }}
          />
        ) : null}

        {['text', 'footer', 'social'].includes(block.type) ? (
          <p
            contentEditable
            suppressContentEditableWarning
            data-editable-block-id={block.id}
            style={{ ...commonStyle, margin: 0, fontWeight: styles.fontWeight }}
            onBlur={(event) => updateBlock(block.id, { contentHtml: sanitizeInlineHtml(event.currentTarget.innerHTML), content: event.currentTarget.innerText })}
            dangerouslySetInnerHTML={{ __html: getBlockInlineHtml(block) }}
          />
        ) : null}

        {block.type === 'image' ? (
          <button type="button" className="image-drop-zone" onClick={() => pickImage(block.id)} style={commonStyle}>
            {block.src ? <img src={block.src} alt={block.content || 'Email'} /> : <span>Choose image</span>}
          </button>
        ) : null}

        {block.type === 'button' ? (
          <div style={{ padding: blockPadding(styles), textAlign: styles.align }}>
            <a style={{ display: 'inline-block', color: styles.textColor, background: styles.backgroundColor, borderRadius: styles.borderRadius, padding: '12px 22px', fontFamily: styles.fontFamily, fontSize: styles.fontSize, fontWeight: styles.fontWeight, textDecoration: 'none' }}>
              <span contentEditable suppressContentEditableWarning onBlur={(event) => updateBlock(block.id, { content: event.currentTarget.innerText })}>{block.content}</span>
            </a>
          </div>
        ) : null}

        {block.type === 'divider' ? <div style={{ padding: blockPadding(styles) }}><div style={{ borderTop: `1px solid ${styles.backgroundColor}` }} /></div> : null}
        {block.type === 'spacer' ? <div style={{ height: block.height || 28 }} /> : null}

        {['columns2', 'columns3'].includes(block.type) ? (
          <div className={`email-columns ${block.type}`} style={commonStyle}>
            {(block.columns || []).map((column, index) => (
              <div
                key={index}
                contentEditable
                suppressContentEditableWarning
                onBlur={(event) => {
                  const columns = [...(block.columns || [])];
                  columns[index] = sanitizeInlineHtml(event.currentTarget.innerHTML);
                  updateBlock(block.id, { columns });
                }}
                dangerouslySetInnerHTML={{ __html: sanitizeInlineHtml(column) }}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <section
      className={`builder-shell ${showHtmlView ? 'html-shell' : contentMode === 'compose' ? 'compose-shell' : 'design-shell'}`}
      style={{
        '--left-panel-width': leftPanelCollapsed ? '56px' : '264px',
        '--right-panel-width': rightPanelCollapsed ? '56px' : '308px'
      }}
    >
      {contentMode === 'design' && !showHtmlView ? (
        <aside className={`builder-sidebar blocks-panel ${leftPanelCollapsed ? 'collapsed' : ''}`}>
        <div className="builder-panel-head">
          <div className="panel-title-block">
            <strong>Blocks</strong>
            {!leftPanelCollapsed ? <span>Drag blocks into the canvas</span> : null}
          </div>
          <div className="panel-head-actions">
            {!leftPanelCollapsed ? (
              <button type="button" onClick={() => setShowSavedBlocks((current) => !current)}>
                Saved
              </button>
            ) : null}
            <button
              type="button"
              className="panel-toggle-button"
              onClick={() => setLeftPanelCollapsed((current) => !current)}
              aria-expanded={!leftPanelCollapsed}
              title={leftPanelCollapsed ? 'Open blocks panel' : 'Collapse blocks panel'}
            >
              {leftPanelCollapsed ? '›' : '‹'}
            </button>
          </div>
        </div>
        {!leftPanelCollapsed ? (
          <div className="sidebar-body">
            <div className="block-palette">
              {blockCatalog.map((item) => (
                <button key={item.type} type="button" draggable onDragStart={() => setDraggedBlockId(`new:${item.type}`)} onClick={() => addBlockAfterSelected(item.type)}>
                  <span>{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
            {showSavedBlocks ? (
              <div className="saved-list">
                {savedBlocks.map((item, index) => (
                  <button
                    key={`${item.name}-${index}`}
                    type="button"
                    onClick={() => {
                      const block = { ...item.block, id: makeId(), styles: { ...item.block.styles }, columns: item.block.columns ? [...item.block.columns] : undefined };
                      commit([...blocks, block]);
                      setSelectedBlockId(block.id);
                    }}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="collapsed-rail">
            <button type="button" onClick={() => setLeftPanelCollapsed(false)} title="Open blocks panel">
              Blocks
            </button>
          </div>
        )}
        </aside>
      ) : null}

      <main className="builder-main">
        {showHtmlView ? (
          <div className="compose-stage">
            <div className="compose-header">
              <div className="compose-header-row">
                <div className="compose-header-actions">
                  <button type="button" className="secondary-button sm" onClick={() => setShowHtmlView(false)}>
                    Back to {contentMode === 'compose' ? 'Compose' : 'Design'} mode
                  </button>
                  <button type="button" className="secondary-button sm" onClick={exportHtml}>
                    Export HTML
                  </button>
                </div>
              </div>
            </div>
            <div className="code-editor-panel">
              <textarea
                className="code-editor rich-code-editor"
                value={activeHtml}
                readOnly
                spellCheck={false}
              />
            </div>
          </div>
  ) : contentMode === 'compose' ? (
  <div className="compose-stage">
    <div className="compose-header">
      <div className="compose-header-row">
        <div className="compose-header-fields">
          <label className="compose-subject-field">
            Subject
            <input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Write a subject line" />
          </label>
          <label className="compose-preview-field">
            Preview text
            <input value={previewText} onChange={(event) => setPreviewText(event.target.value)} placeholder="Short preview shown in inbox" />
          </label>
        </div>
        <div className="compose-header-actions">
          <span className={`spam-grade-pill tone-${spamAnalytics.gradeTone}`}>{spamAnalytics.score} · {spamAnalytics.grade}</span>
          <button type="button" className="secondary-button sm" onClick={() => setShowTemplates((current) => !current)}>
            Templates
          </button>
          <button type="button" className="primary-button sm" onClick={saveDocument} disabled={!subject.trim() || !activeHtml.trim()}>Save</button>
        </div>
      </div>
    </div>
              <RichTextEditor
                content={bodyHtml}
                onChange={setBodyHtml}
                tokens={[
                  { label: 'First name', value: '{{first_name}}' },
                  { label: 'Last name', value: '{{last_name}}' },
                  { label: 'Company', value: '{{company}}' },
                  { label: 'Unsubscribe', value: '{{unsubscribe_url}}' }
                ]}
                onPickImage={async () => {
                  const result = await desktopInvoke('content:pick-image');
                  return result?.src ? result : null;
                }}
                onPickAttachment={async () => {
                  const result = await desktopInvoke('content:pick-attachment');
                  return Array.isArray(result) ? result : [];
                }}
                onAiRewrite={async (payload) => desktopInvoke('ai:process-email', {
                  mode: payload.mode || 'rewrite',
                  html: payload.html || bodyHtml,
                  selectedText: payload.selectedText || '',
                  subject,
                  previewText
                })}
                defaultSignature="<p>Best,<br>{{first_name}}</p>"
                onSwitchMode={() => setShowHtmlView(true)}
                onToggleTemplates={() => setShowTemplates((current) => !current)}
                showTemplates={showTemplates}
                onToggleKeyboardHelp={() => setShowKeyboardHelp((current) => !current)}
                showKeyboardHelp={showKeyboardHelp}
                previewMode={device}
                onTogglePreviewMode={() => setDevice((current) => (current === 'desktop' ? 'mobile' : 'desktop'))}
                variant="compose"
              />
    {showTemplates ? (
      <div className="builder-template-strip compose-template-strip">
        {[...composeTemplates, ...templates.filter((template) => template.mode === 'compose')].map((template, index) => (
          <button key={`${template.name}-${index}`} type="button" onClick={() => applyTemplate(template)}>
            <strong>{template.name}</strong>
            <span>{template.subject}</span>
          </button>
        ))}
      </div>
    ) : null}
    {savedMessage ? <p className="success-text">{savedMessage}</p> : null}
    {error ? <p className="error-text">{error}</p> : null}
  </div>
          ) : (
          <>
            <div className="content-shell-header">
              <div className="content-shell-title">
                <p className="content-shell-kicker">Design mode</p>
                <h2>Email blocks</h2>
              </div>
              <div className="content-shell-actions">
                <button type="button" className="secondary-button sm" onClick={() => { setShowHtmlView(false); setContentMode('compose'); }}>
                  Compose mode
                </button>
                <button type="button" className="secondary-button sm" onClick={() => setShowHtmlView(true)}>
                  HTML view
                </button>
                <button type="button" className="secondary-button sm" onClick={() => setLeftPanelCollapsed((current) => !current)}>
                  {leftPanelCollapsed ? 'Show blocks' : 'Hide blocks'}
                </button>
                <button type="button" className="secondary-button sm" onClick={() => setRightPanelCollapsed((current) => !current)}>
                  {rightPanelCollapsed ? 'Show settings' : 'Hide settings'}
                </button>
              </div>
            </div>
            <div className="builder-topbar">
              <select
                value={selectedDocumentId}
                onChange={(event) => {
                  const next = documents.find((documentRow) => String(documentRow.id) === event.target.value);
                  if (next) loadDocument(next);
                }}
              >
                <option value="">Draft</option>
                {documents.map((documentRow) => (
                  <option key={documentRow.id} value={documentRow.id}>
                    {documentRow.name}
                  </option>
                ))}
              </select>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Document name" />
              <input value={previewText} onChange={(event) => setPreviewText(event.target.value)} placeholder="Preview text" />
              <div className="builder-topbar-actions">
                <button type="button" onClick={saveDocument} className="primary-button sm">Save</button>
                <button type="button" onClick={() => setShowTemplates((current) => !current)}>Templates</button>
                <div className="toolbar-dropdown" ref={toolMenuRef}>
                  <button
                    type="button"
                    className={`toolbar-btn ${toolMenuOpen ? 'active' : ''}`}
                    onClick={() => setToolMenuOpen((current) => !current)}
                  >
                    ⋯
                  </button>
                  {toolMenuOpen ? (
                    <div className="toolbar-dropdown-menu toolbar-dropdown-menu-wide">
                      <button type="button" onClick={() => { setToolMenuOpen(false); runAi('write', null); }}>AI write</button>
                      <button type="button" onClick={() => { setToolMenuOpen(false); runAi('improve', selectedBlock); }}>AI improve</button>
                      <button type="button" onClick={() => { setToolMenuOpen(false); runAi('spam_check', selectedBlock); }}>AI spam check</button>
                      <div className="toolbar-dropdown-separator" />
                      {blockCatalog.map((item) => (
                        <button key={item.type} type="button" onClick={() => { setToolMenuOpen(false); addBlockAfterSelected(item.type); }}>
                          Add {item.label}
                        </button>
                      ))}
                      <div className="toolbar-dropdown-separator" />
                      <button type="button" onClick={() => { setToolMenuOpen(false); exportHtml(); }}>Export HTML</button>
                      <button type="button" onClick={() => { setToolMenuOpen(false); setShowPreview(true); }}>Preview test</button>
                      <button type="button" onClick={() => { setToolMenuOpen(false); createNewDocument(); }}>New draft</button>
                      <button type="button" onClick={() => { setToolMenuOpen(false); deleteDocument(); }}>Delete draft</button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
            {showTemplates ? (
              <div className="builder-template-strip">
                {[...builtinTemplates, ...templates].map((template, index) => (
                  <button key={`${template.name}-${index}`} type="button" onClick={() => applyTemplate(template)}>
                    <strong>{template.name}</strong>
                    <span>{template.subject}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <div className="email-stage" style={{ background: canvas.backgroundColor }}>
              <div
                className={`email-canvas ${device}`}
                style={{ width: device === 'desktop' ? canvas.width : 375, background: canvas.contentBackgroundColor, borderRadius: canvas.borderRadius }}
                onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (draggedBlockId?.startsWith('new:')) {
                  addBlock(draggedBlockId.replace('new:', ''));
                }
              }}
              >
                {blocks.map(renderCanvasBlock)}
              </div>
            </div>
            {savedMessage ? <p className="success-text">{savedMessage}</p> : null}
            {error ? <p className="error-text">{error}</p> : null}
          </>
        )}
      </main>

      {contentMode === 'design' && !showHtmlView ? (
        <aside className={`builder-sidebar settings-panel ${rightPanelCollapsed ? 'collapsed' : ''}`}>
        <div className="builder-panel-head">
          <div className="panel-title-block">
            <strong>Settings</strong>
            {!rightPanelCollapsed ? <span>Block inspector and canvas settings</span> : null}
          </div>
          <div className="panel-head-actions">
            {selectedBlock && !rightPanelCollapsed && contentMode === 'design' ? <button type="button" onClick={saveSelectedBlock}>Save block</button> : null}
            <button
              type="button"
              className="panel-toggle-button"
              onClick={() => setRightPanelCollapsed((current) => !current)}
              aria-expanded={!rightPanelCollapsed}
              title={rightPanelCollapsed ? 'Open settings panel' : 'Collapse settings panel'}
            >
              {rightPanelCollapsed ? '‹' : '›'}
            </button>
          </div>
        </div>
        {!rightPanelCollapsed ? (
          <div className="sidebar-body">
            {contentMode === 'design' && selectedBlock ? (
              <div className="settings-form">
                {['text', 'heading', 'footer', 'social', 'logo'].includes(selectedBlock.type) && (
                  <div className="settings-hint">
                    Select text on the canvas, then use B, I, U, Link, or Unlink in the block toolbar.
                  </div>
                )}
                <label>Font family<select value={selectedBlock.styles.fontFamily} onChange={(event) => updateBlockStyles(selectedBlock.id, { fontFamily: event.target.value })}>{fontOptions.map((font) => <option key={font} value={font}>{font.split(',')[0]}</option>)}</select></label>
                <label>Font size<input type="number" value={selectedBlock.styles.fontSize} onChange={(event) => updateBlockStyles(selectedBlock.id, { fontSize: Number(event.target.value) })} /></label>
                <label>Line height<input type="number" step="0.05" value={selectedBlock.styles.lineHeight} onChange={(event) => updateBlockStyles(selectedBlock.id, { lineHeight: Number(event.target.value) })} /></label>
                <label>Text color<input type="color" value={selectedBlock.styles.textColor} onChange={(event) => updateBlockStyles(selectedBlock.id, { textColor: event.target.value })} /></label>
                <label>Background<input type="color" value={selectedBlock.styles.backgroundColor} onChange={(event) => updateBlockStyles(selectedBlock.id, { backgroundColor: event.target.value })} /></label>
                <label>Alignment<select value={selectedBlock.styles.align} onChange={(event) => updateBlockStyles(selectedBlock.id, { align: event.target.value })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
                <label>Padding top<input type="number" value={selectedBlock.styles.paddingTop} onChange={(event) => updateBlockStyles(selectedBlock.id, { paddingTop: Number(event.target.value) })} /></label>
                <label>Padding sides<input type="number" value={selectedBlock.styles.paddingLeft} onChange={(event) => updateBlockStyles(selectedBlock.id, { paddingLeft: Number(event.target.value), paddingRight: Number(event.target.value) })} /></label>
                <label>Padding bottom<input type="number" value={selectedBlock.styles.paddingBottom} onChange={(event) => updateBlockStyles(selectedBlock.id, { paddingBottom: Number(event.target.value) })} /></label>
                <label>Border radius<input type="number" value={selectedBlock.styles.borderRadius} onChange={(event) => updateBlockStyles(selectedBlock.id, { borderRadius: Number(event.target.value) })} /></label>
                {selectedBlock.type === 'button' && (
                  <>
                    <label>Button text<input value={selectedBlock.content || ''} onChange={(event) => updateBlock(selectedBlock.id, { content: event.target.value })} /></label>
                    <label>Button URL<input value={selectedBlock.url || ''} onChange={(event) => updateBlock(selectedBlock.id, { url: event.target.value })} /></label>
                  </>
                )}
                {selectedBlock.type === 'image' && (
                  <>
                    <label>Image URL<input value={selectedBlock.src || ''} onChange={(event) => updateBlock(selectedBlock.id, { src: event.target.value })} /></label>
                    <label>Alt text<input value={selectedBlock.content || ''} onChange={(event) => updateBlock(selectedBlock.id, { content: event.target.value })} /></label>
                    <button type="button" className="settings-secondary-button" onClick={() => pickImage(selectedBlock.id)}>Choose local image</button>
                  </>
                )}
                {selectedBlock.type === 'spacer' && <label>Height<input type="number" value={selectedBlock.height || 28} onChange={(event) => updateBlock(selectedBlock.id, { height: Number(event.target.value) })} /></label>}
              </div>
            ) : (
              <div className="settings-hint">
                Compose mode keeps the center focused on writing. Switch to Design to inspect blocks and canvas settings.
              </div>
            )}

            <div className="section-settings">
              <strong>Section</strong>
              <label>Width<input type="number" value={canvas.width} onChange={(event) => commit(blocks, { ...canvas, width: Number(event.target.value) })} /></label>
              <label>Outer background<input type="color" value={canvas.backgroundColor} onChange={(event) => commit(blocks, { ...canvas, backgroundColor: event.target.value })} /></label>
              <label>Canvas background<input type="color" value={canvas.contentBackgroundColor} onChange={(event) => commit(blocks, { ...canvas, contentBackgroundColor: event.target.value })} /></label>
              <label>Border radius<input type="number" value={canvas.borderRadius} onChange={(event) => commit(blocks, { ...canvas, borderRadius: Number(event.target.value) })} /></label>
            </div>
          </div>
        ) : (
          <div className="collapsed-rail">
            <button type="button" onClick={() => setRightPanelCollapsed(false)} title="Open settings panel">
              Settings
            </button>
          </div>
        )}
        </aside>
      ) : null}

      {showPreview && (
        <div className="builder-preview-modal">
          <div className="builder-preview-head">
            <strong>Preview test email</strong>
            <button type="button" onClick={() => setShowPreview(false)}>Close</button>
          </div>
          <iframe title="Email preview" srcDoc={activeHtml} />
        </div>
      )}
    </section>
  );
}

export default ContentPage;
