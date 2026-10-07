import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'TavernSound — Uma mesa. Mil histórias.',
  description: 'Reúna seu grupo em um tabletop virtual com mapas, personagens e áudio espacial. Sua próxima aventura começa no TavernSound.',
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
