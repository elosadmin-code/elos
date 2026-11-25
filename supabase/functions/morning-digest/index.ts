// morning-digest — Elos
// Roda todo dia 7h30 (Brasilia) via pg_cron. Envia por WhatsApp:
//   1) D+1: um lembrete para cada contato cadastrado ontem
//   2) Briefing: contatos com cadencia vencida (last_contacted_at + interval_days <= agora)
// Idempotente: usa a tabela processed_messages como trava (uma chave por envio).
// Deploy: supabase functions deploy morning-digest --no-verify-jwt --project-ref hiwrscxyclsovfbnzmwn

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const DAY = 86400000
const BRT_OFFSET = 3 * 3600000 // Brasilia = UTC-3

// Data (YYYY-MM-DD) no fuso de Brasilia
function brtDate(ms: number): string {
  return new Date(ms - BRT_OFFSET).toISOString().slice(0, 10)
}

// Reserva atomica: true so na primeira vez que a chave aparece
async function claim(key: string): Promise<boolean> {
  const { error } = await supabase.from('processed_messages').insert({ msg_key: key })
  if (!error) return true
  if (error.code === '23505') return false
  console.error('[ELOS-DIGEST] claim falhou:', JSON.stringify(error))
  return false // na duvida, nao envia (melhor perder um envio do que duplicar)
}

// Envio pela API Omni da Z-API (mesmo caminho do whatsapp-webhook)
async function sendWhatsApp(phone: string, message: string): Promise<boolean> {
  const channelId = Deno.env.get('ZAPI_INSTANCE_ID') || ''
  const secret = Deno.env.get('ZAPI_SECRET_KEY') || ''
  if (!channelId || !secret) {
    console.error('[ELOS-DIGEST] ZAPI_INSTANCE_ID ou ZAPI_SECRET_KEY ausente')
    return false
  }
  const recipient = phone.replace(/\D/g, '')
  const identifier = recipient.startsWith('55') ? recipient : `55${recipient}`
  try {
    const res = await fetch(`https://api.omni.z-api.io/v1/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${secret}` },
      body: JSON.stringify({
        recipient: { identifier },
        content: { type: 'TEXT', body: { message } },
      }),
    })
    if (!res.ok) console.error('[ELOS-DIGEST] Z-API status', res.status, (await res.text()).slice(0, 300))
    return res.ok
  } catch (e) {
    console.error('[ELOS-DIGEST] erro de rede Z-API:', String(e))
    return false
  }
}

function d1Message(name: string, role: string | null, company: string | null): string {
  const who = [role, company].filter(Boolean).join(', ')
  return (
    `Bom dia! Elos aqui.\n\n` +
    `Ontem você cadastrou *${name}*${who ? ` (${who})` : ''}.\n\n` +
    `Qual é o próximo passo com essa pessoa?\n\n` +
    `1️⃣ Me ajuda a escrever a mensagem agora\n` +
    `2️⃣ Me lembra em 3 dias\n` +
    `3️⃣ Já cuidei disso`
  )
}

serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }

  // Protecao: so o pg_cron (que conhece o segredo) pode disparar
  const expected = Deno.env.get('CRON_SECRET') || ''
  if (!expected || req.headers.get('x-cron-secret') !== expected) {
    console.warn('[ELOS-DIGEST] segredo invalido')
    return new Response('Unauthorized', { status: 401 })
  }

  const now = Date.now()
  const today = brtDate(now)
  const yesterday = brtDate(now - DAY)
  // Janela UTC que corresponde ao "dia de ontem" em Brasilia
  const yStart = new Date(Date.parse(`${yesterday}T00:00:00Z`) + BRT_OFFSET).toISOString()
  const yEnd = new Date(Date.parse(`${today}T00:00:00Z`) + BRT_OFFSET).toISOString()

  let sent = 0
  let failed = 0
  let skipped = 0

  try {
    const { data: profiles, error: pErr } = await supabase
      .from('profiles')
      .select('id, whatsapp_number')
      .not('whatsapp_number', 'is', null)
    if (pErr) throw pErr

    for (const profile of profiles ?? []) {
      const userId = profile.id as string
      const phone = profile.whatsapp_number as string
      if (!phone) continue

      // ── 1. D+1: contatos cadastrados ontem ──────────────────────────────
      const { data: fresh } = await supabase
        .from('contacts')
        .select('id, name, role, company')
        .eq('user_id', userId)
        .gte('created_at', yStart)
        .lt('created_at', yEnd)

      for (const c of fresh ?? []) {
        if (!(await claim(`d1:${c.id}`))) { skipped++; continue }
        const ok = await sendWhatsApp(phone, d1Message(c.name, c.role, c.company))
        if (ok) sent++
        else {
          failed++
          // libera a chave para uma nova tentativa na proxima execucao
          await supabase.from('processed_messages').delete().eq('msg_key', `d1:${c.id}`)
        }
      }

      // ── 2. Briefing: cadencias vencidas ─────────────────────────────────
      const { data: cads } = await supabase
        .from('cadences')
        .select('contact_id, interval_days, last_contacted_at, contacts(name)')
        .eq('user_id', userId)

      const due = (cads ?? [])
        .filter((c: any) => c.interval_days && c.last_contacted_at)
        .map((c: any) => {
          const last = Date.parse(c.last_contacted_at)
          return {
            contactId: c.contact_id as string,
            name: (c.contacts?.name ?? 'Contato') as string,
            daysSince: Math.floor((now - last) / DAY),
            overdue: now >= last + c.interval_days * DAY,
          }
        })
        .filter((c) => c.overdue)
        .sort((a, b) => b.daysSince - a.daysSince)
        .slice(0, 8) // limite para o briefing nao virar um textao

      if (due.length > 0) {
        if (!(await claim(`digest:${userId}:${today}`))) { skipped++; continue }

        // ultima anotacao de cada contato vencido
        const lines: string[] = []
        for (let i = 0; i < due.length; i++) {
          const d = due[i]
          const { data: h } = await supabase
            .from('contact_history')
            .select('notes')
            .eq('contact_id', d.contactId)
            .order('contacted_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          const note = (h?.notes ?? '').replace(/\s*\[msgid:[^\]]*\]/g, '').trim()
          const short = note.length > 90 ? note.slice(0, 87) + '...' : note
          lines.push(`${i + 1}. *${d.name}*, ${d.daysSince} dias sem contato${short ? `. Última vez: ${short}` : ''}`)
        }

        const msg =
          `Bom dia! Elos aqui.\n\n` +
          `Hoje ${due.length === 1 ? 'tem 1 relação' : `tem ${due.length} relações`} pedindo retomada:\n\n` +
          lines.join('\n') +
          `\n\nQuer ajuda para redigir alguma mensagem? Responde com o número.`

        const ok = await sendWhatsApp(phone, msg)
        if (ok) sent++
        else {
          failed++
          await supabase.from('processed_messages').delete().eq('msg_key', `digest:${userId}:${today}`)
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, date: today, sent, failed, skipped }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[ELOS-DIGEST] erro geral:', String(err))
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
