export class ConfigConflictError extends Error {
  constructor(message = '配置已被其他管理员修改，请重试') {
    super(message);
    this.name = 'ConfigConflictError';
  }
}
