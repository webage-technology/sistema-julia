import { redirect } from 'next/navigation'

// A raiz leva para o painel: o que precisa de atenção hoje.
export default function Home() {
  redirect('/painel')
}
