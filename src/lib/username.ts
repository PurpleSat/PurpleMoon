/**
 * 用户名唯一性（忽略大小写）。
 *
 * 数据库（SQLite / Redis 键）对用户名区分大小写，若只做精确比较，
 * 站长为 boss 时任何人都能注册 Boss / BOSS 并在便签板等共享区域冒充站长。
 * 新增账号（自助注册 / 后台新增）时用本函数与“站长用户名 + 现有全部用户”做不区分大小写比较。
 * 已存在的历史账号不受影响，登录仍按精确匹配。
 */
export function isUsernameTaken(
  candidate: string,
  existingUsernames: string[],
  ownerUsername?: string
): boolean {
  const c = candidate.toLowerCase();
  if (ownerUsername && ownerUsername.toLowerCase() === c) return true;
  return existingUsernames.some((u) => u.toLowerCase() === c);
}
