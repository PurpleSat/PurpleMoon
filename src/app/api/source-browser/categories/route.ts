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

    const apiSite = (config as any).api_site || {};
    const source = apiSite[sourceKey];

    if (!source || !source.api) {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 });
    }

    const res = await fetch(source.api, { next: { revalidate: 3600 } });
    if (!res.ok) throw new Error(`Failed to fetch from ${source.name}`);

    const data = await res.json();
    const categories = data.class || [];

    return NextResponse.json({ categories });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
