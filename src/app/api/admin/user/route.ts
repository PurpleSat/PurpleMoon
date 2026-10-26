/* eslint-disable @typescript-eslint/no-explicit-any,no-console,@typescript-eslint/no-non-null-assertion */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getVerifiedAuthUser } from '@/lib/auth-server';
import { getConfig, withConfigConflictRetry } from '@/lib/config';
import { buildAuthCookieValue, readLimitedJson, setAuthCookies } from '@/lib/cookies';
import { checkCsrf } from '@/lib/csrf-guard';
import { getStorage } from '@/lib/db';
import { IStorage } from '@/lib/types';
import {
  adminMayCreateUserInDefaultGroup,
  adminMayTakeOverAccount,
  getDefaultRegisterGroup,
} from '@/lib/user-groups';
import { isUsernameTaken } from '@/lib/username';

export const runtime = 'edge';

const ACTIONS = [
  'add',
  'ban',
  'unban',
  'setAdmin',
  'cancelAdmin',
  'setAllowRegister',
  'changePassword',
  'deleteUser',
] as const;

// 🛡️ 安全验证规范 (SEC-07)：强制用户名与密码合法性
const usernameSchema = z
  .string()
  .trim()
  .min(3, '用户名不能少于3个字符')
  .max(32, '用户名不能超过32个字符')
  .regex(/^[a-zA-Z0-9_-]+$/, '用户名仅允许包含字母、数字、下划线及连字符');

const passwordSchema = z
  .string()
  .min(6, '密码长度不能少于6位')
  .max(100, '密码长度不能超过100位');

