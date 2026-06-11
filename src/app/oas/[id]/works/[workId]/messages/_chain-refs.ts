// src/app/oas/[id]/works/[workId]/messages/_chain-refs.ts
//
// メッセージ逆参照ロジックは client / server 共有のため src/lib/message-refs.ts に移動した（#6-4b）。
// 既存の編集画面 import 互換のため、ここから再エクスポートする。
export {
  findReferrers,
  findExternalReferrers,
  computeDeleteSet,
  refLabelOf,
  REFERRER_KIND_LABEL,
  type Referrer,
  type ReferrerKind,
  type RefMessage,
} from "@/lib/message-refs";
