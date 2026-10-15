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
  // ★ 被拒≠掉线：人还在认证界面，要看得到原因（连接由下一次提交时统一收回）
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
