import { pipeline, env, TextStreamer } from '@huggingface/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;

class MyPipeline {
  static task = 'text-generation';
  static model = 'HuggingFaceTB/SmolLM2-135M-Instruct';
  static instance = null;
  static warmedUp = false;

  static async getInstance(progress_callback = null) {
    if (this.instance === null) {
      try {
        this.instance = await pipeline(this.task, this.model, {
          progress_callback,
          device: 'wasm',
          dtype: 'q8',
        });
        self.postMessage({ status: 'ready' });  // Inform the main thread that the model is ready
      } catch (error) {
        console.error('Error loading the model:', error);
        self.postMessage({
          status: 'error',
          error: error.message,
        });
      }
    }
    return this.instance;
  }
}

const sectionCache = new Map();

async function warmupGenerator(generator) {
  if (!generator || MyPipeline.warmedUp) {
    return;
  }

  await generator('Assistant:', {
    max_new_tokens: 8,
    temperature: 0.1,
    top_p: 0.9,
    do_sample: false,
    return_full_text: false,
  });

  MyPipeline.warmedUp = true;
}

function sanitizeAnswer(raw) {
  const protectedText = String(raw || '')
    .replace(/<think[\s\S]*?<\/think>/gi, '')
    .replace(/\b(Question:|User:|Assistant:|Answer:)\b[\s\S]*/i, '')
    .replace(/^\s*a:\s*/i, '')
    .replace(/^\s*(final answer:|answer:)\s*/i, '')
    .replace(/^\s*(user|assistant)\s*:\s*/gim, '')
    .replace(/\n{2,}/g, '\n')
    .replace(/(\d)\.(\d)/g, '$1__DOT__$2')
    .replace(/\b([A-Z])\.([A-Z])\./g, '$1__DOT__$2__DOT__')
    .replace(/\bM\.Eng\b/g, 'M__DOT__Eng')
    .trim();

  const sentences = protectedText.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  const limited = sentences
    .slice(0, 2)
    .join(' ')
    .replace(/__DOT__/g, '.')
    .trim();

  return limited || 'I’m not sure from my current context.';
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatSourceLabel(source) {
  switch (source) {
    case 'faq':
      return 'FAQ';
    case 'extractive':
      return 'Extractive';
    case 'generative':
      return 'Generative';
    case 'generative-fallback':
      return 'Fallback';
    default:
      return 'Unknown';
  }
}

function computeConfidence({
  source,
  faqScore = 0,
  extractiveScore = 0,
  bestSectionScore = 0,
  contextBlockCount = 0,
  usedFallback = false,
}) {
  const baselineMap = {
    faq: 88,
    extractive: 76,
    generative: 61,
    'generative-fallback': 50,
  };

  const primaryScore = source === 'faq' ? faqScore : extractiveScore;
  let confidence = baselineMap[source] ?? 55;
  confidence += Math.min(primaryScore * 3, 8);
  confidence += Math.min(bestSectionScore, 4);
  confidence += contextBlockCount === 1 ? 2 : 0;
  confidence -= usedFallback ? 6 : 0;

  return Math.round(clamp(confidence, 35, 95));
}

function buildAnswerMetadata({
  source,
  faqScore = 0,
  extractiveScore = 0,
  selectedSections = [],
  contextBlockCount = 0,
  generationMs = null,
  usedFallback = false,
}) {
  const bestSectionScore = selectedSections[0]?.score || 0;

  return {
    source,
    sourceLabel: formatSourceLabel(source),
    confidence: computeConfidence({
      source,
      faqScore,
      extractiveScore,
      bestSectionScore,
      contextBlockCount,
      usedFallback,
    }),
    faqScore,
    extractiveScore,
    contextBlockCount,
    bestSectionScore,
    generationMs,
    usedFallback,
    selectedSections: selectedSections.map(section => ({
      id: section.id,
      score: section.score,
    })),
  };
}

function splitSentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
}

