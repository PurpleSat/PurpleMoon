/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig, withConfigConflictRetry } from '@/lib/config';
import { checkCsrf } from '@/lib/csrf-guard';
import { getStorage } from '@/lib/db';

export const runtime = 'edge';

const siteConfigSchema = z.object({
  SiteName: z.string().min(1, '站点名称不能为空').max(100, '站点名称过长'),
  Announcement: z.string().max(5000, '公告内容过长'),
  SearchDownstreamMaxPage: z.number().min(1, '页数不能小于1').max(100, '页数限制过大'),
  SiteInterfaceCacheTime: z.number().min(0, '缓存时间不能为负'),
  ImageProxy: z
    .string()
    .max(200, '代理地址过长')
    .refine((v) => v === '' || /^https?:\/\/[^\s<>"']+$/i.test(v), {
      message: '图片代理地址必须是合法的 http/https URL',
    })
    .optional()
    .or(z.literal('')),
}).passthrough();

async function parseSafeBody(request: NextRequest, maxSizeKB: number) {
  const text = await request.text();
  if (text.length > maxSizeKB * 1024) throw new Error('Payload Too Large');
  if (!text.trim()) throw new Error('Empty Body');
  return JSON.parse(text);
}

export async function POST(request: NextRequest) {
  const csrf = checkCsrf(request);
  if (!csrf.ok) return csrf.response!;

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json({ error: '不支持本地存储进行管理员配置' }, { status: 400 });
  }

  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = authInfo.username;

    const rawBody = await parseSafeBody(request, 50);

    const parsed = siteConfigSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const {
      SiteName,
      Announcement,
      SearchDownstreamMaxPage,
      SiteInterfaceCacheTime,
      ImageProxy,
    } = parsed.data;

    return await withConfigConflictRetry(async () => {
    const adminConfig = await getConfig();
    const storage = getStorage();

    // 权限校验
    if (username !== process.env.USERNAME) {
      const user = adminConfig.UserConfig.Users.find((u) => u.username === username);
      if (!user || user.role !== 'admin') {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
    }

    // 更新缓存中的站点设置
    adminConfig.SiteConfig = {
      SiteName,
      Announcement,
      SearchDownstreamMaxPage,
      SiteInterfaceCacheTime,
      ImageProxy: ImageProxy || '',
    };

    // 写入数据库
    if (storage && typeof (storage as any).setAdminConfig === 'function') {
      await (storage as any).setAdminConfig(adminConfig);
    }

    return NextResponse.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
    }); // 结束 withConfigConflictRetry 包裹的闭包
  } catch (error: any) {
    if (error.message === 'Payload Too Large') {
      return NextResponse.json({ error: '请求体过大' }, { status: 413 });
    }

    console.error('更新站点配置失败 (服务端日志):', error);
    
    return NextResponse.json(
      { 
        error: '更新站点配置失败，请联系站长检查服务端日志' 
      },
      { status: 500 }
    );
  }
}
