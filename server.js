import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

// 双模式 LLM 支持：
// 模式 1 (Coze 沙箱): 使用 coze-coding-dev-sdk，自动处理鉴权
// 模式 2 (外部部署): 设置 LLM_API_KEY 环境变量，使用 OpenAI 兼容 API
let cozeSDK = null;
try {
  cozeSDK = await import('coze-coding-dev-sdk');
} catch (e) {
  console.log('[AI Question Bank] Coze SDK not available, using direct API mode');
}

const USE_DIRECT_API = !!process.env.LLM_API_KEY;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.DEPLOY_RUN_PORT || 5000;

// 中间件
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

// CORS 支持（GitHub Pages 跨域部署时需要）
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

// ========== 学科 Prompt 配置 ==========
const SUBJECTS = {
  tax: {
    name: '税法',
    systemPrompt: `你是一位资深注册会计师税法考试辅导老师，精通中国现行税收法律法规。
你的任务是分析图片中的税法考试题目，给出准确、专业的解析。
重点关注：各税种（增值税、企业所得税、个人所得税、消费税等）的计算、税收优惠政策、纳税申报、税务筹划等知识点。
解析时要注明引用的税法条款和最新政策。`
  },
  accounting: {
    name: '会计',
    systemPrompt: `你是一位资深注册会计师会计考试辅导老师，精通中国企业会计准则。
你的任务是分析图片中的会计考试题目，给出准确、专业的解析。
重点关注：会计准则应用、账务处理、合并报表、收入确认、金融工具、租赁等知识点。
解析时要体现会计分录和准则依据。`
  },
  audit: {
    name: '审计',
    systemPrompt: `你是一位资深注册会计师审计考试辅导老师，精通中国注册会计师审计准则。
你的任务是分析图片中的审计考试题目，给出准确、专业的解析。
重点关注：审计程序、审计证据、审计风险、内部控制、审计报告等知识点。
解析时要体现审计逻辑和准则依据。`
  },
  finance: {
    name: '财管',
    systemPrompt: `你是一位资深注册会计师财务成本管理考试辅导老师，精通财务管理理论和实务。
你的任务是分析图片中的财管考试题目，给出准确、专业的解析。
重点关注：财务分析、资本预算、资本成本、营运资金管理、成本计算、本量利分析等知识点。
解析时要展示计算过程和公式推导。`
  },
  strategy: {
    name: '战略',
    systemPrompt: `你是一位资深注册会计师公司战略与风险管理考试辅导老师。
你的任务是分析图片中的战略考试题目，给出准确、专业的解析。
重点关注：战略分析（PEST、SWOT、波特五力）、战略选择、战略实施、风险管理、内部控制等知识点。
解析时要结合实际案例和理论框架。`
  },
  economic_law: {
    name: '经济法',
    systemPrompt: `你是一位资深注册会计师经济法考试辅导老师，精通中国经济法律制度。
你的任务是分析图片中的经济法考试题目，给出准确、专业的解析。
重点关注：物权法、合同法、公司法、证券法、破产法、票据法等知识点。
解析时要注明引用的法律条文。`
  }
};

// 默认模型（多模态，支持图片理解）
const DEFAULT_MODEL = USE_DIRECT_API
  ? (process.env.LLM_MODEL || 'gpt-4o')
  : 'doubao-seed-2-0-pro-260215';

// ========== LLM 流式调用（双模式） ==========

/**
 * 模式 2: 直接调用 OpenAI 兼容 API（用于外部部署）
 */
