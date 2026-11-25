export const ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: '用户名或密码错误',
  account_disabled: '账号已被禁用，请联系管理员',
  too_many_attempts: '操作过于频繁，请稍后再试',
  missing_credentials: '请填写用户名和密码',
  weak_password: '密码至少 8 位',
  bad_username: '用户名只能是 3–32 位字母、数字或下划线',
  username_taken: '这个用户名已经被占用了',
  registration_closed: '这个实例当前没有开放注册',
  bad_invite_code: '邀请码不正确',
  anonymous_mode: '这个实例是匿名模式，不需要登录',
  wrong_password: '当前密码不正确',
  default_password: '不能把初始密码再设一遍',
  same_password: '新密码不能和当前密码相同',
  password_update_failed: '密码更新失败，请稍后重试',
  unauthenticated: '登录状态已失效，请重新登录',
  forbidden: '当前账号没有这个权限',
  user_not_found: '用户不存在',
  cannot_disable_self: '不能禁用自己',
  bad_app: '应用名不合法',
  bad_collection: '集合名不合法',
  bad_id: '记录 ID 不合法',
  bad_ops: '同步请求格式不正确',
  too_many_ops: '一次提交的变更太多，请减少后重试',
  bad_records: '备份文件格式不正确',
  too_many_records: '备份记录太多，无法导入',
  version_not_found: '找不到这个历史版本',
  payload_too_large: '提交的内容太大',
  invalid_json: '请求内容不是合法 JSON',
  not_found: '接口不存在',
  internal_error: '服务器出了点问题，请稍后再试',
};

export function messageOf(code: string): string {
  return ERROR_MESSAGES[code] || code;
}

export class ApiError extends Error {
  status: number;
  code: string;
  headers?: Record<string, string>;
  constructor(status: number, code: string, headers?: Record<string, string>) {
    super(code);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}
