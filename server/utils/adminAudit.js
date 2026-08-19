const serializeDetail = (detail) => {
  if (detail === undefined || detail === null || detail === '') return null
  if (typeof detail === 'string') return detail.slice(0, 2000)
  try {
    return JSON.stringify(detail).slice(0, 2000)
  } catch {
    return null
  }
}

export const recordAdminAction = async (db, {
  adminId,
  adminName,
  action,
  targetType,
  targetId = null,
  detail = null,
}) => {
  try {
    await db.run(
      `INSERT INTO admin_audit_logs
       (admin_id, admin_name, action, target_type, target_id, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      adminId || null,
      String(adminName || '管理员').slice(0, 80),
      String(action || 'unknown').slice(0, 80),
      String(targetType || 'unknown').slice(0, 40),
      targetId === null || targetId === undefined ? null : String(targetId).slice(0, 120),
      serializeDetail(detail),
      new Date().toISOString()
    )
  } catch (error) {
    // 审计记录不能反向阻断正常管理操作，但需要保留服务端诊断信息。
    console.error('Failed to record admin action:', error)
  }
}
