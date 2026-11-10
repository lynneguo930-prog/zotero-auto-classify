/* Zotero 8/9/10 设置面板脚本。
 * Zotero 8 起 preference pane 脚本运行在独立 global scope，
 * 所以：变量显式挂 window，不依赖 XHTML 的 onload，Zotero 对象多级兜底。
 */
window.AutoClassifyPrefs = (function () {
  const P = 'extensions.autoclassify.';
  const FIELDS = {
    llmURL: 'ac-llm-url',
    apiKey: 'ac-api-key',
    model: 'ac-model',
    parentCollection: 'ac-parent',
    categories: 'ac-categories',
  };
  const CHECKS = { useLLM: 'ac-use-llm', autoNew: 'ac-auto-new' };
  let inited = false;

  function Z() {
    try { if (typeof Zotero !== 'undefined' && Zotero) return Zotero; } catch (e) { /* ignore */ }
    try { if (window.Zotero) return window.Zotero; } catch (e) { /* ignore */ }
    try { if (window.parent && window.parent.Zotero) return window.parent.Zotero; } catch (e) { /* ignore */ }
    try { if (window.opener && window.opener.Zotero) return window.opener.Zotero; } catch (e) { /* ignore */ }
    return null;
  }

  function core() {
    const z = Z();
    return z && z.AutoClassify ? z.AutoClassify : null;
  }

  function get(k) {
    const z = Z();
    return z ? z.Prefs.get(P + k, true) : '';
  }

  function set(k, v) {
    const z = Z();
    if (!z) throw new Error('找不到 Zotero 对象');
    z.Prefs.set(P + k, v, true);
  }

  function el(id) { return document.getElementById(id); }

  function status(msg, ok) {
    const node = el('ac-status');
    if (!node) return;
    node.textContent = msg || '';
    node.className = 'ac-status ' + (ok ? 'ac-ok' : 'ac-bad');
  }

  // 与核心模块的校验规则保持一致；核心模块可用时优先复用它。
  function localValidate(text) {
    const rows = String(text || '').split(/\r?\n/)
      .map(s => s.trim()).filter(s => s && !s.startsWith('#'));
    if (!rows.length) return { ok: false, msg: '类别表不能为空' };
    const names = [];
    for (const line of rows) {
      const i = line.indexOf('|');
      if (i < 0) return { ok: false, msg: '这一行缺少竖线 | ：' + line };
      const name = line.slice(0, i).trim();
      const kws = line.slice(i + 1).split(/[,，]/).map(s => s.trim()).filter(Boolean);
      if (!/^[\u4e00-\u9fa5]{2,5}$/.test(name)) {
        return { ok: false, msg: '类别名必须是 2–5 个汉字：' + name };
      }
      if (!kws.length && name !== '其他主题') {
        return { ok: false, msg: '类别「' + name + '」没有关键词' };
      }
      if (names.includes(name)) return { ok: false, msg: '类别名重复：' + name };
      names.push(name);
    }
    return { ok: true, count: names.length };
  }

  function validate(text) {
    const c = core();
    if (c && typeof c.validateCategories === 'function') {
      return c.validateCategories(text);
    }
    return localValidate(text);
  }

  function init() {
    if (inited) return;
    if (!el('ac-save')) return;   // 面板尚未注入，等下一次调度
    inited = true;
    try {
      for (const k of Object.keys(FIELDS)) {
        const node = el(FIELDS[k]);
        if (node) node.value = get(k) == null ? '' : String(get(k));
      }
      for (const k of Object.keys(CHECKS)) {
        const node = el(CHECKS[k]);
        if (node) node.checked = !!get(k);
      }
      // 首次安装时核心模块已把默认类别表写进 pref，这里只做兜底显示
      const cat = el('ac-categories');
      const c = core();
      if (cat && !cat.value && c && c.DEFAULT_CATEGORIES) {
        cat.value = c.DEFAULT_CATEGORIES;
      }
      // html:button 触发 click，XUL 元素触发 command；两者都接，300ms 内去重
      const bind = (id, fn) => {
        const n = el(id);
        if (!n) return;
        let last = 0;
        const run = () => {
          const now = Date.now();
          if (now - last < 300) return;
          last = now;
          try { fn(); }
          catch (e) { status('操作失败：' + (e && e.message ? e.message : e), false); }
        };
        n.addEventListener('click', run);
        n.addEventListener('command', run);
      };
      bind('ac-save', save);
      bind('ac-restore', restore);
      bind('ac-test', testConnection);
    }
    catch (e) {
      status('设置面板初始化失败：' + (e && e.message ? e.message : e), false);
    }
  }

  function save() {
    const text = (el('ac-categories') || {}).value || '';
    const check = validate(text);
    if (!check.ok) { status(check.msg, false); return; }
    try {
      for (const k of Object.keys(FIELDS)) {
        const node = el(FIELDS[k]);
        if (node) set(k, node.value);
      }
      for (const k of Object.keys(CHECKS)) {
        const node = el(CHECKS[k]);
        if (node) set(k, !!node.checked);
      }
      status('已保存，共 ' + check.count + ' 个类别。下次分类立即生效。', true);
    }
    catch (e) {
      status('保存失败：' + (e && e.message ? e.message : e), false);
    }
  }

  function restore() {
    const c = core();
    if (!c || !c.DEFAULT_CATEGORIES) {
      status('读不到默认类别表，请重启 Zotero 后重试。', false); return;
    }
    const cat = el('ac-categories');
    if (cat) cat.value = c.DEFAULT_CATEGORIES;
    status('已填回默认类别表，记得点「保存设置」。', true);
  }

  async function testConnection() {
    const url = (el('ac-llm-url') || {}).value || '';
    const key = (el('ac-api-key') || {}).value || '';
    const model = (el('ac-model') || {}).value || '';
    if (!key) { status('没填 API Key —— 当前会用本地规则，无需测试。', true); return; }
    const c = core();
    if (!c || !c.testConnection) {
      status('核心模块未就绪，请重启 Zotero 后重试。', false); return;
    }
    status('正在连接…', true);
    try {
      const r = await c.testConnection({ url, key, model });
      status(r.message, r.ok);
    }
    catch (e) {
      status('测试失败：' + (e && e.message ? e.message : e), false);
    }
  }

  // 不依赖 onload：延迟两轮调度，兼容面板注入时机差异（init 幂等）
  try { setTimeout(init, 0); setTimeout(init, 400); } catch (e) { /* ignore */ }

  return { init, validateCategories: localValidate };
})();
