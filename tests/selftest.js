'use strict';
/* 冒烟自检：用 mock Zotero 在 Node 里跑核心逻辑，不需要真的装 Zotero。
 * 运行：node tests/selftest.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const PREFIX = 'extensions.autoclassify.';

let passed = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) passed++;
  else failures.push(name + (detail ? ' -> ' + detail : ''));
}
function eq(name, actual, expected) {
  ok(name, actual === expected,
    'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

function makeItem(id, fields, tags, collections) {
  return {
    id,
    libraryID: 1,
    _fields: Object.assign({}, fields || {}),
    _tags: (tags || []).slice(),
    _collections: (collections || []).slice(),
    _saved: 0,
    getField(n) { return this._fields[n] || ''; },
    setField(n, v) { this._fields[n] = v; },
    getTags() { return this._tags.slice(); },
    setTags(t) { this._tags = t.slice(); },
    addTag(t) { this._tags.push({ tag: t, type: 0 }); },
    removeTag(t) { this._tags = this._tags.filter(x => (x.tag || x) !== t); },
    getCollections() { return this._collections.slice(); },
    setCollections(c) { this._collections = c.slice(); },
    addToCollection(c) { if (!this._collections.includes(c)) this._collections.push(c); },
    isRegularItem() { return true; },
    async saveTx() { this._saved++; },
  };
}

function createEnv(options) {
  options = options || {};
  const collections = [];
  const alerts = [];
  const logs = [];
  const forbiddenCalls = [];
  const httpCalls = [];
  const registeredColumns = [];
  const registeredMenus = [];
  const globalsSeen = [];
  const itemsById = new Map();
  let notifier = null;
  let unregisteredObserver = null;
  let unregisteredColumn = null;
  let viewRefresh = 0;
  let columnRefresh = 0;
  let nextCollectionID = 100;

  const prefs = Object.assign({
    llmURL: 'https://example.invalid/v1/chat/completions',
    apiKey: '',
    model: 'test-model',
    useLLM: true,
    autoNew: true,
    parentCollection: '自动分类',
    categories: '',
  }, options.prefs || {});

  const Zotero = {
    version: options.version || '10.0.8',
    debug: (m) => logs.push(String(m)),
    alert: (m) => alerts.push(String(m)),
    Prefs: {
      get(k, global) { globalsSeen.push(global); return prefs[k.replace(PREFIX, '')]; },
      set(k, v) { prefs[k.replace(PREFIX, '')] = v; },
    },
    HTTP: {
      async request(method, url, opts) {
        httpCalls.push({ method, url, opts });
        if (options.httpHandler) return options.httpHandler(httpCalls.length);
        return { responseText: JSON.stringify({ choices: [{ message: { content: '转录组' } }] }) };
      },
    },
    Collection: class {
      constructor() { this.libraryID = null; this.name = ''; this.parentID = null; this.id = null; }
      async saveTx() { this.id = nextCollectionID++; collections.push(this); }
    },
    Collections: {
      // 贴近 Zotero 10 真实行为：默认只返回顶层，recursive=true 才含子文件夹
      getByLibrary(libID, recursive) {
        return collections.filter(c => c.libraryID === libID
          && (recursive || !c.parentID));
      },
      getByParent(pid) {
        return collections.filter(c => (c.parentID || 0) === pid);
      },
    },
    Items: { get(id) { return itemsById.get(id) || null; } },
    ItemTreeManager: {
      registerColumn(opt) {
        registeredColumns.push(opt);
        return 'auto-classify@workbuddy.local-autoclassify';
      },
      unregisterColumn(k) { unregisteredColumn = k; },
      refreshColumns() { columnRefresh++; },
    },
    MenuManager: {
      registerMenu(opt) { registeredMenus.push(opt); return opt.menuID; },
    },
    Notifier: {
      registerObserver(observer, types, id) {
        notifier = { observer, types, id };
        return 'notifier-1';
      },
      unregisterObserver(id) { unregisteredObserver = id; },
    },
  };

  const env = {
    Zotero,
    selectedItems: [],
    viewItems: [],
    itemsById,
    collections,
    alerts,
    logs,
    httpCalls,
    forbiddenCalls,
    registeredColumns,
    registeredMenus,
    globalsSeen,
    get notifier() { return notifier; },
    get unregisteredObserver() { return unregisteredObserver; },
    get unregisteredColumn() { return unregisteredColumn; },
    get viewRefresh() { return viewRefresh; },
    get columnRefresh() { return columnRefresh; },
  };

  const ZoteroPane = {
    getSelectedItems: () => env.selectedItems,
    itemsView: {
      getSortedItems: () => env.viewItems,
      refresh: () => { viewRefresh++; },
    },
    // Zotero 10 中这些单数 getter 会抛错；核心代码绝不能调用
    getSelectedCollection: () => {
      forbiddenCalls.push('getSelectedCollection');
      throw new Error('Zotero 10 禁用单数 selection getter');
    },
    getCollectionTreeRow: () => {
      forbiddenCalls.push('getCollectionTreeRow');
      throw new Error('Zotero 10 禁用单数 selection getter');
    },
  };

  const sandbox = {
    Zotero,
    ZoteroPane,
    console,
    setTimeout,
    clearTimeout,
  };
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.join(ROOT, 'content', 'auto-classify.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'auto-classify.js' });
  env.AC = Zotero.AutoClassify;
  return env;
}

async function main() {
  // ---------------------------------------------------------------- 类别表
  const env = createEnv();
  const AC = env.AC;
  ok('核心模块挂载成功', !!AC && typeof AC.init === 'function');

  const v = AC.validateCategories(AC.DEFAULT_CATEGORIES);
  ok('默认类别表合法', v.ok, v.msg);
  eq('默认类别数量', v.count, 43);
  const defCats = AC.parseCategories(AC.DEFAULT_CATEGORIES);
  eq('解析后的类别数量', defCats.length, 43);
  ok('全部类别名为 2-5 汉字', defCats.every(c => /^[\u4e00-\u9fa5]{2,5}$/.test(c.name)),
    JSON.stringify(defCats.filter(c => !/^[\u4e00-\u9fa5]{2,5}$/.test(c.name))));
  ok('包含兜底类别', defCats.some(c => c.name === AC._internal.FALLBACK));

  // 逻辑测试用一套固定类别（与下方测试数据匹配），不依赖公开默认类别（通用 11 类）
  const TEST_CATS = [
    '转录组|RNA-seq,transcriptome,转录组,差异表达',
    '基因组|genome,genomic,基因组',
    '抗病基因|NLR,R gene,resistance,抗病基因',
    '基因编辑|CRISPR,knockout,基因编辑',
    '综述进展|review,综述,进展',
    '分子标记|marker,分子标记',
    '其他主题|其他,未分类',
  ].join('\n');
  const tc = AC.parseCategories(TEST_CATS);

  ok('空表被拒绝', !AC.validateCategories('').ok);
  ok('缺少竖线被拒绝', !AC.validateCategories('转录组 RNA-seq').ok);
  ok('超长类别名被拒绝', !AC.validateCategories('这是一个超长类别|RNA').ok);
  ok('重复类别名被拒绝',
    !AC.validateCategories('转录组|RNA\n转录组|DNA').ok);
  ok('无关键词被拒绝', !AC.validateCategories('转录组|').ok);

  // ------------------------------------------------------------ 本地规则打分
  const meta = (title, abstract) => ({
    title: title || '', abstract: abstract || '', tags: [], publication: '', extra: '',
  });
  const R = AC._internal.ruleClassify;
  eq('RNA-seq 标题 -> 转录组', R(meta('RNA-seq analysis of tomato leaves'), tc), '转录组');
  eq('CRISPR 标题 -> 基因编辑', R(meta('CRISPR-Cas9 knockout in tomato'), tc), '基因编辑');
  eq('review 标题 -> 综述进展', R(meta('A review on research progress'), tc), '综述进展');
  eq('无命中 -> 其他主题', R(meta('A study of something unrelated'), tc), AC._internal.FALLBACK);
  eq('摘要命中也生效', R(meta('Untitled', 'transcriptome profiling of tomato'), tc), '转录组');

  // --------------------------------------------------------- 模型输出清洗
  const N = AC._internal.normalizeLabel;
  eq('直接类别名', N('转录组', tc), '转录组');
  eq('带前缀和句号', N('类别：抗病基因。', tc), '抗病基因');
  eq('带引号', N('"分子标记"', tc), '分子标记');
  eq('允许自创新类别', N('表观新知', tc), '表观新知');
  eq('纯英文输出被拒绝', N('OK', tc), null);
  eq('空输出被拒绝', N('', tc), null);

  // ------------------------------------------------------------------ init
  await AC.init({ id: 'auto-classify@workbuddy.local', rootURI: 'file:///plugin/' });
  eq('注册了 1 个自定义列', env.registeredColumns.length, 1);
  eq('列标题是「类型」', env.registeredColumns[0].label, '类型');
  eq('列 dataKey 正确', env.registeredColumns[0].dataKey, 'autoclassify');
  ok('列有 dataProvider', typeof env.registeredColumns[0].dataProvider === 'function');
  eq('注册了 2 组菜单', env.registeredMenus.length, 2);
  ok('菜单用 l10nID 而非 label',
    env.registeredMenus.every(m => m.menus.every(x => !!x.l10nID && !('label' in x))));
  ok('菜单有 onShowing 兜底',
    env.registeredMenus.every(m => m.menus.every(x => typeof x.onShowing === 'function')));
  ok('Notifier 监听 item', !!env.notifier && env.notifier.types.includes('item'));
  ok('偏好读取都带 global=true', env.globalsSeen.every(x => x === true));

  // -------------------------------------------------------------- 写回端到端
  const conf = AC._internal.cfg();
  const item = makeItem(1, { title: 'RNA-seq of tomato', abstractNote: 'transcriptome' },
    [{ tag: '重要', type: 0 }], [999]);
  await AC._internal.applyCategory(item, '转录组', conf, tc);

  ok('Extra 写入 Category 行', /^Category:\s*转录组$/m.test(item.getField('extra')),
    item.getField('extra'));
  ok('标签写入 类型: 前缀', item.getTags().some(t => (t.tag || t) === '类型:转录组'));
  ok('用户原有标签保留', item.getTags().some(t => (t.tag || t) === '重要'));
  ok('saveTx 被调用', item._saved === 1);
  eq('读取类别（Extra 路径）', AC._internal.readCategory(item), '转录组');
  eq('自定义列能读到类别',
    env.registeredColumns[0].dataProvider(item), '转录组');

  const parent = env.collections.find(c => c.name === '自动分类' && !c.parentID);
  const child = env.collections.find(c => c.name === '转录组' && c.parentID === (parent && parent.id));
  ok('自动建了父文件夹', !!parent);
  ok('自动建了同名子文件夹', !!child);
  ok('文献归入子文件夹', item.getCollections().includes(child.id));
  ok('用户原有文件夹保留', item.getCollections().includes(999));

  // 重分类：应从旧类别移出、仍保留手动文件夹
  await AC._internal.applyCategory(item, '基因组', conf, tc);
  const child2 = env.collections.find(c => c.name === '基因组');
  ok('重分类归入新文件夹', item.getCollections().includes(child2.id));
  ok('重分类从旧类别移出', !item.getCollections().includes(child.id));
  ok('重分类仍保留手动文件夹', item.getCollections().includes(999));
  ok('Extra 只有一行 Category',
    (item.getField('extra').match(/^Category:/gm) || []).length === 1);
  ok('标签只有一个 类型: 前缀',
    item.getTags().filter(t => String(t.tag || t).startsWith('类型:')).length === 1);

  // 回归：模拟重启 Zotero（内存缓存清空）后再次分类，不能重复建同名文件夹
  const beforeRestart = env.collections.length;
  env.AC._internal.state.collectionCache.clear();
  await env.AC._internal.applyCategory(item, '基因组', conf, tc);
  eq('重启后不重复建文件夹', env.collections.length, beforeRestart);
  ok('重启后复用已有文件夹', item.getCollections().includes(child2.id));

  // 回归：读不到原有归属时必须只加不删，不能清空用户手动分类
  const legacyItem = makeItem(50, { title: 'RNA-seq' }, [], [777]);
  legacyItem.getCollections = undefined;
  await env.AC._internal.applyCategory(legacyItem, '转录组', conf, tc);
  ok('读不到原有归属时保留用户文件夹', legacyItem._collections.includes(777));
  ok('读不到原有归属时仍加入目标', legacyItem._collections.includes(child.id));

  // 标签回退读取
  const tagOnly = makeItem(2, {}, [{ tag: '类型:分子标记', type: 0 }], []);
  eq('读取类别（标签回退路径）', AC._internal.readCategory(tagOnly), '分子标记');

  // 清除
  await AC._internal.clearCategory(item, conf, tc);
  ok('清除后 Extra 无 Category', !/Category:/.test(item.getField('extra')));
  ok('清除后无 类型: 标签',
    !item.getTags().some(t => String(t.tag || t).startsWith('类型:')));
  ok('清除后移出自动文件夹', !item.getCollections().includes(child2.id));
  ok('清除后手动文件夹仍在', item.getCollections().includes(999));

  // ------------------------------------------------------------ 模型成功路径
  const okEnv = createEnv({
    prefs: { apiKey: 'fake-key', categories: TEST_CATS },
    httpHandler: () => ({
      responseText: JSON.stringify({ choices: [{ message: { content: '类别：抗病基因' } }] }),
    }),
  });
  await okEnv.AC.init({ id: 'auto-classify@workbuddy.local', rootURI: 'file:///plugin/' });
  const okItem = makeItem(3, { title: 'NLR gene confers resistance' }, [], []);
  const r1 = await okEnv.AC._internal.runBatch([okItem], { silent: true, onlyUnclassified: false });
  eq('模型路径成功 1 篇', r1.done, 1);
  eq('统计为模型分类', r1.byModel, 1);
  eq('模型结果写回', okEnv.AC._internal.readCategory(okItem), '抗病基因');
  ok('静默模式不弹窗', okEnv.alerts.length === 0);
  okEnv.AC.shutdown();

  // -------------------------------------------------------------- 回退 + 熔断
  const failEnv = createEnv({
    prefs: { apiKey: 'fake-key', categories: TEST_CATS },
    httpHandler: () => { throw new Error('network down'); },
  });
  await failEnv.AC.init({ id: 'auto-classify@workbuddy.local', rootURI: 'file:///plugin/' });
  const five = [1, 2, 3, 4, 5].map(i => makeItem(10 + i,
    { title: 'RNA-seq analysis number ' + i }, [], []));
  const r2 = await failEnv.AC._internal.runBatch(five, { silent: true, onlyUnclassified: false });
  eq('回退后 5 篇仍全部分类成功', r2.done, 5);
  eq('模型只尝试 3 次即熔断', failEnv.httpCalls.length, 3);
  eq('全部走本地规则', r2.byModel, 0);
  eq('本地规则给出预期类别', failEnv.AC._internal.readCategory(five[0]), '转录组');
  ok('回退日志有记录', failEnv.logs.some(l => l.includes('模型分类失败')));
  failEnv.AC.shutdown();

  // ------------------------------------------------------------ 无 Key 直接规则
  const offEnv = createEnv({ prefs: { useLLM: false, apiKey: 'fake-key', categories: TEST_CATS } });
  await offEnv.AC.init({ id: 'auto-classify@workbuddy.local', rootURI: 'file:///plugin/' });
  const offItem = makeItem(30, { title: 'CRISPR knockout' }, [], []);
  await offEnv.AC._internal.runBatch([offItem], { silent: true, onlyUnclassified: false });
  eq('关闭模型后不发网络请求', offEnv.httpCalls.length, 0);
  eq('关闭模型后仍正确分类', offEnv.AC._internal.readCategory(offItem), '基因编辑');
  offEnv.AC.shutdown();

  // ------------------------------------------------------------- 自动分类监听
  env.itemsById.set(42, makeItem(42, { title: 'RNA-seq new item' }, [], []));
  env.notifier.observer.notify('modify', 'item', [42], {});
  eq('modify 事件不入队', env.AC._internal.state.autoQueue.size, 0);
  env.notifier.observer.notify('add', 'item', [42], {});
  eq('add 事件入队', env.AC._internal.state.autoQueue.size, 1);

  // --------------------------------------------------------------- shutdown
  env.AC.shutdown();
  ok('shutdown 注销 Notifier', env.unregisteredObserver === 'notifier-1');
  ok('shutdown 注销自定义列', !!env.unregisteredColumn);
  ok('未调用 Zotero 10 禁用的单数 getter', env.forbiddenCalls.length === 0,
    JSON.stringify(env.forbiddenCalls));

  // ------------------------------------------------------------- 静态检查
  const boot = fs.readFileSync(path.join(ROOT, 'bootstrap.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  ok('bootstrap 不调用 registerChrome', !/registerChrome\s*\(/.test(boot));
  const core = fs.readFileSync(path.join(ROOT, 'content', 'auto-classify.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  ok('核心不使用 collectionTreeRow', !/collectionTreeRow/.test(core));
  ok('核心不使用 isCollection()', !/\.isCollection\s*\(/.test(core));

  // ------------------------------------------------------- 8/9/10 版本矩阵
  const VERSION_MATRIX = [
    ['8.0.0', 8], ['8.0.12', 8],
    ['9.0.0', 9], ['9.0.5', 9],
    ['10.0.0', 10], ['10.0.8', 10], ['10.1.0', 10],
  ];
  for (const [ver, major] of VERSION_MATRIX) {
    const vEnv = createEnv({ version: ver });
    const r = vEnv.AC.compatReport();
    eq('compatReport 识别 ' + ver, r.major, major);
    eq('compatReport 版本串 ' + ver, r.version, ver);
    ok('核心 API 在 ' + ver + ' 可用',
      r.itemTreeManager && r.notifier && r.collections && r.http && r.menuManager);
    vEnv.AC.shutdown();
  }
  ok('compatReport 已暴露', typeof AC.compatReport === 'function');
  ok('majorVersion 已暴露', typeof AC.majorVersion === 'function');

  // ------------------------------------------------------- manifest 安装校验
  // 依据（实测，非文档推测）：Zotero 10.0.8 的 omni.ja
  // modules/Extension.sys.mjs L1874-1883，type == "extension" 时
  // 强制要求 id / update_url / strict_max_version，缺一即 manifestError。
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const zInfo = manifest.applications.zotero;
  eq('manifest_version', manifest.manifest_version, 2);
  eq('manifest 最低版本', zInfo.strict_min_version, '8.0');
  eq('manifest 最高版本（具体数字，不用通配符）', zInfo.strict_max_version, '10.999');
  eq('插件 ID', zInfo.id, 'auto-classify@example.com');
  ok('Zotero 10 三个强制字段齐全',
    ['id', 'update_url', 'strict_max_version']
      .every(k => typeof zInfo[k] === 'string' && zInfo[k].length > 0));
  ok('update_url 为 https', /^https:\/\//.test(zInfo.update_url || ''));
  ok('版本字段为纯数字（不含通配符，避免版本比较歧义）',
    /^[0-9.]+$/.test(zInfo.strict_min_version || '')
    && /^[0-9.]+$/.test(zInfo.strict_max_version || ''));
  ok('manifest 文本字段纯 ASCII（排除编码变量）',
    [manifest.name, manifest.description, manifest.author, manifest.homepage_url]
      .every(s => /^[\x00-\x7F]*$/.test(s)));
  ok('提供 check-install.py（用本机 Zotero 运行时规则离线校验）',
    fs.existsSync(path.join(ROOT, 'check-install.py')));

  function inRange(v, min, max) {
    const parse = (s) => String(s).split('.').map(n => parseInt(n, 10) || 0);
    const cmp = (a, b) => {
      for (let i = 0; i < 3; i++) {
        const d = (a[i] || 0) - (b[i] || 0);
        if (d) return d;
      }
      return 0;
    };
    return cmp(parse(v), parse(min)) >= 0 && cmp(parse(v), parse(max)) <= 0;
  }
  for (const v of ['8.0.0', '8.0.12', '9.0.5', '10.0.8', '10.1.0', '10.10.0']) {
    ok('版本 ' + v + ' 在声明范围内', inRange(v, zInfo.strict_min_version, zInfo.strict_max_version));
  }
  ok('Zotero 7 被下限挡住', !inRange('7.0.11', zInfo.strict_min_version, zInfo.strict_max_version));
  ok('Zotero 11 超出上限', !inRange('11.0.0', zInfo.strict_min_version, zInfo.strict_max_version));

  // ------------------------------------------------------------ 安装包
  const xpiPath = path.join(ROOT, 'zotero-auto-classify.xpi');
  ok('xpi 已生成且非空', fs.existsSync(xpiPath) && fs.statSync(xpiPath).size > 1000);
  ok('不再生成注定失败的「无上限兜底包」',
    !fs.existsSync(path.join(ROOT, 'zotero-auto-classify-fallback.xpi')));
  if (fs.existsSync(xpiPath)) {
    const xpiBuf = fs.readFileSync(xpiPath);
    ok('xpi 是合法 zip（PK 头）', xpiBuf[0] === 0x50 && xpiBuf[1] === 0x4B);
  }

  // ---------------------------------------------------- FTL / 面板静态检查
  for (const loc of ['zh-CN', 'en-US']) {
    const ftl = fs.readFileSync(path.join(ROOT, 'locale', loc, 'auto-classify.ftl'), 'utf8');
    ok(loc + ' FTL 使用 .label 属性', (ftl.match(/\.label\s*=/g) || []).length === 3);
  }
  const pane = fs.readFileSync(path.join(ROOT, 'prefs.xhtml'), 'utf8');
  ok('设置面板不依赖 onload（Zotero 8 独立 scope）', !/onload=/.test(pane));
  const paneScript = fs.readFileSync(path.join(ROOT, 'prefs-script.js'), 'utf8');
  ok('设置面板脚本挂到 window', /window\.AutoClassifyPrefs\s*=/.test(paneScript));
  ok('设置面板有 Zotero 多级兜底', /function Z\(\)/.test(paneScript));
  ok('核心不用已废弃的 Bluebird/spawn/JSM',
    !/Zotero\.spawn|Bluebird|\.jsm/.test(core));

  // ------------------------------------------------------------------- 汇总
  console.log('');
  if (failures.length) {
    console.log('FAILED ' + failures.length + ' / ' + (passed + failures.length));
    for (const f of failures) console.log('  x ' + f);
    process.exitCode = 1;
  }
  else {
    console.log('PASS  ' + passed + ' checks');
  }
}

main().catch(e => {
  console.error('自检脚本异常：', e);
  process.exitCode = 1;
});
