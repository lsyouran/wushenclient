/**
 * 安卓布局判据（§94）—— **本机可跑、且已自证会红**的静态检查。
 *
 * 为什么要有这个文件：§93 的判据表全绿（连 CI 编译都过）而真机是塌的。
 * 那次塌的根因在 Compose 的**测量语义**，`grep` 天生看不见 —— 所以这里不假装
 * 能验"布局对不对"，只盯三件**能被文本证明、且塌过一次**的事：
 *
 *   J1  `MudAction` 里 `Text` / `Button` 的 `fillMaxWidth` 必须挂在 `fillWidth` 上。
 *       无条件挂 ⇒ 按钮反向撑满整行、同排 `weight(1f)` 兄弟被压成 0（房名、输入框消失）。
 *   J2  出口那颗必须 `dense`（上一版 56×44，用户原话"出口那么大一个框"）。
 *   J3  `AuthScreen` 的通栏必须走 `fillWidth = true`（传 `Modifier.fillMaxWidth()` 只会"通栏 + 靠左字"）。
 *
 *   J4  `MapSheet` 代码零引用（地图改成就地展开，§94.4）。
 *   J5  `MudSizes.DragBar*` 零定义（拖拽条是不可拖的假控件，已删）。
 *   J6  `ui/` 下无裸 `数字.dp`（除 `Theme.kt` / `MapView.kt`）。
 *
 * ★ 退出码：0 = 全绿，1 = 有红。**加新判据时先造一个必然违规的样本看它红**，
 *   造不出来的判据不要往这里加（§71.8.2：假红 = 训练人忽略报警）。
 *
 * 用法：node newmud/tools/check-android-layout.mjs [ui目录]
 *   默认目录按 `import.meta.url` 上溯派生（不硬编码 `newmud`，不读 `process.cwd()`）。
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// ★ 退出码必须走 EXIT_PASS / EXIT_FAIL，**不许写裸数字**：G6.R6.7 会把
//   `process.exit(1)` 判红（四态 0/1/2/3 只在 lib.mjs 定义一次）。
import { EXIT_FAIL, EXIT_PASS } from "./gate/lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// tools/ → newmud/
const root = resolve(here, "..");
const uiDir = process.argv[2] ? resolve(process.argv[2]) : join(root, "android/app/src/main/kotlin/mud/app/ui");

const read = (name) => readFileSync(join(uiDir, name), "utf8");

/** 目录下所有 .kt —— 判据按**目录**扫，不按手抄的文件名单（手抄名单只在有人新增时才红） */
const ktFiles = () => readdirSync(uiDir).filter((f) => f.endsWith(".kt"));

/** 去掉块注释 / 行注释，只留代码 —— 判据的观察对象不许包含自己的说明书 */
function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

const results = [];
const check = (id, desc, fn) => {
  let ok = false;
  let detail = "";
  try {
    const r = fn();
    ok = r.ok;
    detail = r.detail;
  } catch (e) {
    ok = false;
    detail = `读取失败：${e.message}`;
  }
  results.push({ id, desc, ok, detail });
};

// ── J1：MudAction 的两处 fillMaxWidth 必须在 fillWidth 分支里 ──────────────
check("J1", "MudAction 的 fillMaxWidth 只挂在 fillWidth 上", () => {
  const code = codeOnly(read("Widgets.kt"));
  const start = code.indexOf("fun MudAction(");
  if (start < 0) return { ok: false, detail: "找不到 fun MudAction(" };
  // 函数体到下一个顶层 @Composable 之前（MudAction 之后是 MudTab）
  const end = code.indexOf("fun MudTab(", start);
  const body = code.slice(start, end > 0 ? end : undefined);
  const guarded = body.match(/if \(fillWidth\) Modifier\.fillMaxWidth\(\) else Modifier/g) ?? [];
  const buttonGuarded = /\.then\(if \(fillWidth\) Modifier\.fillMaxWidth\(\) else Modifier\)/.test(body);
  // ★★ 所有 `fillMaxWidth()` 必须**恰好**等于带守卫的那两处。
  //   早一版这里有个 `bare` 变量算了却没进 `ok`（死判据）⇒ 在 Button 链上再补一条
  //   `.fillMaxWidth()` 时，`guarded` 仍为 2、`buttonGuarded` 仍 true，闸门**全绿**。
  //   QA 复现过这条假绿（§94.5）。
  //   ★ 计数必须按 `fillMaxWidth()`（**不带 `Modifier.` 前缀**）：变异样本用的是
  //     扩展写法 `.fillMaxWidth()`，只数 `Modifier.fillMaxWidth()` 会漏掉它
  //     —— 这正是第二次复现时抓不到的原因。
  const total = (body.match(/fillMaxWidth\(\)/g) ?? []).length;
  const ok = guarded.length === 2 && buttonGuarded && total === guarded.length;
  return {
    ok,
    detail: `带守卫 ${guarded.length} 处（期望 2）、Button 链守卫=${buttonGuarded}、该函数内 fillMaxWidth() 总数=${total}（必须等于守卫数）`,
  };
});

// ── J2：出口那颗必须 dense ────────────────────────────────────────────────
check("J2", "出口方向按钮带 dense = true", () => {
  const code = codeOnly(read("GameScreen.kt"));
  const line = code.split(/\r?\n/).find((l) => l.includes("row.label"));
  if (!line) return { ok: false, detail: "找不到出口按钮那一行" };
  const ok = /dense\s*=\s*true/.test(line);
  return { ok, detail: `该行：${line.trim()}${ok ? "" : "（缺 dense）"}` };
});

