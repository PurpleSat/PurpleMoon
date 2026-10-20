/** 分组 id（稳定标识，不随重命名变化）。旧版本固定分组的 id 为 'A' / 'B' */
export type UserGroup = string;

/** 一个用户分组：可自由命名，并自由选择可访问的资源站 */
export interface UserGroupDef {
  id: string;
  name: string;
  /** true：可访问全部已启用资源站（含以后新增的）；false：仅限 sourceKeys */
  allSources: boolean;
  sourceKeys: string[];
}

export interface AdminConfig {
  configVersion?: number;
  SiteConfig: {
    SiteName: string;
    Announcement: string;
    SearchDownstreamMaxPage: number;
    SiteInterfaceCacheTime: number;
    ImageProxy: string;
  };
  UserConfig: {
    AllowRegister: boolean;
    Users: {
      username: string;
      role: 'user' | 'admin' | 'owner';
      banned?: boolean;
      /** 所属分组 id。缺省 / 分组未启用时不受限制（兼容升级前的老用户）；站长不受分组限制 */
      group?: UserGroup;
      /** 管理员改密码或封禁时写入时间戳；签发时间早于该值的旧会话立即作废 */
      sessionsValidAfter?: number;
    }[];
  };
  /**
   * 分组配置。未配置（undefined）表示站长尚未启用分组：所有用户可访问全部已启用资源站。
   * 旧版（固定 A/B 两组）的格式为 DefaultRegisterGroup + GroupBSourceKeys，读取时自动迁移。
   */
  GroupConfig?: {
    Groups?: UserGroupDef[];
    /** 新注册 / 后台新增用户的默认分组 id */
    DefaultRegisterGroupId?: string;
    /** @deprecated 旧格式，仅用于迁移 */
    DefaultRegisterGroup?: 'A' | 'B';
    /** @deprecated 旧格式，仅用于迁移 */
    GroupBSourceKeys?: string[];
  };
  SourceConfig: {
    key: string;
    name: string;
    api: string;
    detail?: string;
    from: 'config' | 'custom';
    disabled?: boolean;
  }[];
}

export interface AdminConfigResult {
  Role: 'owner' | 'admin';
  Config: AdminConfig;
}
