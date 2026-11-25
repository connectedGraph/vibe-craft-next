/**
 * 同步状态浮层：给没有内置同步面板的工具用。
 * 右下角小圆点，点开显示账号、状态、手动同步、退出。
 */
(function (global) {
  'use strict';

  let dot, label, panel, statusText, userText, syncBtn, logoutBtn, adminLink;
  let currentStatus = { phase: 'off' };

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function build() {
    if (document.getElementById('vibesync-widget')) return;

    const wrap = document.createElement('div');
    wrap.id = 'vibesync-widget';
    wrap.innerHTML = `
      <style>
        #vibesync-widget { position: fixed; right: 16px; bottom: 16px; z-index: 80;
          font-family: 'Inter','Segoe UI',system-ui,'PingFang SC','Microsoft YaHei',sans-serif; }
        #vs-dot-btn { display: flex; align-items: center; gap: 8px; padding: 8px 12px;
          background: rgba(255,255,255,.86); border: 1px solid rgba(15,23,42,.1); border-radius: 999px;
          box-shadow: 0 10px 26px -14px rgba(15,23,42,.4); cursor: pointer; color: #334155;
          font-size: 12px; font-weight: 600; backdrop-filter: blur(10px); }
        #vs-dot-btn:hover { border-color: #c7d2fe; color: #4338ca; }
        #vs-dot { width: 8px; height: 8px; border-radius: 999px; background: #94a3b8; }
        #vs-dot.idle { background: #34d399; }
        #vs-dot.syncing { background: #818cf8; animation: vs-pulse 1s infinite; }
        #vs-dot.error { background: #f87171; }
        #vs-dot.login-required { background: #fbbf24; }
        @keyframes vs-pulse { 50% { opacity: .35; } }
        #vs-panel { display: none; position: absolute; right: 0; bottom: 46px; width: 260px;
          background: rgba(255,255,255,.96); border: 1px solid rgba(15,23,42,.1); border-radius: 14px;
          box-shadow: 0 22px 50px -24px rgba(15,23,42,.45); padding: 14px; backdrop-filter: blur(14px); }
        #vs-panel.on { display: block; }
        #vs-panel h4 { margin: 0 0 8px; font-size: 12px; color: #0f172a; }
        #vs-panel .muted { font-size: 11px; color: #64748b; line-height: 1.5; }
        #vs-panel .row { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
        #vs-panel button, #vs-panel a { flex: 1; min-width: 70px; text-align: center; padding: 7px 8px;
          border-radius: 8px; border: 1px solid rgba(15,23,42,.1); background: #fff; color: #334155;
          font-size: 11px; font-weight: 600; cursor: pointer; text-decoration: none; }
        #vs-panel button:hover, #vs-panel a:hover { border-color: #c7d2fe; color: #4338ca; }
        #vs-panel #vs-user { font-size: 12px; color: #0f172a; font-weight: 700; }
      </style>
      <button id="vs-dot-btn" type="button"><span id="vs-dot"></span><span id="vs-label">Sync</span></button>
      <div id="vs-panel">
        <h4>Cloud Sync</h4>
        <div id="vs-user" class="muted">未登录</div>
        <div id="vs-status" class="muted" style="margin-top:4px"></div>
        <div class="row">
          <button id="vs-now" type="button">Sync Now</button>
          <a id="vs-admin" href="/admin.html" style="display:none">管理</a>
          <button id="vs-logout" type="button">退出</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    dot = document.getElementById('vs-dot');
    label = document.getElementById('vs-label');
    panel = document.getElementById('vs-panel');
    statusText = document.getElementById('vs-status');
    userText = document.getElementById('vs-user');
    syncBtn = document.getElementById('vs-now');
    logoutBtn = document.getElementById('vs-logout');
    adminLink = document.getElementById('vs-admin');

    document.getElementById('vs-dot-btn').onclick = (e) => {
      e.stopPropagation();
      panel.classList.toggle('on');
      if (panel.classList.contains('on')) refreshPanel();
    };
    panel.onclick = (e) => e.stopPropagation();
    document.addEventListener('click', () => panel.classList.remove('on'));

    syncBtn.onclick = async () => {
      syncBtn.disabled = true;
      syncBtn.textContent = '同步中…';
      await global.VibeSync.syncNow();
      syncBtn.disabled = false;
      syncBtn.textContent = 'Sync Now';
      refreshPanel();
    };
    logoutBtn.onclick = () => global.VibeSync.logout();
  }

  function render(status) {
    currentStatus = status || { phase: 'off' };
    if (!dot) return;
    dot.className = currentStatus.phase || 'off';
    const texts = {
      off: 'Sync',
      idle: 'Synced',
      syncing: 'Syncing…',
      'login-required': 'Sign in',
      error: 'Sync Error',
    };
    label.textContent = texts[currentStatus.phase] || 'Sync';
    if (panel && panel.classList.contains('on')) refreshPanel();
  }

  function refreshPanel() {
    const acc = global.VibeSync.getAccount();
    const user = acc.user;
    userText.textContent = user ? `${user.username}${user.role === 'admin' ? ' · 管理员' : ''}` : (acc.mode === 'off' ? '匿名模式' : '未登录');
    adminLink.style.display = user && user.role === 'admin' ? '' : 'none';
    logoutBtn.style.display = user ? '' : 'none';
    syncBtn.style.display = user || acc.mode === 'off' ? '' : 'none';
    const s = currentStatus;
    if (s.phase === 'error') {
      statusText.textContent = '同步失败：' + (s.lastError || 'unknown');
    } else if (s.phase === 'login-required') {
      statusText.textContent = '需要登录后才能同步。';
    } else if (s.lastSyncAt) {
      statusText.textContent = '上次同步 ' + new Date(s.lastSyncAt).toLocaleTimeString();
    } else {
      statusText.textContent = '本地数据仍然可用，云端只做备份与多设备同步。';
    }
  }

  global.SyncWidget = {
    /** 用法：SyncWidget.mount({ app, collections, makeConflict, onApplied }) */
    mount(config) {
      if (!global.VibeSync) { console.warn('[SyncWidget] VibeSync not loaded'); return; }
      build();
      global.VibeSync.attach({
        ...config,
        onStatus: (s) => {
          render(s);
          if (typeof config.onStatus === 'function') config.onStatus(s);
        },
      });
      render(global.VibeSync.getStatus());
    },
  };
})(window);
