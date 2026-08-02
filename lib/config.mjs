/**
 * config.mjs — 配置持久化（.config/config.json + token.json）
 *
 * config.json: model + copilotToken + providerUrl + providerKey
 *   → 敏感字段（copilotToken, providerKey）AES-256-CBC 加密落盘
 * token.json:  微信 iLink 登录 token，明文存储
 *
 * SDK 的 Copilot 认证走 GITHUB_TOKEN 环境变量，不走这里的 copilotToken。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

export const DATA_DIR = path.join(ROOT, '.config');
export const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
export const TOKEN_FILE = path.join(DATA_DIR, 'token.json');

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try { fs.chmodSync(DATA_DIR, 0o700); } catch {}
}

// ── 模型配置（纯 JSON）──

export function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE))
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {}
  return {};
}

/** 保存时自动加密敏感字段 */
export function saveConfig(config) {
  ensureDir();
  const safe = { ...config };
  if (safe.copilotToken) { safe._enc = encrypt(safe.copilotToken); delete safe.copilotToken; }
  if (safe.providerKey)  { safe._pkey = encrypt(safe.providerKey);  delete safe.providerKey; }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(safe, null, 2));
  try { fs.chmodSync(CONFIG_FILE, 0o600); } catch {}
}

/** 读取并自动解密 */
export function loadConfigWithKey() {
  const config = loadConfig();
  if (config._enc)  { try { config.copilotToken = decrypt(config._enc); } catch { config.copilotToken = ''; } delete config._enc; }
  if (config._pkey) { try { config.providerKey  = decrypt(config._pkey); } catch { config.providerKey  = ''; } delete config._pkey; }
  return config;
}

// ── 微信登录 token（与 SDK 无关）──

export function loadToken() {
  try {
    if (fs.existsSync(TOKEN_FILE))
      return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
  } catch {}
  return null;
}

export function saveToken(token) {
  ensureDir();
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(token, null, 2));
  try { fs.chmodSync(TOKEN_FILE, 0o600); } catch {}
}

// ── 日志脱敏 ──

export function maskKey(key) {
  if (!key || key.length < 10) return '***';
  return key.slice(0, 8) + '...' + key.slice(-4);
}

// ── AES-256-CBC 加密（机器指纹派生密钥）──

const MACHINE_KEY = crypto.createHash('sha256')
  .update(os.hostname() + os.homedir() + os.userInfo().username)
  .digest();

function encrypt(plain) {
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv('aes-256-cbc', MACHINE_KEY, iv);
  const enc = Buffer.concat([c.update(plain, 'utf-8'), c.final()]);
  return iv.toString('hex') + ':' + enc.toString('hex');
}

function decrypt(encoded) {
  const [ivHex, encHex] = encoded.split(':');
  const d = crypto.createDecipheriv('aes-256-cbc', MACHINE_KEY, Buffer.from(ivHex, 'hex'));
  return Buffer.concat([d.update(Buffer.from(encHex, 'hex')), d.final()]).toString('utf-8');
}