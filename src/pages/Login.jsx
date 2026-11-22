import { useState } from 'react'
import { supabase } from '../lib/supabase'
import './Login.css'

export default function Login() {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')

    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) setError(translateError(error.message))
      } else {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) setError(translateError(error.message))
        else setMessage('Conta criada! Verifique seu email para confirmar o cadastro antes de entrar.')
      }
    } catch {
      setError('Erro inesperado. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  function translateError(msg) {
    if (msg.includes('Invalid login credentials')) return 'Email ou senha incorretos.'
    if (msg.includes('Email not confirmed')) return 'Confirme seu email antes de entrar.'
    if (msg.includes('User already registered')) return 'Esse email já está cadastrado.'
    if (msg.includes('Password should be at least')) return 'A senha precisa ter pelo menos 6 caracteres.'
    return msg
  }

  function switchMode(next) {
    setMode(next)
    setError('')
    setMessage('')
  }

  return (
    <div className="login-bg">
      <div className="login-card">
        <div className="login-brand">
          <img
            src="/wordmark-brass.svg"
            alt="elos"
            className="login-wordmark"
          />
          <span className="login-tagline">relacionamento estratégico</span>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <input
            className="login-input"
            type="email"
            placeholder="seu@email.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <input
            className="login-input"
            type="password"
            placeholder="Senha"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
          />

          {error && <p className="login-error">{error}</p>}
          {message && <p className="login-success">{message}</p>}

          <button className="login-btn" type="submit" disabled={loading}>
            {loading ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Criar conta'}
          </button>
        </form>

        <p className="login-switch">
          {mode === 'login' ? (
            <>Não tem conta?{' '}
              <button type="button" onClick={() => switchMode('signup')}>Criar conta</button>
            </>
          ) : (
            <>Já tem conta?{' '}
              <button type="button" onClick={() => switchMode('login')}>Entrar</button>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
