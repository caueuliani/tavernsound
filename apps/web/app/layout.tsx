import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Tavern Sound',
  description: 'Virtual Tabletop with Spatial Audio',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR">
      <body style={{ 
        margin: 0, 
        padding: 0, 
        fontFamily: 'Arial, sans-serif',
        backgroundColor: '#1a1a1a'
      }}>
        {children}
      </body>
    </html>
  )
}