import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import './Settings.css'

export default function Settings({ user }) {
  const [whatsapp, setWhatsapp] = useState('')
  const [savingWa, setSavingWa] = useState(false)
  const [waMsg, setWaMsg] = useState('')
  const [loadingProfile, setLoadingProfile] = useState(true)

  useEffect(() => {
    async function loadProfile() {
      const { data } = await supabase
        .from('profiles')
        .select('whatsapp_number')
        .eq('id', user.id)
        .maybeSingle()
      if (data?.whatsapp_number) setWhatsapp(data.whatsapp_number)
      setLoadingProfile(false)
    }
    if (user?.id) loadProfile()
  }, [user?.id])

  async function handleSaveWhatsapp(e) {
    e.preventDefault()
    setSavingWa(true)
    setWaMsg('')
    try {
      const clean = whatsapp.replace(/\D/g, '')
      const { error } = await supabase
        .from('profiles')
        .upsert({ id: user.id, whatsapp_number: clean }, { onConflict: 'id' })
      if (error) {
        setWaMsg('Erro: ' + error.message)
      } else {
        setWaMsg('Número salvo com sucesso!')
        setTimeout(() => setWaMsg(''), 3000)
      }
    } finally {
      setSavingWa(false)
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut()
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Configurações</h1>
      </div>

      {/* WhatsApp */}
      <div className="settings-section">
        <h2 className="settings-section-title">WhatsApp</h2>
        <div className="settings-card">
          <div className="settings-wa-block">
            <p className="settings-wa-desc">
              Número de WhatsApp que você usa para mandar mensagens de voz e texto para o Elos.
              Use o formato com DDI: <strong>5511999998888</strong>
            </p>
            {loadingProfile ? (
              <p className="settings-hint">Carregando...</p>
            ) : (
              <form className="settings-wa-form" onSubmit={handleSaveWhatsapp}>
                <input
                  className="settings-wa-input"
                  type="tel"
                  value={whatsapp}
                  onChange={e => setWhatsapp(e.target.value)}
                  placeholder="5511999998888"
                />
                <button className="settings-wa-btn" type="submit" disabled={savingWa || !whatsapp.trim()}>
                  {savingWa ? 'Salvando...' : 'Salvar'}
                </button>
              </form>
            )}
            {waMsg && <p className={'settings-wa-msg' + (waMsg.startsWith('Erro') ? ' error' : ' success')}>{waMsg}</p>}
          </div>
        </div>
      </div>

      {/* Conta */}
      <div className="settings-section">
        <h2 className="settings-section-title">Conta</h2>
        <div className="settings-card">
          <div className="settings-row">
            <span className="settings-label">E-mail</span>
            <span className="settings-value">{user?.email}</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">ID</span>
            <span className="settings-value settings-mono">{user?.id?.slice(0, 8)}…</span>
          </div>
        </div>
      </div>

      {/* Sobre */}
      <div className="settings-section">
        <h2 className="settings-section-title">Sobre</h2>
        <div className="settings-card">
          <div className="settings-row">
            <span className="settings-label">Versão</span>
            <span className="settings-value">0.1.0 — beta</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">Produto</span>
            <span className="settings-value">Elos CRM</span>
          </div>
        </div>
      </div>

      {/* Zona de perigo */}
      <div className="settings-section">
        <h2 className="settings-section-title settings-danger-title">Zona de perigo</h2>
        <div className="settings-card settings-danger-card">
          <div className="settings-row settings-row-action">
            <div>
              <div className="settings-label">Sair da conta</div>
              <div className="settings-hint">Você precisará fazer login novamente.</div>
            </div>
            <button className="btn-danger" onClick={handleLogout}>Sair</button>
          </div>
        </div>
      </div>
    </div>
  )
}
