/**
 * setup.mjs — 首次运行交互配置
 */
import readline from 'node:readline';

const ask = (rl, q) => new Promise(r => rl.question(q, r));

export async function interactiveSetup(config) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('  GitHub Copilot Chat Setup\n');
  console.log('  直接回车 = 使用 Copilot 内置模型（gpt-5, claude 等）。');
  console.log('  填 API 地址 = 接入自己的模型（DeepSeek, OpenAI 等）。\n');

  const model = await ask(rl, '  模型名 [deepseek-v4-pro]: ') || 'deepseek-v4-pro';
  config.model = model.trim();

  const providerUrl = await ask(rl, '  API 地址（留空=用 Copilot 内置）: ');
  if (providerUrl.trim()) {
    config.providerUrl = providerUrl.trim();
    config.providerKey = (await ask(rl, '  API Key: ')).trim();
  }

  rl.close();
  console.log(`\n  [OK] 模型: ${config.model}${config.providerUrl ? ' (自定义 API)' : ''}\n`);
  return config;
}