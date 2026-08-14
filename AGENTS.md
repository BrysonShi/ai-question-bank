# AGENTS.md

## 项目概览

AI 智能题库助手 - 注册会计师备考学习辅助工具。用户上传题目截图，多模态大模型直接看图识别题目并给出结构化解析（答案、解析、知识点、易错点）。支持悬浮书签工具，在任意答题网页注入悬浮面板。

**产品定位**：学习辅助工具，非考试代答工具。只负责呈现答案和解析，用户自行查看和提交。

## 技术栈

- 前端：原生 HTML + CSS + JavaScript（无构建步骤）
- 后端：Node.js + Express（LLM API 代理）
- LLM：双模式 - Coze SDK（沙箱）/ OpenAI 兼容 API（外部部署）
- 存储：localStorage（错题本 + 历史记录）

## 构建和运行命令

```bash
# 安装依赖
pnpm install

# 开发环境启动
pnpm run dev        # 等同于 node server.js

# 生产环境启动
pnpm run start      # 等同于 node server.js
```

端口通过环境变量 `DEPLOY_RUN_PORT` 配置，默认 5000。

## 文件结构

```
.
├── index.html      # 主页面（HTML 结构）
├── style.css       # 全局样式（简洁风格、响应式）
├── app.js          # 前端逻辑（上传、解析、错题本、历史记录、悬浮工具）
├── bookmarklet.js  # 悬浮书签工具（注入答题网页的悬浮面板）
├── server.js       # 后端服务（静态文件 + LLM API 代理 + SSE 流式）
├── package.json    # 依赖配置
├── .coze           # Coze 沙箱配置
├── DESIGN.md       # 设计规范
├── AGENTS.md       # 本文件
├── api/
│   └── index.js    # Vercel Serverless 入口
├── vercel.json     # Vercel 部署配置
├── Dockerfile      # Docker 部署配置（Railway/Render）
├── .dockerignore   # Docker 忽略文件
└── .env.example    # 环境变量模板
```

## 后端 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/analyze` | POST | 接收图片 base64 + 学科，SSE 流式返回 LLM 解析结果 |
| `/api/analyze-text` | POST | 接收文本 + 学科，SSE 流式返回 LLM 解析结果（悬浮工具用） |
| `/api/subjects` | GET | 返回学科列表（税法/会计/审计/财管/战略/经济法） |
| `/api/health` | GET | 健康检查 |
| `/bookmarklet.js` | GET | 悬浮书签工具脚本（注入答题网页） |

### /api/analyze 请求格式

```json
{
  "image": "data:image/png;base64,...",
  "subject": "accounting",
  "index": 0,
  "model": "可选，指定模型"
}
```

### /api/analyze 响应格式（SSE）

```
data: {"type":"start","index":0,"subject":"会计"}
data: {"type":"chunk","content":"...","index":0}
data: {"type":"complete","index":0,"raw":"完整JSON字符串"}
data: {"type":"error","index":0,"message":"错误信息"}
```

### /api/analyze-text 请求格式

```json
{
  "text": "1. 下列哪项属于流动资产？ A. 固定资产 B. 存货 C. 无形资产 D. 长期股权投资",
  "subject": "accounting",
  "index": 0
}
```

### 悬浮书签工具（Bookmarklet）

`bookmarklet.js` 是注入到任意答题网页的悬浮面板脚本，通过 Bookmarklet 方式加载：

1. 用户在主站「悬浮工具」Tab 中配置后端地址
2. 将生成的书签链接拖到浏览器书签栏
3. 在任意答题网页点击书签，悬浮面板注入页面
4. 面板支持：区域截图（Screen Capture API）、Ctrl+V 粘贴、批量扫描页面文本
5. 调用 `/api/analyze`（图片）或 `/api/analyze-text`（文本）进行解析

**v2 效率增强功能**：

- **批量自动扫描**：点击「扫描」自动提取页面全部题目文本，一次性发送给 LLM 批量解析，返回所有题目的结构化结果
- **题目导航器**：多题结果以导航器模式展示（第 X/N 题），一次只看一题，支持「上一题/下一题」按钮切换
- **答案高亮**：正确选项以绿色背景+加粗+边框突出显示，一眼可见
- **键盘快捷键**：空格键或 → 键切换下一题，← 键返回上一题（在输入框中不触发）
- **解析预加载**：由于 LLM 一次返回所有题目，切题时解析即时可见，当前题目的解析自动展开

**产品边界**：悬浮工具只负责呈现答案和解析，不自动提交、不自动点击选项。

### LLM 返回的 JSON 结构

