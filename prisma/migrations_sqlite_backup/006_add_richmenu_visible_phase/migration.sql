-- RichMenu に spreadsheet_richmenu_id と visible_phase を追加
ALTER TABLE "rich_menus" ADD COLUMN "spreadsheet_richmenu_id" TEXT;
ALTER TABLE "rich_menus" ADD COLUMN "visible_phase" TEXT;
CREATE INDEX "rich_menus_spreadsheet_richmenu_id_idx" ON "rich_menus"("spreadsheet_richmenu_id");
CREATE INDEX "rich_menus_visible_phase_idx" ON "rich_menus"("visible_phase");
