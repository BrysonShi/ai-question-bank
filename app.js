'use strict';

// ========== API 配置 ==========
// 同源部署时留空即可（如 Coze 沙箱环境）
// 部署到 GitHub Pages 时，修改为后端地址，如 'https://your-backend.example.com'
// 也可在浏览器控制台执行 localStorage.setItem('aqb_api_base', 'https://...') 动态配置
const API_BASE = localStorage.getItem('aqb_api_base') || '';

// ========== State ==========
const state = {
  images: [],
  subject: 'accounting',
  currentTab: 'analysis',
  isAnalyzing: false,
  wrongBook: [],
  history: []
};

// ========== Constants ==========
const STORAGE_KEYS = {
  WRONG_BOOK: 'aqb_wrong_book',
  HISTORY: 'aqb_history',
  SETTINGS: 'aqb_settings'
};

const SUBJECT_NAMES = {
  tax: '税法',
  accounting: '会计',
  audit: '审计',
  finance: '财管',
  strategy: '战略',
  economic_law: '经济法'
};

const MAX_IMAGES = 20;
const MAX_IMAGE_DIM = 1920;
const IMAGE_QUALITY = 0.85;

// ========== DOM ==========
const els = {
  subjectSelect: document.getElementById('subjectSelect'),
  uploadZone: document.getElementById('uploadZone'),
  fileInput: document.getElementById('fileInput'),
  thumbnailList: document.getElementById('thumbnailList'),
  actionBar: document.getElementById('actionBar'),
  uploadCount: document.getElementById('uploadCount'),
  clearBtn: document.getElementById('clearBtn'),
  analyzeBtn: document.getElementById('analyzeBtn'),
  progressBar: document.getElementById('progressBar'),
  progressText: document.getElementById('progressText'),
  progressCount: document.getElementById('progressCount'),
  progressFill: document.getElementById('progressFill'),
  resultsContainer: document.getElementById('resultsContainer'),
  emptyState: document.getElementById('emptyState'),
  wrongBookContainer: document.getElementById('wrongBookContainer'),
  wrongEmpty: document.getElementById('wrongEmpty'),
  wrongCount: document.getElementById('wrongCount'),
  wrongSubjectFilter: document.getElementById('wrongSubjectFilter'),
  clearWrongBtn: document.getElementById('clearWrongBtn'),
  historyContainer: document.getElementById('historyContainer'),
  historyEmpty: document.getElementById('historyEmpty'),
  clearHistoryBtn: document.getElementById('clearHistoryBtn'),
  imageViewer: document.getElementById('imageViewer'),
  viewerImage: document.getElementById('viewerImage'),
  closeViewer: document.getElementById('closeViewer'),
  toastContainer: document.getElementById('toastContainer'),
  tabs: document.querySelectorAll('.tab'),
  tabContents: document.querySelectorAll('.tab-content')
};

// 流式卡片引用（避免全量重渲染）
const streamingCards = new Map();

// ========== Utility ==========
function generateId() {
  return 'id_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function showToast(message, type) {
  type = type || 'info';
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.textContent = message;
  els.toastContainer.appendChild(toast);
  setTimeout(function () {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(function () { toast.remove(); }, 300);
  }, 3000);
}

