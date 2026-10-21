#!/usr/bin/env python3
"""把 CI 的失败原因变成**匿名可读**的注解 + step summary。

★ 为什么需要这个脚本（26 册 §87）：
  1. Actions 的**原始日志**只对仓库 owner 开放（匿名 `GET /actions/runs/{id}/logs` 是 403）。
  2. **step summary** 无条数限制，但 run 页面是 JS 渲染的 ⇒ 用 `curl` 抓 HTML 拿不到正文。
  3. **注解（annotation）** 是唯一"公开只读 + 能用 HTTP 直接取到正文"的通道：
     `GET /repos/{o}/{r}/commits/{sha}/check-runs` → `annotations_url`。
  4. 但注解**每步有条数上限**（10 条），所以这里必须**先挑最值钱的**，不能把日志倒进去。

★ 值钱的顺序（也正是失败的排查顺序）：
  ① 测试断言失败：哪个用例、断言消息是什么（JUnit XML 的 `<failure message>`）—— 这是根因
  ② Kotlin 编译错：`e: file:line:col` 开头那些行 —— 这是"代码根本没编过"
  ③ Gradle `* What went wrong:` —— 配置阶段失败（没有 ①② 时唯一的线索）
  ④ 滤掉框架栈之后的尾部 —— 兜底

★ 本脚本**永远 exit 0**。它是诊断步骤，它自己再红一次就等于"失败时什么都看不到"——
  上一版就是这么翻车的：`grep` 没匹配返回 1，GitHub 默认 shell 是 `bash -eo pipefail`，
  于是诊断步骤在写任何内容之前就退出了（run 39618705876 的 step 6）。

用法：python3 .github/ci-diagnose.py <log1> [log2 ...]
日志可以是任意个；缺失的会被跳过并在 summary 里注明。
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
# ★ 可用 CI_DIAGNOSE_ANDROID 覆盖：拿一份**假的** JUnit XML 跑一遍，
#   证明"它真的会红、也真的会绿"（判据自己的自证，否则它可能只是个永绿的摆设）。
ANDROID = Path(os.environ.get("CI_DIAGNOSE_ANDROID") or (REPO_ROOT / "newmud" / "android"))
MAX_ANNOTATIONS = 9          # 留一条给"完整内容见 summary"
ANNOTATION_CHARS = 1800      # 单条注解别太长，否则页面折叠后反而看不清


def esc(text: str) -> str:
    """GitHub 注解要求的百分号转义（只转这三样，其余原样）"""
    return text.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def clip(text: str, n: int = ANNOTATION_CHARS) -> str:
    text = text.strip()
    return text if len(text) <= n else text[:n] + " …（截断）"


def unescape_xml(s: str) -> str:
    return (
        s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"')
        .replace("&apos;", "'").replace("&#10;", "\n").replace("&amp;", "&")
    )


FRAMEWORK_STACK = re.compile(
    r"^\s+at (org\.gradle|java\.|jdk\.|sun\.|kotlin\.|com\.sun|worker\.org|org\.junit)"
)


def attr(attrs: str, key: str) -> str:
    """从一段属性文本里取 `key="..."`，取不到就空串（属性顺序不保证，必须按名字找）"""
    m = re.search(rf'{key}="([^"]*)"', attrs)
    return unescape_xml(m.group(1)) if m else ""


def parse_test_results() -> list[str]:
    """从 JUnit XML 里抽失败用例。★ 一个失败的 `testcase` 就是一条结论，比日志尾 40 行值钱得多。"""
    out: list[str] = []
    for xml in sorted(ANDROID.glob("*/build/test-results/test/TEST-*.xml")):
        try:
            text = xml.read_text(encoding="utf-8", errors="replace")
        except OSError as e:
            out.append(f"[{xml.name}] 读不出来：{e}")
            continue
        module = xml.parents[3].name  # <module>/build/test-results/test/TEST-x.xml
        # ★ 必须区分**自闭合**的 `<testcase ... />`（通过的用例就是这种）。
        #   第一版写成 `<testcase([^>]*)>(.*?)</testcase>`：自闭合标签后面的 `/>` 里有 `>`，
        #   于是 attrs 吃到 `/`，body 一路吞到**下一个** `</testcase>` —— 失败信息被记到
        #   前一个通过的用例名下。这种"整体匹配成功但错位"的假绿比全文匹配失败更阴。
        for m in re.finditer(r"<testcase\b([^>]*?)(?:/>|>(.*?)</testcase>)", text, re.S):
            attrs, body = m.group(1), m.group(2) or ""
            if "<failure" not in body and "<error" not in body:
                continue
            name = attr(attrs, "name") or "?"
            cls = attr(attrs, "classname")
            fm = re.search(r"<(?:failure|error)\b([^>]*)>", body)
            msg = attr(fm.group(1), "message") if fm else ""
            stack = [
                ln.strip()
                for ln in unescape_xml(body).splitlines()
                if ln.strip().startswith("at ") and not FRAMEWORK_STACK.match(ln)
            ][:3]
            head = f"{module} :: {cls}#{name}"
            if msg:
                head += f"\n{msg}"
            if stack:
                head += "\n" + "\n".join(stack)
            out.append(head)
    return out


def parse_log(path: Path) -> dict[str, list[str]]:
    """从 gradle 输出里抽三类东西"""
    res = {"compile": [], "wrong": [], "tail": []}
    if not path.exists():
        return res
    text = path.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()

    res["compile"] = [ln for ln in lines if re.match(r"^e: ", ln)][:8]

    # `* What went wrong:` 之后到下一个空行/下一个 `* ` 段之前
    for i, ln in enumerate(lines):
        if "What went wrong:" in ln:
            block = []
            for j in range(i + 1, min(i + 12, len(lines))):
                if lines[j].startswith("* ") or lines[j].strip() == "Try:":
                    break
                if lines[j].strip():
                    block.append(lines[j].rstrip())
            res["wrong"] = block[:8]
            break

    # 尾部：滤掉框架栈（否则最后 40 行全是 DefaultBuildWorkGraph 之类）
    res["tail"] = [ln for ln in lines if ln.strip() and not FRAMEWORK_STACK.match(ln)][-18:]
    # ★ 兜底分支只对**真的失败了**的日志生效。不然一份 `BUILD SUCCESSFUL` 的日志
    #   也会被当成"没解析出原因的失败"贴上去 —— 判据必须能区分"没找到原因"和"没失败"。
    res["failed"] = "BUILD SUCCESSFUL" not in text and (
        "FAILURE:" in text or "BUILD FAILED" in text or " FAILED" in text
    )
    return res


def main(argv: list[str]) -> int:
    logs = [Path(a) for a in argv[1:]]
    failures = parse_test_results()
    per_log = {p.name: parse_log(p) for p in logs}

    # ── 组装注解（按值钱程度排序，加起来不超过上限）──────────────────────
    annotations: list[str] = []
    for f in failures:
        annotations.append("测试失败：" + f)
    for name, r in per_log.items():
        for ln in r["compile"]:
            annotations.append(f"编译错（{name}）：{ln}")
    for name, r in per_log.items():
        if r["wrong"]:
            annotations.append(f"Gradle 配置/构建失败（{name}）：" + "\n".join(r["wrong"]))
    if not annotations:
        for name, r in per_log.items():
            if r["failed"] and r["tail"]:
                annotations.append(f"日志尾部（{name}，已滤框架栈）：" + "\n".join(r["tail"][-10:]))
                break

    shown = annotations[:MAX_ANNOTATIONS]
    for a in shown:
        print(f"::error::{esc(clip(a))}")
    if len(annotations) > len(shown):
        print(f"::warning::还有 {len(annotations) - len(shown)} 条失败信息没做注解，见本页 summary")

    # ── summary：全量（无条数限制，人看这页）────────────────────────────
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        parts = ["### 失败诊断", ""]
        parts.append(f"- 失败用例：{len(failures)} 条")
        for p in logs:
            parts.append(f"- 日志 `{p.name}`：{'有' if p.exists() else '**不存在**（红在 gradle 启动之前）'}")
        parts.append("")
        if failures:
            parts += ["**测试失败用例**", "```", *failures, "```", ""]
        for name, r in per_log.items():
            if r["compile"]:
                parts += [f"**Kotlin 编译错（{name}）**", "```", *r["compile"], "```", ""]
            if r["wrong"]:
                parts += [f"**What went wrong（{name}）**", "```", *r["wrong"], "```", ""]
            if r["tail"]:
                parts += [f"**日志尾部（{name}，已滤框架栈）**", "```", *r["tail"], "```", ""]
        if not any([failures] + [r["compile"] or r["wrong"] for r in per_log.values()]):
            parts += ["没有解析出结构化的失败原因 —— 看下面的 artifact `build-log-*`。", ""]
        try:
            with open(summary_path, "a", encoding="utf-8") as fh:
                fh.write("\n".join(parts) + "\n")
        except OSError as e:
            print(f"::warning::summary 写不进去：{e}")

    # ★ 永远成功：诊断步骤自己红 = 失败时什么都看不到（run 39618705876 的教训）
    print(f"diagnose: {len(annotations)} 条候选，发出 {len(shown)} 条注解")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