export async function POST(request: NextRequest) {
  const csrf = checkCsrf(request);
  if (!csrf.ok) return csrf.response!;

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地存储进行管理员配置',
      },
      { status: 400 }
    );
  }

  try {
    // 🛡️ 安全修复 (SEC-02, SEC-04, SEC-NEW-07)：强制管理员签名与实时角色重验
    const authUser = await getVerifiedAuthUser(request, { requiredRole: 'admin' });
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = authUser.username;

    const parsedBody = await readLimitedJson(request, 32 * 1024);
    if (!parsedBody.ok) {
      return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status });
    }
    const body = parsedBody.data;

    const {
      targetUsername,
      targetPassword,
      allowRegister,
      action,
    } = (body || {}) as {
      targetUsername?: string;
      targetPassword?: string;
      allowRegister?: boolean;
      action?: (typeof ACTIONS)[number];
    };

    if (!action || !ACTIONS.includes(action)) {
      return NextResponse.json({ error: '参数格式错误' }, { status: 400 });
    }

    if (action !== 'setAllowRegister' && !targetUsername) {
      return NextResponse.json({ error: '缺少目标用户名' }, { status: 400 });
    }

    if (action === 'add') {
      const uRes = usernameSchema.safeParse(targetUsername);
      if (!uRes.success) {
        return NextResponse.json({ error: uRes.error.issues[0].message }, { status: 400 });
      }
      const pRes = passwordSchema.safeParse(targetPassword);
      if (!pRes.success) {
        return NextResponse.json({ error: pRes.error.issues[0].message }, { status: 400 });
      }
    } else if (action === 'changePassword') {
      const pRes = passwordSchema.safeParse(targetPassword);
      if (!pRes.success) {
        return NextResponse.json({ error: pRes.error.issues[0].message }, { status: 400 });
      }
    }

    if (
      action !== 'setAllowRegister' &&
      action !== 'changePassword' &&
      action !== 'deleteUser' &&
      username === targetUsername
    ) {
      return NextResponse.json(
        { error: '无法对自己进行此操作' },
        { status: 400 }
      );
    }

    // 🛡️ 逻辑修复 (L-04 & LOG-01)：配置版本冲突会让下面的闭包重试。
    // 当第 1 次尝试已完成 storage.registerUser 但 setAdminConfig 冲突重试时，
    // 第 2 次重试里的 getConfig() 会通过 syncUsers 将刚写入底层表的用户合并进 Users 列表，
    // 因此判重必须在 !registeredInThisRequest 时才拦截，并在已注册时就地更新分组与角色。
    let registeredInThisRequest = false;

    return await withConfigConflictRetry(async () => {
      const adminConfig = await getConfig();
      const storage: IStorage | null = getStorage();

      let operatorRole: 'owner' | 'admin';
      if (username === process.env.USERNAME) {
        operatorRole = 'owner';
      } else {
        const userEntry = adminConfig.UserConfig.Users.find(
          (u) => u.username === username
        );
        if (!userEntry || userEntry.role !== 'admin') {
          return NextResponse.json({ error: '权限不足' }, { status: 401 });
        }
        operatorRole = 'admin';
      }

      let targetEntry = adminConfig.UserConfig.Users.find(
        (u) => u.username === targetUsername
      );

      if (
        targetEntry &&
        targetEntry.role === 'owner' &&
        action !== 'changePassword'
      ) {
        return NextResponse.json({ error: '无法操作站长' }, { status: 400 });
      }

      const isTargetAdmin = targetEntry?.role === 'admin';

      if (action === 'setAllowRegister') {
        if (typeof allowRegister !== 'boolean') {
          return NextResponse.json({ error: '参数格式错误' }, { status: 400 });
        }
        adminConfig.UserConfig.AllowRegister = allowRegister;
      } else {
        switch (action) {
          case 'add': {
            if (
              !registeredInThisRequest &&
              (targetEntry ||
                isUsernameTaken(
                  targetUsername!,
                  adminConfig.UserConfig.Users.map((u) => u.username),
                  process.env.USERNAME
                ))
            ) {
              return NextResponse.json({ error: '用户已存在' }, { status: 400 });
            }
            if (!targetPassword) {
              return NextResponse.json(
                { error: '缺少目标用户密码' },
                { status: 400 }
              );
            }
            if (!adminMayCreateUserInDefaultGroup(adminConfig, username)) {
              return NextResponse.json(
                {
                  error:
                    '默认注册分组的资源站权限高于你，仅站长可新增用户（或请站长调整默认注册分组）',
                },
                { status: 403 }
              );
            }
            if (!storage || typeof storage.registerUser !== 'function') {
              return NextResponse.json(
                { error: '存储未配置用户注册' },
                { status: 500 }
              );
            }
            if (!registeredInThisRequest) {
              await storage.registerUser(targetUsername!, targetPassword);
              registeredInThisRequest = true;
            }
            const defaultGroup = getDefaultRegisterGroup(adminConfig);
            if (targetEntry) {
              targetEntry.role = 'user';
              targetEntry.group = defaultGroup;
              targetEntry.banned = false;
              delete targetEntry.sessionsValidAfter;
            } else {
              adminConfig.UserConfig.Users.push({
                username: targetUsername!,
                role: 'user',
                group: defaultGroup,
              });
              targetEntry =
                adminConfig.UserConfig.Users[
                  adminConfig.UserConfig.Users.length - 1
                ];
            }
            break;
          }
          case 'ban': {
            if (!targetEntry) {
              return NextResponse.json(
                { error: '目标用户不存在' },
                { status: 404 }
              );
            }
            if (isTargetAdmin && operatorRole !== 'owner') {
              return NextResponse.json(
                { error: '仅站长可封禁管理员' },
                { status: 401 }
              );
            }
            if (!adminMayTakeOverAccount(adminConfig, username, targetUsername!)) {
              return NextResponse.json(
                { error: '该用户的资源站权限高于你，仅站长可操作该用户' },
                { status: 403 }
              );
            }
            targetEntry.banned = true;
            targetEntry.sessionsValidAfter = Date.now();
            break;
          }
          case 'unban': {
            if (!targetEntry) {
              return NextResponse.json(
                { error: '目标用户不存在' },
                { status: 404 }
              );
            }
            if (isTargetAdmin && operatorRole !== 'owner') {
              return NextResponse.json(
                { error: '仅站长可操作管理员' },
                { status: 401 }
              );
            }
            if (!adminMayTakeOverAccount(adminConfig, username, targetUsername!)) {
              return NextResponse.json(
                { error: '该用户的资源站权限高于你，仅站长可操作该用户' },
                { status: 403 }
              );
            }
            targetEntry.banned = false;
            break;
          }
          case 'setAdmin': {
            if (!targetEntry) {
              return NextResponse.json(
                { error: '目标用户不存在' },
                { status: 404 }
              );
            }
            if (targetEntry.role === 'admin') {
              return NextResponse.json(
                { error: '该用户已是管理员' },
                { status: 400 }
              );
            }
            if (operatorRole !== 'owner') {
              return NextResponse.json(
                { error: '仅站长可设置管理员' },
                { status: 401 }
              );
            }
            targetEntry.role = 'admin';
            break;
          }
          case 'cancelAdmin': {
            if (!targetEntry) {
              return NextResponse.json(
                { error: '目标用户不存在' },
                { status: 404 }
              );
            }
            if (targetEntry.role !== 'admin') {
              return NextResponse.json(
                { error: '目标用户不是管理员' },
                { status: 400 }
              );
            }
            if (operatorRole !== 'owner') {
              return NextResponse.json(
                { error: '仅站长可取消管理员' },
                { status: 401 }
              );
            }
            targetEntry.role = 'user';
            break;
          }
          case 'changePassword': {
            if (!targetEntry) {
              return NextResponse.json(
                { error: '目标用户不存在' },
                { status: 404 }
              );
            }
            if (!targetPassword) {
              return NextResponse.json({ error: '缺少新密码' }, { status: 400 });
            }

            if (targetEntry.role === 'owner') {
              return NextResponse.json(
                { error: '无法修改站长密码' },
                { status: 401 }
              );
            }

            if (
              isTargetAdmin &&
              operatorRole !== 'owner' &&
              username !== targetUsername
            ) {
              return NextResponse.json(
                { error: '仅站长可修改其他管理员密码' },
                { status: 401 }
              );
            }

            if (!adminMayTakeOverAccount(adminConfig, username, targetUsername!)) {
              return NextResponse.json(
                { error: '该用户的资源站权限高于你，仅站长可修改其密码' },
                { status: 403 }
              );
            }

            if (!storage || typeof storage.changePassword !== 'function') {
              return NextResponse.json(
                { error: '存储未配置密码修改功能' },
                { status: 500 }
              );
            }

            await storage.changePassword(targetUsername!, targetPassword);
            // 改密码后，该用户此前签发的所有旧会话立即作废
            targetEntry.sessionsValidAfter = Date.now();
            break;
          }
          case 'deleteUser': {
            if (!targetEntry) {
              return NextResponse.json(
                { error: '目标用户不存在' },
                { status: 404 }
              );
            }

            if (username === targetUsername) {
              return NextResponse.json(
                { error: '不能删除自己' },
                { status: 400 }
              );
            }

            if (isTargetAdmin && operatorRole !== 'owner') {
              return NextResponse.json(
                { error: '仅站长可删除管理员' },
                { status: 401 }
              );
            }

            if (!adminMayTakeOverAccount(adminConfig, username, targetUsername!)) {
              return NextResponse.json(
                { error: '该用户的资源站权限高于你，仅站长可删除该用户' },
                { status: 403 }
              );
            }

            if (!storage || typeof storage.deleteUser !== 'function') {
              return NextResponse.json(
                { error: '存储未配置用户删除功能' },
                { status: 500 }
              );
            }

            await storage.deleteUser(targetUsername!);

            const userIndex = adminConfig.UserConfig.Users.findIndex(
              (u) => u.username === targetUsername
            );
            if (userIndex > -1) {
              adminConfig.UserConfig.Users.splice(userIndex, 1);
            }

            break;
          }
          default:
            return NextResponse.json({ error: '未知操作' }, { status: 400 });
        }
      }

      if (storage && typeof (storage as any).setAdminConfig === 'function') {
        await (storage as any).setAdminConfig(adminConfig);
      }

      const response = NextResponse.json(
        { ok: true },
        {
          headers: {
            'Cache-Control': 'no-store',
          },
        }
      );

      // 若管理员修改的是自己的密码，同步为其当前会话轮换最新签名 Cookie，
      // 既踢下其它设备上的旧会话，又避免管理员当前浏览器在改密后被误踢下线
      if (action === 'changePassword' && username === targetUsername) {
        const freshCookie = await buildAuthCookieValue(username, operatorRole);
        setAuthCookies(response, request, freshCookie, username, operatorRole);
      }

      return response;
    });
  } catch (error) {
    console.error('用户管理操作失败:', error);
    return NextResponse.json(
      {
        error: '用户管理操作失败',
      },
      { status: 500 }
    );
  }
}
