#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""打包成 Zotero 可安装的 .xpi（本质是 zip）：只生成一个包。

重要：Zotero 10.0.8 的运行时代码 modules/Extension.sys.mjs (L1874-1883)
对 type == "extension" 的插件强制要求 applications.zotero 下三个字段：

    id / update_url / strict_max_version

缺任意一个都会走 manifestError() -> "Extension is invalid"，
界面统一显示「无法安装插件…它可能无法与该版本的 Zotero 兼容」。
所以不要删 update_url，也不要做「不写 strict_max_version」的兜底包。

用法：python build.py
"""
import json
import os
import re
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "zotero-auto-classify.xpi")
OBSOLETE = os.path.join(ROOT, "zotero-auto-classify-fallback.xpi")

# 只有这些文件进 xpi；tests/、说明文档、构建脚本都排除
INCLUDE = [
    "manifest.json",
    "bootstrap.js",
    "prefs.js",
    "prefs.xhtml",
    "prefs.css",
    "prefs-script.js",
    "content/auto-classify.js",
    "locale/zh-CN/auto-classify.ftl",
    "locale/en-US/auto-classify.ftl",
]

# 依据上面那段 Zotero 源码，缺一不可
REQUIRED = ("id", "update_url", "strict_max_version")


def validate(manifest):
    z = manifest.get("applications", {}).get("zotero", {})
    assert manifest.get("manifest_version") == 2, "manifest_version 应为 2"
    for key in REQUIRED:
        assert z.get(key), "缺少必填字段 applications.zotero.%s（Zotero 会拒绝安装）" % key
    assert re.fullmatch(r"[0-9]+(\.[0-9]+)*", z["strict_min_version"]), \
        "strict_min_version 不能含通配符"
    assert re.fullmatch(r"[0-9]+(\.[0-9]+)*", z["strict_max_version"]), \
        "strict_max_version 请用具体版本号（纯数字），避免通配符比较歧义"
    assert z["update_url"].startswith("https://"), "update_url 必须是 https URL"
    return z


def main():
    missing = [p for p in INCLUDE if not os.path.isfile(os.path.join(ROOT, p))]
    if missing:
        raise SystemExit("缺少文件：" + ", ".join(missing))

    with open(os.path.join(ROOT, "manifest.json"), encoding="utf-8") as f:
        manifest = json.load(f)
    z = validate(manifest)

    payload = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel in INCLUDE:
            arc = rel.replace("\\", "/")
            if rel == "manifest.json":
                zf.writestr(arc, payload)
            else:
                zf.write(os.path.join(ROOT, rel), arc)

    # 旧版「无上限兜底包」在 Zotero 10 上必然安装失败，删掉以免误装
    if os.path.isfile(OBSOLETE):
        os.remove(OBSOLETE)
        print("已移除旧兜底包：" + os.path.basename(OBSOLETE))

    with zipfile.ZipFile(OUT) as zf:
        assert zf.testzip() is None, "xpi 损坏"
        assert "manifest.json" in zf.namelist()
        assert json.loads(zf.read("manifest.json").decode("utf-8"))["applications"]["zotero"] == z

    print("已生成：zotero-auto-classify.xpi")
    print("  %d 个文件，%.1f KB，插件版本 %s" %
          (len(INCLUDE), os.path.getsize(OUT) / 1024, manifest["version"]))
    print("  兼容范围：%s ~ %s" % (z["strict_min_version"], z["strict_max_version"]))
    print("  必填字段：%s 全部齐全" % ", ".join(REQUIRED))
    print("下一步：python check-install.py 用本机 Zotero 运行时规则离线校验这个包。")


if __name__ == "__main__":
    main()
