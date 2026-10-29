export class ConfigConflictError extends Error {
  constructor(message = '配置已被其他管理员修改，请重试') {
    super(message);
    this.name = 'ConfigConflictError';
  }
}

/** 底层存储在“原子建用户”时发现同名用户已存在（并发注册输掉的一方） */
export class UserExistsError extends Error {
  constructor(message = '用户已存在') {
    super(message);
    this.name = 'UserExistsError';
  }
}
