/* global Zotero, ZoteroPane */
/* 文献自动分类 · Zotero 8/9/10 通用插件核心
 *
 * 用户需要改的东西都集中在两处：
 *   1) 下面的 DEFAULT_CATEGORIES —— 默认类别表
 *   2) Zotero → 设置 → 自动分类 —— 日常改类别表 / 填 API Key
 *
 * 跨版本做法：一律用「特性检测 + try/catch」，不按版本号硬分支。
 *   - 不用 ZoteroPane.getSelectedCollection() 等单数 getter（10 会抛错）
 *   - 不用 Zotero.Item.isCollection()（10 已移除），只用 isRegularItem()
 *   - 不用 registerChrome()（Firefox 140 ESR 上 skin 条目会抛异常）
 *   - 菜单用 l10nID + FTL 的 .label 属性（8 起 MenuManager 的规范写法）
 *   - 不用 Bluebird / Zotero.spawn() / JSM（8 起已移除），只用标准 Promise
 */
(function () {
  'use strict';

  const PLUGIN_ID = 'auto-classify@workbuddy.local';
  const PREF = 'extensions.autoclassify.';
  const EXTRA_LINE_RE = /^\s*Category\s*:/i;
  const TAG_PREFIX = '类型:';
  const FALLBACK = '其他主题';
  const COLUMN_KEY = 'autoclassify';
  const MAX_LLM_FAILURES = 3;
  const LLM_TIMEOUT_MS = 20000;
  const AUTO_DEBOUNCE_MS = 1800;

  // 每行：类别名|关键词1,关键词2,...   类别名必须 2–5 个汉字
  // 默认 = 用户原有详细类别（植物病理/组学）+ 主要学科 + 学科下细分。
  // 注意：这是 DEFAULT，用户在「设置 → 自动分类」里随时可整表替换（见 samples/ 下的示例）。
  const DEFAULT_CATEGORIES = [
    // —— A. 用户原有详细类别（植物病理 / 组学，保留不动）——
    '转录组|RNA-seq,RNA sequencing,transcriptome,transcriptomic,转录组,转录本,差异表达,DEG,表达谱,单细胞,scRNA',
    '基因组|genome,genomic,全基因组,基因组,assembly,组装,注释,annotation,泛基因组,pangenome',
    '抗病基因|R gene,NLR,NBS-LRR,resistance gene,抗病基因,抗性基因,Tm-2,effector,免疫受体,无毒基因',
    '病毒互作|virus,viral,ToBRFV,TMV,ToMV,病毒,coat protein,movement protein,侵染,复制酶,viroid',
    '真菌病害|Botrytis,灰霉,真菌,fungus,fungal,Phytophthora,疫霉,白粉,枯萎,necrotroph',
    '群体遗传|GWAS,QTL,群体,population,遗传多样性,连锁不平衡,群体结构,选择清扫,germplasm',
    '分子标记|marker,SSR,KASP,分子标记,连锁图谱,图位克隆,finemapping,基因定位,BSA-seq',
    '基因编辑|CRISPR,Cas9,基因编辑,敲除,knockout,转基因,overexpression,过表达,VIGS,突变体',
    '表观调控|epigenetic,甲基化,methylation,组蛋白,histone,染色质,chromatin,小RNA,miRNA,lncRNA',
    '代谢调控|metabolome,代谢,metabolite,次生代谢,生物碱,番茄碱,挥发物,hormone,水杨酸,茉莉酸',
    '生信分析|bioinformatics,生信,算法,pipeline,流程,机器学习,深度学习,数据库,预测模型,软件工具',
    '病原鉴定|pathogen,病原,分离鉴定,检测,diagnostic,PCR,qPCR,ELISA,测序鉴定,病害诊断',
    '育种应用|breeding,育种,品种,栽培,驯化,domestication,种质,产量,品质,田间',
    '功能验证|functional,功能验证,互作,interaction,酵母双杂,BiFC,亚细胞定位,表型,phenotype',
    '综述进展|review,综述,进展,展望,perspective,meta-analysis,荟萃分析',
    // —— B. 主要学科（覆盖大多数科研人员）——
    '医学|medicine,medical,clinical,医学,临床,patient,disease,therapy,药物,diagnosis',
    '化学|chemistry,chemical,化学,synthesis,反应,分子结构',
    '生物化学|biochemistry,biochemical,生物化学,蛋白,代谢,酶',
    '生物学|biology,biological,生物,物种,进化,organism',
    '物理|physics,physical,物理,量子,粒子,能量',
    '材料科学|materials,material,材料,纳米,半导体,复合材料',
    '计算机|computer,computing,算法,软件,编程,数据科学',
    '工程|engineering,工程,机械,电子,结构,系统',
    '环境科学|environment,环境,污染,生态,气候,可持续',
    '地球科学|geoscience,geology,地质,海洋,大气,地震',
    '农业科学|agriculture,agronomy,农业,作物,土壤,植保',
    '数学|mathematics,math,数学,代数,统计,几何',
    '心理学|psychology,psychological,心理,认知,行为,情绪',
    '经济学|economics,economy,经济,市场,金融,贸易',
    '社会科学|social science,sociology,社会,政治,人类,教育',
    // —— C. 主要学科下的细分（在 B 的基础上再细化）——
    '肿瘤学|oncology,tumor,cancer,肿瘤,癌,癌症, carcinoma',
    '免疫学|immunology,immune,免疫,抗体,抗原,炎症',
    '药理学|pharmacology,drug,药理,药物,剂量,临床药学',
    '神经科学|neuroscience,neuron,神经,脑,认知神经',
    '有机化学|organic chemistry,有机,合成,官能团,有机反应',
    '分析化学|analytical chemistry,分析,色谱,质谱,光谱',
    '催化化学|catalysis,catalyst,催化,催化剂,反应动力学',
    '蛋白质|protein,蛋白,多肽,折叠,结构生物',
    '微生物|microbiology,microbe,microorganism,微生物,细菌,病原菌',
    '遗传学|genetics,genetic,遗传,基因,突变,基因组',
    '细胞生物|cell biology,细胞,亚细胞,胞内,细胞器',
    '生态学|ecology,ecological,生态,群落,生物多样性,保护',
    // —— 兜底 ——
    '其他主题|其他,未分类'
  ].join('\n');

  const state = {
    id: PLUGIN_ID,
    rootURI: '',
    columnKey: null,
    notifierID: null,
    busy: false,
    autoQueue: new Map(),
    autoTimer: null,
    collectionCache: new Map(),
  };

  function log(msg) {
    try { Zotero.debug('[AutoClassify] ' + msg); } catch (e) { /* ignore */ }
  }

  // 版本探测只用于日志/告警，功能分支一律走特性检测
  function majorVersion() {
    try {
      return parseInt(String(Zotero.version || '0').split('.')[0], 10) || 0;
    }
    catch (e) { return 0; }
  }

  function compatReport() {
    const has = (obj, fn) => !!(obj && typeof obj[fn] === 'function');
    let version = '?';
    try { version = String(Zotero.version || '?'); } catch (e) { /* ignore */ }
    return {
      version,
      major: majorVersion(),
      menuManager: has(Zotero.MenuManager, 'registerMenu'),
      itemTreeManager: has(Zotero.ItemTreeManager, 'registerColumn'),
      preferencePanes: has(Zotero.PreferencePanes, 'register'),
      notifier: has(Zotero.Notifier, 'registerObserver'),
      collections: has(Zotero.Collections, 'getByLibrary'),
      http: has(Zotero.HTTP, 'request'),
    };
  }

  // ---------------------------------------------------------------- prefs
  function pref(key, fallback) {
    try {
      const v = Zotero.Prefs.get(PREF + key, true);
      return (v === undefined || v === null) ? fallback : v;
    }
    catch (e) { return fallback; }
  }

  function setPref(key, value) {
    try { Zotero.Prefs.set(PREF + key, value, true); }
    catch (e) { log('写偏好失败 ' + key + ': ' + e.message); }
  }

  function cfg() {
    return {
      url: String(pref('llmURL', '')).trim(),
      key: String(pref('apiKey', '')).trim(),
      model: String(pref('model', '')).trim() || 'deepseek-chat',
      useLLM: !!pref('useLLM', true),
      autoNew: !!pref('autoNew', true),
      parent: String(pref('parentCollection', '自动分类')).trim(),
      categoriesText: String(pref('categories', '') || DEFAULT_CATEGORIES),
    };
  }

  // ------------------------------------------------------------ 类别表解析
  function validateCategories(text) {
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
      if (!kws.length && name !== FALLBACK) {
        return { ok: false, msg: '类别「' + name + '」没有关键词' };
      }
      if (names.includes(name)) return { ok: false, msg: '类别名重复：' + name };
      names.push(name);
    }
    return { ok: true, count: names.length };
  }

  function parseCategories(text) {
    const out = [];
    for (const line of String(text || '').split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s.startsWith('#')) continue;
      const i = s.indexOf('|');
      if (i < 0) continue;
      const name = s.slice(0, i).trim();
      if (!/^[\u4e00-\u9fa5]{2,5}$/.test(name)) continue;
      const keywords = s.slice(i + 1).split(/[,，]/)
        .map(k => k.trim().toLowerCase()).filter(Boolean);
      out.push({ name, keywords });
    }
    if (!out.length) log('类别表为空或格式无效，已退回默认表');
    if (!out.some(c => c.name === FALLBACK)) out.push({ name: FALLBACK, keywords: [] });
    return out;
  }

  // -------------------------------------------------------------- 文献信息
  function readMeta(item) {
    const field = (name) => {
      try { return String(item.getField(name) || ''); } catch (e) { return ''; }
    };
    let tags = [];
    try {
      tags = (item.getTags() || []).map(t =>
        (typeof t === 'string' ? t : (t && t.tag) || '')).filter(Boolean);
    }
    catch (e) { /* ignore */ }
    const extra = field('extra').split(/\r?\n/)
      .filter(l => !EXTRA_LINE_RE.test(l)).join(' ');
    return {
      title: field('title'),
      abstract: field('abstractNote'),
      publication: field('publicationTitle'),
      tags,
      extra,
    };
  }

  function readCategory(item) {
    let extra = '';
    try { extra = String(item.getField('extra') || ''); } catch (e) { return ''; }
    const m = extra.match(/^\s*Category\s*:\s*(.+?)\s*$/im);
    if (m) return m[1].trim();
    try {
      for (const t of (item.getTags() || [])) {
        const name = typeof t === 'string' ? t : (t && t.tag) || '';
        if (name && name.startsWith(TAG_PREFIX)) return name.slice(TAG_PREFIX.length).trim();
      }
    }
    catch (e) { /* ignore */ }
    return '';
  }

  function isRegular(item) {
    try {
      return typeof item.isRegularItem === 'function' ? item.isRegularItem() : true;
    }
    catch (e) { return true; }
  }

  // ------------------------------------------------------------ 本地规则引擎
  function ruleClassify(meta, categories) {
    const title = (meta.title || '').toLowerCase();
    const body = [meta.abstract, meta.tags.join(' '), meta.publication, meta.extra]
      .join(' ').toLowerCase();
    let best = null;
    let bestScore = 0;
    for (const cat of categories) {
      if (cat.name === FALLBACK) continue;
      let score = 0;
      for (const kw of cat.keywords) {
        const weight = 1 + Math.min(kw.length, 12) / 4;
        if (title.includes(kw)) score += weight * 3;
        if (body.includes(kw)) score += weight;
      }
      if (score > bestScore) { bestScore = score; best = cat.name; }
    }
    return bestScore > 0 ? best : FALLBACK;
  }

  // -------------------------------------------------------------- 模型引擎
  function normalizeLabel(raw, categories) {
    let s = String(raw || '')
      .replace(/^```[a-z]*\s*/i, '')
      .replace(/```$/, '')
      .split(/\n/)[0]
      .trim()
      .replace(/^["'`《》【】\s]+/, '')
      .replace(/["'`《》【】。.，,：:\s]+$/, '');
    if (!s) return null;
    // 优先命中类别表（取最长的，避免「抗病」盖掉「抗病基因」）
    const hits = categories.filter(c => c.name !== FALLBACK && s.includes(c.name));
    if (hits.length) {
      return hits.sort((a, b) => b.name.length - a.name.length)[0].name;
    }
    const t = s.replace(/^(类别|类型|分类|答案|输出|结果)\s*[:：]?\s*/, '').trim();
    const m = t.match(/^[\u4e00-\u9fa5]{2,5}/);
    return m ? m[0] : null;
  }

  async function llmRequest(conf, messages, maxTokens) {
    const payload = {
      model: conf.model,
      messages,
      temperature: 0,
      max_tokens: maxTokens || 24,
    };
    const xhr = await Zotero.HTTP.request('POST', conf.url, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + conf.key,
      },
      body: JSON.stringify(payload),
      timeout: LLM_TIMEOUT_MS,
    });
    const data = JSON.parse(xhr.responseText);
    if (!data || !data.choices || !data.choices.length) {
      throw new Error('接口返回不是 OpenAI 兼容格式');
    }
    return data.choices[0].message.content;
  }

  async function llmClassify(meta, categories, conf) {
    const list = categories.map(c => c.name).filter(n => n !== FALLBACK).join('、');
    const system = '你是文献分类助手。只输出一个 2 到 5 个汉字的类别名，'
      + '不要解释、不要标点、不要引号。优先从给定类别中选；若都不合适，'
      + '可以自己造一个 2-5 字的中文类别名。';
    const user = '可选类别：' + list + '\n\n'
      + '标题：' + (meta.title || '').slice(0, 500) + '\n'
      + '摘要：' + (meta.abstract || '').slice(0, 1200) + '\n'
      + '关键词：' + meta.tags.join('、') + '\n'
      + '期刊：' + (meta.publication || '') + '\n\n'
      + '只输出一个类别名。';
    const raw = await llmRequest(conf, [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], 24);
    const label = normalizeLabel(raw, categories);
    if (!label) throw new Error('模型输出无法解析为 2–5 字类别：' + String(raw).slice(0, 60));
    return label;
  }

  async function testConnection(overrides) {
    const conf = Object.assign(cfg(), overrides || {});
    if (!conf.url || !conf.key) {
      return { ok: false, message: '接口地址或 API Key 为空（留空时用本地规则，属正常情况）。' };
    }
    try {
      await llmRequest(conf, [
        { role: 'system', content: '只输出 OK' },
        { role: 'user', content: '请输出 OK' },
      ], 8);
      return { ok: true, message: '连接成功：接口地址、Key、模型名都可用。' };
    }
    catch (e) {
      return { ok: false, message: '连接失败：' + (e && e.message ? e.message : String(e)) };
    }
  }

  async function classifyOne(item, categories, conf, runtime) {
    const meta = readMeta(item);
    if (conf.useLLM && conf.key && conf.url && runtime.llmEnabled) {
      try {
        const label = await llmClassify(meta, categories, conf);
        runtime.llmFailures = 0;
        return { label, source: 'model' };
      }
      catch (e) {
        runtime.llmFailures += 1;
        log('模型分类失败（第 ' + runtime.llmFailures + ' 次）：' + e.message);
        if (runtime.llmFailures >= MAX_LLM_FAILURES) {
          runtime.llmEnabled = false;
          log('连续失败 ' + MAX_LLM_FAILURES + ' 次，本次任务后续改用本地规则');
        }
      }
    }
    return { label: ruleClassify(meta, categories), source: 'rule' };
  }

  // ------------------------------------------------------------ 文件夹管理
  // Zotero 10 的 getByLibrary(id) 默认只返回顶层文件夹，必须 recursive=true
  // 才能看到子文件夹；有 parentID 时优先用 getByParent，更精确。
  function collectionsUnder(libraryID, parentID) {
    try {
      const C = Zotero.Collections;
      if (parentID && C && typeof C.getByParent === 'function') {
        return C.getByParent(parentID, false, true) || [];
      }
      if (C && typeof C.getByLibrary === 'function') {
        return C.getByLibrary(libraryID, true, true) || [];
      }
    }
    catch (e) { log('读取文件夹列表失败：' + e.message); }
    return [];
  }

  function findCollection(libraryID, name, parentID) {
    const targetParent = parentID || 0;
    return collectionsUnder(libraryID, parentID).find(c => c && !c.deleted
      && c.name === name && (c.parentID || 0) === targetParent) || null;
  }

  async function ensureCollection(libraryID, name, parentID) {
    const key = [libraryID, parentID || 0, name].join('|');
    if (state.collectionCache.has(key)) return state.collectionCache.get(key);
    const hit = findCollection(libraryID, name, parentID);
    if (hit && hit.id) {
      state.collectionCache.set(key, hit.id);
      return hit.id;
    }
    const col = new Zotero.Collection();
    col.libraryID = libraryID;
    col.name = name;
    if (parentID) col.parentID = parentID;
    await col.saveTx();
    if (!col.id) throw new Error('创建文件夹失败：' + name);
    state.collectionCache.set(key, col.id);
    log('新建分类文件夹：' + name);
    return col.id;
  }

  async function ensureParent(libraryID, parentName) {
    return parentName ? await ensureCollection(libraryID, parentName, null) : null;
  }

  // 本插件管理的文件夹 id：用于「改类别后从旧类别移出」
  function managedCollectionIDs(libraryID, parentID, categories) {
    const names = new Set(categories.map(c => c.name));
    const ids = [];
    for (const c of collectionsUnder(libraryID, parentID)) {
      if (!c || c.deleted || !c.id) continue;
      if (parentID) {
        if ((c.parentID || 0) === parentID) ids.push(c.id);
      }
      else if (!c.parentID && names.has(c.name)) {
        ids.push(c.id);
      }
    }
    return ids;
  }

  // -------------------------------------------------------------- 写回条目
  async function applyCategory(item, label, conf, categories) {
    // 1) Extra：Category: 类别名（自定义列读这里）
    let extra = '';
    try { extra = String(item.getField('extra') || ''); } catch (e) { /* ignore */ }
    const lines = extra.split(/\r?\n/).filter(l => !EXTRA_LINE_RE.test(l));
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    lines.push('Category: ' + label);
    item.setField('extra', lines.join('\n'));

    // 2) 标签：类型:类别名（方便在标签筛选器里过滤）
    let rawTags = [];
    try { rawTags = item.getTags() || []; } catch (e) { /* ignore */ }
    const tags = rawTags
      .map(t => (typeof t === 'string'
        ? { tag: t, type: 0 }
        : { tag: String((t && t.tag) || ''), type: (t && t.type) || 0 }))
      .filter(t => t.tag && !t.tag.startsWith(TAG_PREFIX));
    tags.push({ tag: TAG_PREFIX + label, type: 0 });
    if (typeof item.setTags === 'function') {
      item.setTags(tags);
    }
    else {
      try {
        for (const t of rawTags) {
          const n = typeof t === 'string' ? t : (t && t.tag) || '';
          if (n.startsWith(TAG_PREFIX) && typeof item.removeTag === 'function') item.removeTag(n);
        }
      }
      catch (e) { /* ignore */ }
      if (typeof item.addTag === 'function') item.addTag(TAG_PREFIX + label);
    }

    // 3) 归入同名文件夹；只接管本插件管理的文件夹，不动用户原有归属
    const libID = item.libraryID;
    const parentID = await ensureParent(libID, conf.parent);
    const targetID = await ensureCollection(libID, label, parentID);
    const managed = new Set(managedCollectionIDs(libID, parentID, categories));
    managed.add(targetID);
    let current = null;
    try {
      if (typeof item.getCollections === 'function') current = item.getCollections() || [];
    }
    catch (e) { /* ignore */ }
    if (current && typeof item.setCollections === 'function') {
      const kept = current.filter(id => !managed.has(id));
      kept.push(targetID);
      item.setCollections(kept);
    }
    else if (typeof item.addToCollection === 'function') {
      // 读不到原有归属时只加不删，避免误清空用户手动分类
      item.addToCollection(targetID);
    }

    await item.saveTx();
  }

  async function clearCategory(item, conf, categories) {
    let extra = '';
    try { extra = String(item.getField('extra') || ''); } catch (e) { /* ignore */ }
    item.setField('extra', extra.split(/\r?\n/)
      .filter(l => !EXTRA_LINE_RE.test(l)).join('\n').trim());

    let rawTags = [];
    try { rawTags = item.getTags() || []; } catch (e) { /* ignore */ }
    const tags = rawTags
      .map(t => (typeof t === 'string'
        ? { tag: t, type: 0 }
        : { tag: String((t && t.tag) || ''), type: (t && t.type) || 0 }))
      .filter(t => t.tag && !t.tag.startsWith(TAG_PREFIX));
    if (typeof item.setTags === 'function') item.setTags(tags);

    const libID = item.libraryID;
    const existingParent = conf.parent ? findCollection(libID, conf.parent, null) : null;
    const parentID = existingParent ? existingParent.id : null;
    const managed = new Set(managedCollectionIDs(libID, parentID, categories));
    if (managed.size && typeof item.setCollections === 'function'
        && typeof item.getCollections === 'function') {
      let current = null;
      try { current = item.getCollections() || []; } catch (e) { /* ignore */ }
      if (current) item.setCollections(current.filter(id => !managed.has(id)));
    }
    await item.saveTx();
  }

  // ---------------------------------------------------------------- 主流程
  function pane() {
    try { if (typeof ZoteroPane !== 'undefined' && ZoteroPane) return ZoteroPane; }
    catch (e) { /* ignore */ }
    try {
      if (typeof Zotero.getActiveZoteroPane === 'function') return Zotero.getActiveZoteroPane();
    }
    catch (e) { /* ignore */ }
    try {
      const w = Zotero.getMainWindow && Zotero.getMainWindow();
      if (w && w.ZoteroPane) return w.ZoteroPane;
    }
    catch (e) { /* ignore */ }
    return null;
  }

  function selectedItems() {
    const p = pane();
    try { return (p && p.getSelectedItems && p.getSelectedItems()) || []; }
    catch (e) { log('读取选中条目失败：' + e.message); return []; }
  }

  function itemsInView() {
    const p = pane();
    try {
      if (p && p.itemsView && typeof p.itemsView.getSortedItems === 'function') {
        return p.itemsView.getSortedItems() || [];
      }
    }
    catch (e) { log('读取当前视图失败：' + e.message); }
    return selectedItems();
  }

  function alertUser(msg) {
    try { Zotero.alert(msg); } catch (e) { log(msg); }
  }

  function refreshTree() {
    try {
      if (Zotero.ItemTreeManager && typeof Zotero.ItemTreeManager.refreshColumns === 'function') {
        Zotero.ItemTreeManager.refreshColumns();
      }
    }
    catch (e) { /* ignore */ }
    const p = pane();
    try { if (p && p.itemsView && p.itemsView.refresh) p.itemsView.refresh(); }
    catch (e) { /* ignore */ }
  }

  async function runBatch(items, options) {
    if (state.busy) {
      if (!options.silent) alertUser('正在分类中，请等这一批跑完再操作。');
      return null;
    }
    state.busy = true;
    const conf = cfg();
    const check = validateCategories(conf.categoriesText);
    if (!check.ok) {
      state.busy = false;
      log('类别表无效：' + check.msg + '，已使用默认表');
    }
    const categories = check.ok
      ? parseCategories(conf.categoriesText)
      : parseCategories(DEFAULT_CATEGORIES);
    const runtime = { llmEnabled: true, llmFailures: 0 };
    let done = 0, skipped = 0, failed = 0, byModel = 0;

    try {
      for (const item of items) {
        if (!item || !isRegular(item)) { skipped++; continue; }
        if (options.onlyUnclassified && readCategory(item)) { skipped++; continue; }
        try {
          const result = await classifyOne(item, categories, conf, runtime);
          await applyCategory(item, result.label, conf, categories);
          done++;
          if (result.source === 'model') byModel++;
        }
        catch (e) {
          failed++;
          log('分类失败 item=' + (item.id || '?') + '：' + e.message);
        }
      }
      refreshTree();
    }
    finally {
      state.busy = false;
    }

    const summary = '自动分类完成：成功 ' + done + ' 篇'
      + '（模型 ' + byModel + ' / 规则 ' + (done - byModel) + '）'
      + '，跳过 ' + skipped + ' 篇，失败 ' + failed + ' 篇。';
    log(summary);
    if (!options.silent) alertUser(summary);
    return { done, skipped, failed, byModel };
  }

  async function classifySelection() {
    const items = selectedItems().filter(isRegular);
    if (!items.length) { alertUser('请先在文献列表里选中要分类的条目。'); return; }
    return runBatch(items, { silent: false, onlyUnclassified: false });
  }

  async function classifyView() {
    const items = itemsInView().filter(isRegular);
    if (!items.length) { alertUser('当前视图里没有可分类的文献。'); return; }
    return runBatch(items, { silent: false, onlyUnclassified: false });
  }

  async function clearSelection() {
    const items = selectedItems().filter(isRegular);
    if (!items.length) { alertUser('请先选中要清除分类标记的条目。'); return; }
    const conf = cfg();
    const categories = parseCategories(conf.categoriesText || DEFAULT_CATEGORIES);
    let done = 0;
    for (const item of items) {
      try { await clearCategory(item, conf, categories); done++; }
      catch (e) { log('清除失败 item=' + (item.id || '?') + '：' + e.message); }
    }
    refreshTree();
    alertUser('已清除 ' + done + ' 篇文献的分类标记（原有的手动文件夹不受影响）。');
  }

  // -------------------------------------------------------- 新增文献自动分类
  function scheduleAuto() {
    if (state.autoTimer) clearTimeout(state.autoTimer);
    state.autoTimer = setTimeout(async () => {
      state.autoTimer = null;
      const ids = Array.from(state.autoQueue.keys());
      state.autoQueue.clear();
      const items = [];
      for (const id of ids) {
        let item = null;
        try { item = Zotero.Items.get(id); } catch (e) { /* ignore */ }
        if (item && isRegular(item) && !readCategory(item)) items.push(item);
      }
      if (items.length) await runBatch(items, { silent: true, onlyUnclassified: true });
    }, AUTO_DEBOUNCE_MS);
  }

  function registerNotifier() {
    try {
      state.notifierID = Zotero.Notifier.registerObserver({
        notify(event, type, ids) {
          if (type !== 'item' || event !== 'add') return;
          if (!cfg().autoNew) return;
          for (const id of ids) state.autoQueue.set(id, true);
          scheduleAuto();
        },
      }, ['item'], 'autoclassify');
    }
    catch (e) { log('注册自动分类监听失败：' + e.message); }
  }

  // ---------------------------------------------------------------- 自定义列
  function registerColumn() {
    if (!Zotero.ItemTreeManager
        || typeof Zotero.ItemTreeManager.registerColumn !== 'function') {
      log('当前 Zotero 未提供自定义列接口；类型仍会写入标签和 Extra 字段。');
      return;
    }
    try {
      state.columnKey = Zotero.ItemTreeManager.registerColumn({
        dataKey: COLUMN_KEY,
        label: '类型',
        pluginID: state.id,
        enabledTreeIDs: ['main'],
        showInColumnPicker: true,
        minWidth: 60,
        dataProvider: (item) => {
          try { return readCategory(item); } catch (e) { return ''; }
        },
        zoteroPersist: ['width', 'hidden', 'sortDirection'],
      });
      if (!state.columnKey) log('注册「类型」列被拒绝，请检查 Zotero 日志');
    }
    catch (e) { log('注册「类型」列失败：' + e.message); }
  }

  // -------------------------------------------------------------------- 菜单
  function menuItem(l10nID, text, onCommand) {
    return {
      menuType: 'menuitem',
      l10nID,
      // 8/9/10 的 MenuManager 都只认 l10nID；FTL 未生效时兜底显示中文
      onShowing: (event, context) => {
        const node = context && context.menuElem;
        if (!node || node.getAttribute('label')) return;
        // Zotero 8 起推荐用 label property，同时保留 attribute 兼容旧行为
        try { node.label = text; } catch (e) { /* ignore */ }
        try { node.setAttribute('label', text); } catch (e) { /* ignore */ }
      },
      onCommand,
    };
  }

  function registerMenus() {
    if (!Zotero.MenuManager || typeof Zotero.MenuManager.registerMenu !== 'function') {
      log('当前 Zotero 未提供 MenuManager，可用设置面板的按钮代替。');
      return;
    }
    try {
      Zotero.MenuManager.registerMenu({
        menuID: 'autoclassify-item',
        pluginID: state.id,
        target: 'main/library/item',
        menus: [
          menuItem('auto-classify-menu-selection', '自动分类（选中条目）', classifySelection),
          menuItem('auto-classify-menu-clear', '清除分类标记', clearSelection),
        ],
      });
      Zotero.MenuManager.registerMenu({
        menuID: 'autoclassify-tools',
        pluginID: state.id,
        target: 'main/menubar/tools',
        menus: [
          menuItem('auto-classify-menu-view', '自动分类：当前视图全部', classifyView),
        ],
      });
    }
    catch (e) { log('注册菜单失败：' + e.message); }
  }

  // -------------------------------------------------------------- 生命周期
  async function init(options) {
    state.id = (options && options.id) || PLUGIN_ID;
    state.rootURI = (options && options.rootURI) || '';
    const report = compatReport();
    log('Zotero ' + report.version + ' / API 探测 ' + JSON.stringify(report));
    if (report.major && report.major < 8) {
      log('警告：本插件面向 Zotero 8/9/10，当前版本较旧，部分功能会自动降级');
    }
    if (!pref('categories', '')) setPref('categories', DEFAULT_CATEGORIES);
    registerColumn();
    registerMenus();
    registerNotifier();
    log('已就绪（Zotero 8/9/10）');
  }

  function shutdown() {
    if (state.autoTimer) { clearTimeout(state.autoTimer); state.autoTimer = null; }
    if (state.notifierID) {
      try { Zotero.Notifier.unregisterObserver(state.notifierID); } catch (e) { /* ignore */ }
      state.notifierID = null;
    }
    if (state.columnKey && Zotero.ItemTreeManager
        && typeof Zotero.ItemTreeManager.unregisterColumn === 'function') {
      try { Zotero.ItemTreeManager.unregisterColumn(state.columnKey); } catch (e) { /* ignore */ }
      state.columnKey = null;
    }
    state.autoQueue.clear();
    state.collectionCache.clear();
  }

  Zotero.AutoClassify = {
    init,
    shutdown,
    DEFAULT_CATEGORIES,
    validateCategories,
    parseCategories,
    testConnection,
    classifySelection,
    classifyView,
    clearSelection,
    compatReport,
    majorVersion,
    // 以下仅供自检脚本使用
    _internal: {
      readMeta, readCategory, ruleClassify, normalizeLabel,
      applyCategory, clearCategory, runBatch, cfg, state,
      FALLBACK, TAG_PREFIX,
    },
  };
})();
