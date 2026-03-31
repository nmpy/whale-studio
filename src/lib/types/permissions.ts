/**
 * ロール・権限型定義
 * 将来 permission ベースに拡張する際はここに Permission 型を追加する
 */

export const ROLES = ['owner', 'editor', 'viewer'] as const;
export type Role = typeof ROLES[number];

/** ロール階層（数値が高いほど上位） */
export const ROLE_LEVELS: Record<Role, number> = {
  owner:  30,
  editor: 20,
  viewer: 10,
};

/** ロール名の日本語表示 */
export const ROLE_LABELS: Record<Role, string> = {
  owner:  'オーナー',
  editor: '編集者',
  viewer: '閲覧者',
};

/** ロール名の説明 */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner:  '全機能を利用できます。メンバー管理・削除も可能です',
  editor: '作品・メッセージ・謎など制作に必要な編集ができます',
  viewer: '閲覧のみ可能です。保存・編集・削除はできません',
};

/** 権限 */
export type Permission =
  // ワークスペース
  | 'workspace:read'
  | 'workspace:update'
  | 'workspace:delete'
  // メンバー管理
  | 'member:read'
  | 'member:manage'
  // OA
  | 'oa:read'
  | 'oa:create'
  | 'oa:update'      // 重要設定（channel_secret等）変更
  | 'oa:delete'
  // 作品
  | 'work:read'
  | 'work:create'
  | 'work:update'
  | 'work:delete'
  // メッセージ
  | 'message:read'
  | 'message:create'
  | 'message:update'
  | 'message:delete'
  // 謎
  | 'riddle:read'
  | 'riddle:create'
  | 'riddle:update'
  | 'riddle:delete'
  // キャラクター
  | 'character:read'
  | 'character:create'
  | 'character:update'
  | 'character:delete'
  // フェーズ
  | 'phase:read'
  | 'phase:create'
  | 'phase:update'
  | 'phase:delete'
  // 分析・ダッシュボード
  | 'analytics:read'
  // LINE 設定
  | 'line:apply';

/** 権限マトリクス — どのロールがどの権限を持つか */
export const PERMISSION_MATRIX: Record<Permission, Role[]> = {
  'workspace:read':    ['owner', 'editor', 'viewer'],
  'workspace:update':  ['owner'],
  'workspace:delete':  ['owner'],

  'member:read':       ['owner'],
  'member:manage':     ['owner'],

  'oa:read':           ['owner', 'editor', 'viewer'],
  'oa:create':         ['owner'],
  'oa:update':         ['owner'],
  'oa:delete':         ['owner'],

  'work:read':         ['owner', 'editor', 'viewer'],
  'work:create':       ['owner', 'editor'],
  'work:update':       ['owner', 'editor'],
  'work:delete':       ['owner'],

  'message:read':      ['owner', 'editor', 'viewer'],
  'message:create':    ['owner', 'editor'],
  'message:update':    ['owner', 'editor'],
  'message:delete':    ['owner'],

  'riddle:read':       ['owner', 'editor', 'viewer'],
  'riddle:create':     ['owner', 'editor'],
  'riddle:update':     ['owner', 'editor'],
  'riddle:delete':     ['owner'],

  'character:read':    ['owner', 'editor', 'viewer'],
  'character:create':  ['owner', 'editor'],
  'character:update':  ['owner', 'editor'],
  'character:delete':  ['owner'],

  'phase:read':        ['owner', 'editor', 'viewer'],
  'phase:create':      ['owner', 'editor'],
  'phase:update':      ['owner', 'editor'],
  'phase:delete':      ['owner'],

  'analytics:read':    ['owner', 'editor', 'viewer'],

  'line:apply':        ['owner', 'editor'],
};

/** ユーザーのロールが minRole 以上かチェック */
export function roleAtLeast(userRole: Role, minRole: Role): boolean {
  return ROLE_LEVELS[userRole] >= ROLE_LEVELS[minRole];
}

/** ユーザーが指定権限を持つかチェック */
export function hasPermission(role: Role, permission: Permission): boolean {
  return PERMISSION_MATRIX[permission].includes(role);
}

/** 値が有効な Role かチェック */
export function isValidRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
