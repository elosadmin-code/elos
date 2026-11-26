// morning-digest — Elos
// Roda todo dia 7h30 (Brasilia) via pg_cron. Envia por WhatsApp:
// UMA mensagem por usuario por manha, com:
//   1) D+1: quem foi cadastrado ontem + pergunta do proximo passo (resposta em frase natural)
//   2) Retomadas: contatos com cadencia vencida (last_contacted_at + interval_days <= agora)
// Sem menu numerico: o usuario responde por texto ou audio ("me lembra do Fulano em 3 dias").
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

// Corta a anotacao no fim de uma palavra (nunca no meio) e fecha com reticencias
function trimNote(text: string, max = 100): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  const base = (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.\-]+$/, '')
  return base + '…'
}

const MAX_FRESH = 5
const MAX_DUE = 8

function firstName(full: string): string {
  return (full || '').trim().split(/\s+/)[0] || full
}

function who(role: string | null, company: string | null): string {
  const w = [role, company].filter(Boolean).join(', ')
  return w ? ` (${w})` : ''
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

      // ── Quem foi cadastrado ontem ─────────────────────────────────────────
      const { data: freshAll } = await supabase
        .from('contacts')
        .select('id, name, role, company')
        .eq('user_id', userId)
        .gte('created_at', yStart)
        .lt('created_at', yEnd)
        .order('created_at', { ascending: true })

      // ── Cadencias vencidas ────────────────────────────────────────────────
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

      if ((freshAll ?? []).length === 0 && due.length === 0) continue

      // Uma trava por usuario por dia: nunca manda duas mensagens na mesma manha
      const digestKey = `digest:${userId}:${today}`
      if (!(await claim(digestKey))) { skipped++; continue }

      // Cada cadastrado de ontem tem a sua trava (D+1 so acontece uma vez por contato)
      const claimedFresh: any[] = []
      for (const c of freshAll ?? []) {
        if (await claim(`d1:${c.id}`)) claimedFresh.push(c)
      }

      // Quem ja foi avisado no D+1 nao precisa aparecer de novo como atrasado hoje
      const dueShown = due.filter((d) => !claimedFresh.some((f) => f.id === d.contactId)).slice(0, MAX_DUE)

      if (claimedFresh.length === 0 && dueShown.length === 0) {
        await supabase.from('processed_messages').delete().eq('msg_key', digestKey)
        skipped++
        continue
      }

      const parts: string[] = [`Bom dia! Elos aqui.`]

      if (claimedFresh.length > 0) {
        const shown = claimedFresh.slice(0, MAX_FRESH)
        const extra = claimedFresh.length - shown.length
        const list = shown.map((c) => `• *${c.name}*${who(c.role, c.company)}`).join('\n')
        const e1 = firstName(shown[0].name)
        const e2 = firstName((shown[1] ?? shown[0]).name)
        parts.push(
          `Ontem você cadastrou:\n${list}${extra > 0 ? `\ne mais ${extra}` : ''}`,
          `Qual é o próximo passo? Me diga por texto ou áudio, por exemplo:\n` +
          `"me lembra do ${e1} em 3 dias"\n` +
          `"me ajuda a escrever pra ${e2}"`
        )
      }

      if (dueShown.length > 0) {
        const lines: string[] = []
        for (const d of dueShown) {
          const { data: h } = await supabase
            .from('contact_history')
            .select('notes')
            .eq('contact_id', d.contactId)
            .order('contacted_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          const note = (h?.notes ?? '').replace(/\s*\[msgid:[^\]]*\]/g, '').replace(/\s*\[ZAPI:[^\]]*\]/g, '').trim()
          const short = trimNote(note)
          const dias = d.daysSince === 1 ? 'dia' : 'dias'
          lines.push(`• *${d.name}*, ${d.daysSince} ${dias} sem contato${short ? `. Última vez: ${short}` : ''}`)
        }
        parts.push(
          `${dueShown.length === 1 ? 'Pedindo retomada hoje:' : `${dueShown.length} relações pedindo retomada hoje:`}\n${lines.join('\n')}`
        )
        if (claimedFresh.length === 0) {
          parts.push(`Quer ajuda? Diga, por exemplo: "me ajuda a escrever pra ${firstName(dueShown[0].name)}".`)
        }
      }

      const ok = await sendWhatsApp(phone, parts.join('\n\n'))
      if (ok) {
        sent++
      } else {
        failed++
        // libera todas as travas para nova tentativa na proxima execucao
        await supabase.from('processed_messages').delete().eq('msg_key', digestKey)
        for (const c of claimedFresh) {
          await supabase.from('processed_messages').delete().eq('msg_key', `d1:${c.id}`)
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