// ── J3：**全部** MudAction 调用点都不许自己传 Modifier.fillMaxWidth ────────
//
// ★★ 早一版只查 `AuthScreen.kt` 一处 ⇒ 其余 12 个调用点照原样写
//   `MudAction(..., modifier = Modifier.fillMaxWidth())` 时闸门**全绿**，
//   而那正是 2026-10-22 真机塌掉的同一写法（只是换个调用点）。
//   QA 复现过（§94.5）⇒ 改成扫 `ui/*.kt` 的每一个 `MudAction(` 实参块。
//   ★ 这需要按括号配平切出实参块，不能全文正则：全文匹配会把
//     `MudField(modifier = Modifier.fillMaxWidth())`（合法且必要）算成违规（假红）。
check("J3", "所有 MudAction 调用点都不自己传 Modifier.fillMaxWidth；通栏只出现在 AuthScreen", () => {
  const files = ktFiles();
  const offenders = [];
  const fillWidthFiles = new Set();
  let callSites = 0;
  for (const f of files) {
    const code = codeOnly(read(f));
    for (let i = code.indexOf("MudAction("); i >= 0; i = code.indexOf("MudAction(", i + 1)) {
      // 跳过定义处（`fun MudAction(`）
      if (/\bfun\s+$/.test(code.slice(Math.max(0, i - 8), i))) continue;
      let depth = 0;
      let end = -1;
      for (let j = i + "MudAction".length; j < code.length; j += 1) {
        const ch = code[j];
        if (ch === "(") depth += 1;
        else if (ch === ")") {
          depth -= 1;
          if (depth === 0) {
            end = j;
            break;
          }
        }
      }
      if (end < 0) continue;
      const block = code.slice(i, end + 1);
      callSites += 1;
      if (/fillMaxWidth\(\)/.test(block)) offenders.push(f);
      if (/fillWidth\s*=\s*true/.test(block)) fillWidthFiles.add(f);
    }
  }
  const fillOk = fillWidthFiles.size === 1 && fillWidthFiles.has("AuthScreen.kt");
  const ok = callSites > 0 && offenders.length === 0 && fillOk;
  return {
    ok,
    detail: `调用点 ${callSites} 处、自己传 fillMaxWidth 的 ${offenders.length} 处${offenders.length ? `（${[...new Set(offenders)].join(", ")}）` : ""}、fillWidth=true 出现在 ${[...fillWidthFiles].join("/") || "无"}（期望只有 AuthScreen.kt）`,
  };
});

// ── J4：MapSheet 代码零引用 ───────────────────────────────────────────────
check("J4", "MapSheet 代码零引用（注释不算）", () => {
  const files = ["GameScreen.kt", "MapView.kt", "ChatSheet.kt", "Widgets.kt"];
  const hits = files.filter((f) => /MapSheet\s*\(/.test(codeOnly(read(f))));
  return { ok: hits.length === 0, detail: hits.length ? `仍被调用：${hits.join(", ")}` : "0 处" };
});

// ── J5：DragBar 常量已删 ──────────────────────────────────────────────────
check("J5", "MudSizes.DragBar* 已删除", () => {
  const code = codeOnly(read("Theme.kt"));
  const defs = code.match(/val DragBar[WH]\s*=/g) ?? [];
  return { ok: defs.length === 0, detail: `定义 ${defs.length} 处` };
});

// ── J6：ui/ 下无裸 数字.dp ────────────────────────────────────────────────
check("J6", "ui/ 无裸 dp（Theme/MapView 除外）", () => {
  // ★ 按目录扫而不是手抄文件名：新增一个 `ui/*.kt` 若写了裸 dp，手抄名单会漏掉它
  //   （"按手抄清单判、只在有人改清单时才红"是本项目记过的三处同病，§71.8.2）。
  //   `MapView.kt` 的 10/1/5.dp 是**绘制量**（笔宽、虚线间隔），不是布局值。
  const files = ktFiles().filter((f) => f !== "Theme.kt" && f !== "MapView.kt");
  const bad = [];
  for (const f of files) {
    const code = codeOnly(read(f));
    for (const m of code.matchAll(/[0-9]+\.dp\b/g)) bad.push(`${f}:${m[0]}`);
  }
  return { ok: bad.length === 0, detail: bad.length ? bad.join(", ") : `0 处（扫 ${files.length} 个文件）` };
});

// ── J7：地图开着时描述必须让位（否则小屏输入行会被挤出屏幕）────────────
check("J7", "RoomDescMapLines 有定义且在 maxLines 里被引用（地图开着描述降 3 行）", () => {
  const theme = codeOnly(read("Theme.kt"));
  const screen = codeOnly(read("GameScreen.kt"));
  const def = /val RoomDescMapLines\s*=\s*3/.test(theme);
  const used = /MudSizes\.RoomDescMapLines/.test(screen);
  // 守卫：地图开着时不许给「展开描述」（否则 expanded 与地图共存会把出口/此处裁掉）
  const guard = /if \(!mapOpen && \(descOverflow \|\| expanded\)\)/.test(screen);
  return {
    ok: def && used && guard,
    detail: `定义=${def}、maxLines 引用=${used}、!mapOpen 守卫=${guard}`,
  };
});

let fail = 0;
for (const r of results) {
  if (!r.ok) fail += 1;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.id}  ${r.desc} —— ${r.detail}`);
}
console.log(`\n${results.length - fail}/${results.length} 通过${fail ? "（有红）" : ""}`);
process.exit(fail ? EXIT_FAIL : EXIT_PASS);
