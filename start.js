#!/usr/bin/env node

/* eslint-disable no-console,@typescript-eslint/no-var-requires */
const http = require('http');
const path = require('path');

// 调用 generate-manifest.js 生成 manifest.json
function generateManifest() {
  console.log('Generating manifest.json for Docker deployment...');

  try {
    const generateManifestScript = path.join(
      __dirname,
      'scripts',
      'generate-manifest.js'
    );
    require(generateManifestScript);
  } catch (error) {
    console.error('❌ Error calling generate-manifest.js:', error);
    throw error;
  }
}

generateManifest();

// 直接在当前进程中启动 standalone Server（`server.js`）
require('./server.js');

// 容器内回环探测固定优先走 127.0.0.1，避免绑定 0.0.0.0 时部分环境回环探测异常
const POLL_HOST =
  !process.env.HOSTNAME || process.env.HOSTNAME === '0.0.0.0'
    ? '127.0.0.1'
    : process.env.HOSTNAME;
const POLL_PORT = process.env.PORT || 3000;
const TARGET_URL = `http://${POLL_HOST}:${POLL_PORT}/api/server-config`;

let serverReady = false;
let pollInFlight = false;

// 串行轮询直到服务就绪（避免并发重叠请求与超时销毁触发未捕获的 ECONNRESET 异常）
const intervalId = setInterval(() => {
  if (serverReady || pollInFlight) return;
  pollInFlight = true;

  const req = http.get(TARGET_URL, (res) => {
    // 消费响应流，释放底层套接字
    res.resume();
    pollInFlight = false;

    if (
      !serverReady &&
      res.statusCode &&
      res.statusCode >= 200 &&
      res.statusCode < 400
    ) {
      serverReady = true;
      clearInterval(intervalId);
      console.log('Server is up, stop polling.');

      // 服务器启动后，立即执行一次 cron 任务
      executeCronJob();

      // 然后设置每小时执行一次 cron 任务
      setInterval(() => {
        executeCronJob();
      }, 60 * 60 * 1000);
    }
  });

  req.on('error', () => {
    // 启动阶段服务尚未就绪或请求超时销毁属正常现象，静默忽略并等待下一轮探测
    pollInFlight = false;
  });

  req.setTimeout(8000, () => {
    req.destroy();
  });
}, 1000);

// 执行 cron 任务的函数
function executeCronJob() {
  const cronUrl = `http://${POLL_HOST}:${POLL_PORT}/api/cron`;

  console.log(`Executing cron job: ${cronUrl}`);

  // 🛡️ 安全修复 (SEC-06)：注入 Bearer 认证请求头，确保容器内定时刷新任务成功执行
  const options = {
    headers: {},
  };
  if (process.env.CRON_SECRET) {
    options.headers['Authorization'] = `Bearer ${process.env.CRON_SECRET}`;
  }

  const req = http.get(cronUrl, options, (res) => {
    let data = '';

    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        console.log('Cron job executed successfully:', data);
      } else {
        console.error('Cron job failed:', res.statusCode, data);
      }
    });
  });

  req.on('error', (err) => {
    console.error('Error executing cron job:', err);
  });

  req.setTimeout(30000, () => {
    console.error('Cron job timeout');
    req.destroy();
  });
}
