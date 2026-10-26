/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthUser } from '@/lib/auth-server';
import { getConfig } from '@/lib/config';
import { readLimitedJson } from '@/lib/cookies';
import { checkCsrf } from '@/lib/csrf-guard';
import { db } from '@/lib/db';
import { formatSourceNameForRole } from '@/lib/site-access';
import { rejectIfLocalStorageMode } from '@/lib/storage-mode';
import { parseFavorite, parseRecordKey } from '@/lib/validation';

export const runtime = 'edge';

const MAX_FAVORITES_PER_USER = 1000;

export async function GET(request: NextRequest) {
  const localModeReject = rejectIfLocalStorageMode();
  if (localModeReject) return localModeReject;

  try {
    const authUser = await getVerifiedAuthUser(request);
    if (!authUser || !authUser.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const config = authUser.config ?? (await getConfig());
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (key) {
      const parsedKey = parseRecordKey(key);
      if (!parsedKey) {
        return NextResponse.json(
          { error: 'Invalid key format' },
          { status: 400 }
        );
      }
      const fav = await db.getFavorite(authUser.username, parsedKey.source, parsedKey.id);
      if (!fav) {
        return NextResponse.json(null, { status: 200 });
      }
      return NextResponse.json(
        {
          ...fav,
          source_name: formatSourceNameForRole(
            config,
            authUser.username,
            authUser.role,
            parsedKey.source,
            fav.source_name
          ),
        },
        { status: 200 }
      );
    }

    const favorites = await db.getAllFavorites(authUser.username);
    const formatted = Object.fromEntries(
      Object.entries(favorites).map(([k, fav]) => {
        const parsed = parseRecordKey(k);
        const sourceKey = parsed ? parsed.source : k.split('+')[0];
        return [
          k,
          {
            ...fav,
            source_name: formatSourceNameForRole(
              config,
              authUser.username,
              authUser.role,
              sourceKey,
              fav.source_name
            ),
          },
        ];
      })
    );
    return NextResponse.json(formatted, { status: 200 });
  } catch (err) {
    console.error('获取收藏失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const localModeReject = rejectIfLocalStorageMode();
  if (localModeReject) return localModeReject;

  const csrf = checkCsrf(request);
  if (!csrf.ok) return csrf.response;

  try {
    const authUser = await getVerifiedAuthUser(request);
    if (!authUser || !authUser.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsedBody = await readLimitedJson(request, 32 * 1024);
    if (!parsedBody.ok) {
      return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status });
    }
    const { key, favorite } = (parsedBody.data || {}) as {
      key?: unknown;
      favorite?: unknown;
    };

    if (!key || !favorite) {
      return NextResponse.json(
        { error: 'Missing key or favorite' },
        { status: 400 }
      );
    }

    const parsedKey = parseRecordKey(key);
    if (!parsedKey) {
      return NextResponse.json(
        { error: 'Invalid key format' },
        { status: 400 }
      );
    }
    const parsedFav = parseFavorite(favorite);
    if (!parsedFav.ok) {
      return NextResponse.json({ error: parsedFav.error }, { status: 400 });
    }
    const { source, id } = parsedKey;
    const finalFavorite = parsedFav.data;

    // 落库时若能匹配到配置中的真实源名则写入标准源名，读取时再按当前角色动态脱敏或展示真实名
    const config = authUser.config ?? (await getConfig());
    const realSiteName = config?.SourceConfig?.find((s) => s.key === source)?.name;
    if (realSiteName) {
      finalFavorite.source_name = realSiteName;
    }

    if (!(await db.getFavorite(authUser.username, source, id))) {
      const existing = await db.getAllFavorites(authUser.username);
      if (Object.keys(existing).length >= MAX_FAVORITES_PER_USER) {
        return NextResponse.json(
          { error: `收藏已达上限（${MAX_FAVORITES_PER_USER} 条），请先清理` },
          { status: 400 }
        );
      }
    }

    await db.saveFavorite(authUser.username, source, id, finalFavorite);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('保存收藏失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const localModeReject = rejectIfLocalStorageMode();
  if (localModeReject) return localModeReject;

  const csrf = checkCsrf(request, { requireJsonContentType: false });
  if (!csrf.ok) return csrf.response;

  try {
    const authUser = await getVerifiedAuthUser(request);
    if (!authUser || !authUser.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const username = authUser.username;
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (key) {
      const parsedKey = parseRecordKey(key);
      if (!parsedKey) {
        return NextResponse.json(
          { error: 'Invalid key format' },
          { status: 400 }
        );
      }
      await db.deleteFavorite(username, parsedKey.source, parsedKey.id);
    } else {
      const all = await db.getAllFavorites(username);
      await Promise.all(
        Object.keys(all).map(async (k) => {
          const parsed = parseRecordKey(k);
          if (parsed) await db.deleteFavorite(username, parsed.source, parsed.id);
        })
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('删除收藏失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
