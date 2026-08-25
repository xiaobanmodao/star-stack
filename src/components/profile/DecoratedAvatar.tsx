import { useEffect, useState } from 'react'
import type { AvatarFrameId, AvatarOverlayId } from '../../types'
import { classNames } from '../ui/classNames'
import './DecoratedAvatar.css'

const OVERLAY_ASSETS: Record<Exclude<AvatarOverlayId, 'none'>, string> = {
  'streak-100': '/assets/decorations/streak-100-overlay.png',
  'perfect-solve': '/assets/decorations/perfect-solve-overlay.png',
}

type DecoratedAvatarProps = {
  avatar?: string | null
  fallback: string
  frame?: AvatarFrameId
  overlay?: AvatarOverlayId
  size?: 'profile' | 'topbar' | 'conversation' | 'discussion' | 'discussion-small' | 'chat' | 'message' | 'edit'
  alt?: string
  loading?: 'eager' | 'lazy'
  className?: string
}

export default function DecoratedAvatar({
  avatar,
  fallback,
  frame = 'none',
  overlay = 'none',
  size = 'discussion',
  alt = '',
  loading = 'lazy',
  className,
}: DecoratedAvatarProps) {
  const [imageFailed, setImageFailed] = useState(false)
  const overlayAsset = overlay !== 'none' ? OVERLAY_ASSETS[overlay] : null

  useEffect(() => {
    setImageFailed(false)
  }, [avatar])

  return (
    <span
      className={classNames(
        'decorated-avatar',
        `decorated-avatar-${size}`,
        `decorated-avatar-frame-${frame}`,
        className,
      )}
      data-avatar-frame={frame}
      data-avatar-overlay={overlay}
    >
      {avatar && !imageFailed ? (
        <img className="decorated-avatar-media" src={avatar} alt={alt} loading={loading} decoding="async" onError={() => setImageFailed(true)} />
      ) : (
        <span className="decorated-avatar-fallback" aria-hidden={alt ? undefined : true}>{fallback}</span>
      )}
      {overlayAsset && (
        <img
          className="decorated-avatar-overlay"
          src={overlayAsset}
          alt=""
          aria-hidden="true"
          loading={loading}
          decoding="async"
        />
      )}
    </span>
  )
}
