import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Extension, Mark, mergeAttributes } from '@tiptap/core';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { TextStyle } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import Color from '@tiptap/extension-color';
import TextAlign from '@tiptap/extension-text-align';

const AttachmentLink = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      'data-pm-attachment': {
        default: null
      }
    };
  }
});

const Underline = Mark.create({
  name: 'underline',

  parseHTML() {
    return [
      { tag: 'u' },
      { style: 'text-decoration', consuming: false, getAttrs: (value) => String(value).includes('underline') && null }
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['u', HTMLAttributes, 0];
  },

  addCommands() {
    return {
      toggleUnderline:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name)
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-u': () => this.editor.commands.toggleUnderline()
    };
  }
});

const FontSize = Extension.create({
  name: 'fontSize',

  addOptions() {
    return {
      types: ['textStyle']
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => element.style.fontSize || null,
            renderHTML: (attributes) => {
              if (!attributes.fontSize) {
                return {};
              }
              return { style: `font-size:${attributes.fontSize}` };
            }
          }
        }
      }
    ];
  },

  addCommands() {
    return {
      setFontSize:
        (fontSize) =>
        ({ commands }) =>
          commands.setMark('textStyle', { fontSize: `${Number(fontSize) || 16}px` }),
      unsetFontSize:
        () =>
        ({ commands }) =>
          commands.setMark('textStyle', { fontSize: null })
    };
  }
});

const highlightOptions = [
  { label: 'Yellow', value: '#fff3a3' },
  { label: 'Green', value: '#c8f7dc' },
  { label: 'Blue', value: '#cfe8ff' },
  { label: 'Pink', value: '#ffd6e7' }
];

const emojiOptions = ['🙂', '👍', '🔥', '⭐', '✅', '🎉', '💡', '📌', '⚠️', '❤️'];
const fontSizeOptions = ['12', '13', '14', '15', '16', '18', '20', '24', '28', '32'];
const textColorSwatches = [
  { label: 'Black', value: '#111827' },
  { label: 'Slate', value: '#475569' },
  { label: 'Blue', value: '#2563eb' },
  { label: 'Green', value: '#16a34a' },
  { label: 'Red', value: '#dc2626' },
  { label: 'Orange', value: '#ea580c' },
  { label: 'Purple', value: '#7c3aed' }
];
const highlightColorSwatches = [
  { label: 'None', value: '' },
  { label: 'Yellow', value: '#fff3a3' },
  { label: 'Green', value: '#c8f7dc' },
  { label: 'Blue', value: '#cfe8ff' },
  { label: 'Pink', value: '#ffd6e7' }
];

