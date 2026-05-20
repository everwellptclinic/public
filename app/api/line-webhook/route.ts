import { NextRequest, NextResponse } from 'next/server'
import { getSession, setSession, clearSession } from '@/lib/sessions'
import { getAvailableSlots, getUpcomingDates, createAppointment } from '@/lib/calendar'

// ─── 設定區 ───────────────────────────────────────────────────
const CLINIC_NAME = '恆好物理治療所'
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://everwellptclinic.vercel.app'
const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN!
const OWNER_LINE_ID = process.env.OWNER_LINE_ID!
const GOOGLE_MAP_URL = 'https://maps.app.goo.gl/bcXKmX7C2Xhg5PDB6'

// ─── 圖片路徑設定 ─────────────────────────────────────────────
const IMAGES = {
  businessHours: [`${BASE_URL}/images/time.png`],
  pricing: [
    `${BASE_URL}/images/price01.png`,
    `${BASE_URL}/images/price02.png`,
    `${BASE_URL}/images/price03.png`,
    `${BASE_URL}/images/price04.png`,
    `${BASE_URL}/images/price05.png`,
  ],
  team: [`${BASE_URL}/images/team_card_chen.png`],
  treatments: [
    `${BASE_URL}/images/card-15_manual.png`,
    `${BASE_URL}/images/card-16_exercise.png`,
    `${BASE_URL}/images/card-17_ESWT.png`,
    `${BASE_URL}/images/card-18_HIL.png`,
    `${BASE_URL}/images/card-19_SIS.png`,
    `${BASE_URL}/images/card-20_insole.png`,
  ],
  conditions: [
    `${BASE_URL}/images/card-01.png`,
    `${BASE_URL}/images/card-02.png`,
    `${BASE_URL}/images/card-03.png`,
    `${BASE_URL}/images/card-04.png`,
    `${BASE_URL}/images/card-05.png`,
    `${BASE_URL}/images/card-06.png`,
    `${BASE_URL}/images/card-07.png`,
    `${BASE_URL}/images/card-08.png`,
    `${BASE_URL}/images/card-09.png`,
    `${BASE_URL}/images/card-10.png`,
    `${BASE_URL}/images/card-11.png`,
    `${BASE_URL}/images/card-12.png`,
    `${BASE_URL}/images/card-13.png`,
    `${BASE_URL}/images/card-14.png`,
  ],
}

// ─── 主要 Webhook 入口 ────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json()

  // 立即回應 200，事件在背景處理（避免 LINE 重試導致重複訊息）
  ;(async () => {
    for (const event of body.events || []) {
      const userId = event.source?.userId
      if (!userId) continue
      try {
        if (event.type === 'message' && event.message?.type === 'text') {
          await handleText(userId, event.message.text.trim(), event.replyToken)
        }
        if (event.type === 'postback') {
          await handlePostback(userId, event.postback?.data, event.replyToken)
        }
      } catch (e) {
        console.error('Event handler error:', e)
      }
    }
  })()

  return NextResponse.json({ status: 'ok' })
}

// ─── 處理文字訊息 ─────────────────────────────────────────────
async function handleText(userId: string, text: string, replyToken: string) {
  const session = getSession(userId)

  // 圖文選單：預約
  if (text === '預約') {
    setSession(userId, { step: 'AWAITING_APPOINTMENT_TYPE' })
    await replyButtons(replyToken,
      `您好，我是${CLINIC_NAME} AI 助理 😊\n請問您是要進行初次預約或後續治療預約？`,
      [
        { label: '初次預約',     data: 'TYPE:first' },
        { label: '後續治療預約', data: 'TYPE:followup' },
      ]
    )
    return
  }

  // 圖文選單：營業時間
  if (text === '營業時間') {
    await replyImages(replyToken, IMAGES.businessHours)
    return
  }

  // 圖文選單：收費標準
  if (text === '收費標準') {
    await replyImages(replyToken, IMAGES.pricing)
    return
  }

  // 圖文選單：專業團隊
  if (text === '專業團隊') {
    await replyImages(replyToken, IMAGES.team)
    return
  }

  // 圖文選單：治療項目（治療方式 + 適應症）
  if (text === '治療項目') {
    // Reply：文字 + 治療方式前4張（共5則）
    await replyTextAndImages(replyToken,
      '以下是我們的治療方式介紹 👇',
      IMAGES.treatments.slice(0, 4)
    )
    // Push：治療方式第5-6張
    await pushImages(userId, IMAGES.treatments.slice(4))
    // Push：適應症標題
    await pushText(userId, '以下是我們常見的適應症 👇')
    // Push：適應症圖卡分三批
    await pushImages(userId, IMAGES.conditions.slice(0, 5))
    await pushImages(userId, IMAGES.conditions.slice(5, 10))
    await pushImages(userId, IMAGES.conditions.slice(10))
    return
  }

  // 圖文選單：位置
  if (text === '位置') {
    await reply(replyToken,
      `📍 ${CLINIC_NAME}\n\nGoogle Map 導航：\n${GOOGLE_MAP_URL}\n\n歡迎來電或線上預約 😊`
    )
    return
  }

  // 預約流程：初次預約收資料
  if (session.step === 'FIRST_CONTACT_INFO') {
    clearSession(userId)
    await reply(replyToken,
      `謝謝您！\n我們收到您的資料，將盡快與您確認預約時間 🙏\n\n如有任何問題歡迎再詢問。`
    )
    await notifyOwner(`📋 新初次預約\n\n${text}\n\nLINE ID：${userId}`)
    return
  }

  // 預約流程：週六人工預約
  if (session.step === 'FOLLOW_UP_SATURDAY') {
    clearSession(userId)
    await reply(replyToken, `收到您的週六預約需求！\n我們將盡快與您確認時間 🙏`)
    await notifyOwner(`📋 週六彈性預約\n\nLINE ID：${userId}\n偏好時間：${text}`)
    return
  }

  // 後續預約時段選擇中
  if (session.step === 'FOLLOW_UP_TIME') {
    await reply(replyToken, '請使用上方按鈕選擇時段 😊')
    return
  }
}

