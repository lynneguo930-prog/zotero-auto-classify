# Zotero Auto Classify · 文献自动分类插件

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Zotero](https://img.shields.io/badge/Zotero-8%20%7C%209%20%7C%2010-blue)
![Version](https://img.shields.io/badge/version-1.2.0-green)

给每篇文献自动盖一个 **2–5 字的小印章**（如 `转录组`、`抗病基因`），文献列表里多出一列「**类型**」显示印章，再把同印章的文献自动放进**同名文件夹**——这就是"类别相同自动放在一起"。

- 读 **标题 / 摘要 / 关键词 / 期刊** 自动分类
- 可选接入**大模型**（OpenAI 兼容接口，如 DeepSeek），没 Key 也能离线跑
- 自定义「类型」列 + 自动建同名 Collection + 打标签，三处互相印证
- **Zotero 8 / 9 / 10** 一套代码通吃（含 10.0.8）

---

## 快速上手（已验证流程）

1. 安装插件后，打开 **设置 → 自动分类**，填入你的 API（也可不填，走离线规则）
2. 在文献列表**列标题上右键 → 选择列 → 勾「类型」**（只需一次）
3. **全选**所有文献条目（Ctrl/Cmd + A）
4. 右键 → **自动分类（选中条目）**，插件会自己跑完并归类

---

## 功能一览

| 功能 | 说明 |
|---|---|
| 自动分类 | 读标题/摘要/关键词/期刊，给出 2–5 字类别 |
| 「类型」列 | 注册可排序的自定义列，读 Extra 里的 `Category:` 行 |
| 自动归类 | 建 `自动分类 / 类别名` 同名文件夹并移入；重分类时自动移出旧类别 |
| 标签 | 同时写 `类型:类别名` 标签，可用左侧标签筛选器过滤 |
| 双引擎 | 大模型优先，失败/超时回退本地关键词规则，连续失败熔断 |
| 批量 / 自动 | 选中条目右键分类、当前视图全部分类、新导入文献自动分类 |
| 类别可改 | 设置面板里改类别表，保存即生效 |

分类结果同时写在三个地方（坏一个也不丢）：
**「类型」列** ← Extra 的 `Category: 转录组` ｜ **标签** `类型:转录组` ｜ **文件夹** `自动分类 / 转录组`

---

## 兼容性

| Zotero 版本 | 支持情况 |
|---|---|
| 8 / 9 / 10（含 10.0.8） | ✅ 支持 |
| 7 及以下 | ❌ 低于 `strict_min_version = 8.0`，装不上 |
| 11 及以后 | ❌ 超出 `strict_max_version`，需改 manifest 重新打包 |

代码**不按版本号硬分支**，全部走「特性检测 + try/catch」：某个 API 不存在就自动降级（例如没有自定义列接口时，类别仍会写进标签和 Extra；菜单本地化失效时自动补中文 label）。

---

## 安装

从 **[Releases](../../releases)** 下载 `zotero-auto-classify.xpi`，然后：

1. Zotero → 菜单 **工具 → 插件**
2. 右上角齿轮 → **Install Add-on From File…（从文件安装插件）**
3. 选 `zotero-auto-classify.xpi` → 按提示**重启 Zotero**

> 只装这一个包。插件 ID 是 `auto-classify@example.com`；如果列表里有旧版残留，先移除再装。
> `applications.zotero.update_url` 是 Zotero 的**必填字段**（占位地址），本插件不提供自动更新，**不用点「检查更新」**。

---

## 类别表怎么改

设置面板最下面的大文本框，一行一个类别：

```
类别名|关键词1,关键词2,关键词3
```

例如：

```
综述|review,综述,进展,survey
方法|method,protocol,方法,技术,pipeline
```

- **类别名必须是 2–5 个汉字**（保存时会检查）
- 关键词中英文都行，不区分大小写；**标题命中算 3 倍分**，摘要/关键词/期刊命中算 1 倍
- 所有关键词都没命中 → 归到 `其他主题`
- 默认是 **43 类**，分三组（既有你原有的详细领域类别，也覆盖主要学科，且学科下还能再细分）：
  - **A 原有详细（15）**：转录组 / 基因组 / 抗病基因 / 病毒互作 / 真菌病害 / 群体遗传 / 分子标记 / 基因编辑 / 表观调控 / 代谢调控 / 生信分析 / 病原鉴定 / 育种应用 / 功能验证 / 综述进展
  - **B 主要学科（15）**：医学 / 化学 / 生物化学 / 生物学 / 物理 / 材料科学 / 计算机 / 工程 / 环境科学 / 地球科学 / 农业科学 / 数学 / 心理学 / 经济学 / 社会科学
  - **C 学科细分（12）**：肿瘤学 / 免疫学 / 药理学 / 神经科学 / 有机化学 / 分析化学 / 催化化学 / 蛋白质 / 微生物 / 遗传学 / 细胞生物 / 生态学
  - **兜底**：其他主题
- 想换成自己领域的类别？`samples/` 目录里有示例（`plant-pathology-zh.txt` 只含 A 组 16 类、`document-types-zh.txt` 文献类型 11 类），整段复制粘贴即可；也可照格式自己写。只想保留自己领域就删掉 B、C 组，想加细分就往 C 组补行

---

## 模型接口（可选）

不填 API Key 也能用，插件自动退回**本地关键词规则，完全离线**。

想用模型时，在设置里填三项（任何 OpenAI 兼容接口都行）：

| 项 | DeepSeek 示例 |
|---|---|
| 接口地址 | `https://api.deepseek.com/v1/chat/completions` |
| API Key | 你自己的 `sk-…`（插件不内置任何密钥） |
| 模型名 | `deepseek-chat` |

填完点 **测试模型连接** 验证。回退链：

```
有 Key → 试模型 → 失败/超时/解析不了 → 本地规则 → 其他主题
没 Key → 直接本地规则
```

> 模型逐篇串行，几百篇会慢。建议先关模型跑全库，再对少数拿不准的开模型重分类。

---

## 从源码构建

需要 Python 3 与 Node.js：

```bash
python build.py            # 生成 zotero-auto-classify.xpi（构建时强制校验三个必填字段）
python check-install.py    # 用本机 Zotero 运行时规则离线校验 xpi
node tests/selftest.js     # 123 项 mock 自检（分类/写回/回退链/8-10 版本矩阵）
```

---

## 目录结构

```
zotero-auto-classify/
├── zotero-auto-classify.xpi       ← 安装包（Releases 里也有）
├── manifest.json                  插件清单（id / update_url / strict_max_version 三必填齐全）
├── bootstrap.js                   生命周期入口
├── prefs.js / prefs.xhtml / prefs.css / prefs-script.js   设置面板
├── content/auto-classify.js       核心：分类引擎 + 写回 + 归类
├── locale/{zh-CN,en-US}/          菜单文案（FTL .label 属性）
├── tests/selftest.js              mock Zotero 冒烟自检（123 项）
├── build.py                       生成 xpi
├── check-install.py               用本机 Zotero 运行时规则离线校验
├── samples/                       各领域类别表示例（如 plant-pathology-zh.txt）
├── 使用说明.md                    中文详细文档
└── LICENSE
```

---

## 已知限制

- 分类读**元数据**，不读 PDF 全文（扫描版读不出字）
- Zotero 的文献列表**没有"按类别折叠成组"视图**，"放在一起"靠「同名文件夹 + 点列头排序」
- 自检是**静态 + mock 级**验证，没在真实 Zotero 界面点过安装（但 `check-install.py` 按本机 10.0.8 真实规则校验通过）

---

## 许可

[MIT](LICENSE) © 2026 lywen（可在 LICENSE 里改成你的名字）

---

# Zotero Auto Classify (English)

A Zotero plugin that stamps every item with a short **2–5 character category** (e.g. `转录组` / transcriptomics), adds a sortable **Type** column, and groups items into **same-named collections**.

- Classifies from **title / abstract / keywords / journal**
- Optional **LLM** backend (any OpenAI-compatible endpoint, e.g. DeepSeek); works fully offline without a key
- Custom "Type" column + auto-created collections + tags, written in three redundant places
- One codebase for **Zotero 8 / 9 / 10** (incl. 10.0.8)

### Install
Download `zotero-auto-classify.xpi` from [Releases](../../releases), then **Tools → Plugins → gear → Install Add-on From File… → restart Zotero**.

### Usage
1. **Settings → Auto Classify**: fill your API (optional; offline rules work without it)
2. Right-click a column header → **Columns → 类型 (Type)** (one-time)
3. Select items → right-click → **Auto Classify (selected)**
4. Or enable **Auto-classify new items** to classify on import

### Build from source
```bash
python build.py && python check-install.py && node tests/selftest.js
```

### License
[MIT](LICENSE) © 2026 lywen
