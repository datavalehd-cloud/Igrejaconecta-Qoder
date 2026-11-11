import { useState } from 'react'
import { Heart, CalendarDays } from 'lucide-react'
import { PageHeader, Card, CardHeader, CardBody, Button, Field, Input, Select, EmptyState } from '@/components/common/primitives'
import { EventCard } from '@/components/common/Cards'
import { events } from '@/data/mock'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'

/**
 * Fase 3 — Perfil do visitante e favoritos.
 * Cadastro opcional: visitantes podem navegar sem conta e salvar preferências.
 */
export function VisitorProfilePage() {
  useDocumentMeta({ title: 'Meu perfil de visitante', path: '/visitante/perfil' })
  const [saved, setSaved] = useState(false)
  const favorites = events.filter((e) => e.status === 'published').slice(0, 2)

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <PageHeader title="Meu perfil de visitante" subtitle="Cadastro opcional para salvar favoritos e preferências de eventos." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Dados" subtitle="Todos os campos são opcionais." />
          <CardBody className="space-y-4">
            <Field label="Nome"><Input placeholder="Seu nome" /></Field>
            <Field label="E-mail"><Input type="email" placeholder="voce@email.com" /></Field>
            <Field label="Telefone"><Input placeholder="(00) 00000-0000" /></Field>
            <Field label="Cidade"><Input placeholder="Sua cidade" /></Field>
            <Field label="Interesses">
              <Select>
                <option>Jovens</option>
                <option>Família / Casais</option>
                <option>Mulheres</option>
                <option>Homens</option>
                <option>Ação social</option>
              </Select>
            </Field>
            {saved ? (
              <p className="text-sm font-medium text-green-700">Preferências salvas (demo).</p>
            ) : (
              <Button onClick={() => setSaved(true)}>Salvar preferências</Button>
            )}
          </CardBody>
        </Card>

        <div>
          <h2 className="mb-3 inline-flex items-center gap-2 font-semibold text-navy">
            <Heart className="h-4 w-4 text-red-500" /> Meus favoritos
          </h2>
          {favorites.length === 0 ? (
            <EmptyState icon={<Heart className="h-8 w-8" />} title="Nenhum favorito ainda" description="Toque no coração em um evento para salvá-lo aqui." />
          ) : (
            <div className="space-y-4">
              {favorites.map((e) => <EventCard key={e.id} event={e} />)}
            </div>
          )}

          <h2 className="mt-8 mb-3 inline-flex items-center gap-2 font-semibold text-navy">
            <CalendarDays className="h-4 w-4 text-brand-600" /> Minhas inscrições
          </h2>
          <EmptyState title="Sem inscrições" description="Quando você se inscrever em um evento, o QR Code e o histórico aparecem aqui." />
        </div>
      </div>
    </div>
  )
}
