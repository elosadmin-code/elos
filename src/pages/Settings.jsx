import { supabase } from '../lib/supabase'
import './Settings.css'

export default function Settings({ user }) {
  async function handleLogout() {
    await supabase.auth.signOut()
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Configurações</h1>
      </div>

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