function formatDate(ts) {
  const d = new Date(ts);
  const pad = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function naturalSort(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ========== Image Processing ==========
function compressImage(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function (e) {
      const img = new Image();
      img.onload = function () {
        let w = img.width;
        let h = img.height;
        if (w > MAX_IMAGE_DIM || h > MAX_IMAGE_DIM) {
          const ratio = Math.min(MAX_IMAGE_DIM / w, MAX_IMAGE_DIM / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', IMAGE_QUALITY));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ========== Upload Handling ==========
async function handleFiles(fileList) {
  const files = Array.from(fileList).filter(function (f) { return f.type.startsWith('image/'); });
  if (files.length === 0) {
    showToast('请选择图片文件', 'error');
    return;
  }

  const remaining = MAX_IMAGES - state.images.length;
  if (remaining <= 0) {
    showToast('最多上传 ' + MAX_IMAGES + ' 张图片', 'error');
    return;
  }

  const toProcess = files.slice(0, remaining);
  if (files.length > remaining) {
    showToast('已达上限 ' + MAX_IMAGES + ' 张，部分图片未添加', 'error');
  }

  for (const file of toProcess) {
    try {
      const dataUrl = await compressImage(file);
      state.images.push({
        id: generateId(),
        dataUrl: dataUrl,
        name: file.name,
        status: 'pending',
        rawText: '',
        questions: [],
        error: null
      });
    } catch (err) {
      showToast('图片处理失败: ' + file.name, 'error');
    }
  }

  renderThumbnails();
  updateActionBar();
  showToast('已添加 ' + toProcess.length + ' 张图片', 'success');
}

function setupUploadZone() {
  // 点击上传
  els.uploadZone.addEventListener('click', function () {
    els.fileInput.click();
  });
  els.fileInput.addEventListener('change', function (e) {
    handleFiles(e.target.files);
    els.fileInput.value = '';
  });

  // 拖拽上传
  els.uploadZone.addEventListener('dragover', function (e) {
    e.preventDefault();
    els.uploadZone.classList.add('drag-active');
  });
  els.uploadZone.addEventListener('dragleave', function () {
    els.uploadZone.classList.remove('drag-active');
  });
  els.uploadZone.addEventListener('drop', function (e) {
    e.preventDefault();
    els.uploadZone.classList.remove('drag-active');
    handleFiles(e.dataTransfer.files);
  });

  // 粘贴上传
  document.addEventListener('paste', function (e) {
    if (state.currentTab !== 'analysis') return;
    const items = e.clipboardData ? e.clipboardData.items : [];
    const imageFiles = [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      handleFiles(imageFiles);
    }
  });
}

// ========== Thumbnail Rendering ==========
function renderThumbnails() {
  if (state.images.length === 0) {
    els.thumbnailList.classList.add('hidden');
    els.thumbnailList.innerHTML = '';
    return;
  }
  els.thumbnailList.classList.remove('hidden');
  els.thumbnailList.innerHTML = '';

  state.images.forEach(function (img, idx) {
    const item = document.createElement('div');
    item.className = 'thumbnail-item';

    const imgEl = document.createElement('img');
    imgEl.src = img.dataUrl;
    imgEl.alt = img.name;
    item.appendChild(imgEl);

    const index = document.createElement('span');
    index.className = 'thumbnail-index';
    index.textContent = String(idx + 1);
    item.appendChild(index);

    const remove = document.createElement('button');
    remove.className = 'thumbnail-remove';
    remove.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    remove.addEventListener('click', function (e) {
      e.stopPropagation();
      removeImage(img.id);
    });
    item.appendChild(remove);

    const status = document.createElement('div');
    status.className = 'thumbnail-status ' + img.status;
    const statusText = {
      pending: '待解析',
      analyzing: '解析中',
      done: '已完成',
      error: '失败'
    };
    status.textContent = statusText[img.status] || img.status;
    item.appendChild(status);

    els.thumbnailList.appendChild(item);
  });
}

function removeImage(id) {
  state.images = state.images.filter(function (img) { return img.id !== id; });
  streamingCards.delete(id);
  renderThumbnails();
  updateActionBar();
  renderResults();
}

// ========== Action Bar ==========
function updateActionBar() {
  const hasImages = state.images.length > 0;
  els.actionBar.classList.toggle('hidden', !hasImages);
  els.uploadCount.textContent = '已选 ' + state.images.length + ' 张';
  els.emptyState.classList.toggle('hidden', hasImages);

  const hasPending = state.images.some(function (img) { return img.status === 'pending'; });
  els.analyzeBtn.disabled = !hasPending || state.isAnalyzing;
}

// ========== Analysis ==========
async function startAnalysis() {
  const pending = state.images.filter(function (img) { return img.status === 'pending'; });
  if (pending.length === 0) return;

  state.isAnalyzing = true;
  els.analyzeBtn.disabled = true;
  els.progressBar.classList.remove('hidden');
  els.emptyState.classList.add('hidden');

  const total = pending.length;
  let completed = 0;

  for (const image of pending) {
    updateProgress(completed, total);
    await analyzeImage(image);
    completed++;
    renderThumbnails();
  }

  updateProgress(total, total);
  state.isAnalyzing = false;
  els.analyzeBtn.disabled = false;

  setTimeout(function () {
    els.progressBar.classList.add('hidden');
  }, 1000);

  const allQuestions = state.images
    .filter(function (img) { return img.status === 'done'; })
    .flatMap(function (img) { return img.questions; });

  if (allQuestions.length > 0) {
    saveToHistory(allQuestions);
    showToast('解析完成，共 ' + allQuestions.length + ' 道题', 'success');
  } else {
    showToast('未识别到题目，请检查图片清晰度', 'error');
  }
}

async function analyzeImage(image) {
  image.status = 'analyzing';
  image.rawText = '';
  image.questions = [];
  image.error = null;

  // 创建流式卡片
  renderResults();

  try {
    const response = await fetch(`${API_BASE}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: image.dataUrl,
        subject: state.subject,
        index: image.id
      })
    });

    if (!response.ok) {
      throw new Error('HTTP ' + response.status);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const result = await reader.read();
      if (result.done) break;

      buffer += decoder.decode(result.value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            handleSSEEvent(data, image);
          } catch (e) {
            // 忽略不完整的 JSON
          }
        }
      }
    }

    // 如果流结束但没有收到 complete 事件
    if (image.status === 'analyzing') {
      if (image.rawText) {
        image.questions = parseLLMResponse(image.rawText, image.dataUrl);
        image.status = image.questions.length > 0 ? 'done' : 'error';
        if (image.status === 'error') {
          image.error = '未能解析出题目内容';
        }
      } else {
        image.status = 'error';
        image.error = '未收到分析结果';
      }
      renderResults();
    }
  } catch (err) {
    image.status = 'error';
    image.error = err.message || '分析失败';
    renderResults();
  }
}

function handleSSEEvent(data, image) {
  switch (data.type) {
    case 'start':
      image.status = 'analyzing';
      break;
    case 'chunk':
      image.rawText += data.content;
      updateStreamingPreview(image);
      break;
    case 'complete':
      image.questions = parseLLMResponse(data.raw || image.rawText, image.dataUrl);
      image.status = image.questions.length > 0 ? 'done' : 'error';
      if (image.status === 'error') {
        image.error = '未能从 AI 响应中解析出题目';
      }
      streamingCards.delete(image.id);
      renderResults();
      break;
    case 'error':
      image.status = 'error';
      image.error = data.message || '分析失败';
      streamingCards.delete(image.id);
      renderResults();
      break;
  }
}

function updateStreamingPreview(image) {
  const card = streamingCards.get(image.id);
  if (card) {
    const preview = card.querySelector('.streaming-preview');
    if (preview) {
      preview.textContent = image.rawText.slice(-500);
      preview.scrollTop = preview.scrollHeight;
    }
  }
}

function updateProgress(completed, total) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  els.progressFill.style.width = pct + '%';
  els.progressText.textContent = completed < total ? '正在解析...' : '解析完成';
  els.progressCount.textContent = completed + ' / ' + total;
}

// ========== Result Parsing ==========
function parseLLMResponse(raw, imageDataUrl) {
  if (!raw) return [];

  let jsonStr = raw.trim();

  // 去除 markdown 代码块标记
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  // 尝试提取 JSON 对象
  const jsonStart = jsonStr.indexOf('{');
  const jsonEnd = jsonStr.lastIndexOf('}');
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    jsonStr = jsonStr.slice(jsonStart, jsonEnd + 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    // 尝试修复常见 JSON 格式问题
    try {
      jsonStr = jsonStr
        .replace(/,\s*}/g, '}')
        .replace(/,\s*]/g, ']')
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/[\u2018\u2019]/g, "'");
      parsed = JSON.parse(jsonStr);
    } catch (e2) {
      return [];
    }
  }

  let questions = [];
  if (Array.isArray(parsed.questions)) {
    questions = parsed.questions;
  } else if (parsed.questionNumber || parsed.questionType) {
    questions = [parsed];
  }

  return questions.map(function (q) {
    return {
      id: generateId(),
      questionNumber: q.questionNumber || '未编号',
      questionType: q.questionType || '简答题',
      questionStem: q.questionStem || '',
      options: q.options || null,
      answer: q.answer || '',
      analysis: q.analysis || '',
      knowledgePoints: Array.isArray(q.knowledgePoints) ? q.knowledgePoints : [],
      commonMistakes: q.commonMistakes || '',
      subject: state.subject,
      subjectName: SUBJECT_NAMES[state.subject] || '会计',
      imageDataUrl: imageDataUrl || null,
      timestamp: Date.now(),
      isWrong: false
    };
  });
}

// ========== Result Rendering ==========
function renderResults() {
  const container = els.resultsContainer;
  container.innerHTML = '';
  streamingCards.clear();

  // 收集所有渲染项
  const streamItems = [];
  const questionItems = [];
  const errorItems = [];

  state.images.forEach(function (img) {
    if (img.status === 'analyzing') {
      streamItems.push(img);
    } else if (img.status === 'done' && img.questions.length > 0) {
      img.questions.forEach(function (q) {
        questionItems.push(q);
      });
    } else if (img.status === 'error') {
      errorItems.push(img);
    }
  });

  // 题目按题号排序
  questionItems.sort(function (a, b) {
    return naturalSort(a.questionNumber, b.questionNumber);
  });

  // 渲染：流式中 → 题目 → 错误
  streamItems.forEach(function (img) {
    container.appendChild(createStreamingCard(img));
  });
  questionItems.forEach(function (q) {
    container.appendChild(createQuestionCard(q));
  });
  errorItems.forEach(function (img) {
    container.appendChild(createErrorCard(img));
  });

  els.emptyState.classList.toggle('hidden', state.images.length > 0);
}

function createStreamingCard(image) {
  const card = document.createElement('div');
  card.className = 'streaming-card';
  card.innerHTML =
    '<div class="streaming-header">' +
    '<div class="streaming-spinner"></div>' +
    '<span class="streaming-text">AI 正在分析图片...</span>' +
    '</div>' +
    '<div class="streaming-preview"></div>';
  streamingCards.set(image.id, card);
  return card;
}

function createErrorCard(image) {
  const card = document.createElement('div');
  card.className = 'error-card';
  card.innerHTML =
    '<div class="error-card-title">' +
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>' +
    '</svg>' +
    '解析失败' +
    '</div>' +
    '<div class="error-card-msg">' + escapeHtml(image.error || '未知错误') + '</div>';

  const retryBtn = document.createElement('button');
  retryBtn.className = 'btn btn-secondary btn-sm';
  retryBtn.style.marginTop = '10px';
  retryBtn.textContent = '重试';
  retryBtn.addEventListener('click', function () {
    image.status = 'pending';
    image.error = null;
    renderResults();
    renderThumbnails();
    updateActionBar();
    startAnalysis();
  });
  card.appendChild(retryBtn);

  return card;
}

function createQuestionCard(q) {
  const card = document.createElement('div');
  card.className = 'question-card';
  card.dataset.questionId = q.id;

  // 标记是否在错题本中
  const inWrongBook = state.wrongBook.some(function (w) { return w.id === q.id; });
  q.isWrong = inWrongBook;

  // 头部
  const header = document.createElement('div');
  header.className = 'card-header';
  header.innerHTML =
    '<div class="card-header-left">' +
    '<span class="question-number">第 ' + escapeHtml(q.questionNumber) + ' 题</span>' +
    '<span class="type-tag" data-type="' + escapeHtml(q.questionType) + '">' + escapeHtml(q.questionType) + '</span>' +
    '</div>' +
    '<div class="card-header-right">' +
    '<button class="star-btn ' + (inWrongBook ? 'active' : '') + '" title="标记错题">' +
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="' + (inWrongBook ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2">' +
    '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>' +
    '</svg>' +
    '</button>' +
    '</div>';
  card.appendChild(header);

  // 星标按钮
  const starBtn = header.querySelector('.star-btn');
  starBtn.addEventListener('click', function () {
    toggleWrongMark(q);
  });

  // 主体
  const body = document.createElement('div');
  body.className = 'card-body';

  // 题干
  const stem = document.createElement('div');
  stem.className = 'question-stem';
  stem.textContent = q.questionStem;
  body.appendChild(stem);

  // 选项
  if (q.options && typeof q.options === 'object') {
    const optList = document.createElement('div');
    optList.className = 'options-list';
    const correctAnswers = String(q.answer || '').toUpperCase().split('').filter(function (c) {
      return c.trim();
    });

    Object.keys(q.options).forEach(function (key) {
      const opt = document.createElement('div');
      opt.className = 'option-item';
      if (correctAnswers.indexOf(key.toUpperCase()) >= 0) {
        opt.classList.add('correct');
      }
      opt.innerHTML =
        '<span class="option-label">' + escapeHtml(key) + '.</span>' +
        '<span>' + escapeHtml(q.options[key]) + '</span>';
      optList.appendChild(opt);
    });
    body.appendChild(optList);
  }

  // 答案
  if (q.answer) {
    const ans = document.createElement('div');
    ans.className = 'answer-section';
    ans.innerHTML =
      '<div class="answer-label">正确答案</div>' +
      '<div class="answer-value">' + escapeHtml(q.answer) + '</div>';
    body.appendChild(ans);
  }

  // 解析（可折叠）
  if (q.analysis) {
    const collapsible = document.createElement('div');
    collapsible.className = 'collapsible';
    collapsible.innerHTML =
      '<button class="collapse-trigger">' +
      '<span>详细解析</span>' +
      '<svg class="collapse-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
      '<polyline points="6 9 12 15 18 9"/>' +
      '</svg>' +
      '</button>' +
      '<div class="collapse-content">' +
      '<div class="analysis-text">' + escapeHtml(q.analysis) + '</div>' +
      '</div>';
    body.appendChild(collapsible);

    const trigger = collapsible.querySelector('.collapse-trigger');
    const content = collapsible.querySelector('.collapse-content');
    trigger.addEventListener('click', function () {
      trigger.classList.toggle('expanded');
      content.classList.toggle('show');
    });
  }

  // 知识点
  if (q.knowledgePoints && q.knowledgePoints.length > 0) {
    const kpContainer = document.createElement('div');
    kpContainer.style.marginTop = '12px';
    const kpLabel = document.createElement('div');
    kpLabel.style.fontSize = '12px';
    kpLabel.style.fontWeight = '600';
    kpLabel.style.color = 'var(--color-text-secondary)';
    kpLabel.style.marginBottom = '6px';
    kpLabel.textContent = '知识点';
    kpContainer.appendChild(kpLabel);

    const kpList = document.createElement('div');
    kpList.className = 'knowledge-points';
    q.knowledgePoints.forEach(function (kp) {
      const tag = document.createElement('span');
      tag.className = 'kp-tag';
      tag.textContent = kp;
      kpList.appendChild(tag);
    });
    kpContainer.appendChild(kpList);
    body.appendChild(kpContainer);
  }

  // 易错点
  if (q.commonMistakes) {
    const mistakes = document.createElement('div');
    mistakes.className = 'mistakes-box';
    mistakes.innerHTML =
      '<div class="mistakes-label">易错点提示</div>' +
      '<div class="mistakes-text">' + escapeHtml(q.commonMistakes) + '</div>';
    body.appendChild(mistakes);
  }

  card.appendChild(body);

  // 底部操作
  const footer = document.createElement('div');
  footer.className = 'card-footer';

  if (q.imageDataUrl) {
    const viewBtn = document.createElement('button');
    viewBtn.className = 'btn btn-ghost';
    viewBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
      '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>' +
      '<circle cx="12" cy="12" r="3"/>' +
      '</svg>' +
      '查看原图';
    viewBtn.addEventListener('click', function () {
      showImageViewer(q.imageDataUrl);
    });
    footer.appendChild(viewBtn);
  }

  card.appendChild(footer);
  return card;
}

// ========== Wrong Answer Book ==========
function toggleWrongMark(question) {
  const idx = state.wrongBook.findIndex(function (w) { return w.id === question.id; });
  if (idx >= 0) {
    state.wrongBook.splice(idx, 1);
    question.isWrong = false;
    showToast('已从错题本移除', 'info');
  } else {
    state.wrongBook.push(Object.assign({}, question, { isWrong: true }));
    question.isWrong = true;
    showToast('已加入错题本', 'success');
  }
  saveWrongBook();
  renderResults();
  updateWrongCount();
  if (state.currentTab === 'wrong') {
    renderWrongBook();
  }
}

function updateWrongCount() {
  const count = state.wrongBook.length;
  els.wrongCount.textContent = String(count);
  els.wrongCount.classList.toggle('hidden', count === 0);
}

function renderWrongBook() {
  const container = els.wrongBookContainer;
  const filter = els.wrongSubjectFilter.value;
  container.innerHTML = '';

  let items = state.wrongBook;
  if (filter) {
    items = items.filter(function (q) { return q.subject === filter; });
  }

  // 按题号排序
  items.sort(function (a, b) {
    return naturalSort(a.questionNumber, b.questionNumber);
  });

  els.wrongEmpty.classList.toggle('hidden', items.length > 0);

  items.forEach(function (q) {
    container.appendChild(createQuestionCard(q));
  });
}

// ========== History ==========
function saveToHistory(allQuestions) {
  if (!allQuestions || allQuestions.length === 0) return;

  const record = {
    id: generateId(),
    timestamp: Date.now(),
    subject: state.subject,
    subjectName: SUBJECT_NAMES[state.subject] || '会计',
    imageCount: state.images.filter(function (img) { return img.status === 'done'; }).length,
    questionCount: allQuestions.length,
    questions: allQuestions
  };

  state.history.unshift(record);
  if (state.history.length > 10) {
    state.history = state.history.slice(0, 10);
  }
  saveHistory();
  renderHistory();
}

function renderHistory() {
  const container = els.historyContainer;
  container.innerHTML = '';

  els.historyEmpty.classList.toggle('hidden', state.history.length > 0);

  state.history.forEach(function (record) {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML =
      '<div class="history-header">' +
      '<div class="history-info">' +
      '<span class="history-subject">' + escapeHtml(record.subjectName) + '</span>' +
      '<span class="history-meta">' + formatDate(record.timestamp) + '</span>' +
      '<span class="history-meta">' + record.imageCount + ' 张图片 / ' + record.questionCount + ' 道题</span>' +
      '</div>' +
      '<svg class="history-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
      '<polyline points="6 9 12 15 18 9"/>' +
      '</svg>' +
      '</div>' +
      '<div class="history-detail">' +
      '<div class="results-container"></div>' +
      '</div>';

    const header = item.querySelector('.history-header');
    const detail = item.querySelector('.history-detail');
    const detailContainer = item.querySelector('.results-container');

    let expanded = false;
    header.addEventListener('click', function () {
      expanded = !expanded;
      item.classList.toggle('expanded', expanded);
      if (expanded && detailContainer.children.length === 0) {
        record.questions.forEach(function (q) {
          detailContainer.appendChild(createQuestionCard(q));
        });
      }
    });

    container.appendChild(item);
  });
}

// ========== Tab Management ==========
function switchTab(tabName) {
  state.currentTab = tabName;
  els.tabs.forEach(function (tab) {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });
  els.tabContents.forEach(function (content) {
    content.classList.toggle('active', content.id === 'tab-' + tabName);
  });

  if (tabName === 'wrong') {
    renderWrongBook();
  } else if (tabName === 'history') {
    renderHistory();
  } else if (tabName === 'widget') {
    initWidgetTab();
  }
}

// ========== Subject Management ==========
function switchSubject(subject) {
  state.subject = subject;
  saveSettings();
}

// ========== Image Viewer ==========
function showImageViewer(dataUrl) {
  els.viewerImage.src = dataUrl;
  els.imageViewer.classList.remove('hidden');
}

function hideImageViewer() {
  els.imageViewer.classList.add('hidden');
  els.viewerImage.src = '';
}

// ========== localStorage ==========
function loadFromStorage() {
  try {
    const wrong = localStorage.getItem(STORAGE_KEYS.WRONG_BOOK);
    if (wrong) state.wrongBook = JSON.parse(wrong);
  } catch (e) {
    state.wrongBook = [];
  }

  try {
    const hist = localStorage.getItem(STORAGE_KEYS.HISTORY);
    if (hist) state.history = JSON.parse(hist);
  } catch (e) {
    state.history = [];
  }

  try {
    const settings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (settings) {
      const s = JSON.parse(settings);
      if (s.subject) {
        state.subject = s.subject;
        els.subjectSelect.value = s.subject;
      }
    }
  } catch (e) {
    // 使用默认值
  }
}

function saveWrongBook() {
  try {
    localStorage.setItem(STORAGE_KEYS.WRONG_BOOK, JSON.stringify(state.wrongBook));
  } catch (e) {
    showToast('存储空间不足，请清理错题本', 'error');
  }
}

function saveHistory() {
  try {
    localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(state.history));
  } catch (e) {
    // 历史记录不是关键功能，静默失败
  }
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({ subject: state.subject }));
  } catch (e) {
    // 忽略
  }
}

// ========== Init ==========
function init() {
  loadFromStorage();

  // 上传
  setupUploadZone();

  // 学科切换
  els.subjectSelect.addEventListener('change', function () {
    switchSubject(els.subjectSelect.value);
  });

  // 操作按钮
  els.analyzeBtn.addEventListener('click', startAnalysis);
  els.clearBtn.addEventListener('click', function () {
    if (state.isAnalyzing) {
      showToast('正在解析中，请稍后', 'error');
      return;
    }
    state.images = [];
    streamingCards.clear();
    renderThumbnails();
    updateActionBar();
    renderResults();
    showToast('已清空', 'info');
  });

  // Tab 切换
  els.tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      switchTab(tab.dataset.tab);
    });
  });

  // 错题本筛选
  els.wrongSubjectFilter.addEventListener('change', renderWrongBook);

  // 清空错题本
  els.clearWrongBtn.addEventListener('click', function () {
    if (state.wrongBook.length === 0) return;
    if (confirm('确定清空所有错题？此操作不可撤销。')) {
      state.wrongBook = [];
      saveWrongBook();
      renderWrongBook();
      updateWrongCount();
      renderResults();
      showToast('错题本已清空', 'info');
    }
  });

  // 清空历史
  els.clearHistoryBtn.addEventListener('click', function () {
    if (state.history.length === 0) return;
    if (confirm('确定清空所有历史记录？此操作不可撤销。')) {
      state.history = [];
      saveHistory();
      renderHistory();
      showToast('历史记录已清空', 'info');
    }
  });

  // 图片查看器
  els.closeViewer.addEventListener('click', hideImageViewer);
  els.imageViewer.querySelector('.image-viewer-backdrop').addEventListener('click', hideImageViewer);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !els.imageViewer.classList.contains('hidden')) {
      hideImageViewer();
    }
  });

  // 初始渲染
  updateWrongCount();
  renderHistory();
  renderResults();
  updateActionBar();

  initWidgetTab();
}

// ========== 悬浮工具 Tab ==========
function initWidgetTab() {
  var serverInput = document.getElementById('widget-server');
  var bookmarkletLink = document.getElementById('bookmarklet-link');
  if (!serverInput || !bookmarkletLink) return;

  // 加载已保存的服务器地址
  var savedServer = localStorage.getItem('aqb_api_base') || '';
  if (savedServer) {
    serverInput.value = savedServer;
  } else {
    // 自动检测当前 origin
    serverInput.value = window.location.origin;
  }

  // 更新书签
  function updateBookmarklet() {
    var serverAddr = serverInput.value.trim().replace(/\/+$/, '');
    if (!serverAddr) {
      bookmarkletLink.href = 'javascript:void(0)';
      bookmarkletLink.style.opacity = '0.5';
      bookmarkletLink.style.pointerEvents = 'none';
      return;
    }
    bookmarkletLink.style.opacity = '1';
    bookmarkletLink.style.pointerEvents = '';
    var scriptUrl = serverAddr + '/bookmarklet.js';
    var code = "(function(){window.__aqbApiBase='" + serverAddr + "';var s=document.createElement('script');s.src='" + scriptUrl + "?t='+Date.now();document.head.appendChild(s);})()";
    // void 包裹整个 IIFE（含调用括号），防止页面跳转
    bookmarkletLink.href = 'javascript:void(' + code + ')';
  }

  updateBookmarklet();

  serverInput.addEventListener('input', function () {
    var val = this.value.trim();
    if (val) {
      localStorage.setItem('aqb_api_base', val.replace(/\/+$/, ''));
    }
    updateBookmarklet();
  });

  // 拖拽提示
  bookmarkletLink.addEventListener('dragstart', function (e) {
    e.dataTransfer.setData('text/uri-list', bookmarkletLink.href);
    e.dataTransfer.setData('text/plain', bookmarkletLink.href);
  });
}

init();
