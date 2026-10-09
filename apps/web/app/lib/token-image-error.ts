export const TOKEN_IMAGE_FALLBACK = 'Não foi possível enviar a imagem. Tente novamente.'

const safeMessages = new Set([
  'Você não pode alterar a imagem deste token.',
  'A imagem deve ter no máximo 2 MB.',
  'Use uma imagem PNG, JPG ou WebP.',
  'Não foi possível processar esta imagem.',
  'Token não encontrado.',
  'Peça ao mestre para autorizar sua conta nesta sala.',
])

export function tokenImageError(status: number, payload: unknown): string {
  if (status === 413) return 'A imagem deve ter no máximo 2 MB.'
  const message = (payload as { message?: unknown } | null)?.message
  if ([400, 403, 404].includes(status) && typeof message === 'string' && safeMessages.has(message)) return message
  return TOKEN_IMAGE_FALLBACK
}
