import type { XProfile } from '@/lib/types/x';

interface Props {
  profile: XProfile;
  /** モックデータで表示中かどうか（バッジ表示） */
  isMock?: boolean;
}

export default function XAccountCard({ profile, isMock = false }: Props) {
  return (
    <div className="card xa-account-card">
      {/* アバター */}
      <div className="xa-account-avatar">
        {profile.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.avatarUrl} alt={profile.displayName} />
        ) : (
          <div className="xa-account-avatar-placeholder">
            {profile.displayName.slice(0, 1).toUpperCase()}
          </div>
        )}
      </div>

      {/* 名前・ID・bio */}
      <div className="xa-account-info">
        <div className="xa-account-name">
          {profile.displayName}
          {isMock && <span className="xa-mock-badge">Mock Data</span>}
        </div>
        <div className="xa-account-username">@{profile.username}</div>
        {profile.bio && (
          <div className="xa-account-bio">{profile.bio}</div>
        )}
      </div>

      {/* プロフィールリンク */}
      <a
        href={profile.profileUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="xa-account-link"
      >
        Xで見る →
      </a>
    </div>
  );
}
