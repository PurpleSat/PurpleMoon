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
  return process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true';
}
