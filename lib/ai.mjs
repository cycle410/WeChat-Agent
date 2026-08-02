/**
 * ai.mjs — GitHub Copilot Chat 核心模块
 *
 * 底层：@github/copilot-sdk → JSON-RPC → Copilot CLI
 * 架构：全局一个 CopilotClient，每个微信用户一个 CopilotSession
 * 认证：SDK 自动读 GITHUB_TOKEN / GH_TOKEN，无需手动传
 *
 * 对外 API：
 *   initCopilot()     启动（程序启动时一次）
 *   shutdownCopilot() 关闭（Ctrl+C 时）
 *   chat(userId, msg) 发消息、等回复
 *   clearHistory(id)  清用户对话
 *   setModel(name)    换模型
 *   setProvider(cfg)  设自定义 API
 *   setSystemPrompt() 换 AI 人设
 */
import { CopilotClient, approveAll } from '@github/copilot-sdk';

let client = null;
let defaultModel = 'deepseek-v4-pro';
let defaultProvider = null;  // { type, baseUrl, apiKey } 可选 BYOK

const userSessions = new Map();  // userId → { session, sessionId }

export function setModel(m) { defaultModel = m; }
export function setProvider(p) { defaultProvider = p; }

// ── 启动：创建 CopilotClient，拉起后台 CLI ──
// token 可选，不传则 SDK 从 GITHUB_TOKEN 环境变量自动获取

export async function initCopilot({ model, token } = {}) {
  if (model) defaultModel = model;
  client = new CopilotClient({ ...(token ? { gitHubToken: token } : {}) });
  await client.start();
}

// ── 关闭：断开所有会话 + 停 CLI ──

export async function shutdownCopilot() {
  for (const [, { session }] of userSessions) {
    try { await session.disconnect(); } catch {}
  }
  userSessions.clear();
  if (client) { try { await client.stop(); } catch {} client = null; }
}

// ── 会话管理：首次发消息自动创建，之后复用（保留对话上下文）──

async function getUserSession(userId) {
  const entry = userSessions.get(userId);
  if (entry?.session) return entry.session;

  const session = await client.createSession({
    model: defaultModel,
    onPermissionRequest: approveAll,
    systemMessage: { mode: 'replace', content: getSystemPrompt() },
    ...(defaultProvider ? { provider: defaultProvider } : {}),
  });
  userSessions.set(userId, { session, sessionId: session.sessionId });
  return session;
}

export async function clearHistory(userId) {
  const entry = userSessions.get(userId);
  if (entry) {
    try { await entry.session.disconnect(); } catch {}
    try { await client.deleteSession(entry.sessionId); } catch {}
    userSessions.delete(userId);
  }
}

// ── chat() 是 bot.mjs 的唯一入口：发文本 → 等 AI 回复 → 返回字符串 ──

export async function chat(_config, userId, userText) {
  if (!client) throw new Error('Copilot SDK 未初始化，先调用 initCopilot()');
  const session = await getUserSession(userId);
  // sendAndWait：发送消息 + 阻塞等待 AI 完成，返回最终回复
  const resp = await session.sendAndWait({ prompt: userText });
  return resp?.data?.content || '(no response)';
}

// ── AI 人设（system prompt），通过 SDK systemMessage.mode='replace' 注入 ──

const DEFAULT_SYSTEM_PROMPT = `你是热心的学习助手`;
let customPrompt = null;

export function getSystemPrompt() { return customPrompt || DEFAULT_SYSTEM_PROMPT; }

/** 运行时换人设，/clear 后新会话生效 */
export function setSystemPrompt(p) { customPrompt = p; }