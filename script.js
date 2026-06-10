/**
 * NotesMind — AI Notes Summarizer
 * script.js
 *
 * Architecture:
 *  1. DOM References
 *  2. State
 *  3. Theme (dark / light)
 *  4. Input counters
 *  5. Summarization engine (extractive NLP)
 *  6. Keyword extractor
 *  7. Summary quality scorer
 *  8. Render output
 *  9. Stats dashboard
 * 10. History (localStorage)
 * 11. Export: .txt & PDF (print)
 * 12. Modal (history detail)
 * 13. Toast notifications
 * 14. Event wiring
 */

/* ══════════════════════════════════════════════
   1. DOM REFERENCES
══════════════════════════════════════════════ */
const notesInput       = document.getElementById('notesInput');
const charCountEl      = document.getElementById('charCount');
const wordCountEl      = document.getElementById('wordCount');
const textareaWrap     = document.getElementById('textareaWrap');
const summarizeBtn     = document.getElementById('summarizeBtn');
const clearBtn         = document.getElementById('clearBtn');
const processingBanner = document.getElementById('processingBanner');
const outputSection    = document.getElementById('outputSection');
const summaryBody      = document.getElementById('summaryBody');
const keywordsList     = document.getElementById('keywordsList');
const copyBtn          = document.getElementById('copyBtn');
const downloadTxtBtn   = document.getElementById('downloadTxtBtn');
const downloadPdfBtn   = document.getElementById('downloadPdfBtn');
const historyList      = document.getElementById('historyList');
const historyEmpty     = document.getElementById('historyEmpty');
const clearAllHistory  = document.getElementById('clearAllHistory');
const themeToggle      = document.getElementById('themeToggle');
const themeIcon        = document.getElementById('themeIcon');
const toastEl          = document.getElementById('toast');
const modalBackdrop    = document.getElementById('modalBackdrop');
const modalTitle       = document.getElementById('modalTitle');
const modalDate        = document.getElementById('modalDate');
const modalBody        = document.getElementById('modalBody');
const modalClose       = document.getElementById('modalClose');
const modalCopy        = document.getElementById('modalCopy');

// Stats
const statOrigWords  = document.getElementById('statOrigWords');
const statSumWords   = document.getElementById('statSumWords');
const statReduction  = document.getElementById('statReduction');
const statReadTime   = document.getElementById('statReadTime');
const qualityFill    = document.getElementById('qualityFill');
const qualityScore   = document.getElementById('qualityScore');

/* ══════════════════════════════════════════════
   2. STATE
══════════════════════════════════════════════ */
let currentSummary = '';   // Plain text of the current summary
let currentSummaryArr = []; // Array of sentence strings
let toastTimer = null;

/* ══════════════════════════════════════════════
   3. THEME
══════════════════════════════════════════════ */

/** Persist & apply a theme ('dark' | 'light') */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeIcon.textContent = (theme === 'dark') ? '🌙' : '☀️';
  localStorage.setItem('nm_theme', theme);
}

/** Toggle between dark and light */
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

// Load saved theme on start
(function initTheme() {
  const saved = localStorage.getItem('nm_theme') || 'dark';
  applyTheme(saved);
})();

/* ══════════════════════════════════════════════
   4. INPUT COUNTERS
══════════════════════════════════════════════ */

/** Count words in a string */
function countWords(text) {
  return text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
}

/** Update live char / word counter */
function updateCounters() {
  const text = notesInput.value;
  charCountEl.textContent = `${text.length.toLocaleString()} chars`;
  wordCountEl.textContent = `${countWords(text).toLocaleString()} words`;
}

/* ══════════════════════════════════════════════
   5. SUMMARIZATION ENGINE
   — Extractive, frequency-weighted sentence ranking
══════════════════════════════════════════════ */

/**
 * A list of common "stop words" to ignore during frequency analysis.
 */
const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'is','was','are','were','be','been','being','have','has','had','do',
  'does','did','will','would','shall','should','may','might','can','could',
  'not','this','that','these','those','it','its','i','we','you','they',
  'he','she','his','her','their','our','my','your','its','by','from',
  'about','into','through','during','before','after','above','below','as',
  'if','then','than','so','because','also','just','more','some','all',
  'up','out','no','there','here','how','what','which','who','when','where',
  'each','few','more','most','other','own','same','such','very','one',
  'two','three','said','like','know','think','us','him','them'
]);

/**
 * Tokenize text into sentences (handles . ! ? and newlines).
 * @param {string} text
 * @returns {string[]}
 */
