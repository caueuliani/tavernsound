"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export default function RegisterPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      // 1. Cria a conta
      const regRes = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      })

      const regData = await regRes.json()

      if (!regRes.ok) {
        setError(regData.error || "Erro ao criar conta")
        return
      }

      // 2. Login automático via o mesmo endpoint de credentials
      const loginRes = await fetch("/api/auth/callback/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, callbackUrl: "/" }),
      })

      const loginData = await loginRes.json()

      if (!loginRes.ok) {
        // Conta criada mas login falhou — envia para login com banner
        router.push("/login?registered=true")
        return
      }

      router.push(loginData.url || "/")
      router.refresh()
    } catch {
      setError("Erro ao criar conta")
    } finally {
      setLoading(false)
    }
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
        <h1 style={{ marginBottom: "1.5rem", color: "#fff" }}>
          🎲 Criar Conta - TavernSound VTT
        </h1>

        <form onSubmit={handleRegister}>
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", color: "#ccc" }}>
              Nome
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
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
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
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
              minLength={6}
              style={{
                width: "100%",
                padding: "0.75rem",
                background: "#0a0a0a",
                border: "1px solid #333",
                borderRadius: "4px",
                color: "#fff"
              }}
            />
            <small style={{ color: "#999" }}>Mínimo 6 caracteres</small>
          </div>

          {error && (
            <div style={{
              padding: "0.75rem",
              marginBottom: "1rem",
              background: "#991111",
              color: "#fff",
              borderRadius: "4px"
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
              background: "#10b981",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: loading ? "not-allowed" : "pointer",
              fontSize: "1rem",
              fontWeight: "bold"
            }}
          >
            {loading ? "Criando..." : "Criar Conta (FREE)"}
          </button>
        </form>

        <div style={{ 
          marginTop: "1.5rem", 
          textAlign: "center", 
          color: "#999" 
        }}>
          Já tem conta?{" "}
          <a 
            href="/login" 
            style={{ color: "#3b82f6", textDecoration: "none" }}
          >
            Fazer login
          </a>
        </div>
      </div>
    </div>
  )
}