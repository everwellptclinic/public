// 簡單的記憶體對話狀態管理
// 正式環境建議改用 Redis 或 Turso 儲存

type Step =
  | 'IDLE'
  | 'AWAITING_APPOINTMENT_TYPE'   // 等待選擇初次/後續
  | 'FIRST_CONTACT_INFO'          // 初次預約：等待姓名電話
  | 'FOLLOW_UP_DAY'               // 後續：等待選擇日期
  | 'FOLLOW_UP_TIME'              // 後續：等待選擇時間
  | 'FOLLOW_UP_SATURDAY'          // 週六人工預約：等待偏好時間

interface Session {
  step: Step
  selectedDay?: string            // 後續預約選的日期
  availableSlots?: string[]       // 當天可用時段
  expiresAt: number               // 10 分鐘後過期
}

const sessions = new Map<string, Session>()

export function getSession(userId: string): Session {
  const s = sessions.get(userId)
  if (!s || Date.now() > s.expiresAt) {
    return { step: 'IDLE', expiresAt: 0 }
  }
  return s
}

export function setSession(userId: string, data: Partial<Session>) {
  const existing = getSession(userId)
  sessions.set(userId, {
    ...existing,
    ...data,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 分鐘
  })
}

export function clearSession(userId: string) {
  sessions.delete(userId)
}