function tokenizeSentences(text) {
  // Normalize newlines, then split on sentence-ending punctuation
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{2,}/g, '. ')  // paragraph breaks → full stop
    .replace(/\n/g, ' ');

  // Split but avoid breaking decimals like 3.14 or abbreviations
  const raw = normalized.split(/(?<=[.!?])\s+(?=[A-Z"'])/);

  return raw
    .map(s => s.trim())
    .filter(s => s.length > 20 && s.split(/\s+/).length >= 4);
}

/**
 * Build a word-frequency map from text (excluding stop words).
 * @param {string} text
 * @returns {Map<string, number>}
 */
function buildFrequencyMap(text) {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));

  const freq = new Map();
  words.forEach(w => freq.set(w, (freq.get(w) || 0) + 1));

  // Normalize by max frequency
  const maxFreq = Math.max(...freq.values(), 1);
  freq.forEach((v, k) => freq.set(k, v / maxFreq));

  return freq;
}

/**
 * Score a sentence based on the frequency map.
 * Bonus: position (early & late sentences score higher),
 *        length (not too short, not too long).
 * @param {string} sentence
 * @param {Map<string, number>} freq
 * @param {number} index
 * @param {number} total
 * @returns {number}
 */
function scoreSentence(sentence, freq, index, total) {
  const words = sentence
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));

  if (words.length === 0) return 0;

  // Sum of frequencies
  const freqScore = words.reduce((acc, w) => acc + (freq.get(w) || 0), 0) / words.length;

  // Position bonus: intro and closing sentences carry weight
  const posRatio  = index / Math.max(total - 1, 1);
  const posBonus  = (posRatio < 0.2 || posRatio > 0.8) ? 0.15 : 0;

  // Length sweet spot: 10-35 words
  const wc = sentence.split(/\s+/).length;
  const lenBonus = (wc >= 10 && wc <= 35) ? 0.1 : 0;

  return freqScore + posBonus + lenBonus;
}

/**
 * Core summarize function.
 * @param {string} text
 * @param {number} ratio — what fraction of sentences to keep (0–1)
 * @returns {{ sentences: string[], plainText: string }}
 */
function summarize(text, ratio = 0.3) {
  const sentences = tokenizeSentences(text);

  if (sentences.length === 0) {
    throw new Error('No meaningful sentences found. Try pasting longer text.');
  }

  if (sentences.length <= 3) {
    // Short text — return as-is
    return { sentences, plainText: sentences.join(' ') };
  }

  const freq = buildFrequencyMap(text);

  // Score each sentence, preserve original index for ordering
  const scored = sentences.map((s, i) => ({
    sentence: s,
    score: scoreSentence(s, freq, i, sentences.length),
    index: i
  }));

  // How many sentences to include
  const targetCount = Math.max(3, Math.min(
    Math.ceil(sentences.length * ratio),
    10   // hard cap at 10 sentences
  ));

  // Sort by score, pick top N, then re-sort by original position (coherent order)
  const topSentences = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, targetCount)
    .sort((a, b) => a.index - b.index)
    .map(item => item.sentence);

  const plainText = topSentences.join(' ');
  return { sentences: topSentences, plainText };
}

/* ══════════════════════════════════════════════
   6. KEYWORD EXTRACTOR
══════════════════════════════════════════════ */

/**
 * Extract the top N keywords from text using TF scoring.
 * @param {string} text
 * @param {number} n
 * @returns {{ word: string, score: number }[]}
 */
function extractKeywords(text, n = 12) {
  const freq = buildFrequencyMap(text);

  // Filter short words
  const entries = [...freq.entries()]
    .filter(([w]) => w.length > 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);

  return entries.map(([word, score]) => ({ word, score }));
}

/* ══════════════════════════════════════════════
   7. QUALITY SCORER
   — Measures information density of the summary
══════════════════════════════════════════════ */

/**
 * Scores summary quality 0–100 based on:
 *  • Reduction ratio (too little or too much is bad)
 *  • Unique vocabulary density
 *  • Avg sentence length in sweet spot
 * @param {string} origText
 * @param {string} summaryText
 * @returns {{ score: number, label: string }}
 */
