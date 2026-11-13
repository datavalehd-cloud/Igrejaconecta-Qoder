import type { Registration, RegistrationStats } from '@/types'

/**
 * O banco promove qualquer inscrição não cancelada a `presente` na RPC
 * `check_in_registration` — inclusive a da lista de espera, porque a promoção
 * não tem trava de capacidade (0012). A decisão do balcão é não fazer isso em
 * silêncio: a tela avisa que a pessoa não tinha vaga garantida e exige um clique
 * explícito antes de gravar. Quem confirma é o operador, com o nome na frente.
 */
export type QueueAdmission = {
  /** `true`: a tela não pode chamar a RPC antes de uma confirmação explícita. */
  needsConfirmation: boolean
  /** Texto do aviso; vazio quando não há o que confirmar. */
  text: string
}

export function waitlistAdmission(
  registration: Pick<Registration, 'status' | 'visitor_name'>,
  stats?: RegistrationStats | null,
): QueueAdmission {
  if (registration.status !== 'waitlist') return { needsConfirmation: false, text: '' }
  return { needsConfirmation: true, text: queueText(registration.visitor_name, stats) }
}

/** A ocupação só aparece com os números da view; sem eles o aviso não chuta nada. */
export function queueText(name: string, stats?: RegistrationStats | null): string {
  const situation = !stats
    ? ''
    : stats.capacity === null
      ? ' O evento não tem capacidade definida.'
      : ` No check-in, ${stats.checked_in_count} de ${stats.capacity} lugares já foram marcados.`
  return `${name} está na lista de espera: não tinha vaga garantida quando se inscreveu.${situation} `
    + 'Confirmar a admissão marca a presença e tira a pessoa da fila.'
}
