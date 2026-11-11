import { describe, it, expect } from 'vitest'
import { formatDate, formatRegistrations, slugify, whatsappLink, initials } from '@/utils/format'

describe('utils/format', () => {
  it('formatDate não desloca a data sem fuso para o dia anterior', () => {
    expect(formatDate('2026-11-01')).toBe(formatDate('2026-11-01T12:00:00'))
    expect(formatDate('2026-11-01')).toContain('2026')
    expect(formatDate('não é data')).toBe('—')
  })

  it('formatRegistrations mostra traço quando não há fonte confirmada', () => {
    expect(formatRegistrations(undefined, 500)).toBe('—')
    expect(formatRegistrations(3, 500)).toBe('3 / 500')
    expect(formatRegistrations(4)).toBe('4')
    expect(formatRegistrations(0, 10)).toBe('0 / 10')
  })

  it('slugify remove acentos e normaliza para URL amigável', () => {
    expect(slugify('Congresso de Jovens 2026')).toBe('congresso-de-jovens-2026')
    expect(slugify('Ação Social — Natal')).toBe('acao-social-natal')
    expect(slugify('  Olá, Mundo!  ')).toBe('ola-mundo')
  })

  it('whatsappLink mantém apenas dígitos e codifica a mensagem', () => {
    expect(whatsappLink('(12) 99999-0001')).toBe('https://wa.me/12999990001')
    expect(whatsappLink('5512999990001', 'Olá!')).toBe('https://wa.me/5512999990001?text=Ol%C3%A1!')
  })

  it('initials usa as duas primeiras palavras', () => {
    expect(initials('Marcos Lima')).toBe('ML')
    expect(initials('Ana')).toBe('A')
    expect(initials('Maria das Graças Souza')).toBe('MD')
  })
})