// ─── 處理 Postback ────────────────────────────────────────────
async function handlePostback(userId: string, data: string, replyToken: string) {

  // 選擇預約類型：初次
  if (data === 'TYPE:first') {
    setSession(userId, { step: 'FIRST_CONTACT_INFO' })
    await reply(replyToken,
      `好的！麻煩您留下姓名及聯絡電話，\n將由專人與您聯繫 😊\n\n範例：王小明 0912345678`
    )
    return
  }

  // 選擇預約類型：後續治療
  if (data === 'TYPE:followup') {
    const dates = getUpcomingDates(5)
    if (dates.length === 0) {
      clearSession(userId)
      await reply(replyToken, '目前近期無可預約日期，請稍後再試或來電詢問 🙏')
      return
    }
    setSession(userId, { step: 'FOLLOW_UP_DAY' })
    await replyButtons(replyToken,
      '請問您想預約哪一天？',
      dates.map(d => ({ label: d.label, data: `DAY:${d.date.toISOString()}:${d.label}` }))
    )
    return
  }

  // 選擇日期
  if (data.startsWith('DAY:')) {
    const [, isoDate, ...labelParts] = data.split(':')
    const label = labelParts.join(':')
    const date = new Date(isoDate)

    if (date.getDay() === 6) {
      setSession(userId, { step: 'FOLLOW_UP_SATURDAY' })
      await reply(replyToken, `週六為彈性預約 😊\n請告訴我您方便的時間，我們將由專人與您確認。`)
      return
    }

    const slots = await getAvailableSlots(date)
    if (slots.length === 0) {
      await reply(replyToken, `${label} 目前已無可預約時段，請選擇其他日期 🙏`)
      return
    }

    setSession(userId, { step: 'FOLLOW_UP_TIME', selectedDay: isoDate, availableSlots: slots })
    await replyButtons(replyToken,
      `${label} 可預約時段如下，請選擇：`,
      slots.map(slot => ({ label: slot, data: `TIME:${isoDate}:${label}:${slot}` }))
    )
    return
  }

  // 選擇時間，完成預約
  if (data.startsWith('TIME:')) {
    const parts = data.split(':')
    const isoDate = parts[1]
    const dayLabel = parts[2]
    const timeStr = `${parts[3]}:${parts[4]}`
    const hour = parseInt(parts[3])

    clearSession(userId)
    await createAppointment(new Date(isoDate), hour, `[預約] ${userId} - 後續治療`)
    await reply(replyToken,
      `✅ 預約成功！\n\n📅 日期：${dayLabel}\n🕐 時間：${timeStr}\n\n前一天將發送提醒給您 😊\n如需更改請提前告知，謝謝！`
    )
    return
  }
}

// ─── LINE API 工具函式 ────────────────────────────────────────

async function reply(replyToken: string, text: string) {
  await callLine('reply', { replyToken, messages: [{ type: 'text', text }] })
}

async function replyImages(replyToken: string, urls: string[]) {
  await callLine('reply', {
    replyToken,
    messages: urls.slice(0, 5).map(url => ({
      type: 'image', originalContentUrl: url, previewImageUrl: url,
    })),
  })
}

async function replyTextAndImages(replyToken: string, text: string, urls: string[]) {
  await callLine('reply', {
    replyToken,
    messages: [
      { type: 'text', text },
      ...urls.slice(0, 4).map(url => ({
        type: 'image', originalContentUrl: url, previewImageUrl: url,
      })),
    ],
  })
}

async function replyButtons(
  replyToken: string,
  text: string,
  actions: { label: string; data: string }[]
) {
  const chunks: typeof actions[] = []
  for (let i = 0; i < actions.length; i += 4) chunks.push(actions.slice(i, i + 4))

  await callLine('reply', {
    replyToken,
    messages: chunks.slice(0, 5).map((chunk, idx) => ({
      type: 'template',
      altText: idx === 0 ? text : '請繼續選擇',
      template: {
        type: 'buttons',
        text: idx === 0 ? text.slice(0, 60) : '請繼續選擇：',
        actions: chunk.map(a => ({
          type: 'postback', label: a.label, data: a.data, displayText: a.label,
        })),
      },
    })),
  })
}

async function pushText(userId: string, text: string) {
  await callLine('push', { to: userId, messages: [{ type: 'text', text }] })
}

async function pushImages(userId: string, urls: string[]) {
  if (urls.length === 0) return
  await callLine('push', {
    to: userId,
    messages: urls.slice(0, 5).map(url => ({
      type: 'image', originalContentUrl: url, previewImageUrl: url,
    })),
  })
}

async function notifyOwner(text: string) {
  await callLine('push', { to: OWNER_LINE_ID, messages: [{ type: 'text', text }] })
}

async function callLine(type: 'reply' | 'push', body: object) {
  const url = type === 'reply'
    ? 'https://api.line.me/v2/bot/message/reply'
    : 'https://api.line.me/v2/bot/message/push'
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${LINE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) console.error(`LINE API error [${type}]:`, await res.text())
}
