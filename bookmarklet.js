/**
 * AI 题库助手 - 悬浮面板 Bookmarklet
 *
 * 工作原理：
 * 1. 用户将书签拖到浏览器书签栏
 * 2. 在任意答题网页点击书签，注入本脚本
 * 3. 脚本创建悬浮面板，支持截图/粘贴/扫描三种方式捕捉题目
 * 4. 通过后端 /api/analyze 或 /api/analyze-text 接口调用 LLM 分析
 * 5. 结果在面板中展示，用户自行查看
 *
 * 产品边界：工具只负责呈现答案和解析，不自动提交、不自动点击
 */
(function () {
  'use strict';

  // ========== 防重复注入 ==========
  if (window.__aqbPanelInjected) {
    var existing = document.getElementById('aqb-panel');
    if (existing) {
      existing.style.display = existing.style.display === 'none' ? 'flex' : 'none';
    }
    return;
  }
  window.__aqbPanelInjected = true;

  // ========== 配置 ==========
  var API_BASE = window.__aqbApiBase || localStorage.getItem('aqb_api_base') || '';
  var currentSubject = localStorage.getItem('aqb_subject') || 'accounting';
  var isAnalyzing = false;

  var SUBJECTS = {
    tax: '税法',
    accounting: '会计',
    audit: '审计',
    finance: '财管',
    strategy: '战略',
    economic_law: '经济法'
  };

  // 如果没有配置 API 地址，提示用户输入
  if (!API_BASE) {
    API_BASE = prompt('首次使用请输入后端服务地址\n（例如：https://your-backend.com）');
    if (!API_BASE) {
      alert('未配置后端地址，悬浮工具无法工作。请回到主页面「悬浮工具」标签中安装书签。');
      return;
    }
    API_BASE = API_BASE.replace(/\/$/, '');
    localStorage.setItem('aqb_api_base', API_BASE);
  }

  // ========== 注入样式 ==========
  var styleEl = document.createElement('style');
  styleEl.textContent = [
    '#aqb-panel {',
    '  all: initial;',
    '  position: fixed; top: 20px; right: 20px; z-index: 2147483647;',
    '  width: 380px; max-width: calc(100vw - 40px); max-height: calc(100vh - 40px);',
    '  display: flex; flex-direction: column;',
    '  background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px;',
    '  font-family: -apple-system, "Segoe UI", "Noto Sans SC", sans-serif;',
    '  font-size: 14px; color: #1e293b; line-height: 1.6;',
    '  box-shadow: 0 8px 32px rgba(0,0,0,0.16);',
    '  overflow: hidden;',
    '}',
    '#aqb-panel * { all: revert; box-sizing: border-box; margin: 0; padding: 0; }',
    '#aqb-panel * { font-family: -apple-system, "Segoe UI", "Noto Sans SC", sans-serif; }',
    '#aqb-panel .aqb-header {',
    '  display: flex; align-items: center; justify-content: space-between;',
    '  padding: 10px 14px; background: #2563eb; color: #fff; cursor: move;',
    '  user-select: none; -webkit-user-select: none;',
    '}',
    '#aqb-panel .aqb-title { font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 6px; }',
    '#aqb-panel .aqb-controls { display: flex; gap: 4px; }',
    '#aqb-panel .aqb-ctrl-btn {',
    '  width: 24px; height: 24px; border: none; border-radius: 4px;',
    '  background: rgba(255,255,255,0.2); color: #fff; cursor: pointer;',
    '  display: flex; align-items: center; justify-content: center; font-size: 12px;',
    '  transition: background 0.15s;',
    '}',
    '#aqb-panel .aqb-ctrl-btn:hover { background: rgba(255,255,255,0.35); }',
    '#aqb-panel .aqb-body { display: flex; flex-direction: column; flex: 1; overflow: hidden; }',
    '#aqb-panel .aqb-toolbar {',
    '  display: flex; align-items: center; gap: 8px; padding: 10px 12px;',
    '  border-bottom: 1px solid #f1f5f9; flex-wrap: wrap;',
    '}',
    '#aqb-panel .aqb-subject-select {',
    '  padding: 5px 8px; border: 1px solid #e2e8f0; border-radius: 5px;',
    '  font-size: 13px; color: #1e293b; background: #fff; cursor: pointer;',
    '}',
    '#aqb-panel .aqb-actions { display: flex; gap: 6px; flex: 1; }',
    '#aqb-panel .aqb-action-btn {',
    '  flex: 1; padding: 6px 8px; border: 1px solid #e2e8f0; border-radius: 5px;',
    '  background: #fff; color: #1e293b; font-size: 12px; cursor: pointer;',
    '  display: flex; align-items: center; justify-content: center; gap: 4px;',
    '  transition: all 0.15s; white-space: nowrap;',
    '}',
    '#aqb-panel .aqb-action-btn:hover { background: #f8fafc; border-color: #cbd5e1; }',
    '#aqb-panel .aqb-action-btn:active { transform: scale(0.97); }',
    '#aqb-panel .aqb-action-btn svg { width: 14px; height: 14px; flex-shrink: 0; }',
    '#aqb-panel .aqb-action-btn.primary { background: #2563eb; color: #fff; border-color: #2563eb; }',
    '#aqb-panel .aqb-action-btn.primary:hover { background: #1d4ed8; }',
    '#aqb-panel .aqb-action-btn:disabled { opacity: 0.5; cursor: not-allowed; }',
    '#aqb-panel .aqb-status { padding: 8px 12px; font-size: 12px; color: #64748b; display: none; }',
    '#aqb-panel .aqb-status.active { display: flex; align-items: center; gap: 6px; }',
    '#aqb-panel .aqb-spinner {',
    '  width: 14px; height: 14px; border: 2px solid #e2e8f0; border-top-color: #2563eb;',
    '  border-radius: 50%; animation: aqb-spin 0.7s linear infinite;',
    '}',
    '@keyframes aqb-spin { to { transform: rotate(360deg); } }',
    '#aqb-panel .aqb-results {',
    '  flex: 1; overflow-y: auto; padding: 10px 12px; max-height: 60vh;',
    '}',
    '#aqb-panel .aqb-results::-webkit-scrollbar { width: 6px; }',
    '#aqb-panel .aqb-results::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }',
    '#aqb-panel .aqb-empty { color: #94a3b8; font-size: 13px; text-align: center; padding: 24px 0; }',
    '#aqb-panel .aqb-q-card {',
    '  border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; margin-bottom: 10px;',
    '  background: #fff; transition: border-color 0.15s;',
    '}',
    '#aqb-panel .aqb-q-card:hover { border-color: #cbd5e1; }',
    '#aqb-panel .aqb-q-head { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }',
    '#aqb-panel .aqb-q-num {',
    '  font-size: 12px; font-weight: 600; color: #fff; background: #2563eb;',
    '  padding: 2px 8px; border-radius: 4px;',
    '}',
    '#aqb-panel .aqb-q-type {',
    '  font-size: 11px; padding: 2px 6px; border-radius: 3px; font-weight: 500;',
    '}',
    '#aqb-panel .aqb-q-type.t-single { background: #dbeafe; color: #2563eb; }',
    '#aqb-panel .aqb-q-type.t-multi { background: #ede9fe; color: #7c3aed; }',
    '#aqb-panel .aqb-q-type.t-judge { background: #dcfce7; color: #16a34a; }',
    '#aqb-panel .aqb-q-type.t-short { background: #ffedd5; color: #ea580c; }',
    '#aqb-panel .aqb-q-type.t-comprehensive { background: #fee2e2; color: #dc2626; }',
    '#aqb-panel .aqb-q-type.t-calc { background: #cffafe; color: #0891b2; }',
    '#aqb-panel .aqb-q-type.t-default { background: #f1f5f9; color: #64748b; }',
    '#aqb-panel .aqb-q-stem { font-size: 13px; color: #1e293b; margin-bottom: 8px; line-height: 1.5; }',
    '#aqb-panel .aqb-q-opts { font-size: 12px; color: #475569; margin-bottom: 8px; }',
    '#aqb-panel .aqb-q-opt { padding: 2px 0; }',
    '#aqb-panel .aqb-q-opt.correct { color: #16a34a; font-weight: 500; }',
    '#aqb-panel .aqb-q-answer {',
    '  display: inline-flex; align-items: center; gap: 4px; font-size: 13px; font-weight: 600;',
    '  color: #16a34a; margin-bottom: 6px;',
    '}',
    '#aqb-panel .aqb-q-analysis {',
    '  font-size: 12px; color: #475569; line-height: 1.6; margin-bottom: 6px;',
    '  padding: 8px; background: #f8fafc; border-radius: 5px;',
    '}',
    '#aqb-panel .aqb-q-analysis summary { cursor: pointer; font-weight: 500; color: #2563eb; }',
    '#aqb-panel .aqb-q-analysis p { margin-top: 6px; white-space: pre-wrap; }',
    '#aqb-panel .aqb-q-kp { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }',
    '#aqb-panel .aqb-q-kp-tag {',
    '  font-size: 11px; padding: 1px 6px; background: #f1f5f9; color: #64748b;',
    '  border-radius: 3px;',
    '}',
    '#aqb-panel .aqb-q-mistake { font-size: 12px; color: #ea580c; margin-top: 4px; }',
    '#aqb-panel .aqb-capture-overlay {',
    '  position: fixed; inset: 0; z-index: 2147483646; cursor: crosshair;',
    '  background: rgba(0,0,0,0.3); display: none;',
    '}',
    '#aqb-panel .aqb-capture-overlay.active { display: block; }',
    '#aqb-panel .aqb-settings {',
    '  padding: 10px 12px; border-top: 1px solid #f1f5f9; display: none;',
    '}',
    '#aqb-panel .aqb-settings.active { display: block; }',
    '#aqb-panel .aqb-setting-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }',
    '#aqb-panel .aqb-setting-label { font-size: 12px; color: #64748b; min-width: 60px; }',
    '#aqb-panel .aqb-setting-input {',
    '  flex: 1; padding: 4px 8px; border: 1px solid #e2e8f0; border-radius: 4px;',
    '  font-size: 12px; color: #1e293b;',
    '}',
    '#aqb-panel .aqb-setting-save {',
    '  padding: 4px 12px; background: #2563eb; color: #fff; border: none;',
    '  border-radius: 4px; font-size: 12px; cursor: pointer;',
    '}'
  ].join('\n');
  document.head.appendChild(styleEl);

  // ========== SVG 图标 ==========
  var ICONS = {
    book: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
    scan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>'
  };

  // ========== 创建面板 DOM ==========
  var panel = document.createElement('div');
  panel.id = 'aqb-panel';
  panel.innerHTML = [
    '<div class="aqb-header">',
    '  <span class="aqb-title">' + ICONS.book + ' AI 题库助手</span>',
    '  <div class="aqb-controls">',
    '    <button class="aqb-ctrl-btn" id="aqbBtnSettings" title="设置">' + ICONS.settings + '</button>',
    '    <button class="aqb-ctrl-btn" id="aqbBtnMin" title="最小化">—</button>',
    '    <button class="aqb-ctrl-btn" id="aqbBtnClose" title="关闭">✕</button>',
    '  </div>',
    '</div>',
    '<div class="aqb-body">',
    '  <div class="aqb-toolbar">',
    '    <select class="aqb-subject-select" id="aqbSubject">',
    Object.keys(SUBJECTS).map(function (k) {
      return '<option value="' + k + '"' + (k === currentSubject ? ' selected' : '') + '>' + SUBJECTS[k] + '</option>';
    }).join(''),
    '    </select>',
    '    <div class="aqb-actions">',
    '      <button class="aqb-action-btn primary" id="aqbBtnCapture">' + ICONS.camera + ' 截图</button>',
    '      <button class="aqb-action-btn" id="aqbBtnScan">' + ICONS.scan + ' 扫描</button>',
    '    </div>',
    '  </div>',
    '  <div class="aqb-status" id="aqbStatus">',
    '    <div class="aqb-spinner"></div>',
    '    <span id="aqbStatusText">正在分析...</span>',
    '  </div>',
    '  <div class="aqb-results" id="aqbResults">',
    '    <div class="aqb-empty">点击「截图」或「扫描」开始分析题目</div>',
    '  </div>',
    '  <div class="aqb-settings" id="aqbSettings">',
    '    <div class="aqb-setting-row">',
    '      <span class="aqb-setting-label">后端地址</span>',
    '      <input type="text" class="aqb-setting-input" id="aqbApiInput" value="' + API_BASE + '" placeholder="https://your-backend.com" />',
    '      <button class="aqb-setting-save" id="aqbSaveSettings">保存</button>',
    '    </div>',
    '  </div>',
    '</div>'
  ].join('');
  document.body.appendChild(panel);

  // 截图选区覆盖层
  var overlay = document.createElement('div');
  overlay.className = 'aqb-capture-overlay';
  overlay.id = 'aqbCaptureOverlay';
  document.body.appendChild(overlay);

  // ========== DOM 引用 ==========
  var elPanel = document.getElementById('aqb-panel');
  var elSubject = document.getElementById('aqbSubject');
  var elBtnCapture = document.getElementById('aqbBtnCapture');
  var elBtnScan = document.getElementById('aqbBtnScan');
  var elBtnSettings = document.getElementById('aqbBtnSettings');
  var elBtnMin = document.getElementById('aqbBtnMin');
  var elBtnClose = document.getElementById('aqbBtnClose');
  var elStatus = document.getElementById('aqbStatus');
  var elStatusText = document.getElementById('aqbStatusText');
  var elResults = document.getElementById('aqbResults');
  var elSettings = document.getElementById('aqbSettings');
  var elApiInput = document.getElementById('aqbApiInput');
  var elSaveSettings = document.getElementById('aqbSaveSettings');
  var elOverlay = document.getElementById('aqbCaptureOverlay');

  // ========== 拖拽功能 ==========
  var dragData = null;
  var header = panel.querySelector('.aqb-header');

  header.addEventListener('mousedown', function (e) {
    if (e.target.closest('.aqb-ctrl-btn')) return;
    dragData = {
      startX: e.clientX,
      startY: e.clientY,
      origLeft: elPanel.offsetLeft,
      origTop: elPanel.offsetTop
    };
    elPanel.style.right = 'auto';
    elPanel.style.left = dragData.origLeft + 'px';
    elPanel.style.top = dragData.origTop + 'px';
    e.preventDefault();
  });

  document.addEventListener('mousemove', function (e) {
    if (!dragData) return;
    var dx = e.clientX - dragData.startX;
    var dy = e.clientY - dragData.startY;
    var newLeft = Math.max(0, Math.min(window.innerWidth - elPanel.offsetWidth, dragData.origLeft + dx));
    var newTop = Math.max(0, Math.min(window.innerHeight - 40, dragData.origTop + dy));
    elPanel.style.left = newLeft + 'px';
    elPanel.style.top = newTop + 'px';
  });

  document.addEventListener('mouseup', function () { dragData = null; });

  // 触屏拖拽
  header.addEventListener('touchstart', function (e) {
    if (e.target.closest('.aqb-ctrl-btn')) return;
    var t = e.touches[0];
    dragData = {
      startX: t.clientX, startY: t.clientY,
      origLeft: elPanel.offsetLeft, origTop: elPanel.offsetTop
    };
    elPanel.style.right = 'auto';
    elPanel.style.left = dragData.origLeft + 'px';
    elPanel.style.top = dragData.origTop + 'px';
  }, { passive: true });

  document.addEventListener('touchmove', function (e) {
    if (!dragData) return;
    var t = e.touches[0];
    var dx = t.clientX - dragData.startX;
    var dy = t.clientY - dragData.startY;
    var newLeft = Math.max(0, Math.min(window.innerWidth - elPanel.offsetWidth, dragData.origLeft + dx));
    var newTop = Math.max(0, Math.min(window.innerHeight - 40, dragData.origTop + dy));
    elPanel.style.left = newLeft + 'px';
    elPanel.style.top = newTop + 'px';
  }, { passive: true });

  document.addEventListener('touchend', function () { dragData = null; });

  // ========== 控制按钮 ==========
  elBtnMin.addEventListener('click', function () {
    var body = elPanel.querySelector('.aqb-body');
    if (body.style.display === 'none') {
      body.style.display = 'flex';
      elBtnMin.textContent = '—';
    } else {
      body.style.display = 'none';
      elBtnMin.textContent = '+';
    }
  });

  elBtnClose.addEventListener('click', function () {
    elPanel.style.display = 'none';
  });

  elBtnSettings.addEventListener('click', function () {
    elSettings.classList.toggle('active');
  });

  elSaveSettings.addEventListener('click', function () {
    var val = elApiInput.value.trim().replace(/\/$/, '');
    if (val) {
      API_BASE = val;
      localStorage.setItem('aqb_api_base', val);
      elSettings.classList.remove('active');
      showStatus(false);
      elResults.innerHTML = '<div class="aqb-empty">后端地址已更新，点击「截图」或「扫描」开始</div>';
    }
  });

  elSubject.addEventListener('change', function () {
    currentSubject = elSubject.value;
    localStorage.setItem('aqb_subject', currentSubject);
  });

  // ========== 状态控制 ==========
  function showStatus(active, text) {
    if (active) {
      elStatus.classList.add('active');
      elStatusText.textContent = text || '正在分析...';
    } else {
      elStatus.classList.remove('active');
    }
  }

  function setButtonsDisabled(disabled) {
    elBtnCapture.disabled = disabled;
    elBtnScan.disabled = disabled;
  }

  // ========== 截图功能（Screen Capture API） ==========
  elBtnCapture.addEventListener('click', async function () {
    if (isAnalyzing) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      alert('当前浏览器不支持屏幕截图功能，请使用「扫描」或手动截图后粘贴。');
      return;
    }

    try {
      var stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' },
        audio: false
      });

      var video = document.createElement('video');
      video.srcObject = stream;
      video.style.position = 'fixed';
      video.style.top = '-9999px';
      document.body.appendChild(video);

      await new Promise(function (resolve) {
        video.onloadedmetadata = function () { video.play(); resolve(); };
      });

      // 等一帧确保画面渲染
      await new Promise(function (r) { setTimeout(r, 200); });

      var canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);

      // 停止屏幕共享
      stream.getTracks().forEach(function (t) { t.stop(); });
      document.body.removeChild(video);

      var dataUrl = canvas.toDataURL('image/png');
      analyzeImage(dataUrl);

    } catch (err) {
      if (err.name !== 'NotAllowedError') {
        console.error('[AQ Bookmarklet] Capture error:', err);
      }
    }
  });

  // ========== 粘贴功能 ==========
  document.addEventListener('paste', function (e) {
    if (elPanel.style.display === 'none') return;
    if (isAnalyzing) return;

    var items = e.clipboardData && e.clipboardData.items;
    if (!items) return;

    for (var i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        var blob = items[i].getAsFile();
        var reader = new FileReader();
        reader.onload = function (ev) {
          analyzeImage(ev.target.result);
        };
        reader.readAsDataURL(blob);
        e.preventDefault();
        return;
      }
    }
  });

  // ========== 自动扫描功能（提取页面文本） ==========
  elBtnScan.addEventListener('click', function () {
    if (isAnalyzing) return;
    analyzePageText();
  });

  function extractPageText() {
    // 尝试找到主要内容区域
    var selectors = [
      'main', '[role="main"]', '#content', '.content',
      '.question', '.exam', '.paper', '.question-content',
      '.ql-editor', '[contenteditable]',
      'article', '.main-content'
    ];

    var mainEl = null;
    for (var i = 0; i < selectors.length; i++) {
      mainEl = document.querySelector(selectors[i]);
      if (mainEl && mainEl.innerText.trim().length > 50) break;
      mainEl = null;
    }

    var text = mainEl ? mainEl.innerText : document.body.innerText;
    // 清理多余空白
    text = text.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
    // 限制长度避免 token 超限
    if (text.length > 12000) {
      text = text.substring(0, 12000) + '\n...(文本过长，已截断)';
    }
    return text;
  }

  function analyzePageText() {
    var text = extractPageText();
    if (!text || text.length < 20) {
      elResults.innerHTML = '<div class="aqb-empty">未在页面上检测到足够的文本内容</div>';
      return;
    }

    isAnalyzing = true;
    setButtonsDisabled(true);
    showStatus(true, '正在扫描分析...');
    elResults.innerHTML = '<div class="aqb-empty">正在提取页面题目并分析...</div>';

    var body = JSON.stringify({
      text: text,
      subject: currentSubject,
      index: 0
    });

    fetch(API_BASE + '/api/analyze-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return readSSEStream(res, 0);
      })
      .catch(function (err) {
        isAnalyzing = false;
        setButtonsDisabled(false);
        showStatus(false);
        elResults.innerHTML = '<div class="aqb-empty" style="color:#dc2626">分析失败：' + escapeHtml(err.message) + '</div>';
      });
  }

  // ========== 图片分析 ==========
  function analyzeImage(dataUrl) {
    isAnalyzing = true;
    setButtonsDisabled(true);
    showStatus(true, '正在分析截图...');
    elResults.innerHTML = '<div class="aqb-empty">AI 正在识别题目...</div>';

    var body = JSON.stringify({
      image: dataUrl,
      subject: currentSubject,
      index: 0
    });

    fetch(API_BASE + '/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return readSSEStream(res, 0);
      })
      .catch(function (err) {
        isAnalyzing = false;
        setButtonsDisabled(false);
        showStatus(false);
        elResults.innerHTML = '<div class="aqb-empty" style="color:#dc2626">分析失败：' + escapeHtml(err.message) + '</div>';
      });
  }

  // ========== SSE 流式读取 ==========
  function readSSEStream(response, index) {
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var fullContent = '';

    function processLine(line) {
      if (line.indexOf('data: ') !== 0) return;
      var dataStr = line.slice(6).trim();
      if (!dataStr || dataStr === '[DONE]') return;

      try {
        var data = JSON.parse(dataStr);

        if (data.type === 'start') {
          showStatus(true, '正在分析（' + (data.subject || '') + '）...');
        } else if (data.type === 'chunk') {
          fullContent += data.content;
          // 流式预览
          elResults.innerHTML = '<div style="font-size:12px;color:#64748b;white-space:pre-wrap;padding:8px;background:#f8fafc;border-radius:5px;max-height:200px;overflow-y:auto;">' + escapeHtml(fullContent).substring(0, 2000) + '...</div>';
        } else if (data.type === 'complete') {
          isAnalyzing = false;
          setButtonsDisabled(false);
          showStatus(false);
          renderResults(data.raw || fullContent, index);
        } else if (data.type === 'error') {
          isAnalyzing = false;
          setButtonsDisabled(false);
          showStatus(false);
          elResults.innerHTML = '<div class="aqb-empty" style="color:#dc2626">' + escapeHtml(data.message || '分析失败') + '</div>';
        }
      } catch (e) {
        // skip invalid JSON
      }
    }

    function pump() {
      return reader.read().then(function (result) {
        if (result.done) {
          // 处理剩余 buffer
          if (buffer.trim()) {
            buffer.split('\n').forEach(processLine);
          }
          if (isAnalyzing) {
            // 流结束但没收到 complete 事件，尝试用已有的内容渲染
            isAnalyzing = false;
            setButtonsDisabled(false);
            showStatus(false);
            if (fullContent) {
              renderResults(fullContent, index);
            } else {
              elResults.innerHTML = '<div class="aqb-empty">分析完成但未收到有效结果</div>';
            }
          }
          return;
        }

        buffer += decoder.decode(result.value, { stream: true });
        var lines = buffer.split('\n');
        buffer = lines.pop() || '';
        lines.forEach(processLine);
        return pump();
      });
    }

    return pump();
  }

  // ========== 结果渲染 ==========
  function renderResults(rawText, index) {
    var parsed = null;
    try {
      // 清理可能的 markdown 代码块标记
      var cleaned = rawText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      elResults.innerHTML = '<div class="aqb-empty" style="color:#dc2626">解析结果格式异常，请重试</div>';
      return;
    }

    if (!parsed.questions || parsed.questions.length === 0) {
      var msg = parsed.error || '未识别到题目';
      elResults.innerHTML = '<div class="aqb-empty">' + escapeHtml(msg) + '</div>';
      return;
    }

    // 按题号排序
    var questions = parsed.questions.slice().sort(function (a, b) {
      var na = parseInt(a.questionNumber, 10) || 0;
      var nb = parseInt(b.questionNumber, 10) || 0;
      return na - nb;
    });

    var html = '';
    questions.forEach(function (q, i) {
      html += renderQuestionCard(q, i);
    });

    elResults.innerHTML = html;

    // 绑定折叠
    elResults.querySelectorAll('details').forEach(function (d) {
      // 默认展开第一个
      if (d.dataset.idx === '0') d.open = true;
    });
  }

  function renderQuestionCard(q, idx) {
    var typeClass = getTypeClass(q.questionType);
    var typeLabel = q.questionType || '未知题型';

    var html = '<div class="aqb-q-card">';
    html += '<div class="aqb-q-head">';
    html += '<span class="aqb-q-num">第 ' + escapeHtml(q.questionNumber || (idx + 1)) + ' 题</span>';
    html += '<span class="aqb-q-type ' + typeClass + '">' + escapeHtml(typeLabel) + '</span>';
    html += '</div>';

    // 题干
    if (q.questionStem) {
      html += '<div class="aqb-q-stem">' + escapeHtml(q.questionStem) + '</div>';
    }

    // 选项
    if (q.options && typeof q.options === 'object') {
      html += '<div class="aqb-q-opts">';
      var correctAnswer = (q.answer || '').toUpperCase().trim();
      Object.keys(q.options).forEach(function (key) {
        var isCorrect = correctAnswer.indexOf(key.toUpperCase()) !== -1;
        html += '<div class="aqb-q-opt' + (isCorrect ? ' correct' : '') + '">';
        html += escapeHtml(key) + '. ' + escapeHtml(q.options[key]);
        if (isCorrect) html += ' ' + ICONS.check;
        html += '</div>';
      });
      html += '</div>';
    }

    // 答案
    if (q.answer) {
      html += '<div class="aqb-q-answer">' + ICONS.check + ' 答案：' + escapeHtml(q.answer) + '</div>';
    }

    // 解析（可折叠）
    if (q.analysis) {
      html += '<details class="aqb-q-analysis" data-idx="' + idx + '">';
      html += '<summary>查看解析</summary>';
      html += '<p>' + escapeHtml(q.analysis) + '</p>';
      html += '</details>';
    }

    // 知识点
    if (q.knowledgePoints && q.knowledgePoints.length > 0) {
      html += '<div class="aqb-q-kp">';
      q.knowledgePoints.forEach(function (kp) {
        html += '<span class="aqb-q-kp-tag">' + escapeHtml(kp) + '</span>';
      });
      html += '</div>';
    }

    // 易错点
    if (q.commonMistakes) {
      html += '<div class="aqb-q-mistake">易错点：' + escapeHtml(q.commonMistakes) + '</div>';
    }

    html += '</div>';
    return html;
  }

  function getTypeClass(type) {
    if (!type) return 't-default';
    var t = type.toLowerCase();
    if (t.indexOf('单选') !== -1) return 't-single';
    if (t.indexOf('多选') !== -1) return 't-multi';
    if (t.indexOf('判断') !== -1) return 't-judge';
    if (t.indexOf('简答') !== -1) return 't-short';
    if (t.indexOf('综合') !== -1) return 't-comprehensive';
    if (t.indexOf('计算') !== -1) return 't-calc';
    return 't-default';
  }

  function escapeHtml(text) {
    if (text == null) return '';
    var div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  // ========== 初始化提示 ==========
  console.log('[AI 题库助手] 悬浮面板已加载，API: ' + API_BASE);

})();
