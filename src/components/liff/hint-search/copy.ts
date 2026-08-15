// src/components/liff/hint-search/copy.ts
//
// 検索型ヒントページの固定文言。仕様・デザイン上で文面が決まっているものを 1 か所に集約する
// （renderer に散らすと表記ゆれが起きるため）。ページタイトル / 説明は CMS の
// LiffPageConfig.title / description が入っていればそちらを優先し、未設定時の既定として使う。

export const HINT_SEARCH_COPY = {
  // ── 初期画面 ──
  pageTitle:        "ヒントページ",
  pageDescription:  "お困りの内容にあてはまるキーワードをご入力ください。該当するヒントのみを表示します。",
  inputLabel:       "お困りの内容を入力してください",
  inputPlaceholder: "例：さがしているものの名前",
  // 検索の正規化が **実際に吸収する差分だけ** を書くこと。
  // normalizeHintSearchText = NFKC（全角英数→半角 / 半角カナ→全角カナ）+ 小文字化 + カタカナ→ひらがな。
  // 漢字と読み仮名（机 ↔ つくえ）は吸収しないので、ここに「漢字」と書いてはいけない。
  // 漢字表記と読み仮名の両方を当てたい場合は、CMS 側で keywords / aliases に両方登録して運用する。
  inputNote:        "ひらがな・カタカナ・全角・半角の違いは判定に影響しません。",
  submit:           "ヒントを探す",
  searching:        "検索中...",
  openedListLink:   "これまでに見たヒント",
  guideEntryLink:   "キーワードがわからない場合",

  // ── 0 件 ──
  emptyQueryError:  "キーワードを入力してください。",
  notFound:         "該当するヒントが見つかりませんでした。言葉を変えてお試しください。",
  failed:           "うまく取得できませんでした。通信状況をご確認のうえ、もう一度お試しください。",
  supportTitle:     "入力のヒント",
  supportItems: [
    "お探しのものの「名前」をそのままご入力ください",
    "見つけたい場所や人物名でも検索できます",
  ],
  retry:            "もう一度探す",

  // ── 1 件一致 ──
  confirmed:        "キーワードを確認しました",
  enteredLabel:     "入力した内容",

  // ── 複数件一致 ──
  multiHeading:     "該当するヒントが複数見つかりました",
  multiDescription: "お困りの内容に近いものを選択してください。",

  // ── 段階ヒント ──
  hintLevelLabel:   (level: number) => `ヒント${level}`,
  spoilerLabel:     "ネタバレ度",
  spoilerLow:       "低",
  spoilerMedium:    "中",
  spoilerHigh:      "高",
  revealNext:       "もう少し踏み込んだヒントを見る",
  revealLevel:      (level: number) => `ヒント${level}を表示する`,
  lockedHint:       (prev: number) => `ヒント${prev}を見たあとに開きます`,

  // ── 答え ──
  answerOpen:       "答えを見る（ネタバレを含みます）",
  answerCaution:    "この操作は取り消せません。体験の楽しみが減る場合があります。",
  answerConfirmTitle: "答えを表示します",
  answerConfirmBody:  "この先には、この場面の結論そのものが含まれます。ご自身で辿り着く楽しみが失われる可能性があります。",
  answerTargetLabel:  "対象の質問",
  answerAgree:        "ネタバレを含むことを理解しました",
  answerConfirm:      "答えを見る",
  answerCancel:       "やめておく",
  answerHeading:      "答え",

  // ── 見たヒント（開封済みのみ・ネタバレ警告なし）──
  //    ※「ヒント一覧」(= 全件) とは別機能。未開封のヒントは絶対に載せない。
  openedTitle:        "見たヒント",
  openedDescription:  "これまでに見たヒントは、いつでも見返せます。",
  openedSectionLabel: "開いたヒント",
  openedCount:        (n: number) => `${n}件`,
  openedNotice:       "まだ見ていないヒントはここに表示されません。キーワードを入力すると追加されます。",
  openedEmpty:        "まだ見たヒントはありません。キーワードを入力すると、見たヒントがここに追加されます。",
  openedSearchCta:    "キーワードを入力して探す",

  // ── 全ヒント一覧（ネタバレ警告に同意した後にだけ表示）──
  openAllListLink:  "ヒント一覧を見る",
  dialogTitle:      "ヒント一覧を表示しますか？",
  dialogBody:       "ヒント一覧には今後の展開に関する内容が含まれる可能性があります。ネタバレを含む情報を表示してもよろしいですか？",
  dialogCancel:     "戻る",
  dialogConfirm:    "それでも一覧を見る",
  allListTitle:     "ヒント一覧",
  allListNotice:    "このページには今後の展開に関する内容が含まれます。",
  allListEmpty:     "表示できるヒントがありません。",

  // ── 質問ツリー（キーワードがわからない場合）──
  guideEyebrow:     (step: number) => `ヒントページ ／ 質問${step}`,
  guideDescription: "お選びいただいた内容に応じて、必要な範囲だけをお伝えします。",
  guideNotice:      "選ばなかった話題の内容は表示されません。安心してお進みください。",
  guideEmpty:       "選択肢が登録されていません。キーワードを入力してお探しください。",
  guideBackStep:    "ひとつ前に戻る",
  guideBackRoot:    "最初の質問に戻る",

  // ── 戻り導線 ──
  backToSearch:     "キーワード入力に戻る",
  searchAgain:      "別のキーワードで探す",
  backToResults:    "検索結果に戻る",
  backToOpened:     "見たヒントへ戻る",
  backToAllList:    "ヒント一覧へ戻る",
} as const;
