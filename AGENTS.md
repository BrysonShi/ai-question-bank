# AGENTS.md

## 项目概览

AI 智能题库助手 - 注册会计师备考学习辅助工具。用户上传题目截图，多模态大模型直接看图识别题目并给出结构化解析（答案、解析、知识点、易错点）。

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
├── app.js          # 前端逻辑（上传、解析、错题本、历史记录）
├── server.js       # 后端服务（静态文件 + LLM API 代理 + SSE 流式）
├── package.json    # 依赖配置
├── .coze           # Coze 沙箱配置
├── DESIGN.md       # 设计规范
└── AGENTS.md       # 本文件
```

## 后端 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/analyze` | POST | 接收图片 base64 + 学科，SSE 流式返回 LLM 解析结果 |
| `/api/subjects` | GET | 返回学科列表（税法/会计/审计/财管/战略/经济法） |
| `/api/health` | GET | 健康检查 |

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

### 前端部署到 GitHub Pages

1. 将 `index.html`、`style.css`、`app.js` 推送到 GitHub 仓库
2. 在 GitHub 仓库 Settings > Pages 中启用 GitHub Pages
3. 配置 API 地址（二选一）：
   - 修改 `app.js` 顶部的 `API_BASE` 常量
   - 在浏览器控制台执行 `localStorage.setItem('aqb_api_base', 'https://your-backend.example.com')`

### 后端部署

将 `server.js`、`package.json` 部署到任意 Node.js 主机（Vercel / Railway / Render / 云服务器）：

```bash
# 安装依赖
pnpm install

# 设置环境变量
export LLM_API_KEY="your-api-key"
export LLM_BASE_URL="https://api.openai.com/v1"    # 或其他兼容 API
export LLM_MODEL="gpt-4o"                            # 或 glm-4v / qwen-vl 等

# 启动服务
node server.js
```

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
