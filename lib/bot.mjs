/**
 * Main bot loop — login + poll + AI reply + auto-reconnect.
 */
import { loadToken, saveToken } from './config.mjs';
import { getQrCode, pollQrStatus, getUpdates, sendText, sendTyping, extractText } from './weixin.mjs';
import { chat, clearHistory, initCopilot, shutdownCopilot, setProvider } from './ai.mjs';
import { renderQR } from './qr.mjs';

const BASE_URL = 'https://ilinkai.weixin.qq.com';
const MAX_RECONNECT = 5;
const RECONNECT_DELAY = [3000, 5000, 10000, 20000, 30000];

/** 微信扫码登录。有保存的 token 则复用，传 forceLogin 则重新扫码 */
async function login(forceLogin) {
  // 有缓存且不强制重登 → 直接复用
  if (!forceLogin) {
    const saved = loadToken();
    if (saved?.token) {
      console.log(`  [OK] Using saved session (Bot: ${saved.accountId || 'unknown'})`);
      console.log(`       Saved at: ${saved.savedAt || 'unknown'}\n`);
      return saved;
    }
  }

  console.log('  [INFO] WeChat QR Login\n');
  const qrResp = await getQrCode();
  let qrcode = qrResp.qrcode;

  displayQR(qrResp.qrcode_img_content);

  const deadline = Date.now() + 5 * 60_000;
  let refreshCount = 0;

  while (Date.now() < deadline) {
    const status = await pollQrStatus(qrcode);

    if (status.status === 'scaned') {
      console.log('  [INFO] Scanned! Confirm on your phone...');
    }

    if (status.status === 'expired') {
      if (++refreshCount > 3) throw new Error('QR expired 3 times');
      console.log(`  [WARN] QR expired, refreshing (${refreshCount}/3)...`);
      const newQr = await getQrCode();
      qrcode = newQr.qrcode;
      displayQR(newQr.qrcode_img_content);
    }

    if (status.status === 'confirmed') {
      const session = {
        token: status.bot_token,
        baseUrl: status.baseurl || BASE_URL,
        accountId: status.ilink_bot_id,
        userId: status.ilink_user_id,
        savedAt: new Date().toISOString(),
      };
      saveToken(session);
      console.log(`  [OK] Login successful! Bot ID: ${session.accountId}\n`);
      return session;
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  throw new Error('Login timeout');
}

function displayQR(url) {
  if (!url) {
    console.log('  [WARN] No QR URL received\n');
    return;
  }

  console.log('  [INFO] Scan with WeChat:\n');

  // Try terminal QR rendering
  const qrArt = renderQR(url);
  if (qrArt) {
    for (const line of qrArt.split('\n')) {
      console.log('  ' + line);
    }
    console.log();
  }

  // Always show URL as fallback
  console.log(`  [INFO] Or open: ${url}\n`);
  console.log('  Waiting for scan...');
}

function formatTime() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

// Slash commands
const COMMANDS = {
  '/clear': (userId) => { clearHistory(userId); return '[OK] Conversation cleared.'; },
  '/help': () => `可用命令：
/clear — 清除聊天记录
/help — 显示本帮助
/ping — 测试机器人是否在线
/status — 显示机器人状态`,
  '/ping': () => 'Pong!',

};

/**
 * 启动机器人 — 这是整个程序的入口。
 *
 * 执行顺序：
 * 1. 微信扫码登录（或复用上次的 token）
 * 2. 启动 Copilot SDK（连接 GitHub Copilot Chat）
 * 3. 进入消息轮询循环（不断拉取微信消息 → 交给 AI → 回复）
 *
 * @param {object} config 配置对象，包含 model、copilotToken 等
 * @param {object} opts   选项 { forceLogin: 是否强制重新扫码 }
 */
export async function startBot(config, { forceLogin = false } = {}) {
  const session = await login(forceLogin);

  const model = config.model || 'deepseek-v4-pro';

  // 启动 Copilot SDK（initCopilot 内部会 setModel）
  await initCopilot({ model, token: config.copilotToken || undefined });

  // 自定义 provider（BYOK）。不配则 SDK 用 Copilot 内置模型列表
  if (config.providerUrl) {
    setProvider({
      type: 'openai',
      baseUrl: config.providerUrl,
      apiKey: config.providerKey || '',
    });
    console.log(`  Provider: ${config.providerUrl}`);
  }

  console.log(`  [OK] WeChat-Agent 运行中`);
  console.log(`  AI:  GitHub Copilot Chat (${model})`);
  console.log(`  Ctrl+C 退出\n`);
  console.log('  ' + '─'.repeat(30) + '\n');

  const startTime = Date.now();
  let totalMessages = 0;
  COMMANDS['/status'] = () =>
    `WeChat-Agent\n在线: ${Math.floor((Date.now() - startTime) / 60000)}m\n消息: ${totalMessages}\n模型: ${model}`;

  await pollLoop(config, session, { startTime, onMessage: () => totalMessages++ });
}

/**
 * 消息轮询主循环。
 * - 不断调 getUpdates 拉微信消息
 * - 每条文字消息 → chat() 获取 AI 回复 → sendText 发回
 * - 会话过期自动重连
 */
async function pollLoop(config, session, ctx) {
  let { token, baseUrl } = session;
  let running = true;
  let buf = '';          // 轮询游标，避免重复拉取
  let reconnectCount = 0;

  // Ctrl+C 优雅退出
  process.on('SIGINT', () => {
    console.log('\n\n  [INFO] Shutting down...');
    running = false;
    shutdownCopilot().finally(() => {
      setTimeout(() => process.exit(0), 500);
    });
  });

  while (running) {
    try {
      const resp = await getUpdates(baseUrl, token, buf);
      if (resp.get_updates_buf) buf = resp.get_updates_buf;

      // Session expired — try auto-reconnect
      if (resp.errcode === -14 || resp.errcode === -13) {
        console.log(`\n  [WARN] Session expired (code: ${resp.errcode})`);

        if (reconnectCount >= MAX_RECONNECT) {
          console.log('  [ERROR] Max reconnect attempts reached. Run with --login to re-authenticate.');
          process.exit(1);
        }

        reconnectCount++;
        const delay = RECONNECT_DELAY[Math.min(reconnectCount - 1, RECONNECT_DELAY.length - 1)];
        console.log(`  [INFO] Reconnecting (${reconnectCount}/${MAX_RECONNECT}) in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));

        try {
          const newSession = await login(true);
          token = newSession.token;
          baseUrl = newSession.baseUrl;
          buf = '';
          reconnectCount = 0;
          console.log('  [OK] Reconnected!\n');
        } catch (loginErr) {
          console.error(`  [ERROR] Reconnect failed: ${loginErr.message}`);
        }
        continue;
      }

      // Reset reconnect counter on successful poll
      reconnectCount = 0;

      for (const msg of resp.msgs || []) {
        if (msg.message_type !== 1) continue;

        const from = msg.from_user_id;
        const text = extractText(msg);
        const ctx_token = msg.context_token;
        ctx.onMessage();

        // Sanitize user input for logging (prevent log injection)
        const safeText = text.replace(/[\n\r]/g, ' ').slice(0, 200);
        const safeFrom = from.replace(/[\n\r]/g, '');

        console.log(`  [MSG] [${formatTime()}] From: ${safeFrom}`);
        console.log(`        Text: ${safeText}`);

        // Check slash commands
        const cmdKey = text.trim().toLowerCase();
        const cmd = COMMANDS[cmdKey];
        if (cmd) {
          const reply = typeof cmd === 'function' ? cmd(from) : cmd;
          await sendText(baseUrl, token, from, reply, ctx_token);
          console.log(`        [OK] ${reply.split('\n')[0]}\n`);
          continue;
        }

        // Skip non-text for AI (media labels from extractText)
        const mediaLabels = ['[图片]', '[视频]', '[语音]'];
        const isMedia = mediaLabels.some(l => text === l) || text.startsWith('[文件]');
        if (isMedia) {
          await sendText(baseUrl, token, from, `收到${text}，目前仅支持文字对话~`, ctx_token);
          console.log(`        [SKIP] Media ignored\n`);
          continue;
        }

        // Rate limit check (simple per-user cooldown)
        if (isRateLimited(from)) {
          await sendText(baseUrl, token, from, '请稍等，消息太频繁了~', ctx_token);
          console.log(`        [RATE] Rate limited\n`);
          continue;
        }

        sendTyping(baseUrl, token, from, ctx_token).catch(() => {});  // 失败忽略：不影响回复

        console.log(`        [AI] Thinking...`);
        const startTime = Date.now();

        try {
          const reply = await chat(config, from, text);
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

          const chunks = splitMessage(reply, 1800);
          for (const chunk of chunks) {
            await sendText(baseUrl, token, from, chunk, ctx_token);
          }

          const preview = reply.length > 80 ? reply.slice(0, 80) + '…' : reply;
          console.log(`        [OK] [${elapsed}s] ${preview}\n`);
        } catch (aiErr) {
          console.log(`        [ERROR] AI error: ${aiErr.message}\n`);
          await sendText(baseUrl, token, from, '抱歉，AI 处理出错了，请稍后再试~', ctx_token).catch(() => {});
        }
      }
    } catch (err) {
      if (!running) break;
      console.error(`  [WARN] Poll error: ${err.message}, retrying in 3s...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

// ── Rate limiting ──

const rateLimits = new Map();
const RATE_LIMIT_WINDOW = 3000; // 同一用户两条消息最小间隔 3 秒（与 README 一致）
const RATE_LIMIT_MAX = 10; // 每分钟最多 10 条（每次都要调用大模型，避免烧额度）

function isRateLimited(userId) {
  const now = Date.now();
  let entry = rateLimits.get(userId);

  // Periodic cleanup: remove stale entries
  if (rateLimits.size > 500) {
    for (const [id, e] of rateLimits) {
      if (now - e.last > 300000) rateLimits.delete(id); // 5 min stale
    }
  }

  if (!entry) {
    entry = { last: now, count: 1, windowStart: now };
    rateLimits.set(userId, entry);
    return false;
  }

  // Per-minute limit
  if (now - entry.windowStart > 60000) {
    entry.windowStart = now;
    entry.count = 0;
  }
  entry.count++;

  if (entry.count > RATE_LIMIT_MAX) return true;

  // Cooldown between messages
  if (now - entry.last < RATE_LIMIT_WINDOW) return true;

  entry.last = now;
  return false;
}

function splitMessage(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Try to split at newline
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt < maxLen * 0.3) {
      // Try to split at space or CJK boundary
      splitAt = remaining.lastIndexOf(' ', maxLen);
      if (splitAt < maxLen * 0.3) splitAt = maxLen;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, '');
  }
  return chunks;
}