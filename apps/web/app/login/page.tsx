// apps/web/app/login/page.tsx

"use client"

import { Suspense, useState, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { safeReturnPath } from '../lib/auth-security'

export default function LoginPage() {
  return <Suspense fallback={<p role="status">Carregando login…</p>}><LoginForm /></Suspense>
}

function LoginForm() {
  const searchParams = useSearchParams()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (searchParams.get('registered') === 'true') {
      setSuccess("✅ Conta criada com sucesso! Faça login.")
    }
    
    const errorParam = searchParams.get('error')
    if (errorParam) {
      const errorMessages: Record<string, string> = {
        'CredentialsSignin': 'Email ou senha incorretos',
        'OAuthSignin': 'Erro ao fazer login com Google',
        'OAuthCallback': 'Erro no callback do Google',
        'OAuthCreateAccount': 'Erro ao criar conta com Google',
        'EmailCreateAccount': 'Erro ao criar conta',
        'Callback': 'Erro no callback',
        'OAuthAccountNotLinked': 'Email já cadastrado com outro método',
        'EmailSignin': 'Erro ao enviar email',
        'SessionRequired': 'Você precisa estar logado',
        'Default': 'Erro ao fazer login. Tente novamente.'
      }
      setError(errorMessages[errorParam] || errorMessages['Default'])
    }
  }, [searchParams])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSuccess("")
    setLoading(true)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20000)

    try {
      // Usa fetch direto em vez de signIn do NextAuth
      const callbackUrl = searchParams.get('callbackUrl') || '/rooms'
      const response = await fetch('/api/auth/callback/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, callbackUrl }),
        credentials: 'same-origin',
        signal: controller.signal,
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || "❌ Email ou senha incorretos")
        setLoading(false)
        return
      }

      if (data.success) {
        const sessionResponse = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
        if (!sessionResponse.ok) throw new Error('Não foi possível confirmar a sessão. Tente novamente.')
        const session = await sessionResponse.json()
        if (!session.user) throw new Error('O navegador não manteve a sessão. Verifique se os cookies estão permitidos e se o certificado HTTPS está instalado como confiável.')
        window.location.assign(safeReturnPath(data.url || '/rooms'))
      } else {
        setError("❌ Email ou senha incorretos")
        setLoading(false)
      }
      
    } catch (err) {
      setError(controller.signal.aborted
        ? 'O servidor demorou para responder. Verifique a conexão com o notebook e tente novamente.'
        : err instanceof Error ? err.message : 'Não foi possível entrar. Tente novamente.')
    } finally {
      clearTimeout(timeout)
      setLoading(false)
    }
  }

  const handleGoogleLogin = async () => {
    setError("")
    // ✅ Usa a ação "signin" do NextAuth diretamente
    const callbackUrl = searchParams.get('callbackUrl') || '/rooms'
    window.location.href = `/api/auth/google?callbackUrl=${encodeURIComponent(callbackUrl)}`
  }

  return (
    <div style={{ 
      minHeight: "100vh", 
      display: "flex", 
      alignItems: "center", 
      justifyContent: "center",
      background: "#0a0a0a"
    }}>
      <div style={{
        background: "#1a1a1a",
        padding: "2rem",
        borderRadius: "8px",
        width: "100%",
        maxWidth: "400px",
        border: "1px solid #333"
      }}>
        <h1 style={{ marginBottom: "1.5rem", color: "#fff", textAlign: "center" }}>
          🎲 Login - TavernSound VTT
        </h1>

        {/* Botão Google */}
        <button
          onClick={handleGoogleLogin}
          type="button"
          style={{
            width: "100%",
            padding: "0.75rem",
            background: "#fff",
            color: "#000",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "1rem",
            fontWeight: "bold",
            marginBottom: "1.5rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem"
          }}
        >
          <svg width="18" height="18" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Continuar com Google
        </button>

        <div style={{ 
          textAlign: "center", 
          margin: "1rem 0", 
          color: "#666",
          position: "relative"
        }}>
          <span style={{ 
            background: "#1a1a1a", 
            padding: "0 0.5rem",
            position: "relative",
            zIndex: 1
          }}>
            ou
          </span>
          <div style={{
            position: "absolute",
            top: "50%",
            left: 0,
            right: 0,
            height: "1px",
            background: "#333",
            zIndex: 0
          }} />
        </div>

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", color: "#ccc" }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              style={{
                width: "100%",
                padding: "0.75rem",
                background: "#0a0a0a",
                border: "1px solid #333",
                borderRadius: "4px",
                color: "#fff"
              }}
            />
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", color: "#ccc" }}>
              Senha
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              style={{
                width: "100%",
                padding: "0.75rem",
                background: "#0a0a0a",
                border: "1px solid #333",
                borderRadius: "4px",
                color: "#fff"
              }}
            />
          </div>

          {success && (
            <div style={{
              padding: "0.75rem",
              marginBottom: "1rem",
              background: "#047857",
              color: "#fff",
              borderRadius: "4px",
              fontSize: "0.9rem"
            }}>
              {success}
            </div>
          )}

          {error && (
            <div style={{
              padding: "0.75rem",
              marginBottom: "1rem",
              background: "#991111",
              color: "#fff",
              borderRadius: "4px",
              fontSize: "0.9rem"
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "0.75rem",
              background: "#3b82f6",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: loading ? "not-allowed" : "pointer",
              fontSize: "1rem",
              fontWeight: "bold",
              opacity: loading ? 0.6 : 1
            }}
          >
            {loading ? "Entrando..." : "Entrar com Email"}
          </button>
        </form>

        <div style={{ 
          marginTop: "1.5rem", 
          textAlign: "center", 
          color: "#999",
          fontSize: "0.9rem"
        }}>
          Não tem conta?{" "}
          <a 
            href="/register" 
            style={{ color: "#3b82f6", textDecoration: "none", fontWeight: "bold" }}
          >
            Cadastre-se
          </a>
        </div>
      </div>
    </div>
  )
}

