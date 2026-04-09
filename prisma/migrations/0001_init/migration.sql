-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('owner', 'admin', 'editor', 'tester', 'viewer');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('active', 'inactive', 'suspended');

-- CreateTable
CREATE TABLE "oas" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "channel_id" TEXT NOT NULL,
    "channel_secret" TEXT NOT NULL,
    "channel_access_token" TEXT NOT NULL,
    "publish_status" TEXT NOT NULL DEFAULT 'draft',
    "rich_menu_id" TEXT,
    "spreadsheet_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "line_oa_id" TEXT,

    CONSTRAINT "oas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "works" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "publish_status" TEXT NOT NULL DEFAULT 'draft',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "system_character_id" TEXT,
    "welcome_message" TEXT,
    "read_receipt_mode" TEXT,
    "read_delay_ms" INTEGER,
    "typing_enabled" BOOLEAN,
    "typing_min_ms" INTEGER,
    "typing_max_ms" INTEGER,
    "loading_enabled" BOOLEAN,
    "loading_threshold_ms" INTEGER,
    "loading_min_seconds" INTEGER,
    "loading_max_seconds" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "works_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "characters" (
    "id" TEXT NOT NULL,
    "work_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon_type" TEXT NOT NULL DEFAULT 'text',
    "icon_text" TEXT,
    "icon_image_url" TEXT,
    "icon_color" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "characters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phases" (
    "id" TEXT NOT NULL,
    "work_id" TEXT NOT NULL,
    "phase_type" TEXT NOT NULL DEFAULT 'normal',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "start_trigger" TEXT,
    "resume_summary" TEXT,

    CONSTRAINT "phases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transitions" (
    "id" TEXT NOT NULL,
    "work_id" TEXT NOT NULL,
    "from_phase_id" TEXT NOT NULL,
    "to_phase_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "condition" TEXT,
    "flag_condition" TEXT,
    "set_flags" TEXT NOT NULL DEFAULT '{}',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_progress" (
    "id" TEXT NOT NULL,
    "line_user_id" TEXT NOT NULL,
    "work_id" TEXT NOT NULL,
    "current_phase_id" TEXT,
    "reached_ending" BOOLEAN NOT NULL DEFAULT false,
    "flags" TEXT NOT NULL DEFAULT '{}',
    "last_interacted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_preview" BOOLEAN NOT NULL DEFAULT false,
    "preview_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "work_id" TEXT NOT NULL,
    "phase_id" TEXT,
    "character_id" TEXT,
    "message_type" TEXT NOT NULL DEFAULT 'text',
    "body" TEXT,
    "asset_url" TEXT,
    "trigger_keyword" TEXT,
    "target_segment" TEXT,
    "notify_text" TEXT,
    "riddle_id" TEXT,
    "quick_replies" TEXT,
    "alt_text" TEXT,
    "flex_payload_json" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'normal',
    "answer" TEXT,
    "answer_match_type" TEXT NOT NULL DEFAULT '["exact"]',
    "correct_action" TEXT,
    "correct_next_phase_id" TEXT,
    "correct_text" TEXT,
    "incorrect_text" TEXT,
    "puzzle_hint_text" TEXT,
    "puzzle_type" TEXT,
    "next_message_id" TEXT,
    "incorrect_quick_replies" TEXT,
    "lag_ms" INTEGER NOT NULL DEFAULT 0,
    "hint_mode" TEXT NOT NULL DEFAULT 'always',
    "read_receipt_mode" TEXT,
    "read_delay_ms" INTEGER,
    "typing_enabled" BOOLEAN,
    "typing_min_ms" INTEGER,
    "typing_max_ms" INTEGER,
    "loading_enabled" BOOLEAN,
    "loading_threshold_ms" INTEGER,
    "loading_min_seconds" INTEGER,
    "loading_max_seconds" INTEGER,
    "tap_destination_id" TEXT,
    "tap_url" TEXT,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "friend_add_settings" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "campaign_name" TEXT,
    "add_url" TEXT NOT NULL,
    "qr_code_url" TEXT,
    "share_image_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "friend_add_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sns_posts" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "image_url" TEXT,
    "target_url" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sns_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rich_menus" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "chat_bar_text" TEXT NOT NULL DEFAULT 'メニュー',
    "size" TEXT NOT NULL DEFAULT 'compact',
    "image_url" TEXT,
    "line_rich_menu_id" TEXT,
    "spreadsheet_richmenu_id" TEXT,
    "visible_phase" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rich_menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rich_menu_areas" (
    "id" TEXT NOT NULL,
    "rich_menu_id" TEXT NOT NULL,
    "x" INTEGER NOT NULL DEFAULT 0,
    "y" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER NOT NULL DEFAULT 833,
    "height" INTEGER NOT NULL DEFAULT 843,
    "action_type" TEXT NOT NULL DEFAULT 'message',
    "action_label" TEXT NOT NULL DEFAULT '',
    "action_text" TEXT,
    "action_data" TEXT,
    "action_uri" TEXT,
    "destination_id" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rich_menu_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "riddles" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "question_type" TEXT NOT NULL DEFAULT 'text',
    "question_text" TEXT,
    "question_image_url" TEXT,
    "question_video_url" TEXT,
    "question_carousel" TEXT,
    "answer_text" TEXT NOT NULL,
    "match_condition" TEXT NOT NULL DEFAULT 'exact',
    "correct_message" TEXT NOT NULL,
    "wrong_message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "hints" TEXT NOT NULL DEFAULT '[]',
    "character_id" TEXT,
    "target_segment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "work_id" TEXT,

    CONSTRAINT "riddles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segments" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filter_type" TEXT NOT NULL DEFAULT 'friend_7d',
    "phase_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trackings" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tracking_id" TEXT NOT NULL,
    "target_url" TEXT NOT NULL,
    "utm_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trackings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracking_events" (
    "id" TEXT NOT NULL,
    "tracking_id" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "referer" TEXT,
    "clicked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracking_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_trackings" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "line_user_id" TEXT NOT NULL,
    "tracking_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_trackings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_members" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "invited_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "email" TEXT,
    "invited_at" TIMESTAMP(3),
    "joined_at" TIMESTAMP(3),
    "status" "MemberStatus" NOT NULL DEFAULT 'active',
    "role" "MemberRole" NOT NULL DEFAULT 'viewer',

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'editor',
    "token" TEXT NOT NULL,
    "invited_by" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "global_commands" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "payload" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "global_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hint_logs" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "work_id" TEXT NOT NULL,
    "phase_id" TEXT,
    "riddle_id" TEXT NOT NULL,
    "line_user_id" TEXT NOT NULL,
    "hint_step" INTEGER NOT NULL,
    "event_type" TEXT NOT NULL,
    "action_type" TEXT,
    "action_value" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hint_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_announcements" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'info',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "important" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_documents" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "file_url" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_size" INTEGER,
    "mime_type" TEXT NOT NULL DEFAULT 'application/pdf',
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_logs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resource_id" TEXT,
    "detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_activity_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "email" TEXT,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_events" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "work_id" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_progress" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "work_id" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "first_achieved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_events" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_event_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "oa_id" TEXT,
    "work_id" TEXT,
    "event" TEXT NOT NULL,
    "source" TEXT,
    "from_plan" TEXT,
    "to_plan" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_event_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "oa_id" TEXT,
    "event_name" TEXT NOT NULL,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "max_works" INTEGER NOT NULL DEFAULT 1,
    "max_players" INTEGER NOT NULL DEFAULT -1,
    "price_monthly" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'trialing',
    "current_period_start" TIMESTAMP(3) NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "canceled_at" TIMESTAMP(3),
    "external_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_destinations" (
    "id" TEXT NOT NULL,
    "work_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "destination_type" TEXT NOT NULL,
    "liff_target_type" TEXT,
    "url_or_path" TEXT,
    "query_params_json" JSONB NOT NULL DEFAULT '{}',
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "line_destinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "work_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "beacon_uuid" TEXT,
    "beacon_major" INTEGER,
    "beacon_minor" INTEGER,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "radius_meters" INTEGER,
    "gps_enabled" BOOLEAN NOT NULL DEFAULT false,
    "checkin_mode" TEXT NOT NULL DEFAULT 'qr_only',
    "cooldown_seconds" INTEGER NOT NULL DEFAULT 300,
    "transition_id" TEXT,
    "set_flags" TEXT NOT NULL DEFAULT '{}',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "stamp_enabled" BOOLEAN NOT NULL DEFAULT true,
    "stamp_label" TEXT,
    "stamp_order" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_visits" (
    "id" TEXT NOT NULL,
    "line_user_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "work_id" TEXT NOT NULL,
    "checkin_method" TEXT NOT NULL DEFAULT 'qr',
    "distance_meters" DOUBLE PRECISION,
    "visited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "location_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkin_attempts" (
    "id" TEXT NOT NULL,
    "work_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "line_user_id" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'gps',
    "status" TEXT NOT NULL,
    "failure_reason" TEXT,
    "distance_meters" DOUBLE PRECISION,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkin_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liff_page_configs" (
    "id" TEXT NOT NULL,
    "work_id" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "liff_page_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liff_page_blocks" (
    "id" TEXT NOT NULL,
    "page_config_id" TEXT NOT NULL,
    "block_type" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "title" TEXT,
    "settings_json" JSONB NOT NULL DEFAULT '{}',
    "visibility_condition_json" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "liff_page_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "oas_line_oa_id_key" ON "oas"("line_oa_id");

-- CreateIndex
CREATE INDEX "oas_title_idx" ON "oas"("title");

-- CreateIndex
CREATE INDEX "oas_publish_status_idx" ON "oas"("publish_status");

-- CreateIndex
CREATE INDEX "oas_created_at_idx" ON "oas"("created_at");

-- CreateIndex
CREATE INDEX "works_oa_id_idx" ON "works"("oa_id");

-- CreateIndex
CREATE INDEX "works_publish_status_idx" ON "works"("publish_status");

-- CreateIndex
CREATE INDEX "works_sort_order_idx" ON "works"("sort_order");

-- CreateIndex
CREATE INDEX "characters_work_id_idx" ON "characters"("work_id");

-- CreateIndex
CREATE INDEX "characters_name_idx" ON "characters"("name");

-- CreateIndex
CREATE INDEX "characters_sort_order_idx" ON "characters"("sort_order");

-- CreateIndex
CREATE INDEX "characters_is_active_idx" ON "characters"("is_active");

-- CreateIndex
CREATE INDEX "phases_work_id_idx" ON "phases"("work_id");

-- CreateIndex
CREATE INDEX "phases_phase_type_idx" ON "phases"("phase_type");

-- CreateIndex
CREATE INDEX "phases_name_idx" ON "phases"("name");

-- CreateIndex
CREATE INDEX "phases_sort_order_idx" ON "phases"("sort_order");

-- CreateIndex
CREATE INDEX "phases_is_active_idx" ON "phases"("is_active");

-- CreateIndex
CREATE INDEX "transitions_work_id_idx" ON "transitions"("work_id");

-- CreateIndex
CREATE INDEX "transitions_from_phase_id_idx" ON "transitions"("from_phase_id");

-- CreateIndex
CREATE INDEX "transitions_to_phase_id_idx" ON "transitions"("to_phase_id");

-- CreateIndex
CREATE INDEX "user_progress_line_user_id_idx" ON "user_progress"("line_user_id");

-- CreateIndex
CREATE INDEX "user_progress_work_id_idx" ON "user_progress"("work_id");

-- CreateIndex
CREATE INDEX "user_progress_last_interacted_at_idx" ON "user_progress"("last_interacted_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_progress_line_user_id_work_id_key" ON "user_progress"("line_user_id", "work_id");

-- CreateIndex
CREATE INDEX "messages_work_id_idx" ON "messages"("work_id");

-- CreateIndex
CREATE INDEX "messages_phase_id_idx" ON "messages"("phase_id");

-- CreateIndex
CREATE INDEX "messages_character_id_idx" ON "messages"("character_id");

-- CreateIndex
CREATE INDEX "messages_message_type_idx" ON "messages"("message_type");

-- CreateIndex
CREATE INDEX "messages_sort_order_idx" ON "messages"("sort_order");

-- CreateIndex
CREATE INDEX "messages_is_active_idx" ON "messages"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "friend_add_settings_oa_id_key" ON "friend_add_settings"("oa_id");

-- CreateIndex
CREATE INDEX "sns_posts_oa_id_idx" ON "sns_posts"("oa_id");

-- CreateIndex
CREATE INDEX "sns_posts_order_idx" ON "sns_posts"("order");

-- CreateIndex
CREATE INDEX "rich_menus_oa_id_idx" ON "rich_menus"("oa_id");

-- CreateIndex
CREATE INDEX "rich_menus_is_active_idx" ON "rich_menus"("is_active");

-- CreateIndex
CREATE INDEX "rich_menus_spreadsheet_richmenu_id_idx" ON "rich_menus"("spreadsheet_richmenu_id");

-- CreateIndex
CREATE INDEX "rich_menus_visible_phase_idx" ON "rich_menus"("visible_phase");

-- CreateIndex
CREATE INDEX "rich_menu_areas_rich_menu_id_idx" ON "rich_menu_areas"("rich_menu_id");

-- CreateIndex
CREATE INDEX "rich_menu_areas_sort_order_idx" ON "rich_menu_areas"("sort_order");

-- CreateIndex
CREATE INDEX "riddles_oa_id_idx" ON "riddles"("oa_id");

-- CreateIndex
CREATE INDEX "riddles_work_id_idx" ON "riddles"("work_id");

-- CreateIndex
CREATE INDEX "riddles_status_idx" ON "riddles"("status");

-- CreateIndex
CREATE INDEX "riddles_created_at_idx" ON "riddles"("created_at");

-- CreateIndex
CREATE INDEX "segments_oa_id_idx" ON "segments"("oa_id");

-- CreateIndex
CREATE INDEX "segments_status_idx" ON "segments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "trackings_tracking_id_key" ON "trackings"("tracking_id");

-- CreateIndex
CREATE INDEX "trackings_oa_id_idx" ON "trackings"("oa_id");

-- CreateIndex
CREATE INDEX "tracking_events_tracking_id_idx" ON "tracking_events"("tracking_id");

-- CreateIndex
CREATE INDEX "tracking_events_clicked_at_idx" ON "tracking_events"("clicked_at");

-- CreateIndex
CREATE INDEX "user_trackings_tracking_id_idx" ON "user_trackings"("tracking_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_trackings_oa_id_line_user_id_key" ON "user_trackings"("oa_id", "line_user_id");

-- CreateIndex
CREATE INDEX "workspace_members_workspace_id_idx" ON "workspace_members"("workspace_id");

-- CreateIndex
CREATE INDEX "workspace_members_user_id_idx" ON "workspace_members"("user_id");

-- CreateIndex
CREATE INDEX "workspace_members_role_idx" ON "workspace_members"("role");

-- CreateIndex
CREATE INDEX "workspace_members_status_idx" ON "workspace_members"("status");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_workspace_id_user_id_key" ON "workspace_members"("workspace_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_key" ON "invitations"("token");

-- CreateIndex
CREATE INDEX "invitations_oa_id_idx" ON "invitations"("oa_id");

-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "invitations"("email");

-- CreateIndex
CREATE INDEX "invitations_token_idx" ON "invitations"("token");

-- CreateIndex
CREATE INDEX "invitations_expires_at_idx" ON "invitations"("expires_at");

-- CreateIndex
CREATE INDEX "global_commands_oa_id_idx" ON "global_commands"("oa_id");

-- CreateIndex
CREATE INDEX "global_commands_action_type_idx" ON "global_commands"("action_type");

-- CreateIndex
CREATE INDEX "hint_logs_oa_id_idx" ON "hint_logs"("oa_id");

-- CreateIndex
CREATE INDEX "hint_logs_work_id_idx" ON "hint_logs"("work_id");

-- CreateIndex
CREATE INDEX "hint_logs_riddle_id_idx" ON "hint_logs"("riddle_id");

-- CreateIndex
CREATE INDEX "hint_logs_line_user_id_idx" ON "hint_logs"("line_user_id");

-- CreateIndex
CREATE INDEX "admin_announcements_published_at_idx" ON "admin_announcements"("published_at");

-- CreateIndex
CREATE INDEX "admin_announcements_important_idx" ON "admin_announcements"("important");

-- CreateIndex
CREATE INDEX "admin_announcements_sort_order_idx" ON "admin_announcements"("sort_order");

-- CreateIndex
CREATE INDEX "admin_documents_is_published_idx" ON "admin_documents"("is_published");

-- CreateIndex
CREATE INDEX "admin_documents_sort_order_idx" ON "admin_documents"("sort_order");

-- CreateIndex
CREATE INDEX "admin_audit_logs_actor_id_idx" ON "admin_audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "admin_audit_logs_resource_idx" ON "admin_audit_logs"("resource");

-- CreateIndex
CREATE INDEX "admin_audit_logs_created_at_idx" ON "admin_audit_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "app_activity_logs_user_id_key" ON "app_activity_logs"("user_id");

-- CreateIndex
CREATE INDEX "app_activity_logs_last_seen_at_idx" ON "app_activity_logs"("last_seen_at");

-- CreateIndex
CREATE INDEX "onboarding_events_oa_id_idx" ON "onboarding_events"("oa_id");

-- CreateIndex
CREATE INDEX "onboarding_events_work_id_idx" ON "onboarding_events"("work_id");

-- CreateIndex
CREATE INDEX "onboarding_events_created_at_idx" ON "onboarding_events"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_events_work_id_step_key" ON "onboarding_events"("work_id", "step");

-- CreateIndex
CREATE INDEX "onboarding_progress_user_id_work_id_idx" ON "onboarding_progress"("user_id", "work_id");

-- CreateIndex
CREATE INDEX "onboarding_progress_step_idx" ON "onboarding_progress"("step");

-- CreateIndex
CREATE INDEX "onboarding_progress_work_id_idx" ON "onboarding_progress"("work_id");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_progress_user_id_work_id_step_key" ON "onboarding_progress"("user_id", "work_id", "step");

-- CreateIndex
CREATE INDEX "billing_events_event_idx" ON "billing_events"("event");

-- CreateIndex
CREATE INDEX "billing_events_user_id_idx" ON "billing_events"("user_id");

-- CreateIndex
CREATE INDEX "billing_events_created_at_idx" ON "billing_events"("created_at");

-- CreateIndex
CREATE INDEX "billing_event_logs_event_idx" ON "billing_event_logs"("event");

-- CreateIndex
CREATE INDEX "billing_event_logs_user_id_idx" ON "billing_event_logs"("user_id");

-- CreateIndex
CREATE INDEX "billing_event_logs_created_at_idx" ON "billing_event_logs"("created_at");

-- CreateIndex
CREATE INDEX "event_logs_user_id_idx" ON "event_logs"("user_id");

-- CreateIndex
CREATE INDEX "event_logs_event_name_idx" ON "event_logs"("event_name");

-- CreateIndex
CREATE INDEX "event_logs_oa_id_idx" ON "event_logs"("oa_id");

-- CreateIndex
CREATE INDEX "event_logs_created_at_idx" ON "event_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "plans_name_key" ON "plans"("name");

-- CreateIndex
CREATE INDEX "plans_name_idx" ON "plans"("name");

-- CreateIndex
CREATE INDEX "plans_is_active_idx" ON "plans"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_oa_id_key" ON "subscriptions"("oa_id");

-- CreateIndex
CREATE INDEX "subscriptions_plan_id_idx" ON "subscriptions"("plan_id");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

-- CreateIndex
CREATE INDEX "subscriptions_current_period_end_idx" ON "subscriptions"("current_period_end");

-- CreateIndex
CREATE INDEX "line_destinations_work_id_idx" ON "line_destinations"("work_id");

-- CreateIndex
CREATE INDEX "line_destinations_destination_type_idx" ON "line_destinations"("destination_type");

-- CreateIndex
CREATE INDEX "line_destinations_is_enabled_idx" ON "line_destinations"("is_enabled");

-- CreateIndex
CREATE UNIQUE INDEX "line_destinations_work_id_key_key" ON "line_destinations"("work_id", "key");

-- CreateIndex
CREATE INDEX "locations_work_id_idx" ON "locations"("work_id");

-- CreateIndex
CREATE INDEX "locations_beacon_uuid_beacon_major_beacon_minor_idx" ON "locations"("beacon_uuid", "beacon_major", "beacon_minor");

-- CreateIndex
CREATE INDEX "locations_is_active_idx" ON "locations"("is_active");

-- CreateIndex
CREATE INDEX "location_visits_line_user_id_location_id_idx" ON "location_visits"("line_user_id", "location_id");

-- CreateIndex
CREATE INDEX "location_visits_work_id_idx" ON "location_visits"("work_id");

-- CreateIndex
CREATE INDEX "location_visits_visited_at_idx" ON "location_visits"("visited_at");

-- CreateIndex
CREATE INDEX "checkin_attempts_work_id_location_id_line_user_id_status_cr_idx" ON "checkin_attempts"("work_id", "location_id", "line_user_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "checkin_attempts_created_at_idx" ON "checkin_attempts"("created_at");

-- CreateIndex
CREATE INDEX "checkin_attempts_work_id_status_idx" ON "checkin_attempts"("work_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "liff_page_configs_work_id_key" ON "liff_page_configs"("work_id");

-- CreateIndex
CREATE INDEX "liff_page_blocks_page_config_id_idx" ON "liff_page_blocks"("page_config_id");

-- CreateIndex
CREATE INDEX "liff_page_blocks_sort_order_idx" ON "liff_page_blocks"("sort_order");

-- CreateIndex
CREATE INDEX "liff_page_blocks_block_type_idx" ON "liff_page_blocks"("block_type");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_user_id_key" ON "profiles"("user_id");

-- AddForeignKey
ALTER TABLE "works" ADD CONSTRAINT "works_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "works" ADD CONSTRAINT "works_system_character_id_fkey" FOREIGN KEY ("system_character_id") REFERENCES "characters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phases" ADD CONSTRAINT "phases_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transitions" ADD CONSTRAINT "transitions_from_phase_id_fkey" FOREIGN KEY ("from_phase_id") REFERENCES "phases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transitions" ADD CONSTRAINT "transitions_to_phase_id_fkey" FOREIGN KEY ("to_phase_id") REFERENCES "phases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transitions" ADD CONSTRAINT "transitions_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_progress" ADD CONSTRAINT "user_progress_current_phase_id_fkey" FOREIGN KEY ("current_phase_id") REFERENCES "phases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_progress" ADD CONSTRAINT "user_progress_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_tap_destination_id_fkey" FOREIGN KEY ("tap_destination_id") REFERENCES "line_destinations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_correct_next_phase_id_fkey" FOREIGN KEY ("correct_next_phase_id") REFERENCES "phases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_next_message_id_fkey" FOREIGN KEY ("next_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_phase_id_fkey" FOREIGN KEY ("phase_id") REFERENCES "phases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friend_add_settings" ADD CONSTRAINT "friend_add_settings_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sns_posts" ADD CONSTRAINT "sns_posts_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rich_menus" ADD CONSTRAINT "rich_menus_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rich_menu_areas" ADD CONSTRAINT "rich_menu_areas_rich_menu_id_fkey" FOREIGN KEY ("rich_menu_id") REFERENCES "rich_menus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rich_menu_areas" ADD CONSTRAINT "rich_menu_areas_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "line_destinations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riddles" ADD CONSTRAINT "riddles_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riddles" ADD CONSTRAINT "riddles_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segments" ADD CONSTRAINT "segments_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trackings" ADD CONSTRAINT "trackings_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_tracking_id_fkey" FOREIGN KEY ("tracking_id") REFERENCES "trackings"("tracking_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_trackings" ADD CONSTRAINT "user_trackings_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_trackings" ADD CONSTRAINT "user_trackings_tracking_id_fkey" FOREIGN KEY ("tracking_id") REFERENCES "trackings"("tracking_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_commands" ADD CONSTRAINT "global_commands_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hint_logs" ADD CONSTRAINT "hint_logs_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hint_logs" ADD CONSTRAINT "hint_logs_riddle_id_fkey" FOREIGN KEY ("riddle_id") REFERENCES "riddles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_events" ADD CONSTRAINT "onboarding_events_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_events" ADD CONSTRAINT "onboarding_events_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_progress" ADD CONSTRAINT "onboarding_progress_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_destinations" ADD CONSTRAINT "line_destinations_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_transition_id_fkey" FOREIGN KEY ("transition_id") REFERENCES "transitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_visits" ADD CONSTRAINT "location_visits_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liff_page_configs" ADD CONSTRAINT "liff_page_configs_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liff_page_blocks" ADD CONSTRAINT "liff_page_blocks_page_config_id_fkey" FOREIGN KEY ("page_config_id") REFERENCES "liff_page_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

