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
  inputNote:        "ひらがな・カタカナ・漢字の違いは判定に影響しません。",
  submit:           "ヒントを探す",
  searching:        "検索中...",
  openedListLink:   "これまでに開いたヒントを見る",
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

  // ── ヒント一覧（開封済みのみ）──
  listTitle:        "ヒント一覧",
  listDescription:  "これまでに開いたヒントは、いつでも見返せます。",
  listSectionLabel: "開いたヒント",
  listCount:        (n: number) => `${n}件`,
  listNotice:       "まだ開いていないヒントは一覧に表示されません。キーワードを入力すると追加されます。",
  listEmpty:        "まだ開いたヒントはありません。キーワードを入力すると、開いたヒントがここに追加されます。",
  listSearchCta:    "キーワードを入力して探す",

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
  backToList:       "ヒント一覧へ戻る",
} as const;
