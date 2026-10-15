/**
 * src/ui/auth.ts — 认证界面（登入 / 新建名号）
 * ============================================================================
 * wushen 的登录是一串互斥面板（`.mypanel`）：服务器列表 → 登入 → 选角 → 创建。
 * 这里只留**两块**（登入 / 新建），因为账号系统还没落地（26 册 §14.6 的 T12）——
 * 画一个选角界面而后端根本没有角色表，是典型的"假装做了"。
 *
 * ★ 服务器地址**只读**：同源推导（`ws(s)://<当前主机>/ws`），没有输入框。
 *   玩家不该关心服务器在哪儿，也不该被要求手打 IP；同源还顺带保证了
 *   "页面从哪儿来就往哪儿连"（静态页与 WS 同端口，见 `server/static.ts`）。
 */

import { need } from './dom.js';

export type AuthMode = 'login' | 'register';

export interface AuthHooks {
  onSubmit(mode: AuthMode, name: string): void;
}

let hooks: AuthHooks = { onSubmit: () => undefined };

/** 名号最长多少字（服务端是最终裁决者，这里只是提前别让玩家白敲） */
const NAME_MAX = 24;

export function validateName(name: string): string | null {
  const value = name.trim();
  if (value === '') return '请先填一个名号。';
  if (/\s/.test(value)) return '名号里不能有空格。';
  if (value.length > NAME_MAX) return `名号最多 ${String(NAME_MAX)} 个字。`;
  return null;
}

/** 页面怎么来的，就往哪儿连（同源） */
export function serverUrl(): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}/ws`;
}

/** 用 `file://` 打开时无从"同源"，这时候要说实话而不是让他连了个寂寞 */
export function serverReachable(): boolean {
  return location.protocol === 'http:' || location.protocol === 'https:';
}

export function renderServerLabel(): void {
  need('serverLabel').textContent = serverReachable() ? `${location.host}/ws` : '未通过服务器打开';
}

export function prefillName(name: string): void {
  if (name !== '') need<HTMLInputElement>('loginName').value = name;
}

/** 切换「登入 / 新建」两块面板（互斥） */
export function setAuthTab(mode: AuthMode): void {
  need('panelLogin').hidden = mode !== 'login';
  need('panelRegister').hidden = mode !== 'register';
  need('tabLogin').classList.toggle('on', mode === 'login');
  need('tabRegister').classList.toggle('on', mode === 'register');
  need('tabLogin').setAttribute('aria-selected', String(mode === 'login'));
  need('tabRegister').setAttribute('aria-selected', String(mode === 'register'));
}

export function setAuthStatus(text: string, kind: 'idle' | 'busy' | 'error' = 'idle'): void {
  const node = need('authStatus');
  node.textContent = text;
  node.classList.toggle('busy', kind === 'busy');
  node.classList.toggle('error', kind === 'error');
}

export function setAuthBusy(busy: boolean): void {
  need<HTMLButtonElement>('loginBtn').disabled = busy;
  need<HTMLButtonElement>('regBtn').disabled = busy;
}

export function bindAuth(h: AuthHooks): void {
  hooks = h;

  need('tabLogin').addEventListener('click', () => setAuthTab('login'));
  need('tabRegister').addEventListener('click', () => setAuthTab('register'));

  need('loginBtn').addEventListener('click', () => submit('login'));
  need('regBtn').addEventListener('click', () => submit('register'));

  for (const id of ['loginName', 'regName']) {
    need<HTMLInputElement>(id).addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter') return;
      submit(id === 'loginName' ? 'login' : 'register');
    });
  }
}

function submit(mode: AuthMode): void {
  const input = need<HTMLInputElement>(mode === 'login' ? 'loginName' : 'regName');
  hooks.onSubmit(mode, input.value.trim());
}
