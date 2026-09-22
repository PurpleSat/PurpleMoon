import { NextResponse } from 'next/server';
import config from '@/../config.json';

export const runtime = 'edge';

export async function GET() {
  try {
    const apiSite = (config as any).api_site || {};
    const sources = Object.entries(apiSite).map(([key, val]: [string, any]) => ({
      key,
      name: val.name || key,
      api: val.api,
    }));

    return NextResponse.json({ sources });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
