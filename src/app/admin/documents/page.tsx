"use client";

// src/app/admin/documents/page.tsx
// ドキュメント管理（PDF アップロード）— 近日公開

export default function AdminDocumentsPage() {
  return (
    <>
      <div className="page-header">
        <div>
          <h2>ドキュメント管理</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
            ユーザー向け PDF ガイドのアップロード・管理
          </p>
        </div>
      </div>

      <div className="card">
        <div className="empty-state">
          <div className="empty-state-icon">📄</div>
          <p className="empty-state-title">近日公開予定</p>
          <p className="empty-state-desc">
            PDF ドキュメントのアップロード・公開機能は準備中です。
          </p>
        </div>
      </div>
    </>
  );
}