function formatFileSize(size) {
  const bytes = Number(size) || 0;
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${bytes} B`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function briefToHtml(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '<p></p>';
  }

  return `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`;
}

const EmailImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      objectFit: {
        default: 'contain',
        parseHTML: (element) => element.style.objectFit || 'contain',
        renderHTML: () => ({})
      },
      objectPosition: {
        default: 'center center',
        parseHTML: (element) => element.style.objectPosition || 'center center',
        renderHTML: () => ({})
      },
      borderRadius: {
        default: 8,
        parseHTML: (element) => Number.parseInt(element.style.borderRadius, 10) || 8,
        renderHTML: () => ({})
      }
    };
  },

  renderHTML({ HTMLAttributes }) {
    const { objectFit, objectPosition, borderRadius, width, height, style, ...rest } = HTMLAttributes;
    const imageStyle = [
      'max-width:100%',
      width ? `width:${width}px` : 'width:360px',
      height ? `height:${height}px` : 'height:auto',
      `object-fit:${objectFit || 'contain'}`,
      `object-position:${objectPosition || 'center center'}`,
      'display:block',
      'margin:12px 0',
      'border:0',
      `border-radius:${borderRadius ?? 8}px`,
      style || ''
    ].filter(Boolean).join(';');

    return ['img', mergeAttributes(this.options.HTMLAttributes, rest, { width, height, style: imageStyle })];
  }
});

function RichTextEditor({
  content, onChange, tokens = [], onPickImage, onPickAttachment, onAiRewrite,
  defaultSignature = '', onSwitchMode, onToggleTemplates, showTemplates = false,
  onToggleKeyboardHelp, showKeyboardHelp = false, previewMode = 'desktop',
  onTogglePreviewMode, variant = 'compose', spellCheckEnabled = true
}) {
  const [contextMenu, setContextMenu] = useState(null);
  const [linkPanel, setLinkPanel] = useState(null);
  const [imagePanel, setImagePanel] = useState(null);
  const [attachmentPanel, setAttachmentPanel] = useState(null);
  const [imageUrlValue, setImageUrlValue] = useState('');
  const [showAdvancedMenu, setShowAdvancedMenu] = useState(false);
  const [showColorMenu, setShowColorMenu] = useState(false);
  const [showWriteBrief, setShowWriteBrief] = useState(false);
  const [showImageUrlPanel, setShowImageUrlPanel] = useState(false);
  const [writeBrief, setWriteBrief] = useState('');
  const [spellCheck, setSpellCheck] = useState(spellCheckEnabled);
  const advancedMenuRef = useRef(null);
  const colorMenuRef = useRef(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      EmailImage.configure({
        allowBase64: true,
        resize: {
          enabled: true,
          minWidth: 120,
          minHeight: 80,
          alwaysPreserveAspectRatio: false
        },
        HTMLAttributes: {
          class: 'email-image'
        }
      }),
      AttachmentLink.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'email-link',
          style: 'color: #0066cc; text-decoration: underline; cursor: pointer;'
        }
      }),
      FontSize,
      TextStyle,
      Color.configure({
        types: ['textStyle']
      }),
      Highlight.configure({
        multicolor: true
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph']
      })
    ],
    content,
    onUpdate: ({ editor: currentEditor }) => {
      onChange(currentEditor.getHTML());
      if (currentEditor.isActive('image')) {
        setImagePanel(currentEditor.getAttributes('image'));
      }
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      if (currentEditor.isActive('image')) {
        setImagePanel(currentEditor.getAttributes('image'));
      } else {
        setImagePanel(null);
      }
    }
  });

  useEffect(() => {
    if (!editor) {
      return;
    }

    const nextContent = content || '<p></p>';
    if (nextContent !== editor.getHTML()) {
      editor.commands.setContent(nextContent, { emitUpdate: false });
    }
  }, [content, editor]);

  useEffect(() => {
    if (!contextMenu) {
      return undefined;
    }

    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    window.addEventListener('keydown', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('keydown', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!showAdvancedMenu) {
      return undefined;
    }

    const closeMenu = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') {
        return;
      }

      if (event.type === 'mousedown' && advancedMenuRef.current && !advancedMenuRef.current.contains(event.target)) {
        setShowAdvancedMenu(false);
        return;
      }

      if (event.type === 'keydown') {
        setShowAdvancedMenu(false);
      }
    };

    window.addEventListener('mousedown', closeMenu);
    window.addEventListener('keydown', closeMenu);
    return () => {
      window.removeEventListener('mousedown', closeMenu);
      window.removeEventListener('keydown', closeMenu);
    };
  }, [showAdvancedMenu]);

  useEffect(() => {
    if (!showColorMenu) {
      return undefined;
    }

    const closeMenu = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') {
        return;
      }

      if (event.type === 'mousedown' && colorMenuRef.current && !colorMenuRef.current.contains(event.target)) {
        setShowColorMenu(false);
        return;
      }

      if (event.type === 'keydown') {
        setShowColorMenu(false);
      }
    };

    window.addEventListener('mousedown', closeMenu);
    window.addEventListener('keydown', closeMenu);
    return () => {
      window.removeEventListener('mousedown', closeMenu);
      window.removeEventListener('keydown', closeMenu);
    };
  }, [showColorMenu]);

  function getSelectedText() {
    if (!editor) {
      return '';
    }

    const { from, to } = editor.state.selection;
    return editor.state.doc.textBetween(from, to, ' ').trim();
  }

  const insertHtml = useCallback(
    (html) => {
      editor?.chain().focus().insertContent(html).run();
    },
    [editor]
  );

  const insertToken = useCallback((token) => {
    if (!token) {
      return;
    }
    insertHtml(token);
  }, [insertHtml]);

  function normalizeUrl(value) {
    const url = String(value || '').trim();
    if (!url) {
      return '';
    }
    if (/^(https?:|mailto:|tel:|file:)/i.test(url)) {
      return url;
    }
    return `https://${url}`;
  }

  const handleImageInsert = useCallback(async () => {
    if (!editor) {
      return;
    }

    if (onPickImage) {
      const image = await onPickImage();
      if (image?.src) {
        editor.chain().focus().setImage({ src: image.src, alt: image.alt || 'Image', width: 360 }).run();
      }
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (event) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      const reader = new FileReader();
      reader.onload = (readEvent) => {
        editor.chain().focus().setImage({ src: readEvent.target.result, alt: file.name, width: 360 }).run();
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }, [editor, onPickImage]);

  const handleAttachmentInsert = useCallback(async () => {
    if (!editor || !onPickAttachment) {
      return;
    }

    const attachments = await onPickAttachment();
    if (!attachments.length) {
      return;
    }

    setAttachmentPanel({
      attachments: attachments.map((attachment) => ({
        ...attachment,
        url: attachment.url || 'https://'
      })),
      index: 0
    });
  }, [editor, onPickAttachment]);

  const applyAttachmentPanel = useCallback(() => {
    if (!editor || !attachmentPanel) {
      return;
    }

    attachmentPanel.attachments.forEach((attachment) => {
      const url = normalizeUrl(attachment.url);
      const metadata = encodeURIComponent(JSON.stringify({ ...attachment, url }));
      const label = escapeHtml(attachment.filename || 'Attachment');
      const size = formatFileSize(attachment.size);
      const href = url || '#';
      const anchorAttrs = url
        ? `href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener" data-pm-attachment="${metadata}"`
        : `href="#" data-pm-attachment="${metadata}"`;

      insertHtml(
        `<p style="border:1px solid #d9e2ef;background:#f8fbff;border-radius:8px;padding:10px 12px;margin:12px 0;color:#24324b;font-size:13px;"><strong>Attachment</strong><br /><a ${anchorAttrs} style="color:#0066cc;text-decoration:underline;">${label}</a><span style="color:#667085;"> (${size})</span></p>`
      );
    });

    setAttachmentPanel(null);
  }, [editor, insertHtml, attachmentPanel]);

  const handleLinkInsert = useCallback(() => {
    if (!editor) {
      return;
    }

    const { from, to } = editor.state.selection;
    setLinkPanel({
      from,
      to,
      url: editor.getAttributes('link').href || 'https://',
      label: getSelectedText() || 'Read more'
    });
  }, [editor]);

  function applyLinkPanel() {
    if (!editor || !linkPanel) {
      return;
    }

    const url = String(linkPanel.url || '').trim();
    if (!url) {
      editor.chain().focus().setTextSelection({ from: linkPanel.from, to: linkPanel.to }).unsetLink().run();
      setLinkPanel(null);
      return;
    }

    if (!/^https?:\/\//i.test(url) && !url.startsWith('{{')) {
      return;
    }

    const chain = editor.chain().focus();
    if (linkPanel.from !== linkPanel.to) {
      chain.setTextSelection({ from: linkPanel.from, to: linkPanel.to }).extendMarkRange('link').setLink({ href: url }).run();
    } else {
      chain.insertContent(`<a href="${url}">${linkPanel.label || url}</a>`).run();
    }
    setLinkPanel(null);
  }

  function updateSelectedImage(attrs) {
    if (!editor) {
      return;
    }

    const nextAttrs = { ...imagePanel, ...attrs };
    setImagePanel(nextAttrs);
    editor.chain().focus().updateAttributes('image', nextAttrs).run();
  }

  const insertButton = useCallback(() => {
    const label = window.prompt('Button text', 'Primary CTA') || 'Primary CTA';
    const url = window.prompt('Button URL', 'https://') || 'https://';
    insertHtml(
      `<div style="text-align:center;margin:24px 0;"><a href="${url}" style="display:inline-block;padding:14px 26px;background:#18140f;color:#ffffff;text-decoration:none;border-radius:999px;font-weight:700;">${label}</a></div>`
    );
  }, [insertHtml]);

  const insertSignature = useCallback(() => {
    insertHtml(defaultSignature || '<p style="margin-top:24px;">Best,<br />{{first_name}}</p>');
  }, [defaultSignature, insertHtml]);

  const handleAiRewrite = useCallback(async () => {
    if (!editor || !onAiRewrite) {
      return;
    }

    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, ' ').trim();
    const result = await onAiRewrite({
      html: editor.getHTML(),
      selectedText,
      mode: 'rewrite'
    });

    const improvedHtml = result?.improvedHtml || result?.html;
    if (!improvedHtml) {
      return;
    }

    if (from !== to) {
      editor.chain().focus().setTextSelection({ from, to }).insertContent(improvedHtml).run();
    } else {
      editor.commands.setContent(improvedHtml, { emitUpdate: true });
    }
  }, [editor, onAiRewrite]);

  const handleAiAction = useCallback(async (mode) => {
    if (!editor || !onAiRewrite) {
      return;
    }

    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, ' ').trim();
    const result = await onAiRewrite({
      html: editor.getHTML(),
      selectedText: mode === 'write' ? '' : selectedText,
      mode
    });

    const improvedHtml = result?.improvedHtml || result?.html;
    if (!improvedHtml) {
      return;
    }

    // For 'write' mode, always replace all content completely
    if (mode === 'write') {
      editor.commands.setContent(improvedHtml, { emitUpdate: true });
    } else if (from !== to) {
      // For improve/spam_check with selection, replace only selected text
      editor.chain().focus().setTextSelection({ from, to }).insertContent(improvedHtml).run();
    } else {
      // For improve/spam_check without selection, replace all content
      editor.commands.setContent(improvedHtml, { emitUpdate: true });
    }
  }, [editor, onAiRewrite]);

  const handleWriteCompleteEmail = useCallback(async () => {
    if (!editor || !onAiRewrite) {
      return;
    }

    const briefHtml = briefToHtml(writeBrief);
    const result = await onAiRewrite({
      html: briefHtml,
      selectedText: '',
      mode: 'write'
    });

    const improvedHtml = result?.improvedHtml || result?.html;
    if (improvedHtml) {
      editor.commands.setContent(improvedHtml, { emitUpdate: true });
      if (result.subject) {
        // Preserve the editor flow while still letting the parent sync the subject if needed.
      }
    }
    setShowWriteBrief(false);
  }, [editor, onAiRewrite, writeBrief]);

  const handleContextMenu = useCallback(
    (event) => {
      if (!editor || editor.state.selection.empty) {
        setContextMenu(null);
        return;
      }

      event.preventDefault();
      setContextMenu({ x: event.clientX, y: event.clientY });
    },
    [editor]
  );

  const runContextCommand = useCallback(
    (callback) => {
      callback();
      setContextMenu(null);
    },
    []
  );

  if (!editor) {
    return <div className="rich-text-editor loading">Loading editor...</div>;
  }

  return (
    <div className={`rich-text-editor ${variant} preview-${previewMode}`} onContextMenu={handleContextMenu}>
      <div className="editor-toolbar editor-toolbar-minimal" aria-label="Content editing tools">
        <div className="toolbar-group toolbar-block text-tools">
          <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} className={editor.isActive('bold') ? 'toolbar-btn active' : 'toolbar-btn'} title="Bold">
            <strong>B</strong>
          </button>
          <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} className={editor.isActive('italic') ? 'toolbar-btn active' : 'toolbar-btn'} title="Italic">
            <em>I</em>
          </button>
          <button type="button" onClick={() => editor.chain().focus().toggleUnderline().run()} className={editor.isActive('underline') ? 'toolbar-btn active' : 'toolbar-btn'} title="Underline">
            <u>U</u>
          </button>
          <button type="button" onClick={() => editor.chain().focus().toggleStrike().run()} className={editor.isActive('strike') ? 'toolbar-btn active' : 'toolbar-btn'} title="Strikethrough">
            <s>S</s>
          </button>
          <select
            onChange={(event) => editor.chain().focus().setFontSize(event.target.value).run()}
            defaultValue="16"
            className="toolbar-select toolbar-select-sm"
            title="Font size"
          >
            {fontSizeOptions.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
          <div className="toolbar-dropdown" ref={colorMenuRef}>
            <button
              type="button"
              className={`toolbar-btn toolbar-menu-trigger ${showColorMenu ? 'active' : ''}`}
              onClick={() => {
                setShowAdvancedMenu(false);
                setShowColorMenu((current) => !current);
              }}
              title="Color menu"
            >
              A
            </button>
            {showColorMenu ? (
              <div className="toolbar-dropdown-menu toolbar-dropdown-menu-colors">
                <div className="toolbar-dropdown-label">Text color</div>
                <div className="color-swatch-grid">
                  {textColorSwatches.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className="color-swatch"
                      onClick={() => {
                        editor.chain().focus().setColor(option.value).run();
                        setShowColorMenu(false);
                      }}
                      title={option.label}
                    >
                      <span className="color-swatch-dot" style={{ backgroundColor: option.value }} />
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="toolbar-dropdown-separator" />
                <div className="toolbar-dropdown-label">Highlight</div>
                <div className="color-swatch-grid">
                  {highlightColorSwatches.map((option) => (
                    <button
                      key={option.value || 'none'}
                      type="button"
                      className="color-swatch"
                      onClick={() => {
                        if (option.value) {
                          editor.chain().focus().toggleHighlight({ color: option.value }).run();
                        } else {
                          editor.chain().focus().unsetHighlight().run();
                        }
                        setShowColorMenu(false);
                      }}
                      title={option.label}
                    >
                      <span className="color-swatch-dot" style={{ backgroundColor: option.value || '#ffffff', border: '1px solid #cbd5e1' }} />
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="toolbar-dropdown-separator" />
                <label className="color-input-row">
                  Custom
                  <input
                    type="color"
                    defaultValue="#111827"
                    onChange={(event) => {
                      editor.chain().focus().setColor(event.target.value).run();
                      setShowColorMenu(false);
                    }}
                  />
                </label>
              </div>
            ) : null}
          </div>
          <button type="button" onClick={() => editor.chain().focus().setTextAlign('left').run()} className={editor.isActive({ textAlign: 'left' }) ? 'toolbar-btn active' : 'toolbar-btn'} title="Align left">
            ≡
          </button>
          <button type="button" onClick={() => editor.chain().focus().setTextAlign('center').run()} className={editor.isActive({ textAlign: 'center' }) ? 'toolbar-btn active' : 'toolbar-btn'} title="Align center">
            ≣
          </button>
          <button type="button" onClick={() => editor.chain().focus().setTextAlign('right').run()} className={editor.isActive({ textAlign: 'right' }) ? 'toolbar-btn active' : 'toolbar-btn'} title="Align right">
            ☰
          </button>
          <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()} className={editor.isActive('bulletList') ? 'toolbar-btn active' : 'toolbar-btn'} title="Bullet list">
            •
          </button>
          <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()} className={editor.isActive('orderedList') ? 'toolbar-btn active' : 'toolbar-btn'} title="Numbered list">
            1.
          </button>
          <button type="button" onClick={handleLinkInsert} className={editor.isActive('link') ? 'toolbar-btn active' : 'toolbar-btn'} title="Add or edit link">
            🔗
          </button>
          <button type="button" onClick={handleAttachmentInsert} className="toolbar-btn" title="Attach file">
            📎
          </button>
          <div className="toolbar-spacer" />
          <button type="button" onClick={() => editor.chain().focus().undo().run()} className="toolbar-btn" title="Undo (Ctrl+Z)">
            ↶
          </button>
          <button type="button" onClick={() => editor.chain().focus().redo().run()} className="toolbar-btn" title="Redo (Ctrl+Y)">
            ↷
          </button>
          <div className="toolbar-dropdown" ref={advancedMenuRef}>
            <button type="button" className={`toolbar-btn toolbar-menu-trigger ${showAdvancedMenu ? 'active' : ''}`} onClick={() => setShowAdvancedMenu((current) => !current)} title="More tools">
              ⋯
            </button>
            {showAdvancedMenu ? (
              <div className="toolbar-dropdown-menu toolbar-dropdown-menu-wide">
                <div className="toolbar-dropdown-label">Merge tags</div>
                {tokens.map((token) => (
                  <button key={token.value} type="button" onClick={() => { insertToken(token.value); setShowAdvancedMenu(false); }}>
                    {token.label}
                  </button>
                ))}
                <div className="toolbar-dropdown-separator" />
                <div className="toolbar-dropdown-label">AI tools</div>
                <button type="button" onClick={() => { setShowWriteBrief(true); setShowAdvancedMenu(false); }}>Write complete email</button>
                <button type="button" onClick={() => { handleAiAction('rewrite'); setShowAdvancedMenu(false); }}>Rewrite</button>
                <button type="button" onClick={() => { handleAiAction('improve'); setShowAdvancedMenu(false); }}>Improve</button>
                <button type="button" onClick={() => { handleAiAction('personalize'); setShowAdvancedMenu(false); }}>Personalize</button>
                <div className="toolbar-dropdown-separator" />
                <div className="toolbar-dropdown-label">Insert</div>
                <button type="button" onClick={() => { insertButton(); setShowAdvancedMenu(false); }}>Insert button</button>
                <button type="button" onClick={() => { insertHtml('<hr style="border:none;border-top:1px solid #e1e5e9;margin:20px 0;" />'); setShowAdvancedMenu(false); }}>Insert divider</button>
                <button type="button" onClick={() => { insertHtml('<div style="height:16px;"></div>'); setShowAdvancedMenu(false); }}>Insert spacer</button>
                <button type="button" onClick={() => { handleImageInsert(); setShowAdvancedMenu(false); }}>Insert image</button>
<button type="button" onClick={() => { setShowImageUrlPanel(true); setShowAdvancedMenu(false); }}>Insert image from URL</button>
                <button type="button" onClick={() => { handleAttachmentInsert(); setShowAdvancedMenu(false); }}>Add attachment</button>
                <div className="toolbar-dropdown-separator" />
                <div className="toolbar-dropdown-label">Modes</div>
                <button type="button" onClick={() => { onTogglePreviewMode?.(); setShowAdvancedMenu(false); }}>
                  Preview: {previewMode === 'desktop' ? 'Desktop' : 'Mobile'}
                </button>
                <button type="button" onClick={() => { onSwitchMode?.(); setShowAdvancedMenu(false); }}>HTML view</button>
                <button type="button" onClick={() => { onToggleTemplates?.(); setShowAdvancedMenu(false); }}>Templates</button>
<button type="button" onClick={() => { onToggleKeyboardHelp?.(); setShowAdvancedMenu(false); }}>Keyboard help</button>
<div className="toolbar-dropdown-separator" />
<div className="toolbar-dropdown-label">Spell check</div>
<button type="button" onClick={() => { setSpellCheck((prev) => !prev); setShowAdvancedMenu(false); }}>{spellCheck ? 'Disable spell check' : 'Enable spell check'}</button>
<div className="toolbar-dropdown-separator" />
<div className="toolbar-dropdown-label">History</div>
                <button type="button" onClick={() => { editor.chain().focus().undo().run(); setShowAdvancedMenu(false); }}>Undo</button>
                <button type="button" onClick={() => { editor.chain().focus().redo().run(); setShowAdvancedMenu(false); }}>Redo</button>
                <button type="button" onClick={() => { editor.chain().focus().unsetAllMarks().run(); setShowAdvancedMenu(false); }}>Clear formatting</button>
                <button type="button" onClick={() => { insertHtml('<p><a href="{{unsubscribe_url}}">Unsubscribe</a></p>'); setShowAdvancedMenu(false); }}>Insert unsubscribe</button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {showWriteBrief ? (
        <div className="write-brief-panel">
          <div className="write-brief-head">
            <strong>Write complete email</strong>
            <button type="button" className="ghost-button sm" onClick={() => setShowWriteBrief(false)}>Close</button>
          </div>
          <textarea
            value={writeBrief}
            onChange={(event) => setWriteBrief(event.target.value)}
            placeholder="Describe the email you want written. Include tone, audience, offer, and any key points."
            rows={4}
          />
          <div className="write-brief-actions">
            <button type="button" className="ghost-button sm" onClick={() => setWriteBrief('')}>Clear</button>
            <button type="button" className="primary-button sm" onClick={handleWriteCompleteEmail}>Generate email</button>
          </div>
        </div>
) : null}

{showImageUrlPanel ? (
<div className="image-url-panel">
<input
type="url"
value={imageUrlValue}
onChange={(event) => setImageUrlValue(event.target.value)}
placeholder="https://example.com/image.png"
onKeyDown={(event) => {
if (event.key === 'Enter' && imageUrlValue.trim() && editor) {
editor.chain().focus().setImage({ src: imageUrlValue.trim(), alt: 'Image', width: 360 }).run();
setImageUrlValue('');
setShowImageUrlPanel(false);
}
}}
/>
<button type="button" className="primary-button sm" onClick={() => {
if (imageUrlValue.trim() && editor) {
editor.chain().focus().setImage({ src: imageUrlValue.trim(), alt: 'Image', width: 360 }).run();
setImageUrlValue('');
setShowImageUrlPanel(false);
}
}}>Insert</button>
<button type="button" className="ghost-button sm" onClick={() => { setShowImageUrlPanel(false); setImageUrlValue(''); }}>Cancel</button>
</div>
) : null}

<div className="editor-content-wrapper" spellCheck={spellCheck ? 'true' : undefined}>
        {variant === 'compose' && (!content || content === '<p></p>') ? (
          <div className="editor-placeholder">Type your message...</div>
        ) : null}
        <EditorContent editor={editor} className="editor-content" />
      </div>

      {imagePanel ? (
        <div className="image-edit-panel">
          <label>
            Width
            <input
              type="number"
              min="120"
              max="720"
              value={imagePanel.width || 360}
              onChange={(event) => updateSelectedImage({ width: Number(event.target.value) || null })}
            />
          </label>
          <label>
            Height
            <input
              type="number"
              min="60"
              max="900"
              value={imagePanel.height || ''}
              placeholder="Auto"
              onChange={(event) => updateSelectedImage({ height: Number(event.target.value) || null })}
            />
          </label>
          <label>
            Crop
            <select value={imagePanel.objectFit || 'contain'} onChange={(event) => updateSelectedImage({ objectFit: event.target.value })}>
              <option value="contain">Fit</option>
              <option value="cover">Crop</option>
              <option value="fill">Stretch</option>
            </select>
          </label>
          <label>
            Focus
            <select value={imagePanel.objectPosition || 'center center'} onChange={(event) => updateSelectedImage({ objectPosition: event.target.value })}>
              <option value="center center">Center</option>
              <option value="top center">Top</option>
              <option value="bottom center">Bottom</option>
              <option value="center left">Left</option>
              <option value="center right">Right</option>
            </select>
          </label>
          <button type="button" className="toolbar-btn" onClick={() => updateSelectedImage({ width: 360, height: null, objectFit: 'contain', objectPosition: 'center center' })}>Reset</button>
        </div>
      ) : null}

      {linkPanel ? (
        <div className="link-edit-panel">
          <label>
            Text
            <input value={linkPanel.label} onChange={(event) => setLinkPanel((current) => ({ ...current, label: event.target.value }))} disabled={linkPanel.from !== linkPanel.to} />
          </label>
          <label>
            URL
            <input value={linkPanel.url} onChange={(event) => setLinkPanel((current) => ({ ...current, url: event.target.value }))} autoFocus />
          </label>
          <button type="button" className="ghost-button sm" onClick={() => setLinkPanel(null)}>Cancel</button>
          <button type="button" className="primary-button sm" onClick={applyLinkPanel}>Apply</button>
        </div>
      ) : null}

      {attachmentPanel ? (
        <div className="attachment-insert-panel">
          <div className="attachment-insert-head">
            <strong>Attachment link URLs</strong>
            <button type="button" className="ghost-button sm" onClick={() => setAttachmentPanel(null)}>Cancel</button>
          </div>
{attachmentPanel.attachments.map((attachment, index) => (
<div key={index} className="attachment-insert-row">
<div className="attachment-insert-info">
{attachment.contentType?.startsWith('image/') && attachment.content ? (
<div className="attachment-preview-thumb">
<img src={`data:${attachment.contentType};base64,${attachment.content}`} alt={attachment.filename} />
</div>
) : attachment.contentType === 'application/pdf' ? (
<div className="attachment-preview-thumb">PDF</div>
) : null}
<span className="attachment-insert-name">{attachment.filename || 'Attachment'}</span>
<span className="attachment-insert-size">{formatFileSize(attachment.size)}</span>
</div>
              <label>
                Link URL
                <input
                  type="url"
                  value={attachment.url}
                  onChange={(event) => {
                    const next = [...attachmentPanel.attachments];
                    next[index] = { ...next[index], url: event.target.value };
                    setAttachmentPanel({ ...attachmentPanel, attachments: next });
                  }}
                  placeholder="https://example.com/page"
                />
              </label>
            </div>
          ))}
          <p className="attachment-insert-hint">When a recipient clicks the attachment, they will be taken to this URL. Leave blank for a standard file download.</p>
          <div className="attachment-insert-actions">
            <button type="button" className="primary-button sm" onClick={applyAttachmentPanel}>Insert attachments</button>
          </div>
        </div>
      ) : null}

      {contextMenu ? (
        <div
          className="editor-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <button type="button" onClick={() => runContextCommand(() => editor.chain().focus().toggleBold().run())}>Bold</button>
          <button type="button" onClick={() => runContextCommand(() => editor.chain().focus().toggleItalic().run())}>Italic</button>
          <button type="button" onClick={() => runContextCommand(() => editor.chain().focus().toggleHighlight({ color: '#fff3a3' }).run())}>Highlight</button>
          <button type="button" onClick={() => runContextCommand(handleLinkInsert)}>Link</button>
          <button type="button" onClick={() => runContextCommand(() => editor.chain().focus().unsetAllMarks().run())}>Clear</button>
        </div>
      ) : null}
    </div>
  );
}

export default RichTextEditor;
