import { NextRequest, NextResponse } from 'next/server';

// 如果你的项目有封装好的 getUserConfig 和 saveUserConfig 方法，
// 这里直接导入复用。如果没有，我们直接使用 @upstash/redis 与 auth 校验。
import { Redis } from '@upstash/redis';
import { cookies } from 'next/headers';

// 从 cookie 获取用户验证信息
function getAuthInfo() {
  const cookieStore = cookies();
  const token = cookieStore.get('auth_token')?.value;
  if (!token) return null;
  try {
    const decoded = atob(token);
    const [username] = decoded.split(':');
    return username;
  } catch {
    return null;
  }
}

// 初始化 Redis，若未配置则报错
const getRedisClient = () => {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
};

export async function GET(req: NextRequest) {
  const username = getAuthInfo();
  if (!username) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const redis = getRedisClient();
  if (!redis) {
    return NextResponse.json({}, { status: 200 }); // 降级返回空
  }

  try {
    const data = await redis.get(`skipconfigs:${username}`);
    return NextResponse.json(data || {});
  } catch (err) {
    console.error('获取片头片尾配置失败:', err);
    return NextResponse.json({ error: '读取失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const username = getAuthInfo();
  if (!username) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const redis = getRedisClient();
  if (!redis) {
    return NextResponse.json({ error: '未配置数据库' }, { status: 500 });
  }

  try {
    const { key, config } = await req.json();
    if (!key || !config) {
      return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    }

    const currentData: any = (await redis.get(`skipconfigs:${username}`)) || {};
    currentData[key] = config;

    await redis.set(`skipconfigs:${username}`, currentData);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('保存片头片尾配置失败:', err);
    return NextResponse.json({ error: '保存失败' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const username = getAuthInfo();
  if (!username) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const redis = getRedisClient();
  if (!redis) {
    return NextResponse.json({ error: '未配置数据库' }, { status: 500 });
  }

  try {
    const key = req.nextUrl.searchParams.get('key');
    const currentData: any = (await redis.get(`skipconfigs:${username}`)) || {};

    if (key) {
      delete currentData[key];
      await redis.set(`skipconfigs:${username}`, currentData);
    } else {
      await redis.del(`skipconfigs:${username}`);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('删除片头片尾配置失败:', err);
    return NextResponse.json({ error: '删除失败' }, { status: 500 });
  }
}
