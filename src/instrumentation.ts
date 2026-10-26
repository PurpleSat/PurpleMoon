// 🛡️ 安全加固 (S-05)：服务启动时检查 AUTH_SECRET，缺失则直接启动失败（fail-fast），
// 避免服务“看似正常运行”，却在第一次登录/鉴权时才抛错。
// 仅在服务运行时执行；`next build` 阶段不检查，因此不影响镜像构建。

export function register() {
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  if (process.env.NODE_ENV !== 'production') return;

  const secret = (process.env.AUTH_SECRET || '').trim();
  if (secret.length < 16) {
    throw new Error(
      '[PurpleMoon] 启动失败：未配置 AUTH_SECRET，或长度不足 16 字符（建议 32 字符以上）。' +
        '请设置环境变量，例如：AUTH_SECRET=$(openssl rand -hex 32)'
    );
  }
}