function compactText(text, maxChars = 260) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars - 1).trim()}…`;
}

function normalizeQuestion(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseFaqEntries(context) {
  const lines = String(context || '').split(/\n+/g).map(line => line.trim());
  const entries = [];
  let currentQuestion = '';

  for (const line of lines) {
    if (line.startsWith('Q:')) {
      currentQuestion = line.slice(2).trim();
      continue;
    }

    if (line.startsWith('A:') && currentQuestion) {
      entries.push({
        question: currentQuestion,
        answer: line.slice(2).trim(),
      });
      currentQuestion = '';
    }
  }

  return entries;
}

function parseFaqEntriesFromData(faqData) {
  if (!faqData || !Array.isArray(faqData.entries)) {
    return [];
  }

  return faqData.entries
    .filter(entry => entry && entry.question && entry.answer)
    .map(entry => ({
      question: String(entry.question).trim(),
      answer: String(entry.answer).trim(),
      tags: Array.isArray(entry.tags) ? entry.tags : [],
    }));
}

async function loadSection(section) {
  if (!section?.id || !section?.file) {
    return null;
  }

  if (sectionCache.has(section.id)) {
    return sectionCache.get(section.id);
  }

  const response = await fetch(`/context/${section.file}`);
  if (!response.ok) {
    throw new Error(`Failed to load context section: ${section.file}`);
  }

  const data = await response.json();
  sectionCache.set(section.id, data);
  return data;
}

function scoreSection(section, questionTokens) {
  const sectionTokens = new Set([
    ...tokenize(section.id || ''),
    ...tokenize(section.title || ''),
    ...((section.keywords || []).flatMap(keyword => tokenize(keyword))),
  ]);

  let overlap = 0;
  for (const token of sectionTokens) {
    if (questionTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap;
}

async function resolveContextCorpus(question, contextIndex, fallbackContext = '') {
  if (!contextIndex || !Array.isArray(contextIndex.sections)) {
    return {
      contextText: String(fallbackContext || ''),
      faqEntries: parseFaqEntries(String(fallbackContext || '')),
      selectedSections: [],
    };
  }

  const questionTokens = expandQuestionTokens(question);
  const sections = contextIndex.sections.map(section => ({
    ...section,
    score: scoreSection(section, questionTokens) + (section.alwaysLoad ? 100 : 0),
  }));

  const selectedSections = sections
    .sort((a, b) => b.score - a.score)
    .filter((section, index, array) => section.alwaysLoad || section.score > 0 || index < Math.min(3, array.length))
    .slice(0, 4);

  const loadedSections = (await Promise.all(selectedSections.map(loadSection))).filter(Boolean);
  const faqSection = loadedSections.find(section => section.id === 'faq');

  const textBlocks = loadedSections
    .filter(section => Array.isArray(section.blocks))
    .flatMap(section => section.blocks)
    .map(block => typeof block.content === 'string' ? block.content.trim() : '')
    .filter(Boolean);

  return {
    contextText: textBlocks.join('\n\n'),
    faqEntries: parseFaqEntriesFromData(faqSection),
    selectedSections: selectedSections.map(section => ({
      id: section.id,
      score: section.score,
    })),
  };
}

function matchFaqAnswer(context, question, faqEntries = null) {
  const effectiveFaqEntries = Array.isArray(faqEntries) && faqEntries.length
    ? faqEntries
    : parseFaqEntries(context);
  const questionTokens = expandQuestionTokens(question);
  const normalizedQuestion = normalizeQuestion(question);

  let best = { answer: '', score: 0 };

  for (const entry of effectiveFaqEntries) {
    const entryTokens = new Set([
      ...tokenize(entry.question),
      ...((entry.tags || []).flatMap(tag => tokenize(tag))),
    ]);
    let overlap = 0;

    for (const token of entryTokens) {
      if (questionTokens.has(token)) {
        overlap += 1;
      }
    }

    const normalizedEntry = normalizeQuestion(entry.question);
    if (normalizedEntry === normalizedQuestion) {
      overlap += 3;
    }

    if (overlap > best.score) {
      best = { answer: sanitizeAnswer(entry.answer), score: overlap };
    }
  }

  return best;
}

function extractiveFallback(context, question) {
  const lines = String(context || '')
    .split(/\n+/g)
    .map(line => line.trim())
    .filter(line => line.length > 24)
    .filter(line => !/^[-=]{3,}$/.test(line))
    .filter(line => !/^[A-Z\s]{8,}$/.test(line));

  if (!lines.length) {
    return { answer: '', score: 0 };
  }

  const questionTokens = expandQuestionTokens(question);

  const ranked = lines.map((line, index) => {
    const tokens = new Set(tokenize(line));
    let overlap = 0;

    for (const token of tokens) {
      if (questionTokens.has(token)) {
        overlap += 1;
      }
    }

    const boostedOverlap = overlap + (line.toLowerCase().includes('aditya') ? 0.25 : 0);

    return {
      index,
      line,
      score: boostedOverlap,
    };
  });

  ranked.sort((a, b) => b.score - a.score);

  const candidates = ranked.filter(item => item.score > 0);

  if (!candidates.length) {
    return { answer: '', score: 0 };
  }

  const bestScore = candidates[0]?.score || 0;

  if (bestScore < 1) {
    return { answer: '', score: bestScore };
  }

  const selected = candidates
    .slice(0, 2)
    .sort((a, b) => a.index - b.index)
    .map(item => item.line)
    .join(' ')
    .trim();

  const answer = sanitizeAnswer(selected);
  return { answer, score: bestScore };
}

function isUnsureAnswer(answer) {
  return /^i['’]?m\s+not\s+sure/i.test(String(answer || '').trim());
}

const STOP_WORDS = new Set([
  'what', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how',
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'from',
  'about', 'tell', 'me', 'his', 'her', 'he', 'she', 'it', 'this', 'that', 'does', 'did',
]);

const TOKEN_EXPANSIONS = {
  academic: ['education', 'study', 'degree', 'university', 'gpa'],
  background: ['education', 'foundation', 'experience'],
  study: ['education', 'university', 'degree', 'college', 'school'],
  studied: ['education', 'university', 'degree', 'college', 'school'],
  where: ['location', 'university', 'college', 'school'],
  research: ['exploring', 'focus', 'areas', 'interest'],
  career: ['profession', 'work', 'path', 'engineering'],
  tools: ['technologies', 'python', 'matlab', 'pytorch', 'ros'],
  technologies: ['tools', 'python', 'matlab', 'pytorch', 'ros'],
};

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 2)
    .filter(token => !STOP_WORDS.has(token));
}

function expandQuestionTokens(question) {
  const base = tokenize(question);
  const expanded = new Set(base);

  for (const token of base) {
    const additions = TOKEN_EXPANSIONS[token] || [];
    for (const add of additions) {
      expanded.add(add);
    }
  }

  return expanded;
}

function selectRelevantContext(context, question, maxChunks = 3) {
  const blocks = String(context || '')
    .split(/\n\s*\n/g)
    .map(block => block.trim())
    .filter(Boolean);

  if (!blocks.length) {
    return {
      text: '',
      blockCount: 0,
      bestScore: 0,
    };
  }

  const questionTokens = expandQuestionTokens(question);

  const scored = blocks.map((block, index) => {
    const blockTokens = tokenize(block);
    const uniqueBlockTokens = new Set(blockTokens);

    let overlap = 0;
    for (const token of uniqueBlockTokens) {
      if (questionTokens.has(token)) {
        overlap += 1;
      }
    }

    return {
      index,
      block,
      score: overlap,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  const topChunks = scored
    .slice(0, maxChunks)
    .sort((a, b) => a.index - b.index);

  const selected = topChunks
    .map(item => item.block)
    .join('\n\n');

  return {
    text: selected || blocks.slice(0, maxChunks).join('\n\n'),
    blockCount: topChunks.length || Math.min(blocks.length, maxChunks),
    bestScore: scored[0]?.score || 0,
  };
}

self.addEventListener('message', async (event) => {
  if (event.data?.type === 'preload') {
    self.postMessage({ status: 'thinking', message: 'Preparing Electra model...' });
    const preloadGenerator = await MyPipeline.getInstance(x => {
      self.postMessage({ status: 'progress', ...x });
    });

    if (preloadGenerator) {
      try {
        self.postMessage({ status: 'thinking', message: 'Warming up model...' });
        await warmupGenerator(preloadGenerator);
        self.postMessage({ status: 'ready' });
      } catch (error) {
        self.postMessage({ status: 'error', error: error.message });
      }
    }
    return;
  }

  let generator = await MyPipeline.getInstance(x => {
    self.postMessage({ status: 'progress', ...x });
  });

  if (generator) {
    try {
      const question = (event.data.question || '').trim();
      const fallbackContext = (event.data.context || '').trim();
      const contextIndex = event.data.contextIndex || null;
      const history = Array.isArray(event.data.history) ? event.data.history : [];

      if (!question) {
        self.postMessage({
          status: 'error',
          error: 'Please enter a question.',
        });
        return;
      }

      self.postMessage({ status: 'thinking', message: 'Reading your question...' });
      self.postMessage({ status: 'thinking', message: 'Reviewing portfolio context...' });
      const corpus = await resolveContextCorpus(question, contextIndex, fallbackContext);
      const retrieved = selectRelevantContext(corpus.contextText, question, 3);
      const retrievedContext = retrieved.text;
      const faqMatch = matchFaqAnswer(corpus.contextText, question, corpus.faqEntries);
      if (faqMatch.answer && faqMatch.score >= 2) {
        self.postMessage({ status: 'thinking', message: 'Composing final wording...' });
        self.postMessage({
          status: 'complete',
          output: faqMatch.answer,
          metadata: buildAnswerMetadata({
            source: 'faq',
            faqScore: faqMatch.score,
            selectedSections: corpus.selectedSections,
            contextBlockCount: retrieved.blockCount,
          }),
        });
        return;
      }
      const fallback = extractiveFallback(retrievedContext, question);
      const directAnswer = fallback.answer;

      if (directAnswer && !isUnsureAnswer(directAnswer) && fallback.score >= 2) {
        self.postMessage({ status: 'thinking', message: 'Composing final wording...' });
        self.postMessage({
          status: 'complete',
          output: directAnswer,
          metadata: buildAnswerMetadata({
            source: 'extractive',
            faqScore: faqMatch.score,
            extractiveScore: fallback.score,
            selectedSections: corpus.selectedSections,
            contextBlockCount: retrieved.blockCount,
          }),
        });
        return;
      }

      self.postMessage({ status: 'thinking', message: 'Drafting a concise answer...' });

      const recentHistory = history
        .filter(item => item && item.role && item.content)
        .slice(-4)
        .map(item => `${item.role}: ${String(item.content).trim()}`)
        .join(' | ');

      const prompt = `You are Electra, Aditya Chaugule's lightweight portfolio assistant.