function scoreQuality(origText, summaryText) {
  const origWords = countWords(origText);
  const sumWords  = countWords(summaryText);

  if (origWords === 0 || sumWords === 0) return { score: 0, label: 'N/A' };

  // 1. Reduction ratio (ideal: 20–40% of original)
  const ratio = sumWords / origWords;
  let ratioScore;
  if (ratio < 0.1)       ratioScore = 40;  // too compressed
  else if (ratio < 0.25) ratioScore = 90;  // excellent
  else if (ratio < 0.45) ratioScore = 80;  // good
  else if (ratio < 0.6)  ratioScore = 60;  // acceptable
  else                   ratioScore = 35;  // barely condensed

  // 2. Unique word ratio (richer vocab = better)
  const sumTokens = summaryText.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const uniqueRatio = (new Set(sumTokens).size / Math.max(sumTokens.length, 1));
  const vocabScore = Math.min(uniqueRatio * 120, 100);

  // 3. Sentence count (3–8 is ideal)
  const sCount = summaryText.split(/[.!?]+/).filter(s => s.trim().length > 10).length;
  const sentenceScore = sCount >= 3 && sCount <= 8 ? 90 : 60;

  const final = Math.round((ratioScore * 0.5) + (vocabScore * 0.3) + (sentenceScore * 0.2));
  const clamped = Math.min(Math.max(final, 20), 98);

  let label;
  if (clamped >= 85)      label = 'Excellent';
  else if (clamped >= 70) label = 'Good';
  else if (clamped >= 55) label = 'Fair';
  else                    label = 'Low';

  return { score: clamped, label };
}

/* ══════════════════════════════════════════════
   8. RENDER OUTPUT
══════════════════════════════════════════════ */

/** Render keyword pills */
function renderKeywords(keywords) {
  keywordsList.innerHTML = '';
  keywords.forEach(({ word, score }) => {
    const tag = document.createElement('span');
    tag.className = `keyword-tag ${score > 0.7 ? 'high' : ''}`;
    tag.textContent = word;
    tag.title = `Frequency score: ${(score * 100).toFixed(0)}%`;
    keywordsList.appendChild(tag);
  });
}

/** Render summary sentences as numbered cards */
function renderSummary(sentences) {
  summaryBody.innerHTML = '';
  sentences.forEach((sentence, i) => {
    const card = document.createElement('div');
    card.className = 'summary-sentence';

    const num = document.createElement('span');
    num.className = 'sentence-num';
    num.textContent = i + 1;

    const text = document.createElement('span');
    text.className = 'sentence-text';
    text.textContent = sentence;

    card.appendChild(num);
    card.appendChild(text);
    summaryBody.appendChild(card);
  });
}

/* ══════════════════════════════════════════════
   9. STATS DASHBOARD
══════════════════════════════════════════════ */

/**
 * Estimate reading time (average 200 words/min).
 * @param {number} wordCount
 * @returns {string}
 */
function readingTime(wordCount) {
  const minutes = wordCount / 200;
  if (minutes < 1) return `< 1 min`;
  return `${Math.round(minutes)} min`;
}

/** Populate the four stat cards + quality bar */
function renderStats(origText, summaryText) {
  const origWords = countWords(origText);
  const sumWords  = countWords(summaryText);
  const reduction = origWords > 0
    ? Math.round((1 - sumWords / origWords) * 100)
    : 0;

  statOrigWords.textContent = origWords.toLocaleString();
  statSumWords.textContent  = sumWords.toLocaleString();
  statReduction.textContent = `${reduction}%`;
  statReadTime.textContent  = readingTime(sumWords);

  const quality = scoreQuality(origText, summaryText);
  qualityFill.style.width = `${quality.score}%`;
  qualityScore.textContent = `${quality.score}/100 — ${quality.label}`;
}

/* ══════════════════════════════════════════════
   10. HISTORY  (localStorage)
══════════════════════════════════════════════ */

const STORAGE_KEY = 'nm_history';
const MAX_HISTORY = 20;

/** Load history array from localStorage */
function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

/** Save history array to localStorage */
function saveHistory(history) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

/** Add a new summary to history */
function addToHistory(summary, wordCount, origWords) {
  const history = loadHistory();
  const item = {
    id: Date.now().toString(),
    summary,
    wordCount,
    origWords,
    date: new Date().toLocaleString()
  };
  history.unshift(item);
  if (history.length > MAX_HISTORY) history.pop();
  saveHistory(history);
  renderHistoryList();
}

/** Delete a history item by id */
function deleteHistoryItem(id) {
  const history = loadHistory().filter(item => item.id !== id);
  saveHistory(history);
  renderHistoryList();
}

/** Clear entire history */
function clearHistory() {
  saveHistory([]);
  renderHistoryList();
}

