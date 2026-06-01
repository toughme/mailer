const DEFAULT_SYSTEM_PROMPT = `You are a professional email writing assistant. You help users write high-quality, compliant emails that avoid spam triggers while maintaining authenticity and natural language. Always preserve merge tags like {{first_name}}, {{company}}, {{email}}, etc. Maintain factual accuracy and ensure compliance with relevant regulations like CAN-SPAM and GDPR.`;

const PROVIDER_PRESETS = [
  {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    model: 'meta/llama-3.2-3b-instruct',
    apiKeyEnv: 'NVIDIA_API_KEY',
    apiKeyPlaceholder: 'Paste your NVIDIA API key here'
  },
  {
    id: 'openai',
    label: 'OpenAI-compatible',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    apiKeyEnv: 'OPENAI_API_KEY',
    apiKeyPlaceholder: 'Paste your API key here'
  },
  {
    id: 'openrouter',
    label: 'OpenRouter-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4.1-mini',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    apiKeyPlaceholder: 'Paste your OpenRouter API key here'
  },
  {
    id: 'custom',
    label: 'Custom OpenAI-compatible',
    baseUrl: '',
    model: '',
    apiKeyEnv: '',
    apiKeyPlaceholder: 'Paste your API key here'
  }
];

function stripHtml(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textToHtml(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '<p></p>';
  }

  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

function normalizeHtmlFragment(value) {
  const content = String(value || '').trim();
  if (!content) {
    return '<p></p>';
  }

  const withoutFence = content
    .replace(/^```(?:html)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (/<(?:p|div|table|ul|ol|h[1-6]|blockquote|section|article|br|a|strong|em|span)\b/i.test(withoutFence)) {
    return withoutFence;
  }

  return textToHtml(withoutFence);
}

function parseJsonLike(value) {
  const text = String(value || '').trim();
  const withoutFence = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(withoutFence.slice(start, end + 1));
    }
    throw new Error('Response was not JSON.');
  }
}

function getProviderPreset(provider) {
  return PROVIDER_PRESETS.find((preset) => preset.id === provider) || PROVIDER_PRESETS[0];
}

function getEnvApiKey(provider) {
  const preset = getProviderPreset(provider);
  return preset.apiKeyEnv ? process.env[preset.apiKeyEnv] || '' : '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryStatus(status) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function shouldRetryError(error) {
  return error.name === 'AbortError' || /fetch failed|network|socket|timeout|econnreset|etimedout/i.test(error.message || '');
}

function extractTextPart(part) {
  if (typeof part === 'string') {
    return part;
  }
  if (!part || typeof part !== 'object') {
    return '';
  }
  if (typeof part.text === 'string') {
    return part.text;
  }
  if (typeof part.content === 'string') {
    return part.content;
  }
  if (part.text && typeof part.text.value === 'string') {
    return part.text.value;
  }
  return '';
}

function extractAiContent(data) {
  const choice = data?.choices?.[0];
  const message = choice?.message || {};
  const candidates = [
    message.content,
    message.reasoning_content,
    choice?.text,
    data?.output_text,
    data?.content
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const text = candidate.map(extractTextPart).join('').trim();
      if (text) {
        return text;
      }
    } else if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  if (Array.isArray(data?.output)) {
    const text = data.output
      .flatMap((item) => item?.content || [])
      .map(extractTextPart)
      .join('')
      .trim();
    if (text) {
      return text;
    }
  }

  return '';
}

function mapSettings(row, security) {
  const decrypted = row?.encrypted_api_key ? security.decrypt(row.encrypted_api_key) : '';
  const provider = row?.provider || 'nvidia';
  const preset = getProviderPreset(provider);
  return {
    provider,
    providerLabel: preset.label,
    hasApiKey: Boolean(decrypted || getEnvApiKey(provider)),
    apiKeyPreview: decrypted ? `${decrypted.slice(0, 6)}...${decrypted.slice(-4)}` : '',
    model: row?.model || preset.model || 'meta/llama-3.2-3b-instruct',
    baseUrl: row?.base_url || preset.baseUrl || 'https://integrate.api.nvidia.com/v1',
    systemPrompt: row?.system_prompt || DEFAULT_SYSTEM_PROMPT
  };
}

function createAiRewriteService({ db, security }) {
  async function ensureRow() {
    const row = await db.get('SELECT id FROM ai_settings WHERE id = 1');
    if (!row) {
      await db.run(
        `INSERT INTO ai_settings (id, provider, encrypted_api_key, model, base_url, system_prompt, updated_at)
         VALUES (1, 'nvidia', '', 'meta/llama-3.2-3b-instruct', 'https://integrate.api.nvidia.com/v1', ?, CURRENT_TIMESTAMP)`,
        [DEFAULT_SYSTEM_PROMPT]
      );
    }
  }

  async function getRawSettings() {
    await ensureRow();
    return db.get('SELECT * FROM ai_settings WHERE id = 1');
  }

  return {
    async getSettings() {
      const row = await getRawSettings();
      return mapSettings(row, security);
    },

    getProviderPresets() {
      return PROVIDER_PRESETS;
    },

    async updateSettings(payload = {}) {
      await ensureRow();
      const current = await getRawSettings();
      const apiKey = String(payload.apiKey || '').trim();
      const encryptedApiKey = apiKey ? security.encrypt(apiKey) : current.encrypted_api_key || '';
      const provider = String(payload.provider ?? current.provider ?? 'nvidia').trim() || 'nvidia';
      const preset = getProviderPreset(provider);
      const model = String(payload.model ?? current.model ?? preset.model ?? 'meta/llama-3.2-3b-instruct').trim();
      const baseUrl = String(payload.baseUrl ?? current.base_url ?? preset.baseUrl ?? 'https://integrate.api.nvidia.com/v1').trim().replace(/\/+$/, '');
      const systemPrompt = String(payload.systemPrompt ?? current.system_prompt ?? DEFAULT_SYSTEM_PROMPT).trim();

      if (!model) {
        throw new Error('AI model is required.');
      }
      if (!/^https?:\/\//i.test(baseUrl)) {
        throw new Error('AI base URL must start with http:// or https://.');
      }

      await db.run(
        `UPDATE ai_settings
         SET provider = ?, encrypted_api_key = ?, model = ?, base_url = ?, system_prompt = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = 1`,
        [provider, encryptedApiKey, model, baseUrl, systemPrompt]
      );

      return this.getSettings();
    },

    async callAiApi(baseUrl, apiKey, model, systemPrompt, userMessage, options = {}) {
      const {
        maxTokens = 1200,
        temperature = 0.35,
        timeoutMs = 60000,
        retries = 2,
        responseFormat = null
      } = options;

      for (let attempt = 0; attempt <= retries; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const body = {
            model,
            temperature,
            max_tokens: maxTokens,
            messages: [
              {
                role: 'system',
                content: systemPrompt
              },
              {
                role: 'user',
                content: userMessage
              }
            ]
          };

          if (responseFormat) {
            body.response_format = responseFormat;
          }

          const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            signal: controller.signal,
            body: JSON.stringify(body)
          });

          if (!response.ok) {
            const errorText = await response.text();
            if (attempt < retries && shouldRetryStatus(response.status)) {
              await sleep(500 * 2 ** attempt);
              continue;
            }
            throw new Error(`AI API failed: ${response.status} ${errorText.slice(0, 300)}`);
          }

          const data = await response.json();
          const content = extractAiContent(data);
          if (!content) {
            const finishReason = data?.choices?.[0]?.finish_reason || data?.choices?.[0]?.finishReason || 'unknown';
            const preview = JSON.stringify(data).slice(0, 500);
            throw new Error(`AI API returned no content. Finish reason: ${finishReason}. Response: ${preview}`);
          }

          return content;
        } catch (error) {
          if (attempt < retries && shouldRetryError(error)) {
            await sleep(500 * 2 ** attempt);
            continue;
          }
          if (error.name === 'AbortError') {
            throw new Error('AI API timed out. Check your connection, base URL, or model availability.');
          }
          if (/^AI API failed:|^AI API returned no content\./.test(error.message || '')) {
            throw error;
          }
          throw new Error(`AI API request failed: ${error.message}`);
        } finally {
          clearTimeout(timeout);
        }
      }

      throw new Error('AI API request failed.');
    },

    async callAiApiJson(baseUrl, apiKey, model, systemPrompt, userMessage) {
      const response = await this.callAiApi(baseUrl, apiKey, model, systemPrompt, userMessage, {
        responseFormat: { type: 'json_object' }
      });
      return parseJsonLike(response);
    },

    async testConnection(payload = {}) {
      const row = await getRawSettings();
      const provider = String(payload.provider ?? row.provider ?? 'nvidia');
      const preset = getProviderPreset(provider);
      const apiKey = String(payload.apiKey || '').trim() || security.decrypt(row.encrypted_api_key) || getEnvApiKey(provider);
      if (!apiKey) {
        throw new Error(`Add an API key before testing ${preset.label}.`);
      }

      const baseUrl = String(payload.baseUrl ?? row.base_url ?? preset.baseUrl ?? '').trim().replace(/\/+$/, '');
      const model = String(payload.model ?? row.model ?? preset.model ?? '').trim();
      if (!model || !/^https?:\/\//i.test(baseUrl)) {
        throw new Error('A valid base URL and model are required before testing.');
      }

      const startedAt = Date.now();
      const reply = await this.callAiApi(
        baseUrl,
        apiKey,
        model,
        'Reply with exactly: OK',
        'Connection test. Reply with exactly: OK',
        { maxTokens: 64, temperature: 0, timeoutMs: 20000, retries: 1 }
      );

      return {
        provider,
        providerLabel: preset.label,
        model,
        baseUrl,
        latencyMs: Date.now() - startedAt,
        reply
      };
    },

    async processEmail(payload = {}) {
      const row = await getRawSettings();
      const provider = row.provider || 'nvidia';
      const preset = getProviderPreset(provider);
      const apiKey = security.decrypt(row.encrypted_api_key) || getEnvApiKey(provider);
      if (!apiKey) {
        throw new Error('Add an API key in the Infrastructure Settings first.');
      }

      const baseUrl = String(row.base_url || preset.baseUrl || 'https://integrate.api.nvidia.com/v1').replace(/\/+$/, '');
      const model = String(row.model || preset.model || 'meta/llama-3.2-3b-instruct');
      const systemPrompt = String(row.system_prompt || DEFAULT_SYSTEM_PROMPT);
      const mode = String(payload.mode || 'improve').toLowerCase();
      const subject = String(payload.subject || '').trim();
      const previewText = String(payload.previewText || '').trim();
      const html = String(payload.html || '');
      const selectedText = String(payload.selectedText || '').trim();
      const sourceText = stripHtml(html);
      const workingText = selectedText || sourceText;

      if (!workingText && !['write', 'personalize'].includes(mode)) {
        throw new Error('Add email content before using AI assistant.');
      }

      if (['write', 'personalize'].includes(mode) && !workingText && !subject && !previewText) {
        throw new Error('Add a subject, preview text, or brief notes before asking AI to write an email.');
      }

      // Determine the task instruction based on mode
      let taskInstruction = '';
      if (mode === 'write') {
        taskInstruction = `Write a natural, professional email based on the user's intent. Keep it compliant, authentic, and specific.`;
      } else if (mode === 'improve') {
        taskInstruction = `Improve this email while keeping the original intent. Make it more natural, professional, and less likely to be flagged as spam.`;
      } else if (mode === 'personalize') {
        taskInstruction = `Personalize this email with a warm, direct tone. Use merge tags naturally, keep it concise, and make it feel written for one person.`;
      } else if (mode === 'spam_check') {
        taskInstruction = `Analyze this email and rewrite it to reduce spam risk. Identify and fix any potentially problematic wording, excessive urgency, or suspicious formatting.`;
      } else if (mode === 'rewrite') {
        taskInstruction = selectedText
          ? `Rewrite only the selected text. Preserve the meaning and any merge tags.`
          : `Rewrite this email while preserving its meaning, structure, links, and merge tags.`;
      } else {
        taskInstruction = `Improve this email copy. Make it clearer and more engaging.`;
      }

      const userMessage = [
        `Task: ${taskInstruction}`,
        `Return JSON only with this shape: {"html":"email body HTML fragment","subject":"optional improved subject","previewText":"optional improved preview text","notes":["short notes"]}.`,
        `The html value must be suitable for the inside of an email body. Do not include markdown fences, explanations, or a full HTML document.`,
        `Preserve merge tags exactly, such as {{first_name}}, {{company}}, and {{unsubscribe_url}}.`,
        subject && `Subject: ${subject}`,
        previewText && `Preview text: ${previewText}`,
        selectedText && `Selected text to rewrite:`,
        selectedText || null,
        !selectedText && workingText && `Email content:`,
        !selectedText && workingText ? workingText : null,
        ['write', 'personalize'].includes(mode) && !workingText && `Use the subject and preview text as the writing brief.`
      ]
        .filter(Boolean)
        .join('\n\n');

      let structuredResult = null;
      let improvedContent = '';
      try {
        structuredResult = await this.callAiApiJson(baseUrl, apiKey, model, systemPrompt, userMessage);
        improvedContent = structuredResult.html || '';
      } catch {
        improvedContent = await this.callAiApi(baseUrl, apiKey, model, systemPrompt, userMessage);
      }
      const improvedHtml = normalizeHtmlFragment(improvedContent);

      // For spam_check mode, provide additional analysis
      let spamAnalysis = null;
      if (mode === 'spam_check') {
        const analysisMessage = `Provide a brief JSON response with:
{
  "spamScore": (0-100, where 100 is high spam risk),
  "risks": ["list of identified spam risk factors"],
  "suggestions": ["list of specific improvements made"]
}

Analyze this email for spam risk:
${sourceText}`;

        try {
          spamAnalysis = await this.callAiApiJson(baseUrl, apiKey, model, systemPrompt, analysisMessage);
        } catch (error) {
          // If the model does not return parseable JSON, keep the rewrite result usable.
          try {
            const analysisResponse = await this.callAiApi(baseUrl, apiKey, model, systemPrompt, analysisMessage);
            spamAnalysis = { rawAnalysis: analysisResponse };
          } catch {}
        }
      }

      return {
        original: workingText,
        originalHtml: selectedText ? textToHtml(selectedText) : html,
        improved: stripHtml(improvedHtml),
        improvedHtml,
        subject: String(structuredResult?.subject || '').trim() || subject,
        previewText: String(structuredResult?.previewText || '').trim() || previewText,
        notes: Array.isArray(structuredResult?.notes) ? structuredResult.notes : [],
        mode,
        spamAnalysis
      };
    },

    // Legacy rewriteEmail method for backward compatibility
    async rewriteEmail(payload = {}) {
      const result = await this.processEmail({
        ...payload,
        mode: payload.mode || 'improve'
      });
      return { html: result.improvedHtml };
    }
  };
}

module.exports = { createAiRewriteService };
