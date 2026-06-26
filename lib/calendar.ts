import { google } from 'googleapis'

// ─── 營業時間設定 ────────────────────────────────────────────
// 格式：[開始小時, 結束小時)，每小時一個時段
const BUSINESS_HOURS: Record<number, number[][]> = {
  0: [],                                          // 週日 休診
  1: [],                                          // 週一 休診
  2: [[9, 12], [14, 17], [18, 21]],              // 週二
  3: [[9, 12], [14, 17], [18, 21]],              // 週三
  4: [[9, 12], [14, 17], [18, 21]],              // 週四
  5: [[9, 12], [14, 17], [18, 21]],              // 週五
  6: [[9, 12]],                                   // 週六（人工預約，只用來顯示參考）
}

// 取得某天所有營業時段的整點列表
function getBusinessSlots(date: Date): string[] {
  const dayOfWeek = date.getDay()
  const ranges = BUSINESS_HOURS[dayOfWeek] || []
  const slots: string[] = []
  for (const [start, end] of ranges) {
    for (let h = start; h < end; h++) {
      slots.push(`${String(h).padStart(2, '0')}:00`)
    }
  }
  return slots
}

// ─── Google Auth ─────────────────────────────────────────────
function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT!),
    scopes: ['https://www.googleapis.com/auth/calendar'],
  })
}

// ─── 取得某天已佔用的時段 ─────────────────────────────────────
async function getBusySlots(date: Date): Promise<Set<string>> {
  const auth = getAuth()
  const calendar = google.calendar({ version: 'v3', auth })

  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  const end = new Date(date)
  end.setHours(23, 59, 59, 999)

  const { data } = await calendar.events.list({
    calendarId: process.env.GOOGLE_CALENDAR_ID!,
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
    timeZone: 'Asia/Taipei',
  })

  const busy = new Set<string>()
  for (const event of data.items || []) {
    const eventStart = event.start?.dateTime
    if (!eventStart) continue
    const h = new Date(eventStart).getHours()
    busy.add(`${String(h).padStart(2, '0')}:00`)
  }
  return busy
}

// ─── 取得某天可預約時段 ───────────────────────────────────────
export async function getAvailableSlots(date: Date): Promise<string[]> {
  const allSlots = getBusinessSlots(date)
  if (allSlots.length === 0) return []

  const busy = await getBusySlots(date)
  return allSlots.filter(slot => !busy.has(slot))
}

// ─── 取得未來可預約的日期（排除休診、週六）─────────────────────
export function getUpcomingDates(days = 7): { label: string; date: Date }[] {
  const result: { label: string; date: Date }[] = []
  const dayLabels = ['週日', '週一', '週二', '週三', '週四', '週五', '週六']

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  for (let i = 1; i <= 14 && result.length < days; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    const dow = d.getDay()

    // 跳過休診（週日=0、週一=1）和週六（人工預約，另外處理）
    if (dow === 0 || dow === 1 || dow === 6) continue

    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    result.push({ label: `${mm}/${dd}（${dayLabels[dow]}）`, date: d })
  }

  return result
}

export interface Appointment {
  patient: string
  therapist: string
  time: string   // 'HH:MM'
}

// 解析 "[預約] 患者姓名 - 治療師姓名" 格式
function parseSummary(summary: string): { patient: string; therapist: string } | null {
  const match = summary.match(/^\[預約\]\s*(.+?)\s*[-–]\s*(.+)$/)
  if (!match) return null
  return { patient: match[1].trim(), therapist: match[2].trim() }
}

// 以台灣時區取得明天的日期字串，例如 "6/27（五）"
export function getTomorrowDateStr(): string {
  const now = new Date()
  const tpe = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  const tomorrow = new Date(Date.UTC(tpe.getUTCFullYear(), tpe.getUTCMonth(), tpe.getUTCDate() + 1))
  const m = tomorrow.getUTCMonth() + 1
  const d = tomorrow.getUTCDate()
  const dayLabels = ['日', '一', '二', '三', '四', '五', '六']
  const dow = tomorrow.getUTCDay()
  return `${m}/${d}（${dayLabels[dow]}）`
}

// 以台灣時區取得明天的日期範圍
function getTomorrowRangeTaipei(): { timeMin: string; timeMax: string } {
  const now = new Date()
  // 台灣時區 offset = UTC+8
  const tpe = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  // 明天 00:00:00 台灣時間
  const tomorrowStart = new Date(Date.UTC(
    tpe.getUTCFullYear(), tpe.getUTCMonth(), tpe.getUTCDate() + 1,
    0, 0, 0
  ) - 8 * 60 * 60 * 1000)
  const tomorrowEnd = new Date(tomorrowStart.getTime() + 24 * 60 * 60 * 1000 - 1)
  return { timeMin: tomorrowStart.toISOString(), timeMax: tomorrowEnd.toISOString() }
}

// ─── 取得明天的所有預約事件 ──────────────────────────────────
export async function getTomorrowAppointments(): Promise<Appointment[]> {
  const auth = getAuth()
  const calendar = google.calendar({ version: 'v3', auth })

  const { timeMin, timeMax } = getTomorrowRangeTaipei()

  const { data } = await calendar.events.list({
    calendarId: process.env.GOOGLE_CALENDAR_ID!,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
    timeZone: 'Asia/Taipei',
  })

  const results: Appointment[] = []
  for (const e of data.items || []) {
    if (!e.start?.dateTime) continue
    const parsed = parseSummary(e.summary || '')
    if (!parsed) continue

    // 直接以 UTC+8 計算台灣時間（避免 runtime 時區差異）
    const dt = new Date(e.start.dateTime)
    const tpe = new Date(dt.getTime() + 8 * 60 * 60 * 1000)
    const hh = String(tpe.getUTCHours()).padStart(2, '0')
    const mm = String(tpe.getUTCMinutes()).padStart(2, '0')
    results.push({ ...parsed, time: `${hh}:${mm}` })
  }
  return results
}

// ─── 將預約寫入 Google Calendar ──────────────────────────────
export async function createAppointment(
  date: Date,
  hour: number,
  summary: string  // 例如 "[預約] A000002 林世浩 - 陳睿亨"
) {
  const auth = getAuth()
  const calendar = google.calendar({ version: 'v3', auth })

  const start = new Date(date)
  start.setHours(hour, 0, 0, 0)
  const end = new Date(start)
  end.setHours(hour + 1)

  await calendar.events.insert({
    calendarId: process.env.GOOGLE_CALENDAR_ID!,
    requestBody: {
      summary,
      start: { dateTime: start.toISOString(), timeZone: 'Asia/Taipei' },
      end:   { dateTime: end.toISOString(),   timeZone: 'Asia/Taipei' },
    },
  })
}