/** Render the sidebar history list */
function renderHistoryList() {
  const history = loadHistory();

  // Remove all existing items (keep the empty-state element)
  const items = historyList.querySelectorAll('.history-item');
  items.forEach(el => el.remove());

  if (history.length === 0) {
    historyEmpty.style.display = 'flex';
    return;
  }

  historyEmpty.style.display = 'none';

  history.forEach(item => {
    const el = document.createElement('div');
    el.className = 'history-item';
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', `Summary from ${item.date}`);

    el.innerHTML = `
      <div class="history-item-content">
        <div class="history-item-preview">${escapeHtml(item.summary.slice(0, 120))}…</div>
        <div class="history-item-meta">
          <span>${item.wordCount} words</span>
          <span>·</span>
          <span>${item.date}</span>
        </div>
      </div>
      <button class="history-item-del" data-id="${item.id}" title="Delete" aria-label="Delete this history item">
        <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13">
          <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 9a1 1 0 001 1h6a1 1 0 001-1l1-9"
            stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/>
        </svg>
      </button>
    `;

    // Click content area → open modal
    el.querySelector('.history-item-content').addEventListener('click', () => openModal(item));
    el.querySelector('.history-item-content').addEventListener('keydown', e => {
      if (e.key === 'Enter') openModal(item);
    });

    // Click delete button
    el.querySelector('.history-item-del').addEventListener('click', e => {
      e.stopPropagation();
      deleteHistoryItem(item.id);
    });

    historyList.appendChild(el);
  });
}

/** Simple HTML-escape to avoid XSS in history previews */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ══════════════════════════════════════════════
   11. EXPORT
══════════════════════════════════════════════ */

/** Download summary as a plain .txt file */
function downloadTxt(text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `summary_${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Export summary as PDF using the browser's print dialog.
 * Injects a temporary hidden iframe with styled content, then triggers print.
 */
function exportPdf(summaryText, keywords) {
  const theme = document.documentElement.getAttribute('data-theme');
  const isDark = theme === 'dark';

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>NotesMind Summary</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Inter:wght@400;500&display=swap');
    body {
      font-family: 'Inter', sans-serif;
      max-width: 680px;
      margin: 40px auto;
      padding: 0 32px;
      color: #111;
      background: #fff;
    }
    h1 {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 1.5rem;
      margin-bottom: 4px;
      color: #1a1a2e;
    }
    .meta {
      font-size: 0.8rem;
      color: #888;
      margin-bottom: 24px;
      border-bottom: 1px solid #eee;
      padding-bottom: 12px;
    }
    .sentence {
      background: #f7f8fc;
      border-left: 3px solid #6366F1;
      padding: 10px 14px;
      margin-bottom: 10px;
      border-radius: 6px;
      font-size: 0.92rem;
      line-height: 1.65;
    }
    .keywords {
      margin-top: 24px;
      font-size: 0.8rem;
      color: #444;
    }
    .keywords strong {
      display: block;
      margin-bottom: 8px;
      color: #6366F1;
      font-family: 'Space Grotesk', sans-serif;
    }
    .kw-list { display: flex; flex-wrap: wrap; gap: 6px; }
    .kw {
      background: #ede9fe;
      color: #5856d6;
      padding: 3px 10px;
      border-radius: 99px;
      font-weight: 500;
    }
    @media print {
      body { margin: 0; padding: 20px; }
    }
  </style>
</head>
<body>
  <h1>NotesMind — Summary</h1>
  <div class="meta">Generated on ${new Date().toLocaleString()} · NotesMind AI Summarizer</div>
  ${currentSummaryArr.map((s, i) => `<div class="sentence">${i + 1}. ${escapeHtml(s)}</div>`).join('\n')}
  ${keywords.length > 0 ? `
  <div class="keywords">
    <strong>Key Topics</strong>
    <div class="kw-list">
      ${keywords.slice(0, 10).map(k => `<span class="kw">${escapeHtml(k.word)}</span>`).join('')}
    </div>
  </div>` : ''}
</body>
</html>`;

  // Open in a new window and print
  const win = window.open('', '_blank', 'width=800,height=600');
  if (!win) {
    showToast('Pop-up blocked. Please allow pop-ups and try again.', 'error');
    return;
  }
  win.document.write(html);
  win.document.close();
  win.onload = () => {
    setTimeout(() => {
      win.print();
      win.close();
    }, 400);
  };
}

/* ══════════════════════════════════════════════
   12. MODAL
══════════════════════════════════════════════ */

let modalCurrentText = '';

function openModal(item) {
  modalTitle.textContent = 'Previous Summary';
  modalDate.textContent  = `Saved ${item.date} · ${item.wordCount} words`;
  modalBody.textContent  = item.summary;
  modalCurrentText       = item.summary;
  modalBackdrop.hidden   = false;
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  modalBackdrop.hidden = true;
  document.body.style.overflow = '';
}

/* ══════════════════════════════════════════════
   13. TOAST NOTIFICATIONS
══════════════════════════════════════════════ */

