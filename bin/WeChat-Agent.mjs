#!/usr/bin/env node
/**
 * WeChat-Agent — WeChat × GitHub Copilot Chat
 *
 *   直接跑：node bin/WeChat-Agent.mjs
 *   换模型：node bin/WeChat-Agent.mjs --model claude-sonnet-4.5
 *   接自己 API：node bin/WeChat-Agent.mjs --model deepseek-chat \
 *                --provider-url https://api.deepseek.com/v1 --provider-key sk-xxx
 *   ⚠️ 默认模型名 "deepseek-v4-pro" 需在 VS Code Copilot Chat 模型列表确认
 */
import { parseArgs } from 'node:util';
import { startBot } from '../lib/bot.mjs';
import { interactiveSetup } from '../lib/setup.mjs';
import { loadConfigWithKey, saveConfig } from '../lib/config.mjs';

const { values: args } = parseArgs({
  options: {
    'model':         { type: 'string' },
    'provider-url':  { type: 'string' },
    'provider-key':  { type: 'string' },
    'login':         { type: 'boolean', default: false },
    'help':          { type: 'boolean', short: 'h', default: false },
    'version':       { type: 'boolean', short: 'v', default: false },
  },
  strict: false,
});

if (args.version) {
  const pkg = JSON.parse((await import('fs')).readFileSync(
    new URL('../package.json', import.meta.url), 'utf-8'));
  console.log(`WeChat-Agent v${pkg.version}`);
  process.exit(0);
}

if (args.help) {
  console.log(`
  WeChat-Agent — WeChat × GitHub Copilot Chat

  认证：VS Code 里登录了 Copilot 就自动获取，无需手动操作。

  用法:
    node bin/WeChat-Agent.mjs
    node bin/WeChat-Agent.mjs --model claude-sonnet-4.5
    node bin/WeChat-Agent.mjs --model deepseek-chat \\
        --provider-url https://api.deepseek.com/v1 --provider-key sk-xxx

  选项:
    --model <name>          模型名 (默认 deepseek-v4-pro)
    --provider-url <url>    自定义 API 地址（BYOK）
    --provider-key <key>    自定义 API Key
    --login                 强制重新微信扫码
    -h, --help              显示帮助
    -v, --version           显示版本
`);
  process.exit(0);
}

async function main() {
  console.log('\n  WeChat-Agent — GitHub Copilot Chat\n');

  let config = loadConfigWithKey();

  // 环境变量 > CLI 参数 > 配置文件 > 默认值
  if (process.env.GITHUB_TOKEN) config.copilotToken = process.env.GITHUB_TOKEN;
  if (args.model) config.model = args.model;
  if (args['provider-url']) config.providerUrl = args['provider-url'];
  if (args['provider-key']) config.providerKey = args['provider-key'];

  if (!config.model) {
    config = await interactiveSetup(config);
    saveConfig(config);
  }
  if (!config.model) config.model = 'deepseek-v4-pro';

  await startBot(config, { forceLogin: args.login });
}

main().catch(err => {
  console.error('\n  [ERROR]', err.message);
  process.exit(1);
});
