#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""用「你自己电脑上 Zotero 的运行时代码」离线验证 xpi 能不能装上。

它不启动 Zotero、不改任何文件，只做三件事：
  1. 从本机 Zotero 安装目录读 app/application.ini，拿到真实版本号
  2. 从 omni.ja 里的 modules/Extension.sys.mjs 提取 Zotero 对插件清单的
     强制校验规则（形如 "applications.zotero.X not provided"）
  3. 读 xpi 里的 manifest.json，按这些规则 + 版本范围逐项核对

用法：python check-install.py
     python check-install.py --zotero-dir "D:/Zotero"
"""
import argparse
import json
import os
import re
import sys
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
XPI = os.path.join(ROOT, "zotero-auto-classify.xpi")

# 找不到本机 Zotero 时使用的兜底规则（来自 Zotero 10.0.8 运行时）
FALLBACK_REQUIRED = ("id", "update_url", "strict_max_version")


def find_zotero(explicit=None):
    guesses = []
    if explicit:
        guesses.append(explicit)
    for var in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"):
        base = os.environ.get(var)
        if base:
            guesses.append(os.path.join(base, "Zotero"))
    guesses += [r"C:\Program Files\Zotero", r"C:\Program Files (x86)\Zotero",
                r"D:\Zotero", "/opt/zotero", "/usr/lib/zotero"]
    for d in guesses:
        if d and os.path.isfile(os.path.join(d, "omni.ja")):
            return d
    return None


def version_parts(s):
    return [int(x) for x in re.findall(r"\d+", str(s))]


def vc_compare(a, b):
    """近似 Services.vc.compare：对纯数字版本号逐段比较。"""
    pa, pb = version_parts(a), version_parts(b)
    for i in range(max(len(pa), len(pb))):
        x, y = (pa[i] if i < len(pa) else 0), (pb[i] if i < len(pb) else 0)
        if x != y:
            return -1 if x < y else 1
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zotero-dir", default=None)
    args = ap.parse_args()

    if not os.path.isfile(XPI):
        print("找不到 xpi，请先运行 python build.py")
        return 1
    with zipfile.ZipFile(XPI) as zf:
        manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
    z = manifest.get("applications", {}).get("zotero", {})
    print("待检包：zotero-auto-classify.xpi（插件版本 %s）" % manifest.get("version"))
    print("  id=%s  min=%s  max=%s" %
          (z.get("id"), z.get("strict_min_version"), z.get("strict_max_version")))

    d = find_zotero(args.zotero_dir)
    app_version = None
    required = list(FALLBACK_REQUIRED)
    if not d:
        print("\n[提示] 没找到本机 Zotero 安装目录，改用内置的 Zotero 10.0.8 规则校验。")
    else:
        print("\n本机 Zotero：%s" % d)
        ini = os.path.join(d, "app", "application.ini")
        if os.path.isfile(ini):
            m = re.search(r"^Version=(.+)$",
                          open(ini, encoding="utf-8", errors="replace").read(),
                          re.M)
            app_version = m.group(1).strip() if m else None
            print("  实际版本：%s" % (app_version or "未知"))
        with zipfile.ZipFile(os.path.join(d, "omni.ja")) as omni:
            try:
                src = omni.read("modules/Extension.sys.mjs").decode("utf-8", "replace")
            except KeyError:
                src = ""
        found = re.findall(r"applications\.zotero\.(\w+) not provided", src)
        if found:
            required = list(dict.fromkeys(found))
        print("  运行时强制要求的清单字段（从 modules/Extension.sys.mjs 提取）：")
        print("    " + ", ".join(required))

    problems = []
    for key in required:
        if not z.get(key):
            problems.append("缺少必填字段 applications.zotero.%s" % key)
        else:
            print("  [OK] %s = %s" % (key, z[key]))

    if app_version:
        lo, hi = z.get("strict_min_version"), z.get("strict_max_version")
        if not lo or not hi:
            problems.append("版本范围不完整")
        else:
            ok_lo = vc_compare(app_version, lo) >= 0
            ok_hi = vc_compare(app_version, hi) <= 0
            print("  版本比较：%s >= %s → %s；%s <= %s → %s" %
                  (app_version, lo, ok_lo, app_version, hi, ok_hi))
            if not (ok_lo and ok_hi):
                problems.append("当前 Zotero 版本不在声明的兼容范围内")

    print("")
    if problems:
        print("校验未通过，Zotero 会拒绝安装：")
        for p in problems:
            print("  x " + p)
        return 1
    print("校验通过：清单满足本机 Zotero 的强制要求，版本也在范围内。")
    print("注意：这是离线规则校验，不等于在界面里点过安装。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
