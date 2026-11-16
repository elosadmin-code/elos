import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import Login from './pages/Login'

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0F1A14'
      }}>
        <span style={{ color: '#B69A65', fontFamily: 'Outfit, sans-serif', fontSize: '24px' }}>·</span>
      </div>
    )
  }

  if (!user) return <Login />

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0F1A14',
      color: '#E8E4DC',
      fontFamily: 'Outfit, sans-serif',
      padding: '48px 32px'
    }}>
      <h1 style={{
        fontFamily: 'Syne, sans-serif',
        fontWeight: 700,
        fontSize: '36px',
        color: '#B69A65',
        marginBottom: '8px'
      }}>
        elos
      </h1>
      <p style={{ color: '#7A8C7E', marginBottom: '32px' }}>
        Olá, {user.email}
      </p>
      <button
        onClick={() => supabase.auth.signOut()}
        style={{
          padding: '10px 20px',
          background: 'transparent',
          border: '1px solid #2A3D2E',
          color: '#7A8C7E',
          borderRadius: '8px',
          cursor: 'pointer',
          fontFamily: 'Outfit, sans-serif',
          fontSize: '14px'
        }}
      >
        Sair
      </button>
    </div>
  )
}

export default App