```json
{
  "questions": [
    {
      "questionNumber": "1",
      "questionType": "单选题",
      "questionStem": "题干内容",
      "options": {"A": "...", "B": "...", "C": "...", "D": "..."},
      "answer": "B",
      "analysis": "详细解析",
      "knowledgePoints": ["知识点1", "知识点2"],
      "commonMistakes": "易错点提示"
    }
  ]
}
```

## LLM 双模式架构

server.js 支持两种 LLM 调用模式，通过环境变量自动切换：

### 模式 1：Coze SDK（沙箱环境，默认）
- 使用 `coze-coding-dev-sdk` 包
- 鉴权由沙箱自动处理
- 默认模型：`doubao-seed-2-0-pro-260215`

### 模式 2：OpenAI 兼容 API（外部部署）
- 设置 `LLM_API_KEY` 环境变量即激活此模式
- 调用 `{LLM_BASE_URL}/chat/completions` 接口
- 支持 OpenAI / GLM / Qwen-VL 等兼容 API

## 环境变量配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `DEPLOY_RUN_PORT` | 服务监听端口 | 5000 |
| `LLM_API_KEY` | LLM API 密钥（设置后启用直接 API 模式） | - |
| `LLM_BASE_URL` | LLM API 基础地址 | `https://api.openai.com/v1` |
| `LLM_MODEL` | 默认模型名称 | `gpt-4o` |

## 部署指南

### 方案一：Vercel 部署（推荐，免费）

项目已包含 Vercel 配置文件（`vercel.json` + `api/index.js`），一键部署：

1. 将项目推送到 GitHub 仓库
2. 访问 [vercel.com](https://vercel.com)，导入仓库
3. 在 Settings > Environment Variables 中设置：
   - `LLM_API_KEY`：你的 API 密钥
   - `LLM_BASE_URL`：API 地址（如 `https://api.openai.com/v1`）
   - `LLM_MODEL`：模型名称（如 `gpt-4o`）
4. 点击 Deploy，获得地址如 `https://your-app.vercel.app`

### 方案二：Railway / Render 部署（Docker）

项目已包含 `Dockerfile`，支持 Docker 部署：

**Railway**：
1. 访问 [railway.app](https://railway.app)，新建项目
2. 连接 GitHub 仓库
3. 在 Variables 中设置 `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`
4. 自动检测 Dockerfile 并部署

**Render**：
1. 访问 [render.com](https://render.com)，新建 Web Service
2. 连接 GitHub 仓库
3. Build Command：`docker build -t app .`（或留空自动检测）
4. 在 Environment 中设置环境变量

### 方案三：自建服务器

```bash
# 克隆项目后
cp .env.example .env
# 编辑 .env 填写 LLM_API_KEY 等

# Docker 方式
docker build -t ai-question-bank .
docker run -d -p 5000:5000 --env-file .env ai-question-bank

# 或直接运行
pnpm install
node server.js
```

### 前端部署到 GitHub Pages（可选）

如果后端已部署到线上，前端可单独部署到 GitHub Pages：

1. 将 `index.html`、`style.css`、`app.js` 推送到 GitHub 仓库
2. 在 GitHub 仓库 Settings > Pages 中启用 GitHub Pages
3. 配置 API 地址（二选一）：
   - 修改 `app.js` 顶部的 `API_BASE` 常量
   - 在浏览器控制台执行 `localStorage.setItem('aqb_api_base', 'https://your-backend.example.com')`

### 各 LLM 提供商配置示例

```bash
# OpenAI GPT-4o
LLM_API_KEY=sk-xxx
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o

# 智谱 GLM-4V
LLM_API_KEY=xxx
LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
LLM_MODEL=glm-4v

# 通义千问 Qwen-VL
LLM_API_KEY=sk-xxx
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_MODEL=qwen-vl-max
```

## 代码风格

- 前端：原生 JavaScript，`'use strict'` 模式，无框架依赖
- 后端：ESM 模块（`"type": "module"`），async/await
- 命名：camelCase（变量/函数），UPPER_SNAKE（常量）
- 样式：Tailwind 风格的 CSS 变量，BEM 命名

## 关键实现说明

- **流式输出**：后端通过 SSE（Server-Sent Events）逐块推送 LLM 输出，前端通过 `ReadableStream` 读取并增量渲染
- **图片处理**：前端将图片转为 base64 data URL，直接传给多模态 LLM，无需单独 OCR
- **错题本**：localStorage 存储，key 为 `aqb_wrong_book`
- **历史记录**：localStorage 存储，key 为 `aqb_history`，保留最近 10 次
- **学科 prompt**：server.js 中的 `SUBJECTS` 对象，6 个学科各有专属 system prompt
