// morning-digest/index.ts
// Edge Function do Elos — roda diariamente às 7h30 via pg_cron
// Envia briefing proativo de cadências vencidas + D+1 de contatos recém-cadastrados
// Deploy: supabase functions deploy morning-digest --project-ref hiwrscxyclsovfbnzmwn

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ZAPI_INSTANCE = Deno.env.get('ZAPI_INSTANCE_ID')!
const ZAPI_TOKEN = Deno.env.get('ZAPI_TOKEN')!
const ZAPI_CLIENT_TOKEN = Deno.env.get('ZAPI_CLIENT_TOKEN')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ─── Envia mensagem via Z-API ─────────────────────────────────────────────────
async function sendWhatsApp(phone: string, message: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'client-token': ZAPI_CLIENT_TOKEN,
        },
        body: JSON.stringify({ phone, message }),
      }
    )
    return res.ok
  } catch (err) {
    console.error('[ELOS] Erro ao enviar WhatsApp:', err)
    return false
  }
}

// ─── Monta mensagem D+1 (contato recém-cadastrado) ───────────────────────────
function buildD1Message(contactName: string, context: string | null): string {
  const ctx = context ? `\n\nContexto que você registrou: "${context}"` : ''
  return (
    `Bom dia! 👋 Elos aqui.\n\n` +
    `Ontem você conheceu *${contactName}*.${ctx}\n\n` +
    `Qual é o próximo passo com ele(a)?\n\n` +
    `1️⃣ Me ajuda a mandar mensagem agora\n` +
    `2️⃣ Me lembra em 3 dias\n` +
    `3️⃣ Já cuidei disso`
  )
}

// ─── Monta briefing diário (cadências vencidas) ───────────────────────────────
function buildDigestMessage(contacts: Array<{ name: string; days: number; last_note: string | null }>): string {
  if (contacts.length === 0) return ''

  const lines = contacts.map((c, i) => {
    const note = c.last_note ? ` — Última nota: ${c.last_note}` : ''
    return `${i + 1}. *${c.name}* — ${c.days} dias sem contato${note}`
  })

  return (
    `Bom dia! ☀️ Elos aqui.\n\n` +
    `Hoje você tem ${contacts.length} relação${contacts.length > 1 ? 'ões' : ''} pra manter viva${contacts.length > 1 ? 's' : ''}:\n\n` +
    lines.join('\n') +
    `\n\nQuer ajuda pra redigir alguma mensagem? Responda com o número do contato.`
  )
}

// ─── Handler principal ────────────────────────────────────────────────────────
serve(async (req) => {
  // Aceita POST (pg_cron) ou GET (teste manual)
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }

  // Validação de token interno (pg_cron passa Authorization: Bearer <service_key>)
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace('Bearer ', '')
  if (token !== SUPABASE_SERVICE_KEY) {
    console.warn('[ELOS] morning-digest: token inválido')
    return new Response('Unauthorized', { status: 401 })
  }

  const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]

  let totalSent = 0
  let totalErrors = 0

  try {
    // Busca todos os usuários com WhatsApp cadastrado no perfil
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, phone, full_name')
      .not('phone', 'is', null)

    if (profilesError) throw profilesError
    if (!profiles || profiles.length === 0) {
      return new Response(JSON.stringify({ message: 'Nenhum perfil com telefone', sent: 0 }), { status: 200 })
    }

    for (const profile of profiles) {
      const userId = profile.id
      const userPhone = profile.phone

      // ── 1. D+1: contatos criados ontem que ainda não receberam o D+1 ──────
      const { data: d1Contacts } = await supabase
        .from('contacts')
        .select('id, name, notes')
        .eq('user_id', userId)
        .gte('created_at', `${yesterday}T00:00:00`)
        .lt('created_at', `${today}T00:00:00`)
        .eq('d1_sent', false) // flag para evitar reenvio

      for (const contact of d1Contacts ?? []) {
        const msg = buildD1Message(contact.name, contact.notes)
        const ok = await sendWhatsApp(userPhone, msg)

        if (ok) {
          // Marca D+1 como enviado
          await supabase
            .from('contacts')
            .update({ d1_sent: true, d1_sent_at: new Date().toISOString() })
            .eq('id', contact.id)

          // Registra no histórico de interações
          await supabase.from('interactions').insert({
            user_id: userId,
            contact_id: contact.id,
            type: 'proactive_d1',
            notes: 'Mensagem D+1 enviada automaticamente pelo Elos',
            created_at: new Date().toISOString(),
          })

          totalSent++
        } else {
          totalErrors++
          console.error(`[ELOS] Falha ao enviar D+1 para contato ${contact.id}`)
        }
      }

      // ── 2. Briefing diário: cadências vencidas (next_contact_date <= hoje) ──
      const { data: dueCadences } = await supabase
        .from('cadences')
        .select(`
          id,
          contact_id,
          next_contact_date,
          contacts (name, notes)
        `)
        .eq('user_id', userId)
        .lte('next_contact_date', today)
        .eq('digest_sent_today', false)
        .eq('status', 'active')

      if (dueCadences && dueCadences.length > 0) {
        // Calcula dias sem contato para cada um
        const contactsForDigest = dueCadences.map((c) => {
          const dueDate = new Date(c.next_contact_date)
          const days = Math.round((Date.now() - dueDate.getTime()) / 86400000)
          return {
            name: (c.contacts as any)?.name ?? 'Contato',
            days: Math.max(days, 0),
            last_note: (c.contacts as any)?.notes ?? null,
          }
        })

        const digestMsg = buildDigestMessage(contactsForDigest)
        if (digestMsg) {
          const ok = await sendWhatsApp(userPhone, digestMsg)
          if (ok) {
            // Marca todas as cadências como "digest enviado hoje" para não repetir
            const cadenceIds = dueCadences.map((c) => c.id)
            await supabase
              .from('cadences')
              .update({ digest_sent_today: true })
              .in('id', cadenceIds)

            totalSent++
          } else {
            totalErrors++
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, sent: totalSent, errors: totalErrors, date: today }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('[ELOS] Erro geral no morning-digest:', err)
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