/**
 * Show a brief toast message.
 * @param {string} message
 * @param {'success'|'error'|''} type
 * @param {number} duration — ms
 */
function showToast(message, type = '', duration = 2800) {
  clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.className = `toast ${type} show`;
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
  }, duration);
}

/* ══════════════════════════════════════════════
   14. MAIN FLOW — Summarize
══════════════════════════════════════════════ */

let latestKeywords = [];

function handleSummarize() {
  const text = notesInput.value.trim();

  // Validation
  if (!text) {
    showToast('⚠️ Please paste some text before summarizing.', 'error');
    notesInput.focus();
    return;
  }
  if (countWords(text) < 30) {
    showToast('⚠️ Text is too short. Paste at least 30 words for a meaningful summary.', 'error');
    notesInput.focus();
    return;
  }

  // UI: loading state
  summarizeBtn.classList.add('loading');
  summarizeBtn.disabled = true;
  processingBanner.hidden = false;
  outputSection.hidden = true;

  // Simulate async "AI" processing with a short delay for UX
  const startTime = Date.now();
  const MIN_DELAY = 900; // ms — feels deliberate, not instant

  setTimeout(() => {
    try {
      // Run summarization
      const { sentences, plainText } = summarize(text, 0.3);
      latestKeywords = extractKeywords(text, 14);

      currentSummaryArr = sentences;
      currentSummary    = plainText;

      // Render everything
      renderSummary(sentences);
      renderKeywords(latestKeywords);
      renderStats(text, plainText);

      // Show output
      outputSection.hidden = false;

      // Save to history
      addToHistory(plainText, countWords(plainText), countWords(text));

      showToast('✅ Summary ready!', 'success');

    } catch (err) {
      showToast(`❌ ${err.message}`, 'error');
    } finally {
      // Always restore UI
      summarizeBtn.classList.remove('loading');
      summarizeBtn.disabled = false;
      processingBanner.hidden = true;

      // Smooth scroll to output
      if (!outputSection.hidden) {
        setTimeout(() => {
          outputSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      }
    }
  }, Math.max(MIN_DELAY - (Date.now() - startTime), 0));
}

/* ══════════════════════════════════════════════
   15. EVENT WIRING
══════════════════════════════════════════════ */

// Input updates
notesInput.addEventListener('input', updateCounters);

// Textarea focus ring
notesInput.addEventListener('focus', () => textareaWrap.classList.add('focused'));
notesInput.addEventListener('blur',  () => textareaWrap.classList.remove('focused'));

// Summarize
summarizeBtn.addEventListener('click', handleSummarize);

// Allow Ctrl+Enter to summarize
notesInput.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    handleSummarize();
  }
});

// Clear input
clearBtn.addEventListener('click', () => {
  notesInput.value = '';
  updateCounters();
  outputSection.hidden = true;
  currentSummary = '';
  currentSummaryArr = [];
  notesInput.focus();
});

// Copy summary
copyBtn.addEventListener('click', () => {
  if (!currentSummary) return;
  navigator.clipboard.writeText(currentSummary)
    .then(() => showToast('📋 Summary copied to clipboard!', 'success'))
    .catch(() => {
      // Fallback for browsers without clipboard API
      const ta = document.createElement('textarea');
      ta.value = currentSummary;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('📋 Copied!', 'success');
    });
});

// Download .txt
downloadTxtBtn.addEventListener('click', () => {
  if (!currentSummary) return;
  downloadTxt(currentSummary);
  showToast('⬇️ Downloaded summary.txt', 'success');
});

// Export PDF
downloadPdfBtn.addEventListener('click', () => {
  if (!currentSummary) return;
  exportPdf(currentSummary, latestKeywords);
});

// Theme toggle
themeToggle.addEventListener('click', toggleTheme);

// History: clear all
clearAllHistory.addEventListener('click', () => {
  if (loadHistory().length === 0) return;
  clearHistory();
  showToast('🗑️ History cleared.', '');
});

// Modal: close on backdrop click or Escape
modalClose.addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', e => {
  if (e.target === modalBackdrop) closeModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !modalBackdrop.hidden) closeModal();
});

// Modal copy
modalCopy.addEventListener('click', () => {
  navigator.clipboard.writeText(modalCurrentText)
    .then(() => showToast('📋 Copied!', 'success'))
    .catch(() => showToast('Could not copy.', 'error'));
  closeModal();
});

/* ══════════════════════════════════════════════
   INIT
══════════════════════════════════════════════ */
(function init() {
  updateCounters();
  renderHistoryList();
  console.log('%cNotesMind AI Summarizer loaded ✅', 'color:#6366F1;font-weight:bold;font-size:14px');
})();
