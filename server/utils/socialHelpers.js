export const getFollowRelations = async (db, viewerId, targetId) => {
  const [following, followedBy, followerCount, followingCount, friendCount] = await Promise.all([
    db.get(`SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?`, viewerId, targetId),
    db.get(`SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?`, targetId, viewerId),
    db.get(`SELECT COUNT(*) as c FROM follows WHERE followee_id = ?`, targetId),
    db.get(`SELECT COUNT(*) as c FROM follows WHERE follower_id = ?`, targetId),
    db.get(
      `SELECT COUNT(*) as c FROM follows f1
       JOIN follows f2 ON f1.followee_id = f2.follower_id AND f2.followee_id = ?
       WHERE f1.follower_id = ?`,
      targetId, targetId
    ),
  ])
  const isFollowing = Boolean(following)
  const isFollowedBy = Boolean(followedBy)
  return {
    following: isFollowing,
    followedBy: isFollowedBy,
    isFriend: isFollowing && isFollowedBy,
    followerCount: followerCount?.c || 0,
    followingCount: followingCount?.c || 0,
    friendCount: friendCount?.c || 0,
  }
}