async function* streamDirectAPI(messages, model, temperature) {
  const baseUrl = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const apiKey = process.env.LLM_API_KEY;
  const modelName = model || process.env.LLM_MODEL || 'gpt-4o';

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: modelName,
      messages,
      temperature,
      stream: true
    })
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`LLM API error ${response.status}: ${errText || response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
        try {
          const data = JSON.parse(trimmed.slice(6));
          const content = data.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch (_) { /* skip invalid JSON */ }
      }
    }
  }
}

/**
 * 模式 1: 使用 Coze SDK（沙箱环境）
 */
async function* streamCozeSDK(messages, model, temperature, req) {
  const { LLMClient, Config, HeaderUtils } = cozeSDK;
  const config = new Config();
  const customHeaders = HeaderUtils.extractForwardHeaders(req.headers);
  const client = new LLMClient(config, customHeaders);

  const stream = client.stream(messages, {
    model: model || DEFAULT_MODEL,
    temperature,
    thinking: 'disabled'
  });

  for await (const chunk of stream) {
    if (chunk.content) {
      yield chunk.content.toString();
    }
  }
}

/**
 * 统一 LLM 流式接口（自动选择模式）
 */
async function* streamLLM(messages, model, temperature, req) {
  if (USE_DIRECT_API) {
    yield* streamDirectAPI(messages, model, temperature);
  } else if (cozeSDK) {
    yield* streamCozeSDK(messages, model, temperature, req);
  } else {
    throw new Error('未配置 LLM 服务：请安装 coze-coding-dev-sdk 或设置 LLM_API_KEY 环境变量');
  }
}

// ========== API 路由 ==========

/**
 * POST /api/analyze
 * 接收图片 base64 + 学科，调用多模态 LLM 分析题目，SSE 流式返回
 * Body: { image: "data:image/...", subject: "tax", index: 0, model?: "..." }
 */
app.post('/api/analyze', async (req, res) => {
  const { image, subject = 'accounting', index = 0, model } = req.body;

  if (!image) {
    return res.status(400).json({ error: '缺少图片数据' });
  }

  const subjectConfig = SUBJECTS[subject] || SUBJECTS.accounting;

  // SSE 响应头
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'X-Accel-Buffering': 'no'
  });

  // 发送开始事件
  res.write(`data: ${JSON.stringify({ type: 'start', index, subject: subjectConfig.name })}\n\n`);

  try {
    const userPrompt = `请仔细分析这张图片中的考试题目，以纯 JSON 格式返回分析结果（不要包含 \`\`\`json 等标记）。

如果图片中包含多道题目，请全部解析。如果图片模糊或无法识别，返回 {"questions": [], "error": "图片不清晰或未识别到题目"}。

返回格式：
{
  "questions": [
    {
      "questionNumber": "题号（如图片中无题号，按 1、2、3 顺序编号）",
      "questionType": "题型：单选题|多选题|判断题|简答题|综合题|计算题",
      "questionStem": "题干完整内容",
      "options": { "A": "选项A", "B": "选项B", "C": "选项C", "D": "选项D" },
      "answer": "正确答案",
      "analysis": "详细解析，包含解题思路和步骤",
      "knowledgePoints": ["相关知识点1", "相关知识点2"],
      "commonMistakes": "易错点提示"
    }
  ]
}

注意：
1. options 字段仅适用于选择题，其他题型设为 null
2. answer 字段对判断题填写"正确"或"错误"
3. 解析要专业准确，有助于理解记忆
4. 知识点要具体，便于针对性复习`;

    const messages = [
      { role: 'system', content: subjectConfig.systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: userPrompt },
          {
            type: 'image_url',
            image_url: {
              url: image,
              detail: 'high'
            }
          }
        ]
      }
    ];

    // 流式调用 LLM（双模式：Coze SDK 或 OpenAI 兼容 API）
    let fullContent = '';
    for await (const text of streamLLM(messages, model, 0.3, req)) {
      fullContent += text;
      // 实时推送文本块
      res.write(`data: ${JSON.stringify({ type: 'chunk', content: text, index })}\n\n`);
    }

    // 发送完成事件
    res.write(`data: ${JSON.stringify({ type: 'complete', index, raw: fullContent })}\n\n`);
  } catch (error) {
    console.error('LLM analysis error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', index, message: error.message || '分析失败，请重试' })}\n\n`);
  } finally {
    res.end();
  }
});

/**
 * POST /api/analyze-text
 * 接收页面文本 + 学科，调用 LLM 分析题目，SSE 流式返回（用于悬浮工具的自动扫描功能）
 * Body: { text: "...", subject: "tax", index: 0, model?: "..." }
 */
app.post('/api/analyze-text', async (req, res) => {
  const { text, subject = 'accounting', index = 0, model } = req.body;

  if (!text) {
    return res.status(400).json({ error: '缺少文本数据' });
  }

  const subjectConfig = SUBJECTS[subject] || SUBJECTS.accounting;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'X-Accel-Buffering': 'no'
  });

  res.write(`data: ${JSON.stringify({ type: 'start', index, subject: subjectConfig.name })}\n\n`);

  try {
    const userPrompt = `请仔细分析以下网页文本中的考试题目，以纯 JSON 格式返回分析结果（不要包含 \`\`\`json 等标记）。

如果文本中包含多道题目，请全部解析。如果没有识别到题目，返回 {"questions": [], "error": "未识别到题目内容"}。

返回格式：
{
  "questions": [
    {
      "questionNumber": "题号（如文本中无题号，按 1、2、3 顺序编号）",
      "questionType": "题型：单选题|多选题|判断题|简答题|综合题|计算题",
      "questionStem": "题干完整内容",
      "options": { "A": "选项A", "B": "选项B", "C": "选项C", "D": "选项D" },
      "answer": "正确答案",
      "analysis": "详细解析，包含解题思路和步骤",
      "knowledgePoints": ["相关知识点1", "相关知识点2"],
      "commonMistakes": "易错点提示"
    }
  ]
}

注意：
1. options 字段仅适用于选择题，其他题型设为 null
2. answer 字段对判断题填写"正确"或"错误"
3. 解析要专业准确，有助于理解记忆
4. 知识点要具体，便于针对性复习

以下是网页中提取的题目文本：
---
${text}
---`;

    const messages = [
      { role: 'system', content: subjectConfig.systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    let fullContent = '';
    for await (const chunk of streamLLM(messages, model, 0.3, req)) {
      fullContent += chunk;
      res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk, index })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ type: 'complete', index, raw: fullContent })}\n\n`);
  } catch (error) {
    console.error('Text analysis error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', index, message: error.message || '分析失败，请重试' })}\n\n`);
  } finally {
    res.end();
  }
});

/**
 * GET /api/subjects - 获取学科列表
 */
app.get('/api/subjects', (req, res) => {
  const subjects = Object.entries(SUBJECTS).map(([key, val]) => ({
    key,
    name: val.name
  }));
  res.json({ subjects });
});

/**
 * GET /api/health - 健康检查
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// 启动服务
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[AI Question Bank] Server running on http://0.0.0.0:${PORT}`);
});
