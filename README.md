<div align="center">

<img src="https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js" alt="Node">
<img src="https://img.shields.io/badge/Copilot-SDK-8A2BE2?logo=githubcopilot" alt="SDK">
<img src="https://img.shields.io/badge/Platform-WeChat-07C160?logo=wechat" alt="WeChat">
<img src="https://img.shields.io/badge/License-MIT-yellow" alt="License">

# WeChat-Agent

**微信里聊 Copilot，就像在 VS Code 里一样。**

</div>

---

## 它是什么

在微信里 @ 你的机器人，背后是 **VS Code 的同款 GitHub Copilot Chat** 在思考和回复。不是你自己的 API key，不是第三方中转，就是 VS Code 里你每天用的那个 Copilot。

## 怎么做到的

用了 GitHub 官方的 `@github/copilot-sdk`。你在 VS Code 里登录了 Copilot，SDK 自动拿到凭证，零配置启动。

## 能做什么

- 💬 **自然对话** — 问什么答什么，跟 VS Code 里的 Copilot Chat 体验一致
- 🧵 **独立上下文** — 每个人有自己独立的对话线程，互不干扰
- 🔄 **自动重连** — 微信掉线自动恢复，会话过期自动刷新
- 🎛️ **随时切模型** — 一行命令换 Claude、GPT、Gemini 或者你自己接的 API
-  **加密存储** — 敏感信息 AES-256-CBC 落盘，不过期不泄露

## 用法

```bash
# 啥也不配，直接跑 — 默认 DeepSeek V4 Pro
node bin/WeChat-Agent.mjs

# 换 Claude（Copilot 内置，不用 API key）
node bin/WeChat-Agent.mjs --model claude-sonnet-4.5

# 接你自己的 API
node bin/WeChat-Agent.mjs --model deepseek-chat \
    --provider-url https://api.deepseek.com/v1 \
    --provider-key sk-你的key

# 重新扫码
node bin/WeChat-Agent.mjs --login
```

扫码登录后，微信发一条消息试试。

## 聊天命令

在微信里直接发：

| 发送 | 效果 |
|------|------|
| `/clear` | 清空当前对话，从头开始 |
| `/status` | 看机器人跑了多久、回了多少条 |
| `/help` | 显示可用命令 |
| `/ping` | 测一下在不在线 |

## 第一次用

```bash
# 1. 装 Node.js ≥22
# 2. 克隆 + 装依赖
git clone https://github.com/cycle410/WeChat-Agent.git
cd WeChat-Agent
npm install

# 3. 跑起来
node bin/WeChat-Agent.mjs
```

VS Code 里登录了 Copilot 就可以直接跑，不用额外设置环境变量。

---

<div align="center">

**微信消息 → Copilot SDK → Copilot CLI → GitHub Copilot Chat**

</div>


