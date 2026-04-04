/**
 * 権限管理の型定義とロール階層ユーティリティ
 *
 * ロール階層（高 → 低）:
 *   owner (40) > admin (30) > editor (20) > tester (10)
 *
 * - owner  : アカウント所有者。全操作可能。メンバー管理・OA 削除を含む。
 * - admin  : 管理者。コンテンツ編集・メンバー招待が可能。OA 削除は不可。
 * - editor : 編集者。シナリオ・メッセージ・キャラクターの CRUD が可能。
 * - tester : テスター。閲覧とプレビュー専用。書き込み不可。
 *
 * ⚠ 旧ロール 'viewer' は tester に統合されました（DB 互換のため roleAtLeast で吸収）。
 */

export const ROLES = ['owner', 'admin', 'editor', 'tester'] as const;
export type Role = typeof ROLES[number];

export type MemberStatus = 'active' | 'inactive' | 'suspended';

/** 内部ロールレベルマップ（数値が大きいほど強い権限） */
export const ROLE_LEVELS: Record<Role, number> = {
  owner:  40,
  admin:  30,
  editor: 20,
  tester: 10,
};

/** ロール名の日本語表示 */
export const ROLE_LABELS: Record<Role, string> = {
  owner:  'オーナー',
  admin:  '管理者',
  editor: '編集者',
  tester: 'テスター',
};

/** ロール名の説明（ユーザー向け、管理画面の招待フォームなどに表示） */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner:  'すべての機能が使えます。メンバーの招待・削除・ロール変更、OA 設定の変更も可能です',
  admin:  'コンテンツの作成・編集とメンバーの招待ができます。OA の削除はできません',
  editor: 'シナリオ・メッセージ・謎など、作品制作に必要な編集ができます',
  tester: 'シナリオや作品の閲覧・プレビューのみ可能です。編集・保存・削除はできません',
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
  | 'oa:update'
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
  'workspace:read':    ['owner', 'admin', 'editor', 'tester'],
  'workspace:update':  ['owner', 'admin'],
  'workspace:delete':  ['owner'],

  'member:read':       ['owner', 'admin'],
  'member:manage':     ['owner', 'admin'],

  'oa:read':           ['owner', 'admin', 'editor', 'tester'],
  'oa:create':         ['owner'],
  'oa:update':         ['owner', 'admin'],
  'oa:delete':         ['owner'],

  'work:read':         ['owner', 'admin', 'editor', 'tester'],
  'work:create':       ['owner', 'admin', 'editor'],
  'work:update':       ['owner', 'admin', 'editor'],
  'work:delete':       ['owner', 'admin'],

  'message:read':      ['owner', 'admin', 'editor', 'tester'],
  'message:create':    ['owner', 'admin', 'editor'],
  'message:update':    ['owner', 'admin', 'editor'],
  'message:delete':    ['owner', 'admin'],

  'riddle:read':       ['owner', 'admin', 'editor', 'tester'],
  'riddle:create':     ['owner', 'admin', 'editor'],
  'riddle:update':     ['owner', 'admin', 'editor'],
  'riddle:delete':     ['owner', 'admin'],

  'character:read':    ['owner', 'admin', 'editor', 'tester'],
  'character:create':  ['owner', 'admin', 'editor'],
  'character:update':  ['owner', 'admin', 'editor'],
  'character:delete':  ['owner', 'admin'],

  'phase:read':        ['owner', 'admin', 'editor', 'tester'],
  'phase:create':      ['owner', 'admin', 'editor'],
  'phase:update':      ['owner', 'admin', 'editor'],
  'phase:delete':      ['owner', 'admin'],

  'analytics:read':    ['owner', 'admin', 'editor', 'tester'],

  'line:apply':        ['owner', 'admin', 'editor'],
};

/**
 * ユーザーのロールが minRole 以上かチェックする。
 *
 * 旧ロール互換:
 *   'viewer' は tester (10) と同等に扱う（DB 残存データへの後方互換）。
 *
 * @example
 * roleAtLeast('admin', 'editor')  // true  (admin 30 >= editor 20)
 * roleAtLeast('tester', 'editor') // false (tester 10 < editor 20)
 */
export function roleAtLeast(userRole: string, minRole: Role): boolean {
  // 旧ロール 'viewer' → tester レベルとして扱う
  const normalized = userRole === 'viewer' ? 'tester' : userRole;
  const userLevel  = ROLE_LEVELS[normalized as Role] ?? 0;
  const minLevel   = ROLE_LEVELS[minRole];
  return userLevel >= minLevel;
}

/**
 * minRole 以上のすべてのロールを配列で返す。
 * requireRole / withRole の配列指定と組み合わせて使う。
 *
 * @example
 * rolesAtLeast('editor')  // ['editor', 'admin', 'owner']
 * rolesAtLeast('admin')   // ['admin', 'owner']
 * rolesAtLeast('owner')   // ['owner']
 */
export function rolesAtLeast(minRole: Role): Role[] {
  const minLevel = ROLE_LEVELS[minRole];
  return (Object.keys(ROLE_LEVELS) as Role[]).filter(
    (r) => ROLE_LEVELS[r] >= minLevel
  );
}

/** ユーザーが指定権限を持つかチェック */
export function hasPermission(role: Role, permission: Permission): boolean {
  return PERMISSION_MATRIX[permission].includes(role);
}

/** 値が有効な Role かチェック */
export function isValidRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
