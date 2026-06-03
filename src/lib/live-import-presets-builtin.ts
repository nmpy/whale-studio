// src/lib/live-import-presets-builtin.ts
// Phase 2-H: チケットサイト別 built-in プリセット定数。
//
// 各チケットサイトの実 CSV 仕様を完全保証はしない。「よくある日本語列名」に対応する
// 雛形として提供し、ユーザーは Import wizard のプレビュー画面で必要に応じて
// 列マッピングを修正できる。
//
// mapping のキーは Live import の内部 field 名:
//   display_name / email / line_user_id / reservation_number /
//   __date (参加日) / __time (開始時間) / team_name / current_step / memo / status
// 値は CSV/Excel のヘッダー文字列 (= 完全一致 / 自動検出フォールバックは別途存在)。

export type LiveImportPresetTeamMode =
  | "by_reservation"
  | "by_4"
  | "by_team_name_column"
  | "none";

export type LiveImportPresetDuplicateMode = "skip" | "overwrite" | "duplicate";

export type LiveImportMapping = Partial<Record<
  | "display_name"
  | "email"
  | "line_user_id"
  | "reservation_number"
  | "__date"
  | "__time"
  | "team_name"
  | "current_step"
  | "memo"
  | "status",
  string
>>;

export type BuiltinPreset = {
  id:            string; // 安定 id (= UI 内 key)
  name:          string;
  description:   string;
  mapping:       LiveImportMapping;
  teamMode:      LiveImportPresetTeamMode;
  duplicateMode: LiveImportPresetDuplicateMode;
};

/// 各プリセットの mapping は「よくある列名」をベースにしている。
/// チケットサイトの実 CSV と完全一致するとは限らないため、適用後にプレビューで
/// 手動修正できる UI が必要。
export const BUILTIN_PRESETS: BuiltinPreset[] = [
  {
    id:          "generic-csv",
    name:        "汎用 CSV",
    description: "シンプルな日本語ヘッダー(氏名 / メール / 予約番号 等)。多くのチケットサイトの基本形。",
    mapping: {
      reservation_number: "予約番号",
      __date:             "参加日",
      __time:             "開始時間",
      team_name:          "チーム名",
      display_name:       "参加者名",
      email:              "メールアドレス",
      line_user_id:       "LINE ID",
      current_step:       "現在ステップ",
      memo:               "メモ",
    },
    teamMode:      "by_reservation",
    duplicateMode: "skip",
  },
  {
    id:          "reservation-csv",
    name:        "予約番号ありCSV",
    description: "予約番号+氏名+日時のみの最小構成。チームは予約番号ごとに自動化。",
    mapping: {
      reservation_number: "予約番号",
      __date:             "参加日",
      __time:             "開始時間",
      display_name:       "氏名",
      email:              "メールアドレス",
    },
    teamMode:      "by_reservation",
    duplicateMode: "skip",
  },
  {
    id:          "team-csv",
    name:        "チーム名ありCSV",
    description: "チーム名列を直接持つ CSV。チーム名列でチーム化。",
    mapping: {
      __date:       "参加日",
      __time:       "開始時間",
      team_name:    "チーム名",
      display_name: "参加者名",
      email:        "メールアドレス",
    },
    teamMode:      "by_team_name_column",
    duplicateMode: "skip",
  },
  {
    id:          "peatix",
    name:        "Peatix 風",
    description: "Peatix からダウンロードした参加者 CSV を想定。注文番号・氏名・メール等。",
    mapping: {
      reservation_number: "注文番号",
      display_name:       "氏名",
      email:              "メールアドレス",
      __date:             "開催日",
      __time:             "開始時間",
    },
    teamMode:      "by_reservation",
    duplicateMode: "skip",
  },
  {
    id:          "livepocket",
    name:        "LivePocket 風",
    description: "LivePocket の参加者リスト想定。受付番号 / 氏名 / 公演日。",
    mapping: {
      reservation_number: "受付番号",
      display_name:       "氏名",
      email:              "メールアドレス",
      __date:             "公演日",
      __time:             "開演時間",
    },
    teamMode:      "by_reservation",
    duplicateMode: "skip",
  },
  {
    id:          "passmarket",
    name:        "PassMarket 風",
    description: "Yahoo! PassMarket の購入者リスト想定。受注番号 / 購入者名 / 開催日。",
    mapping: {
      reservation_number: "受注番号",
      display_name:       "購入者名",
      email:              "メールアドレス",
      __date:             "開催日",
      __time:             "開始時刻",
    },
    teamMode:      "by_reservation",
    duplicateMode: "skip",
  },
  {
    id:          "teket",
    name:        "teket 風",
    description: "teket の購入者一覧想定。チケット番号 / 氏名 / 公演日。",
    mapping: {
      reservation_number: "チケット番号",
      display_name:       "氏名",
      email:              "メールアドレス",
      __date:             "公演日",
      __time:             "公演開始時間",
    },
    teamMode:      "by_reservation",
    duplicateMode: "skip",
  },
];
