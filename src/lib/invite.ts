/**
 * 是否强制邀请码注册。
 * 必须在服务端运行时读取环境变量（Docker 中 NEXT_PUBLIC_* 在构建时已被内联，
 * 客户端直接读取 process.env 会拿到构建时的值）。
 * 前端通过 layout 注入的 window.RUNTIME_CONFIG.REQUIRE_INVITE_CODE 获取结果。
 */
export function isInviteCodeRequired(): boolean {
  if (process.env.REQUIRE_INVITE_CODE !== undefined) {
    return process.env.REQUIRE_INVITE_CODE === 'true';
  }
  // 🛡️ 逻辑修复 (L-05)：只要配置了 VALID_INVITE_CODE，就视为要求邀请码。
  // 以前仅看 NEXT_PUBLIC_ENABLE_REGISTER：该变量没设为 true、而站长在后台打开了“开放注册”时，
  // 即使配置了邀请码，注册也不需要邀请码。想要“开放注册但不要邀请码”，请显式设置 REQUIRE_INVITE_CODE=false。
  if ((process.env.VALID_INVITE_CODE || '').trim() !== '') return true;
  return process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true';
}