Only answer questions about Aditya based on the context below. If the answer is not in context, say you are not sure.
Keep answers concise, friendly, and clear.
Respond in 1-2 short sentences. Do not reveal chain-of-thought. Output only the final answer.

Context:
${retrievedContext}

Recent chat context (optional):
${recentHistory || 'none'}

Question:
${question}

Answer:`;

      let firstTokenSeen = false;
      const streamer = new TextStreamer(generator.tokenizer, {
        skip_prompt: true,
        callback_function: () => {
          if (!firstTokenSeen) {
            firstTokenSeen = true;
            self.postMessage({ status: 'thinking', message: 'Composing final wording...' });
          }
        },
      });

      const generationStart = performance.now();
      const result = await generator(prompt, {
        max_new_tokens: 96,
        temperature: 0.2,
        top_p: 0.9,
        do_sample: false,
        return_full_text: false,
        streamer,
      });
      const generationMs = Math.round(performance.now() - generationStart);

      const rawOutput =
        Array.isArray(result) && result[0] && typeof result[0].generated_text === 'string'
          ? result[0].generated_text
          : '';

      let finalOutput = sanitizeAnswer(rawOutput);
      let metadata = buildAnswerMetadata({
        source: 'generative',
        faqScore: faqMatch.score,
        extractiveScore: fallback.score,
        selectedSections: corpus.selectedSections,
        contextBlockCount: retrieved.blockCount,
        generationMs,
      });

      if (isUnsureAnswer(finalOutput) || finalOutput.length < 20) {
        const backup = extractiveFallback(retrievedContext, question);
        if (backup.answer) {
          finalOutput = backup.answer;
          metadata = buildAnswerMetadata({
            source: 'generative-fallback',
            faqScore: faqMatch.score,
            extractiveScore: backup.score,
            selectedSections: corpus.selectedSections,
            contextBlockCount: retrieved.blockCount,
            generationMs,
            usedFallback: true,
          });
        }
      }

      self.postMessage({
        status: 'complete',
        output: finalOutput,
        metadata,
      });
    } catch (error) {
      console.error('Error during text generation:', error);
      self.postMessage({
        status: 'error',
        error: error.message,
      });
    }
  } else {
    self.postMessage({
      status: 'error',
      error: 'Model could not be loaded',
    });
  }
});
