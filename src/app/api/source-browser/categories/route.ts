/* eslint-disable no-console,@typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import config from '@/../config.json';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sourceKey = searchParams.get('source');

    if (!sourceKey) {
      return NextResponse.json({ error: 'Missing source parameter' }, { status: 400 });
    }

    // ==========================================
    // 🛡️ 安全加固：验证 sourceKey 格式，防范原型链污染
    // ==========================================
    if (!/^[a-zA-Z0-9_-]+$/.test(sourceKey)) {
      return NextResponse.json({ error: 'Invalid source parameter' }, { status: 400 });
    }

    const apiSite = (config as any).api_site || {};

    // 使用 hasOwnProperty 确保安全读取配置，避免原型链注入风险
    if (!Object.prototype.hasOwnProperty.call(apiSite, sourceKey)) {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 });
    }

    const source = apiSite[sourceKey];

    if (!source || !source.api) {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 });
    }

    const res = await fetch(source.api, { next: { revalidate: 3600 } });
    if (!res.ok) throw new Error(`Failed to fetch from ${source.name || 'upstream'}`);

    const data = await res.json();
    const categories = data.class || [];

    return NextResponse.json({ categories });
  } catch (error: any) {
    console.error('source-browser/categories 接口异常:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
