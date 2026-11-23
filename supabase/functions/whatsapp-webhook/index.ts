// Elos — Webhook Z-API Omni
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

function cleanPhone(phone: string): string {
  // Remove non-digits AND strip @s.whatsapp.net suffix if present
  return (phone ?? '').split('@')[0].replace(/\D/g, '')
}

async function readBody(req: Request): Promise<any> {
  const bodyBuffer = await req.arrayBuffer()
  const bytes = new Uint8Array(bodyBuffer)
  let rawText: string
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    console.log('[ELOS] Descomprimindo gzip...')
    const stream = new DecompressionStream('gzip')
    const writer = stream.writable.getWriter()
    writer.write(bytes)
    writer.close()
    const decompressed = await new Response(stream.readable).arrayBuffer()
    rawText = new TextDecoder().decode(decompressed)
  } else {
    rawText = new TextDecoder().decode(bytes)
  }
  console.log('[ELOS] Body raw:', rawText.slice(0, 2000))
  return JSON.parse(rawText)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })
  }
  try {
    const raw = await readBody(req)
    const body = raw.message || raw
    console.log('[ELOS] Keys:', Object.keys(body).join(', '))
    console.log('[ELOS] sender:', JSON.stringify(body.sender))
    console.log('[ELOS] contents:', JSON.stringify(body.contents))
    console.log('[ELOS] created_by:', body.created_by)
    console.log('[ELOS] channel_id:', body.channel_id)
    console.log('[ELOS] messageEventType:', raw.messageEventType)

    // Skip non-MESSAGE events (Z-API fires multiple events per message: received, read, delivered, etc.)
    const eventType = raw.messageEventType || raw.type || ''
    if (eventType && eventType !== 'ReceivedCallback' && eventType !== 'message' && eventType !== '') {
      console.log('[ELOS] Pulando: evento não é mensagem recebida:', eventType)
      return ok({ skipped: 'non_message_event', eventType })
    }

    // Skip outgoing messages (sent by the business)
    if (body.created_by === 'API' || body.created_by === 'SYSTEM' || body.direction === 'OUTGOING') {
      console.log('[ELOS] Pulando: mensagem enviada pela empresa')
      return ok({ skipped: 'outgoing_message' })
    }

    if (!body.sender?.identifier) {
      console.log('[ELOS] Pulando: sem sender.identifier (mensagem da empresa ou sistema)')
      return ok({ skipped: 'no_sender' })
    }

    const senderPhone = cleanPhone(body.sender.identifier)
    console.log('[ELOS] Remetente (clean):', senderPhone)

    // Extract channel_id from webhook body (Z-API Omni sends this)
    const channelId = body.channel_id || body.channelId || Deno.env.get('ZAPI_INSTANCE_ID') || ''
    console.log('[ELOS] channelId para reply:', channelId)

    let messageText = ''
    let messageType = 'TEXT'
    if (Array.isArray(body.contents) && body.contents.length > 0) {
      const c = body.contents[0]
      console.log('[ELOS] content[0]:', JSON.stringify(c))
      messageText = c.TEXT || c.text || c.body || c.message || c.content || c.value || ''
      if (!messageText && c.external_information) {
        const ei = c.external_information
        messageText = ei.body || ei.text || ei.message || ei.content || ''
        console.log('[ELOS] ext_info:', JSON.stringify(ei).slice(0, 300))
      }
      const cls = c['@class'] || ''
      if (c.AUDIO || c.VOICE || cls.includes('Audio') || cls.includes('Voice')) messageType = 'AUDIO'
      else if (c.IMAGE || cls.includes('Image')) messageType = 'IMAGE'
      else if (c.DOCUMENT || cls.includes('Document')) messageType = 'DOCUMENT'
    }

    if (!messageText && body.text) {
      messageText = typeof body.text === 'string' ? body.text : (body.text?.message || body.text?.body || '')
    }
    if (!messageText && body.metadata) {
      const m = body.metadata
      messageText = m.text || m.body || m.message || m.content || ''
    }

    // Z-API Omni: áudio chega em attachments[], não em contents[]
    if (messageType === 'TEXT' && Array.isArray(body.attachments) && body.attachments.length > 0) {
      const att = body.attachments[0]
      if (att.type === 'AUDIO' || (att['@class'] || '').includes('Audio')) {
        messageType = 'AUDIO'
      }
    }

    console.log(`[ELOS] Tipo: ${messageType}, Texto: "${messageText.slice(0, 100)}"`)

    // ── Áudio: baixar e transcrever com Groq Whisper ──────────────────────
    let audioMime = 'audio/ogg'

    if (messageType === 'AUDIO') {
      // Z-API Omni: URL do áudio está em attachments[], não em contents[]
      const att = Array.isArray(body.attachments)
        ? body.attachments.find((a: any) => a.type === 'AUDIO' || (a['@class'] || '').includes('Audio'))
        : null
      if (att?.mime_type) audioMime = att.mime_type.split(';')[0].trim()

      const c0 = (Array.isArray(body.contents) && body.contents.length > 0) ? body.contents[0] : {}
      const audioObj = c0.AUDIO || c0.VOICE || {}
      const audioUrl =
        att?.url ||
        audioObj.url || audioObj.audioUrl || audioObj.mediaUrl ||
        c0.external_information?.url || c0.external_information?.mediaUrl ||
        body.metadata?.audioUrl || body.metadata?.url || ''

      console.log('[ELOS] Audio URL:', audioUrl, '| MIME:', audioMime)

      if (!audioUrl) {
        return ok({ skipped: 'audio_no_url' })
      }

      try {
        // 1. Download do áudio
        const audioResp = await fetch(audioUrl)
        if (!audioResp.ok) {
          console.error('[ELOS] Audio download falhou:', audioResp.status)
          return ok({ skipped: 'audio_download_failed', status: audioResp.status })
        }
        const audioBuffer = await audioResp.arrayBuffer()
        const ct = audioResp.headers.get('content-type') || 'audio/ogg'
        audioMime = ct.split(';')[0].trim()
        console.log('[ELOS] Audio ok:', audioBuffer.byteLength, 'bytes, mime:', audioMime)

        // 2. Transcrição via Groq Whisper
        const groqKey = Deno.env.get('GROQ_API_KEY') || ''
        if (!groqKey) {
          console.error('[ELOS] GROQ_API_KEY não configurada!')
          return ok({ skipped: 'no_groq_key' })
        }
        const formData = new FormData()
        formData.append('file', new Blob([audioBuffer], { type: audioMime }), 'audio.ogg')
        formData.append('model', 'whisper-large-v3-turbo')
        formData.append('language', 'pt')
        const groqResp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${groqKey}` },
          body: formData
        })
        const groqData = await groqResp.json()
        console.log('[ELOS] Groq status:', groqResp.status, '| resposta:', JSON.stringify(groqData).slice(0, 300))
        if (!groqResp.ok) {
          console.error('[ELOS] Groq erro:', JSON.stringify(groqData))
          return ok({ skipped: 'groq_error', status: groqResp.status, detail: JSON.stringify(groqData).slice(0, 200) })
        }
        messageText = groqData.text || ''
        console.log('[ELOS] Transcrição Groq:', messageText.slice(0, 300))
      } catch (e) {
        console.error('[ELOS] Audio/Groq error:', String(e))
        return ok({ skipped: 'audio_error', error: String(e) })
      }
    }

    if (!messageText || messageText.trim().length < 3) {
      console.log('[ELOS] Pulando: mensagem vazia ou muito curta')
      return ok({ skipped: 'no_text' })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Normalize: try both with and without 55 country code
    const basePhone = senderPhone.replace(/^55/, '')  // e.g. 13997008988
    const fullPhone = `55${basePhone}`                // e.g. 5513997008988
    console.log('[ELOS] ===LOOKUP_INICIO=== base:', basePhone, 'full:', fullPhone)

    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('id')
      .or(`whatsapp_number.eq.${fullPhone},whatsapp_number.eq.${basePhone}`)
      .maybeSingle()

    console.log('[ELOS] ===LOOKUP_FIM=== profile:', profile ? profile.id : 'NULL', 'err:', profileErr ? JSON.stringify(profileErr) : 'nenhum')

    if (!profile) {
      console.log(`[ELOS] Usuário não encontrado para o número: ${senderPhone}`)
      return ok({ skipped: 'user_not_found', phone: senderPhone })
    }

    const userId = profile.id
    const senderName = body.sender?.name || body.sender?.pushName || senderPhone
    console.log(`[ELOS] ===PERFIL_OK=== userId: ${userId}`)
    console.log(`[ELOS] Msg de ${senderName} (${senderPhone}): "${messageText.slice(0, 100)}"`)

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) {
      console.error('[ELOS] ANTHROPIC_API_KEY não configurada!')
      return ok({ skipped: 'no_api_key' })
    }

    console.log('[ELOS] ===CLAUDE_INICIO=== apiKey_prefix:', apiKey.slice(0, 10) + '...' + ' len:' + apiKey.length)

    // Monta o conteúdo da mensagem (áudio já foi transcrito para messageText via Groq Whisper)
    const userContent = `Mensagem de ${senderName}:\n"${messageText}"\n\nSe houver qualquer pessoa mencionada (reunião, ligação, encontro, contato), retorne:\n{"action":"note","contact_name":"nome completo","contact_phone":"telefone ou null","contact_role":"cargo ou null","contact_company":"empresa ou null","note":"resumo do contexto","cadence_days":numero_ou_null}\n\nSó retorne {"action":"ignore"} se não houver nenhuma pessoa mencionada na mensagem.`

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-5-5',
        max_tokens: 1024,
        system: `Você é um assistente de CRM para empreendedores brasileiros. Analise a mensagem e extraia informações sobre contatos profissionais mencionados. Responda APENAS com JSON válido, sem markdown, sem explicações. Sempre que houver um nome de pessoa mencionado, registre como contato. Extraia também cargo (contact_role) e empresa (contact_company) quando mencionados.`,
        messages: [{ role: 'user', content: userContent }]
      })
    })

    console.log('[ELOS] ===CLAUDE_STATUS===', claudeRes.status)
    const claudeData = await claudeRes.json()
    console.log('[ELOS] ===CLAUDE_FULL===', JSON.stringify(claudeData).slice(0, 1500))

    if (!claudeRes.ok) {
      console.error('[ELOS] Claude API erro:', JSON.stringify(claudeData).slice(0, 500))
      return ok({ skipped: 'claude_api_error', status: claudeRes.status, detail: JSON.stringify(claudeData).slice(0, 200) })
    }

    const textBlock = claudeData.content?.find((c: any) => c.type === 'text')
    const claudeRaw = textBlock?.text?.trim() ?? ''
    console.log('[ELOS] ===CLAUDE_RAW===', claudeRaw.slice(0, 500))

    let parsed: any = { action: 'ignore' }
    try {
      const clean = claudeRaw.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim()
      if (clean) parsed = JSON.parse(clean)
    } catch (e) {
      console.error('[ELOS] Claude parse falhou:', String(e), '| raw:', claudeRaw.slice(0, 200))
    }

    console.log('[ELOS] ===CLAUDE_PARSED===', JSON.stringify(parsed))

    if (parsed.action === 'ignore' || !parsed.note) {
      console.log('[ELOS] ===IGNORADO=== action:', parsed.action, 'note:', parsed.note)
      return ok({ action: 'ignored' })
    }

    let contactId: string | null = null

    if (parsed.contact_phone) {
      const phone = cleanPhone(parsed.contact_phone)
      const { data: c } = await supabase.from('contacts').select('id,role,company').eq('user_id', userId)
        .or(`whatsapp.eq.${phone},whatsapp.eq.55${phone}`).maybeSingle()
      if (c) {
        contactId = c.id
        // Enrich existing contact with role/company if not set yet
        const enrichFields: any = {}
        if (parsed.contact_role && !c.role) enrichFields.role = parsed.contact_role
        if (parsed.contact_company && !c.company) enrichFields.company = parsed.contact_company
        if (Object.keys(enrichFields).length > 0) {
          await supabase.from('contacts').update(enrichFields).eq('id', c.id)
          console.log('[ELOS] ===ENRIQUECEU_CONTATO===', JSON.stringify(enrichFields))
        }
      }
    }

    if (!contactId && parsed.contact_name) {
      const { data: c } = await supabase.from('contacts').select('id,role,company').eq('user_id', userId)
        .ilike('name', `%${parsed.contact_name}%`).maybeSingle()
      if (c) {
        contactId = c.id
        // Enrich existing contact with role/company if not set yet
        const enrichFields: any = {}
        if (parsed.contact_role && !c.role) enrichFields.role = parsed.contact_role
        if (parsed.contact_company && !c.company) enrichFields.company = parsed.contact_company
        if (Object.keys(enrichFields).length > 0) {
          await supabase.from('contacts').update(enrichFields).eq('id', c.id)
          console.log('[ELOS] ===ENRIQUECEU_CONTATO===', JSON.stringify(enrichFields))
        }
      }
    }

    if (!contactId && parsed.contact_name) {
      console.log('[ELOS] ===CRIANDO_CONTATO===', parsed.contact_name)
      const { data: newC, error: insertErr } = await supabase.from('contacts').insert({
        user_id: userId, name: parsed.contact_name,
        whatsapp: parsed.contact_phone ? cleanPhone(parsed.contact_phone) : null,
        role: parsed.contact_role || null,
        company: parsed.contact_company || null,
        notes: `Criado via WhatsApp — ${new Date().toLocaleDateString('pt-BR')}`,
      }).select('id').single()
      if (insertErr) console.error('[ELOS] ===ERRO_CONTATO===', JSON.stringify(insertErr))
      if (newC) contactId = newC.id
    }

    if (!contactId) {
      console.log('[ELOS] Sem contato identificado, ignorando')
      return ok({ action: parsed.action, error: 'no_contact' })
    }

    console.log('[ELOS] ===CONTATO_ID===', contactId)

    const now = new Date().toISOString()
    const { data: histRecord, error: histErr } = await supabase.from('contact_history').insert({
      contact_id: contactId, user_id: userId,
      contacted_at: now, channel: 'whatsapp', notes: parsed.note,
    }).select('id').single()
    if (histErr) console.error('[ELOS] ===ERRO_HISTORICO===', JSON.stringify(histErr))
    else console.log('[ELOS] ===HISTORICO_OK=== id:', histRecord?.id)

    const { data: cadence } = await supabase.from('cadences').select('id, interval_days')
      .eq('contact_id', contactId).maybeSingle()
    if (cadence) {
      await supabase.from('cadences').update({
        last_contacted_at: now,
        interval_days: parsed.cadence_days || cadence.interval_days
      }).eq('id', cadence.id)
    } else if (parsed.cadence_days) {
      await supabase.from('cadences').insert({
        contact_id: contactId, user_id: userId,
        interval_days: parsed.cadence_days, last_contacted_at: now,
      })
    }

    // ── Z-API Omni: send confirmation message ──────────────────────────────
    const zapiSecretKey = Deno.env.get('ZAPI_SECRET_KEY') || ''
    const confirmMsg = [
      `✅ *Registrado no Elos*`,
      `👤 ${parsed.contact_name || 'Contato'}`,
      `📝 ${parsed.note}`,
      parsed.cadence_days ? `📅 Próximo contato em ${parsed.cadence_days} dias` : ''
    ].filter(Boolean).join('\n')

    const recipientPhone = senderPhone.startsWith('55') ? senderPhone : `55${senderPhone}`

    console.log('[ELOS] ===ZAPI_DEBUG=== channelId:', channelId,
      '| secretKey:', zapiSecretKey ? zapiSecretKey.slice(0, 12) + '...' : 'N/A',
      '| recipient:', recipientPhone)

    let zapiStatus = 'not_attempted'
    let zapiError = ''

    if (channelId && zapiSecretKey) {
      try {
        const zapiResp = await fetch(`https://api.omni.z-api.io/v1/channels/${channelId}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${zapiSecretKey}`
          },
          body: JSON.stringify({
            recipient: { identifier: recipientPhone },
            content: { type: 'TEXT', body: { message: confirmMsg } }
          })
        })
        const zapiBody = await zapiResp.text()
        zapiStatus = String(zapiResp.status)
        console.log('[ELOS] ===ZAPI_STATUS===', zapiResp.status, zapiBody.slice(0, 400))
        if (zapiResp.ok) {
          console.log('[ELOS] ===ZAPI_SUCCESS=== Mensagem enviada!')
          return ok({ action: 'recorded', contactId, note: parsed.note, sent: true })
        } else {
          zapiError = zapiBody.slice(0, 300)
          console.error('[ELOS] ===ZAPI_FAIL=== status:', zapiResp.status, 'body:', zapiError)
        }
      } catch (zapiErr) {
        zapiStatus = 'network_error'
        zapiError = String(zapiErr)
        console.error('[ELOS] ===ZAPI_NETWORK_ERROR===', zapiError)
      }
    } else {
      zapiStatus = 'missing_config'
      zapiError = `channelId=${channelId || 'empty'} secretKey=${zapiSecretKey ? 'ok' : 'empty'}`
      console.log('[ELOS] ===ZAPI_SKIP=== Configuração incompleta:', zapiError)
    }

    // Store Z-API debug info in contact_history notes so it's visible in dashboard
    if (histRecord?.id && zapiStatus !== 'not_attempted') {
      await supabase.from('contact_history').update({
        notes: `${parsed.note} [ZAPI:${zapiStatus}${zapiError ? ' ERR:' + zapiError.slice(0, 100) : ''}]`
      }).eq('id', histRecord.id)
    }

    return ok({ action: 'recorded', contactId, note: parsed.note, zapi_status: zapiStatus, zapi_error: zapiError.slice(0, 100) })

  } catch (error) {
    console.error('[ELOS] Erro geral:', String(error))
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }
})

function ok(data: object) {
  return new Response(JSON.stringify({ ok: true, ...data }), { headers: { 'Content-Type': 'application/json' } })
}
