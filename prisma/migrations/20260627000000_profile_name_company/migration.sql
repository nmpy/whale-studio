-- 初回登録の氏名（姓・名）/ 会社名を保存するため profiles に列を追加。
-- additive のみ（nullable ADD COLUMN ×3）。既存テーブル・データ・既存カラムは無変更。NOT NULL は付けない。

ALTER TABLE "profiles" ADD COLUMN "last_name" TEXT;
ALTER TABLE "profiles" ADD COLUMN "first_name" TEXT;
ALTER TABLE "profiles" ADD COLUMN "company_name" TEXT;
