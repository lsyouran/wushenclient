/**
 * src/process/handlers/role.ts — 角色 / 账号类包
 *
 * ⚠️ 账号系统尚未落地（docs/26 §14.6 的 T12）：`regist` / `deleterole` / `cross`
 *   目前**没有服务端实现**，前端收到时明确说出来，而不是假装成功。
 */

import { registerHandler } from '../registry.js';
import { errorTextOf } from '../../../shared/error-codes.js';
import { pushLine } from '../../ui/stream.js';
import { renderStatus, showGame } from '../../ui/status.js';
import { setAuthBusy, setAuthStatus } from '../../ui/auth.js';
import { showScreen } from '../../ui/screens.js';
import { patchVitals, rememberRole, state } from '../../state.js';

const asString = (v: unknown): string => (typeof v === 'string' ? v : '');
const asNumber = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

registerHandler('roles', (p) => {
  const list = Array.isArray(p['roles']) ? p['roles'] : [];
  // 角色列表目前只在叙事流里列出（选角 UI 属账号批次）
  pushLine(
    list.length === 0
      ? '【角色】没有可用角色'
      : `【角色】${list
          .map((r) => (typeof r === 'object' && r !== null ? asString((r as Record<string, unknown>)['name']) : ''))
          .filter((s) => s !== '')
          .join('、')}`,
    'sys',
  );
});

registerHandler('login', (p) => {
  state.loggedIn = true;
  // 服务端回的 `id` 才是名号的权威值：认它，而不是认本地输入框里那串
  const id = asString(p['id']);
  if (id !== '') rememberRole(id);
  const level = asNumber(p['level']);
  if (level !== undefined) patchVitals({ level });
  // ★ 先切屏再说话：`showGame()` 会整体重绘一次（状态条 / 房间区 / 抽屉），
  //   然后把欢迎语追加到**已经可见的**消息流里 —— 顺序反过来会把这句话写进隐藏的
  //   #output（`renderAll` 不碰消息流，所以它其实不会被冲掉，但"先切后写"更直白）。
  showGame();
  pushLine(`【登录】欢迎回来，${asString(p['id'])}`, 'sys');
});

registerHandler('loginerror', (p) => {
  const code = asString(p['code']);
  const msg = asString(p['msg']);
  const text = msg === '' ? errorTextOf(code) : msg;

  // ★ 这条帧**不止在登录期到达**（2026-10-16 审查 S2）。
  //   服务端的 `session.ts#errorPacket` 把**所有**错误都包成 `loginerror`
  //   ——连"限流被拒"这种跟登录毫无关系的拒绝也是它。典型路径是
  //   「游戏中被限流」：`RATE_LIMIT_PER_5S = 20`，玩家连点地图格子就能在 5 秒内
  //   打出第 21 帧，服务端回 `RATE_LIMITED` 且 **`close=false`** —— 连接完好、
  //   角色在线。旧实现无条件 `showScreen('auth')`，于是人被甩回登录页、
  //   还写着"登录失败"，跟实际发生的事对不上。
  //
  //   ⇒ 判据应当是"**此刻是不是在游戏里**"，而不是"这个包叫什么名字"。
  //     治本修法是别复用 `loginerror` 通道（要动协议 + G2 台账），属下一批；
  //     本批先把"认证期"与"游戏中"两条路分开。
  if (state.loggedIn) {
    // 人还在江湖里 ⇏ 让他留下，把原因说到他正在看的消息流里。
    //   ★ 不走 `setAuthStatus`：那一栏在 `#auth` 屏上，此刻不可见，
    //     写了既看不到、又污染下一次回认证界面时的显示。
    pushLine(`【拒绝】${text}（${code}）`, 'err');
    return;
  }

  setAuthBusy(false);
  setAuthStatus(`登录失败：${text}（${code}）`, 'error');
  showScreen('auth');
});

registerHandler('regist', (p) => {
  pushLine(p['ok'] === true ? `【创建角色】${asString(p['result'])}` : `【创建角色失败】${asString(p['result'])}`, 'sys');
  void p['code'];
});

registerHandler('deleterole', (p) => {
  pushLine(`【删除角色】${asString(p['roleid'])}`, 'sys');
});

registerHandler('cross', (p) => {
  pushLine(`【跨服】${asString(p['cross_type'])} —— 跨服尚未实现`, 'sys');
});

registerHandler('levelup', (p) => {
  const level = asNumber(p['level']) ?? 0;
  patchVitals({ level });
  pushLine(`【升级】你升到了 ${level} 级！`, 'fight');
  renderStatus();
});

registerHandler('setting', (p) => {
  const items = p['items'];
  const count = typeof items === 'object' && items !== null ? Object.keys(items).length : 0;
  pushLine(`【设置】收到 ${count} 项（设置面板尚未实现）`, 'sys');
});
