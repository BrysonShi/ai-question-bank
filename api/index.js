// Vercel Serverless Function - 简化版测试
import express from 'express';

const app = express();

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.get('/', (req, res) => {
  res.send('AI Question Bank - Working!');
});

export default app;
