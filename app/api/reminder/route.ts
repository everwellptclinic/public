import { NextRequest, NextResponse } from 'next/server'
import { getTomorrowAppointments, getTomorrowDateStr } from '@/lib/calendar'

const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN!
const OWNER_LINE_ID = process.env.OWNER_LINE_ID!
const CRON_SECRET = process.env.CRON_SECRET
const CLINIC_NAME = '恆好物理治療所'

export async function GET(req: NextRequest) {
  if (CRON_SECRET) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const appointments = await getTomorrowAppointments()
  const dateStr = getTomorrowDateStr()

  if (appointments.length === 0) {
    await pushText(OWNER_LINE_ID, `📅 明天 ${dateStr} 目前無預約`)
    return NextResponse.json({ ok: true, count: 0 })
  }

  // 每筆預約獨立一則訊息，方便管理者長按轉傳給患者
  const messages = appointments.map(
    a => `${a.therapist}物理治療師\n\n${a.patient}\n提醒您，明天 ${dateStr}${a.time} 在${CLINIC_NAME}有預約喔 😊`
  )

  // LINE 每次 push 最多 5 則，分批送出
  for (let i = 0; i < messages.length; i += 5) {
    await pushMessages(OWNER_LINE_ID, messages.slice(i, i + 5))
  }

  return NextResponse.json({ ok: true, count: appointments.length })
}

async function pushText(userId: string, text: string) {
  await pushMessages(userId, [text])
}

async function pushMessages(userId: string, texts: string[]) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${LINE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: userId,
      messages: texts.map(text => ({ type: 'text', text })),
    }),
  })
  if (!res.ok) console.error('LINE push error:', await res.text())
}
